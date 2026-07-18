import * as esbuild from 'esbuild-wasm'
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url'

let initPromise: Promise<void> | null = null

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({ wasmURL: esbuildWasmUrl, worker: true })
  }
  return initPromise
}

export interface BundleFile {
  path: string
  content: string
}

export interface BundleResult {
  code: string
  /** Bare npm package roots the code imports (e.g. "react", "@scope/pkg"). */
  packages: string[]
}

/**
 * Bundles a local entry file against the on-device virtual filesystem.
 * Local files are bundled inline; bare npm imports (e.g. "react") are kept
 * external so the browser can load them from esm.sh via an import map. This
 * lets real library-based apps (React, etc.) run in the preview.
 */
export async function bundleForPreview(entryPath: string, files: BundleFile[]): Promise<BundleResult> {
  await ensureInit()
  const fileMap = new Map(files.map((f) => [f.path, f.content]))
  const packages = new Set<string>()

  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [virtualFsPlugin(fileMap, packages)],
    logLevel: 'silent',
  })

  return { code: result.outputFiles[0].text, packages: [...packages] }
}

/** Extracts the importable package root: "react/jsx-runtime" → "react", "@a/b/c" → "@a/b". */
function packageRoot(specifier: string): string {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/')
  return parts[0]
}

function virtualFsPlugin(fileMap: Map<string, string>, packages: Set<string>): esbuild.Plugin {
  return {
    name: 'virtual-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return { path: normalizePath(args.path), namespace: 'vfs' }
        }
        // Bare specifier (npm package) — keep external, load via import map.
        if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
          packages.add(packageRoot(args.path))
          return { path: args.path, external: true }
        }
        const dir = args.importer.slice(0, args.importer.lastIndexOf('/'))
        const resolved = normalizePath(`${dir}/${args.path}`)
        const match = resolveWithExtension(resolved, fileMap)
        if (!match) return { errors: [{ text: `File not found: ${resolved}` }] }
        return { path: match, namespace: 'vfs' }
      })

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
        const content = fileMap.get(args.path)
        if (content === undefined) return { errors: [{ text: `File not found: ${args.path}` }] }
        const ext = args.path.split('.').pop() ?? 'js'
        const knownLoaders: esbuild.Loader[] = ['ts', 'tsx', 'js', 'jsx', 'css', 'json']
        const loader = (knownLoaders as string[]).includes(ext) ? (ext as esbuild.Loader) : 'text'
        return { contents: content, loader }
      })
    },
  }
}

function normalizePath(path: string): string {
  const stack: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return `/${stack.join('/')}`
}

function resolveWithExtension(path: string, fileMap: Map<string, string>): string | null {
  if (fileMap.has(path)) return path
  for (const ext of ['.tsx', '.ts', '.jsx', '.js', '.css']) {
    if (fileMap.has(path + ext)) return path + ext
  }
  for (const ext of ['/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
    if (fileMap.has(path + ext)) return path + ext
  }
  return null
}

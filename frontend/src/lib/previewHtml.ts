import { bundleForPreview, type BundleFile } from './bundler'

const CONSOLE_BRIDGE = `
<script>
  (function () {
    const send = (level, args) => {
      try {
        window.parent.postMessage(
          { source: 'codeide-preview', level, text: args.map(a => {
            try { return typeof a === 'string' ? a : JSON.stringify(a) } catch { return String(a) }
          }).join(' ') },
          '*'
        )
      } catch {}
    }
    ;['log', 'info', 'warn', 'error'].forEach((level) => {
      const orig = console[level]
      console[level] = (...args) => { send(level, args); orig.apply(console, args) }
    })
    window.addEventListener('error', (e) => send('error', [e.message + ' (' + e.filename + ':' + e.lineno + ')']))
    window.addEventListener('unhandledrejection', (e) => send('error', ['Unhandled rejection: ' + e.reason]))
  })()
</script>
`

const SCRIPT_SRC_RE = /<script[^>]*\ssrc=["'](\.\/[^"']+|\/[^"']+)["'][^>]*><\/script>/gi

/** Builds an ES import map that points bare npm package roots at esm.sh. */
function importMap(packages: string[]): string {
  if (packages.length === 0) return ''
  const imports: Record<string, string> = {}
  for (const pkg of packages) {
    imports[pkg] = `https://esm.sh/${pkg}`
    imports[`${pkg}/`] = `https://esm.sh/${pkg}/`
  }
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`
}

/** Builds a preview document that runs Python on-device via Pyodide (WASM). */
function buildPythonDoc(entryPath: string, files: BundleFile[]): string {
  const pyFiles: Record<string, string> = {}
  for (const file of files) {
    if (file.path.endsWith('.py')) pyFiles[file.path.split('/').pop() as string] = file.content
  }
  const entryName = entryPath.split('/').pop() as string
  const payload = JSON.stringify({ files: pyFiles, entry: entryName })
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    ${CONSOLE_BRIDGE}
    <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
    <style>body{font-family:-apple-system,sans-serif;margin:0;padding:12px;background:#0b0d12;color:#e8e8ef}</style>
  </head>
  <body>
    <script type="module">
      const data = ${payload}
      console.log('Python ачааллаж байна... (эхний удаа хэдэн секунд болно)')
      async function main() {
        try {
          const pyodide = await loadPyodide()
          pyodide.setStdout({ batched: (s) => console.log(s) })
          pyodide.setStderr({ batched: (s) => console.error(s) })
          for (const [name, content] of Object.entries(data.files)) pyodide.FS.writeFile(name, content)
          await pyodide.runPythonAsync(data.files[data.entry])
        } catch (err) {
          console.error(String(err))
        }
      }
      main()
    </script>
  </body>
</html>`
}

/** Builds the full HTML document to load into the sandboxed preview iframe. */
export async function buildPreviewDoc(entryPath: string, files: BundleFile[]): Promise<string> {
  if (entryPath.endsWith('.py')) {
    return buildPythonDoc(entryPath, files)
  }

  if (entryPath.endsWith('.html')) {
    const fileMap = new Map(files.map((f) => [f.path, f.content]))
    const raw = fileMap.get(entryPath) ?? ''
    const dir = entryPath.slice(0, entryPath.lastIndexOf('/')) || ''

    let html = raw
    const allPackages = new Set<string>()
    const matches = [...raw.matchAll(SCRIPT_SRC_RE)]
    for (const m of matches) {
      const src = m[1]
      const resolved = src.startsWith('/') ? src : `${dir}/${src}`
      let script: string
      try {
        const result = await bundleForPreview(resolved, files)
        result.packages.forEach((pkg) => allPackages.add(pkg))
        script = `<script type="module">${result.code}</script>`
      } catch (err) {
        script = `<script>console.error(${JSON.stringify(`Bundle error in ${resolved}: ${String(err)}`)})</script>`
      }
      html = html.replace(m[0], script)
    }
    return injectHead(html, importMap([...allPackages]))
  }

  let scriptTag: string
  let map = ''
  try {
    const result = await bundleForPreview(entryPath, files)
    map = importMap(result.packages)
    scriptTag = `<script type="module">${result.code}</script>`
  } catch (err) {
    scriptTag = `<script>console.error(${JSON.stringify(`Bundle error: ${String(err)}`)})</script>`
  }
  return injectHead(
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>body{font-family:-apple-system,sans-serif;margin:0;padding:12px;background:#0b0d12;color:#e8e8ef}</style></head>
  <body>
    <div id="root"></div>
    ${scriptTag}
  </body>
</html>`,
    map,
  )
}

/** Injects the console bridge and (import map) into <head>, in the right order. */
function injectHead(html: string, extra: string): string {
  const head = `${CONSOLE_BRIDGE}${extra}`
  if (html.includes('<head>')) return html.replace('<head>', `<head>${head}`)
  return head + html
}

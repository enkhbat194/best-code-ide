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

/** Builds the full HTML document to load into the sandboxed preview iframe. */
export async function buildPreviewDoc(entryPath: string, files: BundleFile[]): Promise<string> {
  if (entryPath.endsWith('.html')) {
    const fileMap = new Map(files.map((f) => [f.path, f.content]))
    const raw = fileMap.get(entryPath) ?? ''
    const dir = entryPath.slice(0, entryPath.lastIndexOf('/')) || ''

    let html = raw
    const matches = [...raw.matchAll(SCRIPT_SRC_RE)]
    for (const m of matches) {
      const src = m[1]
      const resolved = src.startsWith('/') ? src : `${dir}/${src}`
      let code: string
      try {
        code = await bundleForPreview(resolved, files)
      } catch (err) {
        code = `console.error(${JSON.stringify(`Bundle error in ${resolved}: ${String(err)}`)})`
      }
      html = html.replace(m[0], `<script>${code}</script>`)
    }
    return injectConsoleBridge(html)
  }

  let code: string
  try {
    code = await bundleForPreview(entryPath, files)
  } catch (err) {
    code = `console.error(${JSON.stringify(`Bundle error: ${String(err)}`)})`
  }
  return injectConsoleBridge(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>body{font-family:-apple-system,sans-serif;margin:0;padding:12px;background:#0b0d12;color:#e8e8ef}</style></head>
  <body>
    <div id="root"></div>
    <script>${code}</script>
  </body>
</html>`)
}

function injectConsoleBridge(html: string): string {
  if (html.includes('<head>')) return html.replace('<head>', `<head>${CONSOLE_BRIDGE}`)
  return CONSOLE_BRIDGE + html
}

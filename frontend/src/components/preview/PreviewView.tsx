import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { useFsStore } from '../../store/fsStore'
import { readFile } from '../../lib/fs'
import { buildPreviewDoc } from '../../lib/previewHtml'
import styles from './PreviewView.module.css'

const RUNNABLE_EXT = ['html', 'js', 'jsx', 'ts', 'tsx']

interface ConsoleLine {
  level: string
  text: string
}

export function PreviewView() {
  const { files, refresh } = useFsStore()
  const [entry, setEntry] = useState('')
  const [srcDoc, setSrcDoc] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [refresh])

  const runnable = files.filter((f) => !f.isDir && RUNNABLE_EXT.includes(f.path.split('.').pop() ?? ''))

  useEffect(() => {
    if (!entry && runnable.length > 0) setEntry(runnable[0].path)
  }, [runnable, entry])

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.source === 'codeide-preview') {
        setLogs((l) => [...l.slice(-199), { level: e.data.level, text: e.data.text }])
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const run = async () => {
    if (!entry) return
    setRunning(true)
    setError(null)
    setLogs([])
    try {
      const contents = await Promise.all(
        files
          .filter((f) => !f.isDir)
          .map(async (f) => ({ path: f.path, content: await readFile(f.path) })),
      )
      const doc = await buildPreviewDoc(entry, contents)
      setSrcDoc(doc)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  if (runnable.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          Ажиллуулах боломжтой файл алга (.html / .js / .jsx / .ts / .tsx). Files tab-с файл нэмнэ үү.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <select value={entry} onChange={(e) => setEntry(e.target.value)}>
          {runnable.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <button onClick={run} disabled={running}>
          <Play size={13} /> {running ? '...' : 'Run'}
        </button>
      </div>
      <div className={styles.frameWrap}>
        {srcDoc && <iframe title="preview" sandbox="allow-scripts" srcDoc={srcDoc} />}
      </div>
      <div className={`${styles.console} scroll-y`}>
        {error && <div className={`${styles.consoleLine} ${styles.error}`}>{error}</div>}
        {logs.map((l, i) => (
          <div key={i} className={`${styles.consoleLine} ${l.level === 'error' ? styles.error : l.level === 'warn' ? styles.warn : ''}`}>
            {l.text}
          </div>
        ))}
        {!error && logs.length === 0 && <div className={styles.consoleLine}>Console гарц энд харагдана.</div>}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { DownloadCloud, Play, RefreshCw } from 'lucide-react'
import { useFsStore } from '../../store/fsStore'
import { readFile } from '../../lib/fs'
import { buildPreviewDoc } from '../../lib/previewHtml'
import { importGitHubWorkspace } from '../../lib/workspace'
import styles from './PreviewView.module.css'

const RUNNABLE_EXT = ['html', 'js', 'jsx', 'ts', 'tsx', 'py']

interface ConsoleLine {
  level: string
  text: string
}

interface WorkspaceFile {
  path: string
  isDir: boolean
}

function pickDefaultEntry(files: WorkspaceFile[]): string {
  const runnable = files.filter((file) => !file.isDir && RUNNABLE_EXT.includes(file.path.split('.').pop() ?? ''))
  const preferred = ['index.html', '/index.html', 'src/main.tsx', '/src/main.tsx', 'src/main.jsx', '/src/main.jsx', 'src/App.tsx', '/src/App.tsx']

  for (const candidate of preferred) {
    const match = runnable.find((file) => file.path === candidate)
    if (match) return match.path
  }

  return runnable[0]?.path ?? ''
}

export function PreviewView() {
  const { files, refresh } = useFsStore()
  const [entry, setEntry] = useState('')
  const [srcDoc, setSrcDoc] = useState('')
  const [running, setRunning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runnable = files.filter((file) => !file.isDir && RUNNABLE_EXT.includes(file.path.split('.').pop() ?? ''))

  useEffect(() => {
    if (!entry && runnable.length > 0) setEntry(pickDefaultEntry(runnable))
  }, [runnable, entry])

  useEffect(() => {
    function handler(event: MessageEvent) {
      if (event.data?.source === 'codeide-preview') {
        setLogs((current) => [...current.slice(-199), { level: event.data.level, text: event.data.text }])
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const runFiles = async (selectedEntry: string, selectedFiles = useFsStore.getState().files) => {
    if (!selectedEntry) throw new Error('Preview entry файл олдсонгүй')
    setRunning(true)
    setError(null)
    setLogs([])
    try {
      const contents = await Promise.all(
        selectedFiles
          .filter((file) => !file.isDir)
          .map(async (file) => ({ path: file.path, content: await readFile(file.path) })),
      )
      const doc = await buildPreviewDoc(selectedEntry, contents)
      setEntry(selectedEntry)
      setSrcDoc(doc)
    } finally {
      setRunning(false)
    }
  }

  const run = async () => {
    if (!entry) return
    setStatus(null)
    try {
      await runFiles(entry, files)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const importAndRun = async () => {
    setImporting(true)
    setStatus(null)
    setError(null)
    try {
      const result = await importGitHubWorkspace(120)
      await refresh()
      const importedFiles = useFsStore.getState().files
      const selectedEntry = pickDefaultEntry(importedFiles)
      if (!selectedEntry) {
        throw new Error('Repository импортлогдсон боловч preview хийх .html/.js/.jsx/.ts/.tsx/.py файл олдсонгүй')
      }
      await runFiles(selectedEntry, importedFiles)
      const truncated = result.truncated ? ` Нийт ${result.eligibleCount} файлаас ${result.importedCount}-г татсан.` : ''
      const errors = result.errorCount > 0 ? ` ${result.errorCount} файл татагдсангүй.` : ''
      setStatus(`GitHub repository татагдаж preview шинэчлэгдлээ.${truncated}${errors}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.githubButton} onClick={() => void importAndRun()} disabled={importing || running}>
          {importing ? <RefreshCw className={styles.spin} size={14} /> : <DownloadCloud size={14} />}
          {importing ? 'Татаж байна...' : 'GitHub repo'}
        </button>
        <select value={entry} onChange={(event) => setEntry(event.target.value)} disabled={runnable.length === 0}>
          {runnable.length === 0 && <option value="">Entry файл алга</option>}
          {runnable.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
        <button onClick={() => void run()} disabled={running || !entry}>
          <Play size={13} /> {running ? '...' : 'Run'}
        </button>
      </div>
      {status && <div className={styles.status}>{status}</div>}
      {runnable.length === 0 && !srcDoc ? (
        <div className={styles.empty}>
          <strong>GitHub repo</strong> товчийг дарж Settings-д сонгосон repository/branch-ийг татан шууд preview хийнэ.
        </div>
      ) : (
        <>
          <div className={styles.frameWrap}>{srcDoc && <iframe title="preview" sandbox="allow-scripts" srcDoc={srcDoc} />}</div>
          <div className={`${styles.console} scroll-y`}>
            {error && <div className={`${styles.consoleLine} ${styles.error}`}>{error}</div>}
            {logs.map((line, index) => (
              <div key={index} className={`${styles.consoleLine} ${line.level === 'error' ? styles.error : line.level === 'warn' ? styles.warn : ''}`}>
                {line.text}
              </div>
            ))}
            {!error && logs.length === 0 && <div className={styles.consoleLine}>Console гарц энд харагдана.</div>}
          </div>
        </>
      )}
    </div>
  )
}

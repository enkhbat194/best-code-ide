import { useEffect, useMemo, useState } from 'react'
import { DownloadCloud, Lock, Play, RefreshCw, Search, X } from 'lucide-react'
import { useFsStore } from '../../store/fsStore'
import { readFile } from '../../lib/fs'
import { buildPreviewDoc } from '../../lib/previewHtml'
import { fetchGitHubPreviewWorkspace } from '../../lib/previewWorkspace'
import {
  listGitHubRepositories,
  type GitHubRepositorySummary,
} from '../../lib/workspace'
import type { BundleFile } from '../../lib/bundler'
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

function entryScore(path: string): number {
  const normalized = path.replace(/^\/+/, '')
  const lower = normalized.toLowerCase()
  const depth = normalized.split('/').length
  let score = 0

  if (lower === 'index.html') score = 1000
  else if (lower.endsWith('/index.html')) score = 950
  else if (/^src\/main\.(tsx|jsx|ts|js)$/.test(lower)) score = 900
  else if (lower.endsWith('/src/main.tsx') || lower.endsWith('/src/main.jsx')) score = 860
  else if (/^src\/app\.(tsx|jsx|ts|js)$/.test(lower)) score = 800
  else if (lower.endsWith('/src/app.tsx') || lower.endsWith('/src/app.jsx')) score = 760
  else if (/^main\.(tsx|jsx|ts|js|py)$/.test(lower)) score = 700
  else if (/^app\.(tsx|jsx|ts|js|py)$/.test(lower)) score = 650
  else score = 100

  if (/(^|\/)(frontend|client|web|site)(\/|$)/.test(lower)) score += 80
  if (/(^|\/)(backend|server|api|test|tests|spec|scripts)(\/|$)/.test(lower)) score -= 300
  return score - depth
}

function pickDefaultEntry(files: WorkspaceFile[]): string {
  const runnable = files
    .filter((file) => !file.isDir && RUNNABLE_EXT.includes(file.path.split('.').pop()?.toLowerCase() ?? ''))
    .sort((a, b) => entryScore(b.path) - entryScore(a.path))
  return runnable[0]?.path ?? ''
}

function bundleMetadata(files: BundleFile[]): WorkspaceFile[] {
  return files.map((file) => ({ path: file.path, isDir: false }))
}

export function PreviewView() {
  const { files, refresh } = useFsStore()
  const [entry, setEntry] = useState('')
  const [srcDoc, setSrcDoc] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([])
  const [selectedRepository, setSelectedRepository] = useState<GitHubRepositorySummary | null>(null)
  const [previewFiles, setPreviewFiles] = useState<BundleFile[]>([])
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const [loadingRepositories, setLoadingRepositories] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeFiles = useMemo<WorkspaceFile[]>(
    () => selectedRepository ? bundleMetadata(previewFiles) : files,
    [files, previewFiles, selectedRepository],
  )

  const runnable = useMemo(
    () => activeFiles.filter((file) => !file.isDir && RUNNABLE_EXT.includes(file.path.split('.').pop()?.toLowerCase() ?? '')),
    [activeFiles],
  )

  useEffect(() => {
    if ((!entry || !runnable.some((file) => file.path === entry)) && runnable.length > 0) {
      setEntry(pickDefaultEntry(runnable))
    }
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

  const filteredRepositories = useMemo(() => {
    const query = repoQuery.trim().toLowerCase()
    if (!query) return repositories
    return repositories.filter((repository) =>
      `${repository.fullName} ${repository.description ?? ''}`.toLowerCase().includes(query),
    )
  }, [repositories, repoQuery])

  const renderPreview = async (selectedEntry: string, contents: BundleFile[]) => {
    if (!selectedEntry) throw new Error('Preview entry файл олдсонгүй')
    setRunning(true)
    setError(null)
    setLogs([])
    try {
      const doc = await buildPreviewDoc(selectedEntry, contents)
      setEntry(selectedEntry)
      setSrcDoc(doc)
    } finally {
      setRunning(false)
    }
  }

  const readLocalFiles = async (): Promise<BundleFile[]> => Promise.all(
    files
      .filter((file) => !file.isDir)
      .map(async (file) => ({ path: file.path, content: await readFile(file.path) })),
  )

  const runSelectedRepository = async (repository: GitHubRepositorySummary) => {
    let contents = previewFiles
    if (contents.length === 0) {
      const result = await fetchGitHubPreviewWorkspace(repository, 300)
      contents = result.files
      setPreviewFiles(contents)

      const truncated = result.truncated ? ` Нийт ${result.eligibleCount} файлаас ${result.importedCount}-г preview-д ачааллаа.` : ''
      const errors = result.errorCount > 0 ? ` ${result.errorCount} файл татагдсангүй.` : ''
      const root = result.projectRoot ? ` Root: ${result.projectRoot}.` : ''
      setStatus(`${repository.fullName} зөвхөн Preview дотор нээгдлээ.${root}${truncated}${errors}`)
    }

    const metadata = bundleMetadata(contents)
    const selectedEntry = entry && metadata.some((file) => file.path === entry)
      ? entry
      : pickDefaultEntry(metadata)
    if (!selectedEntry) {
      throw new Error('Repository татагдсан боловч preview хийх entry файл олдсонгүй')
    }
    await renderPreview(selectedEntry, contents)
  }

  const run = async () => {
    setStatus(null)
    setError(null)
    try {
      if (selectedRepository) {
        await runSelectedRepository(selectedRepository)
        return
      }

      const contents = await readLocalFiles()
      const selectedEntry = entry || pickDefaultEntry(files)
      await renderPreview(selectedEntry, contents)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openRepositoryPicker = async () => {
    setRepoPickerOpen(true)
    setError(null)
    if (repositories.length > 0 || loadingRepositories) return
    setLoadingRepositories(true)
    try {
      setRepositories(await listGitHubRepositories())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRepoPickerOpen(false)
    } finally {
      setLoadingRepositories(false)
    }
  }

  const selectRepository = (repository: GitHubRepositorySummary) => {
    setSelectedRepository(repository)
    setPreviewFiles([])
    setEntry('')
    setSrcDoc('')
    setLogs([])
    setError(null)
    setStatus(`${repository.fullName} сонгогдлоо. Run дарж зөвхөн preview нээнэ.`)
    setRepoPickerOpen(false)
  }

  const selectedFullName = selectedRepository?.fullName ?? ''
  const canRun = Boolean(selectedRepository || entry || runnable.length > 0)

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          className={styles.githubButton}
          onClick={() => void openRepositoryPicker()}
          disabled={running}
          title={selectedFullName || 'GitHub repository сонгох'}
        >
          {loadingRepositories ? <RefreshCw className={styles.spin} size={14} /> : <DownloadCloud size={14} />}
          <span>{selectedRepository ? selectedRepository.name : 'GitHub repo'}</span>
        </button>
        <select value={entry} onChange={(event) => setEntry(event.target.value)} disabled={runnable.length === 0}>
          {runnable.length === 0 && (
            <option value="">{selectedRepository ? 'Run дарж repo ачаална' : 'Entry файл алга'}</option>
          )}
          {runnable.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
        <button onClick={() => void run()} disabled={running || !canRun}>
          {running ? <RefreshCw className={styles.spin} size={13} /> : <Play size={13} />}
          {running ? '...' : 'Run'}
        </button>
      </div>

      {status && <div className={styles.status}>{status}</div>}
      {!srcDoc ? (
        <div className={styles.empty}>
          <strong>GitHub repo</strong> → repository-оо сонго → <strong>Run</strong> дарж зөвхөн preview нээнэ.
        </div>
      ) : (
        <>
          <div className={styles.frameWrap}><iframe title="preview" sandbox="allow-scripts" srcDoc={srcDoc} /></div>
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

      {error && !srcDoc && <div className={styles.errorBanner}>{error}</div>}

      {repoPickerOpen && (
        <div className={styles.pickerBackdrop} onClick={() => setRepoPickerOpen(false)}>
          <div className={styles.pickerSheet} onClick={(event) => event.stopPropagation()}>
            <div className={styles.pickerHeader}>
              <div>
                <strong>GitHub repositories</strong>
                <span>{repositories.length > 0 ? `${repositories.length} repo` : 'Уншиж байна...'}</span>
              </div>
              <button className={styles.iconButton} onClick={() => setRepoPickerOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <label className={styles.searchBox}>
              <Search size={16} />
              <input
                value={repoQuery}
                onChange={(event) => setRepoQuery(event.target.value)}
                placeholder="Repository хайх"
                autoFocus
              />
            </label>
            <div className={`${styles.repoList} scroll-y`}>
              {loadingRepositories && <div className={styles.repoMessage}>Repositories татаж байна...</div>}
              {!loadingRepositories && filteredRepositories.length === 0 && (
                <div className={styles.repoMessage}>Repository олдсонгүй.</div>
              )}
              {filteredRepositories.map((repository) => {
                const selected = repository.fullName === selectedFullName
                return (
                  <button
                    key={repository.fullName}
                    className={`${styles.repoItem} ${selected ? styles.repoItemSelected : ''}`}
                    onClick={() => selectRepository(repository)}
                  >
                    <div className={styles.repoTitle}>
                      <span>{repository.fullName}</span>
                      {repository.private && <Lock size={13} />}
                    </div>
                    <div className={styles.repoMeta}>
                      <span>{repository.defaultBranch}</span>
                      {repository.description && <span>{repository.description}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { ChevronLeft, Save, UploadCloud, Trash2, FilePlus, DownloadCloud } from 'lucide-react'
import { useFsStore } from '../../store/fsStore'
import { languageForPath } from '../../lib/languageForPath'
import { commitFile } from '../../lib/backend'
import { importGitHubWorkspace } from '../../lib/workspace'
import styles from './FilesView.module.css'

export function FilesView() {
  const { files, openPath, openContent, dirty, refresh, open, setOpenContent, save, createFile, remove } = useFsStore()
  const [newName, setNewName] = useState('')
  const [pushStatus, setPushStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [syncStatus, setSyncStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (openPath) {
    return (
      <div className={styles.editorWrap}>
        <div className={styles.editorHeader}>
          <button onClick={() => useFsStore.setState({ openPath: null })} aria-label="Back to files">
            <ChevronLeft size={16} />
          </button>
          <span className={styles.path}>{openPath}</span>
          <button onClick={() => void save()} disabled={!dirty}>
            <Save size={14} /> Save
          </button>
          <button
            className={styles.primary}
            disabled={pushing}
            onClick={async () => {
              setPushing(true)
              setPushStatus(null)
              try {
                await save()
                const result = await commitFile({
                  path: openPath,
                  content: openContent,
                  message: `Update ${openPath} from mobile workspace`,
                })
                const riskText = result.risk === 'high' ? ' Өндөр эрсдэлтэй өөрчлөлт гэж тэмдэглэгдсэн.' : ''
                setPushStatus({
                  kind: 'ok',
                  text: `Өөрчлөлт approval-д орлоо. ID: ${result.operationId}.${riskText}`,
                })
              } catch (err) {
                setPushStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
              } finally {
                setPushing(false)
              }
            }}
          >
            <UploadCloud size={14} /> Approval
          </button>
        </div>
        {pushStatus && <div className={`${styles.status} ${pushStatus.kind === 'ok' ? styles.ok : styles.err}`}>{pushStatus.text}</div>}
        <div className={styles.editorScroll}>
          <CodeMirror
            value={openContent}
            height="100%"
            theme={oneDark}
            extensions={languageForPath(openPath)}
            onChange={setOpenContent}
            basicSetup={{ closeBrackets: true, autocompletion: true }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          className={styles.importButton}
          title="GitHub repository-оос local workspace руу import хийх"
          disabled={importing}
          onClick={async () => {
            const shouldImport = files.length === 0 || window.confirm('Ижил нэртэй local файлууд GitHub хувилбараар солигдоно. Үргэлжлүүлэх үү?')
            if (!shouldImport) return
            setImporting(true)
            setSyncStatus(null)
            try {
              const result = await importGitHubWorkspace(40)
              await refresh()
              const truncatedText = result.truncated ? ` Нийт ${result.eligibleCount} файлаас эхний ${result.importedCount}-г импортлов.` : ''
              const errorText = result.errorCount > 0 ? ` ${result.errorCount} файл алдаатай.` : ''
              setSyncStatus({ kind: 'ok', text: `${result.importedCount} файл local workspace-д татагдлаа.${truncatedText}${errorText}` })
            } catch (err) {
              setSyncStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
            } finally {
              setImporting(false)
            }
          }}
        >
          <DownloadCloud size={16} />
          <span>{importing ? 'Import...' : 'GitHub'}</span>
        </button>
        <input
          placeholder="шинэ файл: src/App.tsx"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          onClick={() => {
            if (!newName.trim()) return
            const path = newName.startsWith('/') ? newName : `/${newName}`
            void createFile(path, '')
            setNewName('')
          }}
          aria-label="Create file"
        >
          <FilePlus size={16} />
        </button>
      </div>
      {syncStatus && <div className={`${styles.status} ${syncStatus.kind === 'ok' ? styles.ok : styles.err}`}>{syncStatus.text}</div>}
      <div className={`${styles.list} scroll-y`}>
        {files.length === 0 && (
          <div className={styles.empty}>
            Local файл алга. GitHub товчоор сонгосон repository/branch-аа утсандаа татах эсвэл шинэ файл үүсгэнэ үү.
          </div>
        )}
        {files
          .filter((file) => !file.isDir)
          .map((file) => (
            <div key={file.path} className={styles.row}>
              <button className={styles.rowPath} onClick={() => void open(file.path)}>
                {file.path}
              </button>
              <button className={styles.rowDelete} onClick={() => void remove(file.path)} aria-label={`Delete ${file.path}`}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

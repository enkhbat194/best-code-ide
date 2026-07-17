import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { ChevronLeft, Save, UploadCloud, Trash2, FilePlus } from 'lucide-react'
import { useFsStore } from '../../store/fsStore'
import { languageForPath } from '../../lib/languageForPath'
import { commitFile } from '../../lib/backend'
import styles from './FilesView.module.css'

export function FilesView() {
  const { files, openPath, openContent, dirty, refresh, open, setOpenContent, save, createFile, remove } =
    useFsStore()
  const [newName, setNewName] = useState('')
  const [pushStatus, setPushStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    refresh()
  }, [refresh])

  if (openPath) {
    return (
      <div className={styles.editorWrap}>
        <div className={styles.editorHeader}>
          <button onClick={() => useFsStore.setState({ openPath: null })}>
            <ChevronLeft size={16} />
          </button>
          <span className={styles.path}>{openPath}</span>
          <button onClick={save} disabled={!dirty}>
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
                await commitFile({
                  path: openPath,
                  content: openContent,
                  message: `Update ${openPath} from mobile app`,
                })
                setPushStatus({ kind: 'ok', text: 'GitHub рүү push хийгдлээ ✓' })
              } catch (err) {
                setPushStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
              } finally {
                setPushing(false)
              }
            }}
          >
            <UploadCloud size={14} /> Push
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
        <input
          placeholder="шинэ файлын нэр, ж: src/App.tsx"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          onClick={() => {
            if (!newName.trim()) return
            const path = newName.startsWith('/') ? newName : `/${newName}`
            createFile(path, '')
            setNewName('')
          }}
        >
          <FilePlus size={16} />
        </button>
      </div>
      <div className={`${styles.list} scroll-y`}>
        {files.length === 0 && (
          <div className={styles.empty}>
            Файл алга байна. Дээрээс шинэ файл нэмэх эсвэл Chat tab-с AI-аар файл үүсгүүлээрэй.
          </div>
        )}
        {files
          .filter((f) => !f.isDir)
          .map((f) => (
            <div key={f.path} className={styles.row}>
              <button className={styles.rowPath} onClick={() => open(f.path)}>
                {f.path}
              </button>
              <button className={styles.rowDelete} onClick={() => remove(f.path)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
      </div>
    </div>
  )
}

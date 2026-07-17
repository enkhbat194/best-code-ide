import { useMemo, useState } from 'react'
import { GitCompare, PlayCircle, RefreshCw, GitPullRequest } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import {
  compareBranches,
  createDraftPullRequest,
  runValidation,
  validationStatus,
  waitValidation,
} from '../../lib/repoAgent'
import styles from './ChangesView.module.css'

export function ChangesView() {
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const branch = useSettingsStore((state) => state.branch)
  const [base, setBase] = useState('main')
  const [diff, setDiff] = useState('')
  const [validation, setValidation] = useState('')
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const protectedBranch = branch === 'main' || branch === 'master'
  const defaultTitle = useMemo(() => title || `Update ${repo || 'project'}`, [repo, title])

  async function execute(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <strong>Changes</strong>
          <span>{owner && repo ? `${owner}/${repo}` : 'Repository тохируулаагүй'}</span>
        </div>
        <span className={styles.branch}>{branch || 'main'}</span>
      </header>

      {protectedBranch && (
        <div className={styles.notice}>
          AI main/master дээр шууд код бичихгүй. Chat-аар coding task өгөхөд working branch автоматаар үүсгэнэ.
        </div>
      )}

      <section className={styles.section}>
        <h2><GitCompare size={16} /> Branch diff</h2>
        <div className={styles.row}>
          <label>
            Base
            <input value={base} onChange={(event) => setBase(event.target.value)} placeholder="main" />
          </label>
          <label>
            Head
            <input value={branch} readOnly />
          </label>
        </div>
        <button
          disabled={busy || protectedBranch}
          onClick={() => execute(async () => {
            setDiff(await compareBranches(base.trim() || 'main', branch))
            setStatus('Diff шинэчлэгдлээ.')
          })}
        >
          <RefreshCw size={14} /> Diff шинэчлэх
        </button>
        <pre className={styles.output}>{diff || 'Working branch үүсэж, өөрчлөлт орсны дараа diff энд харагдана.'}</pre>
      </section>

      <section className={styles.section}>
        <h2><PlayCircle size={16} /> Build / validation</h2>
        <div className={styles.actions}>
          <button
            disabled={busy}
            onClick={() => execute(async () => {
              setValidation(await validationStatus(branch))
              setStatus('Validation төлөв шинэчлэгдлээ.')
            })}
          >
            Төлөв шалгах
          </button>
          <button
            disabled={busy}
            onClick={() => execute(async () => {
              setValidation(await waitValidation(branch, 35))
              setStatus('Validation үр дүн авлаа.')
            })}
          >
            Одоо явааг хүлээх
          </button>
          <button
            disabled={busy}
            onClick={() => execute(async () => {
              setValidation(await runValidation(branch, 35))
              setStatus('Validation ажиллаж дууслаа.')
            })}
          >
            Дахин ажиллуулах
          </button>
        </div>
        <pre className={styles.output}>{validation || 'Frontend build/lint болон backend typecheck-ийн үр дүн энд харагдана.'}</pre>
      </section>

      <section className={styles.section}>
        <h2><GitPullRequest size={16} /> Draft Pull Request</h2>
        <label>
          Гарчиг
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={defaultTitle} />
        </label>
        <button
          className={styles.primary}
          disabled={busy || protectedBranch}
          onClick={() => execute(async () => {
            const result = await createDraftPullRequest({
              title: title.trim() || defaultTitle,
              head: branch,
              base: base.trim() || 'main',
              body: `Created from Best Code IDE.\n\nRepository: ${owner}/${repo}\nBranch: ${branch}`,
            })
            setStatus(result)
          })}
        >
          <GitPullRequest size={14} /> Draft PR үүсгэх
        </button>
      </section>

      {busy && <div className={styles.progress}>Ажиллаж байна…</div>}
      {status && <div className={styles.success}>{status}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}

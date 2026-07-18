import { useEffect, useState } from 'react'
import { GitCompare, PlayCircle, RefreshCw, ShieldCheck, ShieldX, XCircle } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import {
  cancelRepositoryTask,
  compareBranches,
  decideApproval,
  listApprovals,
  listRepositoryTasks,
  readRepositoryTaskLogs,
  refreshRepositoryTask,
  runValidation,
  startRepositoryTask,
  validationStatus,
  waitValidation,
  type ApprovalOperation,
  type RepositoryTask,
} from '../../lib/repoAgent'
import styles from './ChangesView.module.css'

export function ChangesView() {
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const branch = useSettingsStore((state) => state.branch)
  const [base, setBase] = useState('main')
  const [diff, setDiff] = useState('')
  const [validation, setValidation] = useState('')
  const [taskLogs, setTaskLogs] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [approvals, setApprovals] = useState<ApprovalOperation[]>([])
  const [tasks, setTasks] = useState<RepositoryTask[]>([])

  const protectedBranch = branch === 'main' || branch === 'master'

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

  async function refreshApprovals() {
    setApprovals(await listApprovals('pending_approval'))
  }

  async function refreshTasks() {
    setTasks(await listRepositoryTasks())
  }

  useEffect(() => {
    if (!owner || !repo) return
    void Promise.all([refreshApprovals(), refreshTasks()]).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [owner, repo])

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <strong>Changes & Tasks</strong>
          <span>{owner && repo ? `${owner}/${repo}` : 'Repository тохируулаагүй'}</span>
        </div>
        <span className={styles.branch}>{branch || 'main'}</span>
      </header>

      {protectedBranch && (
        <div className={styles.notice}>
          Main/master дээр write, commit, push болон task delivery хийхгүй. Эхлээд agent/&lt;task&gt; working branch сонгоно.
        </div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2><ShieldCheck size={16} /> Approval requests</h2>
          <button
            className={styles.compact}
            disabled={busy}
            onClick={() => execute(async () => {
              await refreshApprovals()
              setStatus('Approval жагсаалт шинэчлэгдлээ.')
            })}
          >
            <RefreshCw size={14} /> Шинэчлэх
          </button>
        </div>

        {approvals.length === 0 && <div className={styles.muted}>Хүлээгдэж байгаа approval алга.</div>}
        <div className={styles.approvalList}>
          {approvals.map((operation) => (
            <article key={operation.operation_id} className={styles.approvalCard}>
              <div className={styles.approvalTop}>
                <div>
                  <strong>{operation.title}</strong>
                  <span>{operation.branch} · {operation.operation_id}</span>
                </div>
                <span className={`${styles.risk} ${operation.risk === 'high' ? styles.highRisk : ''}`}>
                  {operation.risk === 'high' ? 'Өндөр эрсдэл' : 'Ердийн'}
                </span>
              </div>
              <p>{operation.summary}</p>
              {operation.risk_reasons.length > 0 && (
                <div className={styles.reasons}>{operation.risk_reasons.join(' · ')}</div>
              )}
              {operation.changes.map((change) => (
                <div key={`${operation.operation_id}:${change.path}`}>
                  <div className={styles.changeMeta}>{change.action.toUpperCase()} · {change.path}</div>
                  <pre className={styles.output}>{change.diff}</pre>
                </div>
              ))}
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => execute(async () => {
                    await decideApproval(operation.operation_id, 'approved')
                    await refreshApprovals()
                    setStatus(`Approved: ${operation.operation_id}. ChatGPT approval-тай дараагийн үйлдлийг үргэлжлүүлж болно.`)
                  })}
                >
                  <ShieldCheck size={14} /> Approve
                </button>
                <button
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => execute(async () => {
                    await decideApproval(operation.operation_id, 'rejected')
                    await refreshApprovals()
                    setStatus(`Rejected: ${operation.operation_id}`)
                  })}
                >
                  <ShieldX size={14} /> Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2><PlayCircle size={16} /> Build / Test tasks</h2>
          <button
            className={styles.compact}
            disabled={busy}
            onClick={() => execute(async () => {
              await refreshTasks()
              setStatus('Task жагсаалт шинэчлэгдлээ.')
            })}
          >
            <RefreshCw size={14} /> Шинэчлэх
          </button>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={busy || protectedBranch}
            onClick={() => execute(async () => {
              const task = await startRepositoryTask('build', branch)
              await refreshTasks()
              setStatus(`Build эхэллээ: ${task.task_id}`)
            })}
          >
            Build эхлүүлэх
          </button>
          <button
            className={styles.primary}
            disabled={busy || protectedBranch}
            onClick={() => execute(async () => {
              const task = await startRepositoryTask('test', branch)
              await refreshTasks()
              setStatus(`Test эхэллээ: ${task.task_id}`)
            })}
          >
            Test эхлүүлэх
          </button>
        </div>

        {tasks.length === 0 && <div className={styles.muted}>Build/test task алга.</div>}
        <div className={styles.approvalList}>
          {tasks.map((task) => (
            <article key={task.task_id} className={styles.approvalCard}>
              <div className={styles.approvalTop}>
                <div>
                  <strong>{task.kind.toUpperCase()} · {task.status}</strong>
                  <span>{task.branch} · {task.workflow}</span>
                </div>
                <span className={styles.risk}>{task.conclusion ?? '—'}</span>
              </div>
              <div className={styles.changeMeta}>{task.task_id}</div>
              {task.error && <div className={styles.reasons}>{task.error}</div>}
              <div className={styles.actions}>
                <button
                  disabled={busy}
                  onClick={() => execute(async () => {
                    const updated = await refreshRepositoryTask(task.task_id)
                    setTasks((items) => items.map((item) => item.task_id === updated.task_id ? updated : item))
                    setStatus(`${updated.kind}: ${updated.status}/${updated.conclusion ?? '-'}`)
                  })}
                >
                  <RefreshCw size={14} /> Status
                </button>
                <button
                  disabled={busy}
                  onClick={() => execute(async () => {
                    const logs = await readRepositoryTaskLogs(task.task_id)
                    setTaskLogs(`TASK ${task.task_id}\n${logs.content || '(log хараахан алга)'}`)
                    setStatus('Task log шинэчлэгдлээ.')
                  })}
                >
                  Log
                </button>
                <button
                  className={styles.danger}
                  disabled={busy || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'}
                  onClick={() => execute(async () => {
                    const cancelled = await cancelRepositoryTask(task.task_id)
                    setTasks((items) => items.map((item) => item.task_id === cancelled.task_id ? cancelled : item))
                    setStatus(`Cancelled: ${cancelled.task_id}`)
                  })}
                >
                  <XCircle size={14} /> Cancel
                </button>
              </div>
            </article>
          ))}
        </div>
        {taskLogs && <pre className={styles.output}>{taskLogs}</pre>}
      </section>

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
        <pre className={styles.output}>{diff || 'Approved operation push хийгдсэний дараа branch diff энд харагдана.'}</pre>
      </section>

      <section className={styles.section}>
        <h2><PlayCircle size={16} /> Legacy validation</h2>
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
            disabled={busy || protectedBranch}
            onClick={() => execute(async () => {
              setValidation(await runValidation(branch, 35))
              setStatus('Validation ажиллаж дууслаа.')
            })}
          >
            Дахин ажиллуулах
          </button>
        </div>
        <pre className={styles.output}>{validation || 'Хуучин validate.yml-ийн үр дүн энд харагдана.'}</pre>
      </section>

      <div className={styles.notice}>
        Pull Request-ийг UI-аас шууд нээхгүй. Approved operation → commit → push → build/test success дарааллыг BestCode MCP баталгаажуулсны дараа draft PR үүсгэнэ.
      </div>

      {busy && <div className={styles.progress}>Ажиллаж байна…</div>}
      {status && <div className={styles.success}>{status}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}

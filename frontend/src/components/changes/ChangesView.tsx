import { useEffect, useRef, useState } from 'react'
import { Clock3, GitBranch, GitCompare, PlayCircle, RefreshCw, ShieldCheck, ShieldX, Trash2, XCircle } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import {
  cancelRepositoryTask,
  completeBranchDeletion,
  compareBranches,
  decideApproval,
  listBranches,
  listApprovals,
  listRepositoryTasks,
  readRepositoryTaskLogs,
  refreshRepositoryTask,
  requestBranchDeletion,
  runValidation,
  startRepositoryTask,
  validationStatus,
  waitValidation,
  type ApprovalOperation,
  type RepositoryBranch,
  type RepositoryTask,
} from '../../lib/repoAgent'
import styles from './ChangesView.module.css'

const approvalStatusLabels: Record<ApprovalOperation['status'], string> = {
  pending_approval: 'Шийдвэр хүлээж байна',
  approved: 'Баталсан',
  rejected: 'Татгалзсан',
  cancelled: 'Цуцалсан',
  expired: 'Хугацаа дууссан',
  superseded: 'Context өөрчлөгдсөн',
  commit_prepared: 'Commit бэлтгэсэн',
  pushed: 'Branch руу хүргэсэн',
  pull_request_opened: 'Pull request нээсэн',
  completed: 'Дууссан',
}

function localTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('mn-MN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<RepositoryTask[]>([])
  const [branches, setBranches] = useState<RepositoryBranch[]>([])
  const decisionsInFlight = useRef(new Set<string>())

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
    const items = await listApprovals()
    const pending = items.filter((item) => item.status === 'pending_approval')
    const recentTerminal = items
      .filter((item) => item.status !== 'pending_approval')
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, 5)
    setApprovals([...pending, ...recentTerminal].sort(
      (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
    ))
  }

  function decisionKey(operationId: string, decision: 'approved' | 'rejected'): string {
    return `pwa-decision:${operationId}:${decision}`
  }

  function requestDecision(operation: ApprovalOperation, decision: 'approved' | 'rejected') {
    if (
      operation.status !== 'pending_approval' ||
      decisionBusyId ||
      decisionsInFlight.current.has(operation.operation_id)
    ) return
    decisionsInFlight.current.add(operation.operation_id)
    setDecisionBusyId(operation.operation_id)
    void execute(async () => {
      try {
        const updated = await decideApproval(
          operation.operation_id,
          decision,
          decisionKey(operation.operation_id, decision),
        )
        setApprovals((items) => items.map((item) => item.operation_id === updated.operation_id ? updated : item))

        if (
          decision === 'approved' &&
          updated.status === 'approved' &&
          operation.risk_reasons.includes('branch_deletion')
        ) {
          await completeBranchDeletion(operation.branch, operation.operation_id)
          await refreshBranches()
          setStatus(`Branch устлаа: ${operation.branch}`)
        } else {
          setStatus(
            decision === 'approved'
              ? `Баталсан: ${operation.operation_id}. Дараагийн зөвшөөрөгдсөн үйлдлийг үргэлжлүүлж болно.`
              : `Татгалзсан: ${operation.operation_id}`,
          )
        }
      } finally {
        await refreshApprovals()
      }
    }).finally(() => {
      decisionsInFlight.current.delete(operation.operation_id)
      setDecisionBusyId(null)
    })
  }

  async function refreshTasks() {
    setTasks(await listRepositoryTasks())
  }

  async function refreshBranches() {
    setBranches(await listBranches())
  }

  useEffect(() => {
    if (!owner || !repo) return
    void Promise.all([refreshApprovals(), refreshTasks(), refreshBranches()]).catch((err) => {
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
          <h2><GitBranch size={16} /> Branch cleanup</h2>
          <button
            className={styles.compact}
            disabled={busy}
            onClick={() => execute(async () => {
              await refreshBranches()
              setStatus('Branch жагсаалт шинэчлэгдлээ.')
            })}
          >
            <RefreshCw size={14} /> Шинэчлэх
          </button>
        </div>
        <div className={styles.muted}>
          Устгах хүсэлт нь эхлээд SHA-pinned өндөр эрсдэлийн approval үүсгэнэ. Approve дарахад л branch устна.
        </div>
        <div className={styles.branchList}>
          {branches.map((item) => (
            <article className={styles.branchCard} key={item.name}>
              <div className={styles.branchMeta}>
                <strong>{item.name}</strong>
                <span>{item.sha.slice(0, 8)} · {item.default ? 'default' : item.protected ? 'protected' : 'working'}</span>
              </div>
              <button
                className={styles.danger}
                disabled={busy || item.default || item.protected}
                onClick={() => execute(async () => {
                  const operation = await requestBranchDeletion(item.name)
                  await refreshApprovals()
                  setStatus(`Устгах approval үүслээ: ${item.name} · ${operation.operation_id}`)
                })}
              >
                <Trash2 size={14} /> Устгах хүсэлт
              </button>
            </article>
          ))}
        </div>
      </section>

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

        {approvals.length === 0 && <div className={styles.muted}>Approval хүсэлт, сүүлийн шийдвэр алга.</div>}
        <div className={styles.approvalList}>
          {approvals.map((operation) => (
            <article key={operation.operation_id} className={styles.approvalCard}>
              <div className={styles.approvalTop}>
                <div>
                  <strong>{operation.title}</strong>
                  <span>{operation.branch} · {operation.operation_id}</span>
                </div>
                <div className={styles.approvalBadges}>
                  <span className={`${styles.state} ${
                    operation.status === 'pending_approval'
                      ? styles.pendingState
                      : ['rejected', 'cancelled', 'expired', 'superseded'].includes(operation.status)
                        ? styles.closedState
                        : styles.terminalState
                  }`}>
                    {approvalStatusLabels[operation.status]}
                  </span>
                  <span className={`${styles.risk} ${operation.risk === 'high' ? styles.highRisk : ''}`}>
                    {operation.risk === 'high' ? 'Өндөр эрсдэл' : 'Ердийн'}
                  </span>
                </div>
              </div>
              <p>{operation.summary}</p>
              <div className={styles.approvalTiming}>
                <Clock3 size={13} />
                {operation.status === 'pending_approval'
                  ? `Хүчинтэй хугацаа: ${localTime(operation.expires_at)} хүртэл`
                  : `Шинэчлэгдсэн: ${localTime(operation.updated_at)}`}
                {operation.decision_actor && ` · ${operation.decision_actor}`}
              </div>
              {operation.superseded_reason && (
                <div className={styles.reasons}>Хуучирсан шалтгаан: {operation.superseded_reason}</div>
              )}
              {operation.base_context_sha && (
                <div className={styles.changeMeta}>Context SHA: {operation.base_context_sha.slice(0, 12)}</div>
              )}
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
                  disabled={busy || decisionBusyId !== null || operation.status !== 'pending_approval'}
                  onClick={() => requestDecision(operation, 'approved')}
                >
                  <ShieldCheck size={14} /> Approve
                </button>
                <button
                  className={styles.danger}
                  disabled={busy || decisionBusyId !== null || operation.status !== 'pending_approval'}
                  onClick={() => requestDecision(operation, 'rejected')}
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

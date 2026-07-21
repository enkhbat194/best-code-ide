import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { listApprovals, listRepositoryTasks, type ApprovalOperation, type RepositoryTask } from '../../lib/repoAgent'
import styles from './SettingsView.module.css'

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('mn-MN')
}

function semanticSummary(operation: ApprovalOperation): string {
  if (operation.risk_reasons.includes('production_deployment')) return 'Production deployment хүсэлт'
  if (operation.risk_reasons.some((reason) => reason.startsWith('critical_path:'))) return 'Critical path өөрчлөлт'
  if (operation.risk_reasons.includes('branch_deletion')) return 'Branch cleanup хүсэлт'
  if (operation.changes.length > 0) return `${operation.changes.length} файлд өөрчлөлт`
  return operation.summary
}

export function TrustHistoryCard() {
  const [approvals, setApprovals] = useState<ApprovalOperation[]>([])
  const [deployments, setDeployments] = useState<RepositoryTask[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [approvalItems, taskItems] = await Promise.all([listApprovals(), listRepositoryTasks()])
      setApprovals(approvalItems.slice(0, 5))
      setDeployments(taskItems.filter((item) => item.kind === 'deployment').slice(0, 5))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div><span className={styles.eyebrow}>TRUST &amp; RELEASE HISTORY</span><h2>Approval ба release түүх</h2></div>
        <button className={styles.iconButton} type="button" onClick={() => void refresh()} disabled={busy} aria-label="Trust history шинэчлэх">
          <RefreshCw size={18} className={busy ? styles.spinning : ''} />
        </button>
      </div>

      <p className={styles.releaseReason}>Хүсэлт бүрийн зорилго, эрсдэл, exact context болон эцсийн төлөвийг owner ойлгохоор харуулна.</p>

      {approvals.length === 0 && !error && <p className={styles.hint}>Approval түүх хоосон байна.</p>}
      {approvals.map((item) => {
        const approved = item.status === 'approved' || item.status === 'completed' || item.status === 'pull_request_opened'
        const Icon = approved ? ShieldCheck : ShieldAlert
        return (
          <div className={styles.releaseRow} key={item.operation_id}>
            <Icon size={16} />
            <span>{semanticSummary(item)}<br /><small>{item.branch} · {formatDate(item.updated_at)}</small></span>
            <strong>{item.risk} · {item.status}</strong>
          </div>
        )
      })}

      <div className={styles.releaseHeader}><div><span className={styles.eyebrow}>RELEASES</span><h3>Сүүлийн deployment-ууд</h3></div><History size={18} /></div>
      {deployments.length === 0 && !error && <p className={styles.hint}>Deployment түүх одоогоор алга.</p>}
      {deployments.map((item) => (
        <div className={styles.releaseRow} key={item.task_id}>
          <History size={16} />
          <span>{item.workflow}<br /><small>{item.branch} · {formatDate(item.completed_at ?? item.updated_at)}</small></span>
          <strong>{item.conclusion ?? item.status}</strong>
        </div>
      ))}
      {error && <p className={styles.releaseReason}>{error}</p>}
    </section>
  )
}

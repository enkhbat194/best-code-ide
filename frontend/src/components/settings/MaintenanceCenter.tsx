import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './SettingsView.module.css'

interface MaintenancePlan {
  checked_at: string
  current_main_sha: string
  stale_approvals: {
    operation_id: string
    title: string
    status: string
    branch: string
    base_context_sha?: string
  }[]
  merged_branches: { name: string; sha: string; comparison: string }[]
  counts: { stale_approvals: number; merged_branches: number }
}

async function maintenanceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const settings = useSettingsStore.getState()
  if (!settings.isConfigured()) throw new Error('Backend тохиргоо дутуу байна')
  const response = await fetch(`${settings.backendUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.authToken}`,
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    try {
      throw new Error((JSON.parse(text) as { error?: string }).error || text)
    } catch (error) {
      if (error instanceof Error && error.message !== text) throw error
      throw new Error(text || `Maintenance error ${response.status}`)
    }
  }
  return JSON.parse(text) as T
}

export function MaintenanceCenter() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const [plan, setPlan] = useState<MaintenancePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!useSettingsStore.getState().isConfigured()) return
    setBusy(true)
    setError('')
    try {
      setPlan(await maintenanceRequest<MaintenancePlan>('/api/maintenance?project_id=bestcode'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (configured) void refresh()
  }, [configured, refresh])

  async function supersedeApprovals() {
    if (!plan || plan.counts.stale_approvals === 0) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await maintenanceRequest<{ updated: number }>('/api/maintenance/approvals/supersede?project_id=bestcode', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: 'SUPERSEDE_STALE_APPROVALS',
          expected_main_sha: plan.current_main_sha,
        }),
      })
      setMessage(`${result.updated} хуучин approval superseded боллоо.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  async function deleteMergedBranches() {
    if (!plan || plan.counts.merged_branches === 0) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await maintenanceRequest<{ deleted: number }>('/api/maintenance/branches/delete?project_id=bestcode', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: 'DELETE_MERGED_BRANCHES',
          expected_main_sha: plan.current_main_sha,
          branches: plan.merged_branches.map(({ name, sha }) => ({ name, sha })),
        }),
      })
      setMessage(`${result.deleted} merge болсон branch устлаа.`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div>
          <span className={styles.eyebrow}>SYSTEM MAINTENANCE CENTER</span>
          <h2>Системийн цэвэрлэгээ</h2>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          onClick={() => void refresh()}
          disabled={!configured || busy}
          aria-label="Maintenance төлөв шинэчлэх"
        >
          <RefreshCw size={18} className={busy ? styles.spinning : ''} />
        </button>
      </div>

      <p className={styles.releaseReason}>
        Хуучин approval болон merge болсон agent branch-уудыг одоогийн main SHA-тай тулгаж байж цэвэрлэнэ.
      </p>

      <div className={styles.releaseGrid}>
        <div className={styles.releaseRow}>
          <Wrench size={16} />
          <span>Хуучин approval</span>
          <strong>{plan?.counts.stale_approvals ?? '—'}</strong>
        </div>
        <div className={styles.releaseRow}>
          <Trash2 size={16} />
          <span>Merge болсон branch</span>
          <strong>{plan?.counts.merged_branches ?? '—'}</strong>
        </div>
        <div className={styles.releaseRow}>
          <ShieldCheck size={16} />
          <span>Plan main SHA</span>
          <strong>{plan?.current_main_sha.slice(0, 8) ?? '—'}</strong>
        </div>
      </div>

      <button
        className={styles.reloadButton}
        type="button"
        onClick={() => void supersedeApprovals()}
        disabled={busy || !plan?.counts.stale_approvals}
      >
        <Wrench size={18} />
        Хуучин approval-уудыг superseded болгох
      </button>

      <button
        className={styles.reloadButton}
        type="button"
        onClick={() => void deleteMergedBranches()}
        disabled={busy || !plan?.counts.merged_branches}
      >
        <Trash2 size={18} />
        Merge болсон branch-уудыг цэвэрлэх
      </button>

      {message && <div className={`${styles.integrityBadge} ${styles.ok}`}>{message}</div>}
      {error && <p className={styles.releaseReason}>{error}</p>}
    </section>
  )
}

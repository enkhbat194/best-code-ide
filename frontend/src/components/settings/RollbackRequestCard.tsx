import { useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { requestRollback, type RollbackRequestInput } from '../../lib/rollbackRequest'
import styles from './SettingsView.module.css'

const emptyForm: RollbackRequestInput = {
  worker: 'best-code-ide',
  targetVersionId: '',
  targetCommitSha: '',
  incidentNote: '',
  smokeExpectation: 'Rollback target health check 200; current main restore health check 200.',
}

export function RollbackRequestCard() {
  const [form, setForm] = useState<RollbackRequestInput>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await requestRollback(form)
      setMessage(`High-risk approval үүслээ: ${result.operationId.slice(0, 8)} · ${result.status}. Production traffic өөрчлөгдөөгүй.`)
      setForm(emptyForm)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const valid = form.targetVersionId.trim().length >= 20 && /^[0-9a-f]{40}$/i.test(form.targetCommitSha.trim()) && form.incidentNote.trim().length >= 10

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div><span className={styles.eyebrow}>EXACT ROLLBACK REQUEST</span><h2>Rollback rehearsal хүсэлт</h2></div>
        <AlertTriangle size={20} />
      </div>
      <p className={styles.releaseReason}>Latest rollback-plan artifact-аас exact Worker version ID болон 40 тэмдэгт commit SHA оруулна. Энэ товч зөвхөн high-risk approval үүсгэнэ; production traffic шилжүүлэхгүй.</p>

      <div className={styles.field}>
        <label>Worker</label>
        <select value={form.worker} onChange={(event) => setForm({ ...form, worker: event.target.value as RollbackRequestInput['worker'] })}>
          <option value="best-code-ide">Backend · best-code-ide</option>
          <option value="best-code-ide-appl">PWA · best-code-ide-appl</option>
        </select>
      </div>
      <div className={styles.field}><label>Exact target version ID</label><input value={form.targetVersionId} onChange={(event) => setForm({ ...form, targetVersionId: event.target.value })} autoCapitalize="off" autoCorrect="off" /></div>
      <div className={styles.field}><label>Exact target commit SHA</label><input value={form.targetCommitSha} onChange={(event) => setForm({ ...form, targetCommitSha: event.target.value })} autoCapitalize="off" autoCorrect="off" /></div>
      <div className={styles.field}><label>Incident note</label><textarea value={form.incidentNote} onChange={(event) => setForm({ ...form, incidentNote: event.target.value })} placeholder="Яагаад rollback rehearsal шаардлагатайг тодорхой бич." /></div>
      <div className={styles.field}><label>Smoke expectation</label><textarea value={form.smokeExpectation} onChange={(event) => setForm({ ...form, smokeExpectation: event.target.value })} /></div>

      <button className={styles.reloadButton} type="button" disabled={busy || !valid} onClick={() => void submit()}>
        <RotateCcw size={18} /> {busy ? 'Хүсэлт үүсгэж байна…' : 'High-risk rollback approval үүсгэх'}
      </button>
      {message && <div className={`${styles.integrityBadge} ${styles.ok}`}>{message}</div>}
      {error && <p className={styles.releaseReason}>{error}</p>}
    </section>
  )
}

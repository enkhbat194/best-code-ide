import { useState } from 'react'
import { CheckCircle2, Circle, FlaskConical, LoaderCircle, XCircle } from 'lucide-react'
import { runPhase4ASmokeTest, type MissionSmokeReport, type MissionSmokeStep } from '../../lib/missionSmoke'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './SettingsView.module.css'

function StepIcon({ step, busy }: { step: MissionSmokeStep; busy: boolean }) {
  if (step.status === 'passed') return <CheckCircle2 size={17} className={styles.stepPass} />
  if (step.status === 'failed') return <XCircle size={17} className={styles.stepFail} />
  if (busy) return <LoaderCircle size={17} className={`${styles.stepPending} ${styles.spinning}`} />
  return <Circle size={17} className={styles.stepPending} />
}

function short(value?: string): string {
  if (!value) return '—'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

export function MissionSmokeCard() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<MissionSmokeReport | null>(null)

  async function run() {
    setBusy(true)
    setReport(null)
    try {
      setReport(await runPhase4ASmokeTest())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div>
          <span className={styles.eyebrow}>PHASE 4A PRODUCTION VERIFICATION</span>
          <h2>Mission ажиллагааны эцсийн шалгалт</h2>
        </div>
        <FlaskConical size={20} />
      </div>

      <p className={styles.releaseReason}>
        Installed PWA-аас production Actions API-г бодитоор дуудаж Mission үүсгэх, унших, writer lease хамгаалалт, mutation, context packet болон lease cleanup-ийг шалгана. Repository, deployment, rollback-д өөрчлөлт хийхгүй.
      </p>

      <button className={styles.smokeButton} type="button" disabled={!configured || busy} onClick={() => void run()}>
        {busy ? <LoaderCircle size={18} className={styles.spinning} /> : <FlaskConical size={18} />}
        {busy ? 'Phase 4A шалгаж байна…' : 'Phase 4A smoke test ажиллуулах'}
      </button>

      {!configured && <p className={styles.hint}>Эхлээд backend URL болон Auth token тохируулна.</p>}

      {report && (
        <>
          <div className={`${styles.integrityBadge} ${styles[report.ok ? 'ok' : 'danger']}`}>
            {report.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>{report.ok ? 'Phase 4A functional smoke амжилттай' : 'Phase 4A smoke test-д алдаа гарлаа'}</span>
          </div>

          <div className={styles.smokeSteps}>
            {report.steps.map((step) => (
              <div className={styles.smokeStep} key={step.key}>
                <StepIcon step={step} busy={busy} />
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.releaseMeta}>
            Mission: {short(report.missionId)} · context v{report.contextVersion ?? '—'} · {short(report.contextHash)} · {new Date(report.completedAt).toLocaleString('mn-MN')}
          </div>
        </>
      )}
    </section>
  )
}

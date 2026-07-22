import { useState } from 'react'
import { CheckCircle2, Circle, FlaskConical, LoaderCircle, XCircle } from 'lucide-react'
import { runVisionOwnerSmokeTest, type VisionSmokeReport, type VisionSmokeStep } from '../../lib/visionSmoke'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './SettingsView.module.css'

function StepIcon({ step, busy }: { step: VisionSmokeStep; busy: boolean }) {
  if (step.status === 'passed') return <CheckCircle2 size={17} className={styles.stepPass} />
  if (step.status === 'failed') return <XCircle size={17} className={styles.stepFail} />
  if (busy) return <LoaderCircle size={17} className={`${styles.stepPending} ${styles.spinning}`} />
  return <Circle size={17} className={styles.stepPending} />
}

function short(value: string | null): string {
  if (!value) return '—'
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

export function VisionSmokeCard() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<VisionSmokeReport | null>(null)

  async function run() {
    setBusy(true)
    setReport(null)
    try {
      setReport(await runVisionOwnerSmokeTest())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div>
          <span className={styles.eyebrow}>CHAT 6 PRODUCTION VISION VERIFICATION</span>
          <h2>Private зураг таних эцсийн шалгалт</h2>
        </div>
        <FlaskConical size={20} />
      </div>

      <p className={styles.releaseReason}>
        Installed PWA deterministic canary PNG үүсгээд authenticated backend-ээр private R2-д хадгална. Дараа нь Cloudflare Workers AI Moondream processing, OCR/shape recognition, checksum болон untrusted provenance-ийг нэг урсгалаар шалгана. Canary Asset нэг checksum-аар дахин ашиглагдана.
      </p>

      <button className={styles.smokeButton} type="button" disabled={!configured || busy} onClick={() => void run()}>
        {busy ? <LoaderCircle size={18} className={styles.spinning} /> : <FlaskConical size={18} />}
        {busy ? 'Vision pipeline шалгаж байна…' : 'Image recognition smoke test ажиллуулах'}
      </button>

      {!configured && <p className={styles.hint}>Эхлээд backend URL болон Auth token тохируулна.</p>}

      {report && (
        <>
          <div className={`${styles.integrityBadge} ${styles[report.ok ? 'ok' : 'danger']}`}>
            {report.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>{report.ok ? 'Chat 6 owner image recognition амжилттай' : 'Vision production smoke test-д алдаа гарлаа'}</span>
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

          {report.summary && <p className={styles.releaseReason}><strong>Provider summary:</strong> {report.summary}</p>}
          <div className={styles.releaseMeta}>
            Asset: {short(report.assetId)} · Result: {short(report.resultObjectId)} · {report.processor ?? '—'} · {report.processorVersion ?? '—'} · {new Date(report.completedAt).toLocaleString('mn-MN')}
          </div>
        </>
      )}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react'
import { clientRelease } from '../../lib/release'
import {
  CLIENT_API_SCHEMA_VERSION,
  canAttemptSafeReload,
  evaluateVersionContract,
  type UpdateState,
} from '../../lib/updateContract'
import styles from './SettingsView.module.css'

interface Props {
  backendSchema?: number | null
  backendSha?: string | null
}

async function applySafeUpdate(targetSha: string): Promise<void> {
  if (!canAttemptSafeReload(window.sessionStorage, targetSha)) {
    throw new Error('Давтагдсан reload зогсоогдлоо. 2 минутын дараа дахин оролдоно уу.')
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map(async (registration) => {
      await registration.update()
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
    }))
  }
  const url = new URL(window.location.href)
  url.searchParams.set('bestcode_update', targetSha.slice(0, 12))
  window.location.replace(url.toString())
}

const labels: Record<UpdateState, string> = {
  current: 'Шинэчлэгдсэн',
  available: 'Шинэ хувилбар байна',
  ready: 'Шинэчлэлт бэлэн',
  applying: 'Шинэчилж байна',
  failed: 'Шинэчлэлт амжилтгүй',
  offline: 'Offline горим',
}

export function UpdateStatusCard({ backendSchema, backendSha }: Props) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [stateOverride, setStateOverride] = useState<UpdateState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const contract = useMemo(() => evaluateVersionContract({
    clientSchema: CLIENT_API_SCHEMA_VERSION,
    backendSchema,
    clientSha: clientRelease.sha,
    backendSha,
    online,
  }), [backendSchema, backendSha, online])

  const state = stateOverride ?? contract.state
  const Icon = state === 'current' ? CheckCircle2 : state === 'offline' ? CloudOff : AlertTriangle

  const apply = async () => {
    setStateOverride('applying')
    setError('')
    try {
      await applySafeUpdate(backendSha || 'unknown')
    } catch (cause) {
      setStateOverride('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className={styles.releaseCard} aria-live="polite">
      <div className={styles.releaseHeader}>
        <div>
          <span className={styles.eyebrow}>VERSION &amp; UPDATE CONTRACT</span>
          <h2>App шинэчлэлтийн төлөв</h2>
        </div>
        <Icon size={20} />
      </div>
      <div className={`${styles.integrityBadge} ${styles[state === 'current' ? 'ok' : state === 'offline' ? 'neutral' : 'warn']}`}>
        <span>{labels[state]}</span>
      </div>
      <p className={styles.releaseReason}>{error || contract.reason}</p>
      <div className={styles.releaseGrid}>
        <div className={styles.releaseRow}><span>App schema</span><strong>v{CLIENT_API_SCHEMA_VERSION}</strong></div>
        <div className={styles.releaseRow}><span>Backend schema</span><strong>{backendSchema ? `v${backendSchema}` : 'тодорхойгүй'}</strong></div>
        <div className={styles.releaseRow}><span>Compatibility</span><strong>{contract.compatible ? 'нийцтэй' : 'зөрүүтэй'}</strong></div>
      </div>
      {(state === 'available' || state === 'ready' || state === 'failed') && online && (
        <button className={styles.reloadButton} type="button" onClick={() => void apply()}>
          <RefreshCw size={18} /> Шинэ хувилбар хэрэглэх
        </button>
      )}
      {state === 'offline' && <p className={styles.hint}>Сүлжээ орсны дараа Settings-ийг шинэчилж compatibility-г дахин шалгана.</p>}
    </section>
  )
}

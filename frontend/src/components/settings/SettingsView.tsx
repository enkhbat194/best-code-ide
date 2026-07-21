import { useCallback, useEffect, useState } from 'react'
import { GitBranch, LockKeyhole, RefreshCw, RotateCw, Server, ShieldAlert, ShieldCheck } from 'lucide-react'
import { getReleaseIntegrity, type ReleaseIntegrity, type ReleaseIntegrityStatus } from '../../lib/repoAgent'
import { clientRelease, shortSha } from '../../lib/release'
import { useSettingsStore } from '../../store/settingsStore'
import { MaintenanceCenter } from './MaintenanceCenter'
import { MissionSmokeCard } from './MissionSmokeCard'
import { RollbackRequestCard } from './RollbackRequestCard'
import { TrustHistoryCard } from './TrustHistoryCard'
import { UpdateStatusCard } from './UpdateStatusCard'
import styles from './SettingsView.module.css'

const statusCopy: Record<ReleaseIntegrityStatus, { label: string; tone: string }> = {
  verified_main: { label: 'Production source баталгаатай', tone: 'ok' },
  stale_main: { label: 'Шинэчлэлт байна', tone: 'warn' },
  preview_build: { label: 'Preview branch build', tone: 'danger' },
  unverified: { label: 'Source нотолгоо дутуу', tone: 'neutral' },
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('mn-MN')
}

async function reloadLatestPwa(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.filter((name) => name !== 'esbuild-wasm').map((name) => caches.delete(name)))
  }
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set('bestcode_update', Date.now().toString())
  window.location.replace(nextUrl.toString())
}

export function SettingsView() {
  const s = useSettingsStore()
  const configured = s.isConfigured()
  const [release, setRelease] = useState<ReleaseIntegrity | null>(null)
  const [releaseError, setReleaseError] = useState('')
  const [checkingRelease, setCheckingRelease] = useState(false)
  const [reloadingPwa, setReloadingPwa] = useState(false)

  const refreshRelease = useCallback(async () => {
    if (!useSettingsStore.getState().isConfigured()) return
    setCheckingRelease(true)
    setReleaseError('')
    try { setRelease(await getReleaseIntegrity(clientRelease)) }
    catch (error) { setReleaseError(error instanceof Error ? error.message : String(error)) }
    finally { setCheckingRelease(false) }
  }, [])

  const handleReloadLatestPwa = useCallback(async () => {
    setReloadingPwa(true)
    setReleaseError('')
    try { await reloadLatestPwa() }
    catch (error) {
      setReleaseError(error instanceof Error ? error.message : String(error))
      setReloadingPwa(false)
    }
  }, [])

  useEffect(() => {
    if (!configured) { setRelease(null); return }
    void refreshRelease()
  }, [configured, refreshRelease, s.backendUrl, s.authToken, s.owner, s.repo])

  const integrityStatus: ReleaseIntegrityStatus = release?.integrity.status ?? 'unverified'
  const status = statusCopy[integrityStatus]
  const StatusIcon = integrityStatus === 'verified_main' ? ShieldCheck : ShieldAlert
  const backendSchema = (release?.backend as (ReleaseIntegrity['backend'] & { api_schema_version?: number }) | undefined)?.api_schema_version ?? 1

  return (
    <div className={`${styles.wrap} scroll-y`}>
      <section className={styles.releaseCard} aria-live="polite">
        <div className={styles.releaseHeader}>
          <div><span className={styles.eyebrow}>RELEASE &amp; INTEGRITY</span><h2>Одоогийн PWA хувилбар</h2></div>
          <button className={styles.iconButton} type="button" onClick={() => void refreshRelease()} disabled={!configured || checkingRelease || reloadingPwa} aria-label="Release төлөв шинэчлэх">
            <RefreshCw size={18} className={checkingRelease ? styles.spinning : ''} />
          </button>
        </div>
        <div className={`${styles.integrityBadge} ${styles[status.tone]}`}><StatusIcon size={18} /><span>{status.label}</span></div>
        <p className={styles.releaseReason}>{release?.integrity.reason ?? (configured ? releaseError || 'Backend-ээс source evidence шалгаж байна…' : 'Backend тохируулсны дараа энэ PWA-ийн branch ба SHA-г GitHub main-тай тулгана.')}</p>
        <div className={styles.releaseGrid}>
          <div className={styles.releaseRow}><GitBranch size={16} /><span>App source</span><strong>{clientRelease.branch} · {shortSha(clientRelease.sha)}</strong></div>
          <div className={styles.releaseRow}><GitBranch size={16} /><span>GitHub main</span><strong>{shortSha(release?.repository.main_sha)}</strong></div>
          <div className={styles.releaseRow}><LockKeyhole size={16} /><span>Deploy policy</span><strong>{release ? `${release.policy.rule} · ${release.policy.production_branch} only` : 'шалгаагүй'}</strong></div>
          <div className={styles.releaseRow}><Server size={16} /><span>Backend</span><strong>{release?.backend.build ?? 'шалгаагүй'}</strong></div>
          <div className={styles.releaseRow}><RotateCw size={16} /><span>Шалгасан</span><strong>{formatDate(release?.checked_at)}</strong></div>
        </div>
        {integrityStatus === 'stale_main' && (
          <button className={styles.reloadButton} type="button" onClick={() => void handleReloadLatestPwa()} disabled={reloadingPwa}>
            <RotateCw size={18} className={reloadingPwa ? styles.spinning : ''} />
            {reloadingPwa ? 'Хуучин cache цэвэрлэж байна…' : 'Хуучин cache цэвэрлээд шинэчлэх'}
          </button>
        )}
        <div className={styles.releaseMeta}>Build: {clientRelease.environment} · {clientRelease.buildId} · {formatDate(clientRelease.builtAt)}{release?.backend.version_id ? ` · Worker ${release.backend.version_id.slice(0, 8)}` : ''}</div>
      </section>

      <UpdateStatusCard backendSchema={backendSchema} backendSha={release?.repository.main_sha} />
      <MissionSmokeCard />
      <TrustHistoryCard />
      <RollbackRequestCard />
      <MaintenanceCenter />

      <div className={styles.status}><span className={`${styles.dot} ${configured ? styles.connected : ''}`} />{configured ? 'Backend тохируулагдсан' : 'Backend тохируулаагүй байна'}</div>
      <div className={styles.field}><label>Worker backend URL</label><input placeholder="https://mobilecode-ai.your-name.workers.dev" value={s.backendUrl} onChange={(e) => s.setBackendUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" /></div>
      <div className={styles.field}><label>Auth token (Worker дээр тохируулсан AUTH_TOKEN)</label><input type="password" value={s.authToken} onChange={(e) => s.setAuthToken(e.target.value)} autoCapitalize="off" autoCorrect="off" /></div>
      <div className={styles.field}><label>GitHub owner</label><input value={s.owner} onChange={(e) => s.setOwner(e.target.value)} placeholder="enkhbat194" /></div>
      <div className={styles.field}><label>GitHub repo</label><input value={s.repo} onChange={(e) => s.setRepo(e.target.value)} placeholder="best-code-ide" /></div>
      <div className={styles.field}><label>Branch</label><input value={s.branch} onChange={(e) => s.setBranch(e.target.value)} placeholder="main" /></div>
      <p className={styles.hint}>DeepSeek API key болон GitHub token нь энэ апп дотор биш, зөвхөн Cloudflare Worker дээр нууцаар хадгалагдана. Энд оруулсан &quot;Auth token&quot; нь зөвхөн энэ апп/AI chat-ыг таны Worker-тэй холбоход ашиглагдана.</p>
    </div>
  )
}

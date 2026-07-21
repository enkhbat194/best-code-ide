import { useState } from 'react'
import { CheckCircle2, Clipboard, Download, LoaderCircle, RefreshCw, Share2, ShieldCheck, Sparkles, XCircle } from 'lucide-react'
import { runDeepSeekResumeCheck, type ProviderResumeCheck } from '../../lib/missionHandoff'
import { getMissionContextPacket, type MissionContextPacket } from '../../lib/missionPacketClient'
import type { MissionRecord } from '../../lib/missionClient'
import type { MissionNextAction } from '../../lib/missionNextAction'
import styles from './MissionHandoffCard.module.css'

interface SmokeStep {
  label: string
  passed: boolean
  detail: string
}

export function MissionHandoffCard({ mission, nextAction }: { mission: MissionRecord; nextAction: MissionNextAction }) {
  const [packet, setPacket] = useState<MissionContextPacket | null>(null)
  const [resumeCheck, setResumeCheck] = useState<ProviderResumeCheck | null>(null)
  const [smokeSteps, setSmokeSteps] = useState<SmokeStep[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState<'packet' | 'copy' | 'export' | 'deepseek' | 'smoke' | ''>('')
  const [error, setError] = useState('')

  async function ensurePacket(): Promise<MissionContextPacket> {
    const current = await getMissionContextPacket(mission.mission_id)
    setPacket(current)
    return current
  }

  async function loadPacket() {
    setLoading('packet')
    setError('')
    setStatus('')
    try {
      const current = await ensurePacket()
      setStatus(`Context Packet v${current.context_version} бэлэн.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading('')
    }
  }

  async function copyPacket() {
    setLoading('copy')
    setError('')
    try {
      const current = packet ?? await ensurePacket()
      await navigator.clipboard.writeText(JSON.stringify(current, null, 2))
      setStatus('Context Packet clipboard-д хуулсан.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading('')
    }
  }

  async function exportPacket() {
    setLoading('export')
    setError('')
    try {
      const current = packet ?? await ensurePacket()
      const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mission-${mission.mission_id}-context-v${current.context_version}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus('Context Packet JSON export үүссэн.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading('')
    }
  }

  async function verifyDeepSeek() {
    setLoading('deepseek')
    setError('')
    setResumeCheck(null)
    try {
      const current = packet ?? await ensurePacket()
      setResumeCheck(await runDeepSeekResumeCheck(current, nextAction))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading('')
    }
  }

  async function runSmoke() {
    setLoading('smoke')
    setError('')
    setSmokeSteps([])
    try {
      const current = await ensurePacket()
      const steps: SmokeStep[] = [
        {
          label: 'Mission identity',
          passed: current.mission_id === mission.mission_id && current.project_id === mission.project_id,
          detail: `${current.mission_id.slice(0, 8)}… · ${current.project_id}`,
        },
        {
          label: 'Context concurrency',
          passed: current.context_version === mission.context_version && current.context_hash === mission.context_hash,
          detail: `v${current.context_version} · ${current.context_hash}`,
        },
        {
          label: 'Goal ба done contract',
          passed: current.goals.length > 0 && current.acceptance_criteria.length > 0,
          detail: `${current.goals.length} goal · ${current.acceptance_criteria.length} criteria`,
        },
        {
          label: 'Decision safety',
          passed: current.open_decisions.length === 0 ? !nextAction.ownerRequired || nextAction.kind !== 'owner_decision' : nextAction.kind === 'owner_decision' && nextAction.blocked,
          detail: current.open_decisions.length > 0 ? `${current.open_decisions.length} open decision → autonomous work blocked` : 'Open decision байхгүй',
        },
        {
          label: 'Next-action policy',
          passed: Boolean(nextAction.title && nextAction.reason),
          detail: `${nextAction.kind} · ${nextAction.blocked ? 'blocked' : 'ready'}`,
        },
        {
          label: 'Writer lease visibility',
          passed: current.writer_lease === null || Boolean(current.writer_lease.holder_id && current.writer_lease.expires_at),
          detail: current.writer_lease ? `${current.writer_lease.holder_id} · ${current.writer_lease.expires_at}` : 'Active writer байхгүй',
        },
      ]
      setSmokeSteps(steps)
      setStatus(steps.every((step) => step.passed) ? 'Phase 4B Mission Canvas smoke амжилттай.' : 'Smoke-д засах шаардлагатай алхам байна.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading('')
    }
  }

  const allPassed = smokeSteps.length > 0 && smokeSteps.every((step) => step.passed)

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div><span>CONTEXT HANDOFF &amp; VERIFICATION</span><h2>AI үргэлжлүүлэх багц</h2></div>
        <Share2 size={21} />
      </div>
      <p className={styles.copy}>ChatGPT, Claude эсвэл DeepSeek нь `mission_context_packet` tool-оор яг энэ context version/hash-ийг авч үргэлжлүүлнэ. Clipboard/export нь нэмэлт нөөц зам.</p>

      <div className={styles.nextAction} data-blocked={nextAction.blocked}>
        <strong>{nextAction.title}</strong>
        <span>{nextAction.reason}</span>
        <small>{nextAction.kind} · {nextAction.ownerRequired ? 'owner шаардлагатай' : 'agent үргэлжлүүлж болно'}</small>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => void loadPacket()} disabled={Boolean(loading)}><RefreshCw size={16} /> Packet авах</button>
        <button type="button" onClick={() => void copyPacket()} disabled={Boolean(loading)}><Clipboard size={16} /> Хуулах</button>
        <button type="button" onClick={() => void exportPacket()} disabled={Boolean(loading)}><Download size={16} /> JSON export</button>
        <button type="button" onClick={() => void verifyDeepSeek()} disabled={Boolean(loading)}><Sparkles size={16} /> DeepSeek resume</button>
      </div>

      {packet && <div className={styles.packetMeta}><span>{packet.schema}</span><strong>v{packet.context_version} · {packet.context_hash}</strong></div>}

      {resumeCheck && (
        <div className={styles.resume} data-ready={resumeCheck.ready}>
          {resumeCheck.ready ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <div>
            <strong>{resumeCheck.ready ? 'DeepSeek context-оос үргэлжлүүлэхэд бэлэн' : 'Context дутуу'}</strong>
            <p>{resumeCheck.summary}</p>
            <span>Дараагийн алхам: {resumeCheck.nextAction}</span>
            {resumeCheck.missingContext.length > 0 && <ul>{resumeCheck.missingContext.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        </div>
      )}

      <button type="button" className={styles.smokeButton} onClick={() => void runSmoke()} disabled={Boolean(loading)}>
        {loading === 'smoke' ? <LoaderCircle size={18} className={styles.spinning} /> : <ShieldCheck size={18} />}
        {loading === 'smoke' ? 'Mission Canvas шалгаж байна…' : 'Phase 4B smoke test ажиллуулах'}
      </button>

      {smokeSteps.length > 0 && (
        <div className={styles.steps}>
          {smokeSteps.map((step) => (
            <div key={step.label} data-passed={step.passed}>
              {step.passed ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </div>
          ))}
        </div>
      )}

      {status && <div className={styles.status} data-success={allPassed || /бэлэн|хуулсан|export|амжилттай/.test(status)}>{status}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </section>
  )
}

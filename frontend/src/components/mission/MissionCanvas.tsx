import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Target,
  UserRound,
} from 'lucide-react'
import {
  getMission,
  listMissions,
  resolveMissionDecision,
  type MissionDecision,
  type MissionOperation,
  type MissionRecord,
} from '../../lib/missionClient'
import { useSettingsStore } from '../../store/settingsStore'
import { MissionComposer } from './MissionComposer'
import styles from './MissionCanvas.module.css'

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('mn-MN')
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

function lifecycleLabel(value: string): string {
  const labels: Record<string, string> = {
    captured: 'Хүсэлт бүртгэгдсэн',
    framing: 'Ойлголт тодруулж байна',
    planned: 'Төлөвлөгдсөн',
    executing: 'Хэрэгжиж байна',
    verifying: 'Шалгаж байна',
    decision: 'Шийдвэр хүлээж байна',
    completed: 'Дууссан',
    packaged: 'Багцлагдсан',
    paused: 'Түр зогссон',
    cancelled: 'Цуцлагдсан',
    failed: 'Алдаатай зогссон',
  }
  return labels[value] ?? value
}

function nextAction(mission: MissionRecord): string {
  const openDecision = mission.decisions.find((item) => item.status === 'open')
  if (openDecision) return `Owner шийдвэр: ${openDecision.title}`
  const activeTask = mission.tasks.find((item) => ['ready', 'running', 'waiting', 'blocked'].includes(item.status))
  if (activeTask) return activeTask.title
  if (mission.goals.length === 0) return 'Mission-ийн зорилго, хүссэн үр дүнг баталгаажуулах'
  if (mission.acceptance_criteria.length === 0) return 'Дууссан гэж тооцох шалгууруудыг нэмэх'
  if (mission.lifecycle === 'captured') return 'Ойлголтыг тодруулж framing төлөвт оруулах'
  return 'Одоогийн төлөвөөс хамгийн үнэ цэнтэй дараагийн ажлыг төлөвлөх'
}

function operationLabel(operation: MissionOperation): string {
  const kind = operation.kind.replace('mission_mutation:', '')
  const labels: Record<string, string> = {
    add_goal: 'Goal нэмэгдсэн',
    add_criterion: 'Done criterion нэмэгдсэн',
    record_decision: 'Owner шийдвэр хүссэн',
    resolve_decision: 'Owner шийдвэр гаргасан',
    add_task: 'Task нэмэгдсэн',
    update_task: 'Task шинэчлэгдсэн',
    record_operation: 'Operation бүртгэгдсэн',
    update_operation: 'Operation шинэчлэгдсэн',
  }
  return labels[kind] ?? operation.kind.replaceAll('_', ' ')
}

export function MissionCanvas() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const [missions, setMissions] = useState<MissionRecord[]>([])
  const [selected, setSelected] = useState<MissionRecord | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolvingDecisionId, setResolvingDecisionId] = useState('')
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const refresh = useCallback(async (preferredId?: string) => {
    if (!useSettingsStore.getState().isConfigured()) return
    setLoading(true)
    setError('')
    try {
      const items = await listMissions(40)
      setMissions(items)
      const targetId = preferredId ?? selected?.mission_id ?? items[0]?.mission_id
      if (!targetId) {
        setSelected(null)
        setComposerOpen(true)
        return
      }
      setSelected(await getMission(targetId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [selected?.mission_id])

  useEffect(() => {
    if (!configured) {
      setMissions([])
      setSelected(null)
      return
    }
    void refresh()
  }, [configured]) // eslint-disable-line react-hooks/exhaustive-deps

  const openDecisions = useMemo(() => selected?.decisions.filter((item) => item.status === 'open') ?? [], [selected])
  const activeTasks = useMemo(() => selected?.tasks.filter((item) => !['completed', 'cancelled', 'failed'].includes(item.status)) ?? [], [selected])
  const recentOperations = useMemo(() => [...(selected?.operations ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 7), [selected])
  const staleError = /context version mismatch|active writer lease|held by/i.test(error)

  async function selectMission(missionId: string) {
    setLoading(true)
    setError('')
    try {
      setSelected(await getMission(missionId))
      setComposerOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function resolveDecision(decision: MissionDecision, status: 'accepted' | 'rejected' | 'superseded') {
    if (!selected) return
    setResolvingDecisionId(decision.decision_id)
    setError('')
    try {
      const updated = await resolveMissionDecision(selected.mission_id, decision.decision_id, status, decisionNotes[decision.decision_id] ?? '')
      setDecisionNotes((current) => ({ ...current, [decision.decision_id]: '' }))
      await refresh(updated.mission_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResolvingDecisionId('')
    }
  }

  return (
    <div className={styles.canvas}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>MISSION CONTROL</span>
          <h1>Mission Canvas</h1>
          <p>{owner && repo ? `${owner}/${repo}` : 'Repository тохируулаагүй'}</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" aria-label="Mission жагсаалт шинэчлэх" onClick={() => void refresh()} disabled={!configured || loading}>
            <RefreshCw size={18} className={loading ? styles.spinning : ''} />
          </button>
          <button type="button" aria-label="Шинэ Mission" onClick={() => { setError(''); setComposerOpen(true) }} disabled={!configured}>
            <Plus size={19} />
          </button>
        </div>
      </header>

      <div className={`${styles.body} scroll-y`}>
        {!configured && (
          <section className={styles.emptyCard}>
            <AlertCircle size={24} />
            <h2>Backend тохиргоо шаардлагатай</h2>
            <p>Settings дотор backend URL, Auth token, GitHub owner болон repo-г тохируулсны дараа Mission Canvas ажиллана.</p>
          </section>
        )}

        {configured && (
          <>
            {missions.length > 0 && (
              <section className={styles.missionStrip} aria-label="Mission жагсаалт">
                {missions.map((mission) => (
                  <button type="button" key={mission.mission_id} className={selected?.mission_id === mission.mission_id ? styles.missionActive : ''} onClick={() => void selectMission(mission.mission_id)}>
                    <span>{mission.title}</span>
                    <small>{lifecycleLabel(mission.lifecycle)} · v{mission.context_version}</small>
                  </button>
                ))}
              </section>
            )}

            {composerOpen && (
              <MissionComposer
                hasExistingMissions={missions.length > 0}
                onCancel={() => setComposerOpen(false)}
                onCreated={async (mission) => {
                  setComposerOpen(false)
                  await refresh(mission.mission_id)
                }}
              />
            )}

            {error && (
              <div className={styles.error}>
                <AlertCircle size={17} />
                <div>
                  <span>{error}</span>
                  {staleError && <button type="button" onClick={() => void refresh()}>Шинэ төлөв татах</button>}
                </div>
              </div>
            )}

            {!composerOpen && selected && (
              <>
                <section className={styles.heroCard}>
                  <div className={styles.heroTop}>
                    <div><span className={styles.lifecycle}>{lifecycleLabel(selected.lifecycle)}</span><h2>{selected.title}</h2></div>
                    <Target size={26} />
                  </div>
                  <div className={styles.nextAction}><span>Дараагийн хамгийн үнэ цэнтэй алхам</span><strong>{nextAction(selected)}</strong><ChevronRight size={18} /></div>
                  <div className={styles.metaGrid}>
                    <div><span>Context</span><strong>v{selected.context_version}</strong></div>
                    <div><span>Hash</span><strong>{shortHash(selected.context_hash)}</strong></div>
                    <div><span>Шинэчилсэн</span><strong>{formatDate(selected.updated_at)}</strong></div>
                  </div>
                </section>

                <section className={styles.summaryGrid}>
                  <article><Target size={18} /><span>Goals</span><strong>{selected.goals.length}</strong></article>
                  <article><ListChecks size={18} /><span>Done criteria</span><strong>{selected.acceptance_criteria.length}</strong></article>
                  <article><Inbox size={18} /><span>Decision</span><strong>{openDecisions.length}</strong></article>
                  <article><Clock3 size={18} /><span>Active tasks</span><strong>{activeTasks.length}</strong></article>
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.sectionTitle}><Target size={19} /><div><span>OWNER INTENT</span><h2>Зорилго ба хүссэн үр дүн</h2></div></div>
                  {selected.goals.length === 0 ? <p className={styles.emptyText}>Зорилго оруулаагүй.</p> : selected.goals.map((goal) => <div className={styles.goal} key={goal.goal_id}><strong>{goal.title}</strong><p>{goal.outcome}</p></div>)}
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.sectionTitle}><ListChecks size={19} /><div><span>DONE CONTRACT</span><h2>Дууссан гэж тооцох шалгуур</h2></div></div>
                  {selected.acceptance_criteria.length === 0 ? <p className={styles.emptyText}>Шалгуур оруулаагүй. Шинэ Mission үүсгэхдээ AI framing ашиглах эсвэл дараагийн mutation editor-оор нэмнэ.</p> : selected.acceptance_criteria.map((criterion) => <div className={styles.criteriaRow} key={criterion.criterion_id}><CheckCircle2 size={17} /><span>{criterion.statement}</span><small>{criterion.status}</small></div>)}
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.sectionTitle}><Inbox size={19} /><div><span>NEEDS YOUR DECISION</span><h2>Owner шийдвэрийн inbox</h2></div></div>
                  {openDecisions.length === 0 ? <p className={styles.emptyText}>Одоогоор owner-оос шийдвэр шаардах зүйл алга.</p> : openDecisions.map((decision) => (
                    <div className={styles.decisionCard} key={decision.decision_id}>
                      <div className={styles.decisionSummary}><CircleDecision /><div><strong>{decision.title}</strong><span>{decision.rationale}</span></div></div>
                      <textarea
                        rows={2}
                        value={decisionNotes[decision.decision_id] ?? ''}
                        onChange={(event) => setDecisionNotes((current) => ({ ...current, [decision.decision_id]: event.target.value }))}
                        placeholder="Шийдвэрийн тайлбар (сонголттой)"
                        maxLength={1000}
                      />
                      <div className={styles.decisionActions}>
                        <button type="button" className={styles.decisionAccept} disabled={Boolean(resolvingDecisionId)} onClick={() => void resolveDecision(decision, 'accepted')}>Зөвшөөрөх</button>
                        <button type="button" disabled={Boolean(resolvingDecisionId)} onClick={() => void resolveDecision(decision, 'rejected')}>Татгалзах</button>
                        <button type="button" disabled={Boolean(resolvingDecisionId)} onClick={() => void resolveDecision(decision, 'superseded')}>Хуучирсан</button>
                        {resolvingDecisionId === decision.decision_id && <LoaderCircle size={17} className={styles.spinning} />}
                      </div>
                    </div>
                  ))}
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.sectionTitle}><Clock3 size={19} /><div><span>PROGRESS &amp; LEASE</span><h2>Явцын timeline</h2></div></div>
                  <div className={styles.timelineRow}><div className={styles.timelineDot} /><div><strong>Mission үүссэн</strong><span>{formatDate(selected.created_at)}</span></div></div>
                  {recentOperations.map((operation) => <div className={styles.timelineRow} key={operation.operation_id}><div className={styles.timelineDot} /><div><strong>{operationLabel(operation)}</strong><span>{operation.status} · {formatDate(operation.updated_at)}</span></div></div>)}
                  <div className={styles.leaseRow}><UserRound size={18} /><div><strong>{selected.writer_lease ? selected.writer_lease.holder_id : 'Идэвхтэй writer байхгүй'}</strong><span>{selected.writer_lease ? `Lease ${formatDate(selected.writer_lease.expires_at)} хүртэл · heartbeat ${formatDate(selected.writer_lease.heartbeat_at)}` : 'Дараагийн агент lease авч өөрчлөлт хийнэ.'}</span></div></div>
                </section>
              </>
            )}

            {!composerOpen && !selected && !loading && (
              <section className={styles.emptyCard}>
                <Target size={26} />
                <h2>Эхний Mission-оо үүсгэнэ үү</h2>
                <p>Зорилгоо нэг удаа бичиж, дараагийн AI бүр ижил durable context-оос үргэлжлүүлэх суурь эндээс эхэлнэ.</p>
                <button type="button" className={styles.primaryButton} onClick={() => setComposerOpen(true)}><Plus size={18} /> Mission үүсгэх</button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CircleDecision() {
  return <span className={styles.decisionIcon}>?</span>
}

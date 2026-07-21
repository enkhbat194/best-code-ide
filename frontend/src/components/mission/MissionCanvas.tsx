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
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  createMissionFromIntent,
  getMission,
  listMissions,
  type MissionIntentDraft,
  type MissionRecord,
} from '../../lib/missionClient'
import { frameMissionIntent, type MissionFramingProposal } from '../../lib/missionFraming'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './MissionCanvas.module.css'

const emptyDraft: MissionIntentDraft = { title: '', intent: '' }

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

export function MissionCanvas() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const owner = useSettingsStore((state) => state.owner)
  const repo = useSettingsStore((state) => state.repo)
  const [missions, setMissions] = useState<MissionRecord[]>([])
  const [selected, setSelected] = useState<MissionRecord | null>(null)
  const [draft, setDraft] = useState<MissionIntentDraft>(emptyDraft)
  const [proposal, setProposal] = useState<MissionFramingProposal | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [framing, setFraming] = useState(false)
  const [creating, setCreating] = useState(false)
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
  const activeTasks = useMemo(() => selected?.tasks.filter((item) => !['completed', 'cancelled'].includes(item.status)) ?? [], [selected])
  const recentOperations = useMemo(() => [...(selected?.operations ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5), [selected])

  function updateDraft(field: keyof MissionIntentDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setProposal(null)
  }

  async function frameIntent() {
    setFraming(true)
    setError('')
    try {
      setProposal(await frameMissionIntent(draft))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setFraming(false)
    }
  }

  async function createMission(useProposal: boolean) {
    setCreating(true)
    setError('')
    try {
      const source = useProposal && proposal
        ? { title: proposal.title, intent: proposal.outcome, acceptanceCriteria: proposal.acceptanceCriteria }
        : draft
      const mission = await createMissionFromIntent(source)
      setDraft(emptyDraft)
      setProposal(null)
      setComposerOpen(false)
      await refresh(mission.mission_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

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

  function openComposer() {
    setDraft(emptyDraft)
    setProposal(null)
    setError('')
    setComposerOpen(true)
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
          <button type="button" aria-label="Шинэ Mission" onClick={openComposer} disabled={!configured}>
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
              <section className={styles.composerCard}>
                <div className={styles.sectionTitle}>
                  <Target size={19} />
                  <div><span>INTENT CAPTURE</span><h2>Шинэ Mission үүсгэх</h2></div>
                </div>
                <label>
                  Mission-ийн нэр
                  <input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="Жишээ: Phase 4B Mission Canvas бүтээх" maxLength={300} />
                </label>
                <label>
                  Эцэст нь ямар бодит үр дүн хүсэж байна вэ?
                  <textarea value={draft.intent} onChange={(event) => updateDraft('intent', event.target.value)} placeholder="Хэрэглэгч юу хийж чаддаг болох, ямар нөхцөлд дууссан гэж тооцохыг энгийн үгээр бичнэ." maxLength={1000} rows={5} />
                </label>

                {!proposal && (
                  <button type="button" className={styles.aiButton} onClick={() => void frameIntent()} disabled={framing || creating || !draft.title.trim() || !draft.intent.trim()}>
                    {framing ? <LoaderCircle size={18} className={styles.spinning} /> : <Sparkles size={18} />}
                    {framing ? 'AI ойлголт боловсруулж байна…' : 'AI-аар ойлголт ба done criteria боловсруулах'}
                  </button>
                )}

                {proposal && (
                  <div className={styles.proposalCard}>
                    <div className={styles.proposalHeader}>
                      <div><span>AI UNDERSTANDING</span><h3>AI-ийн ойлгосон нь</h3></div>
                      <button type="button" onClick={() => void frameIntent()} disabled={framing}><RefreshCw size={16} className={framing ? styles.spinning : ''} /> Дахин</button>
                    </div>
                    <label>
                      Баталгаажуулах нэр
                      <input value={proposal.title} onChange={(event) => setProposal((current) => current ? { ...current, title: event.target.value } : current)} maxLength={300} />
                    </label>
                    <label>
                      Баталгаажуулах үр дүн
                      <textarea value={proposal.outcome} onChange={(event) => setProposal((current) => current ? { ...current, outcome: event.target.value } : current)} maxLength={1000} rows={4} />
                    </label>
                    <ProposalList title="Таамагласан нөхцөл" items={proposal.assumptions} />
                    <ProposalList title="Энэ Mission-д орохгүй" items={proposal.exclusions} />
                    <ProposalList title="Эрсдэл" items={proposal.risks} />
                    <div className={styles.criteriaEditor}>
                      <div className={styles.criteriaEditorTitle}><strong>Done criteria</strong><span>{proposal.acceptanceCriteria.length}/4</span></div>
                      {proposal.acceptanceCriteria.map((criterion, index) => (
                        <div className={styles.criteriaEditRow} key={`${index}-${criterion.slice(0, 12)}`}>
                          <input
                            value={criterion}
                            maxLength={180}
                            onChange={(event) => setProposal((current) => current ? { ...current, acceptanceCriteria: current.acceptanceCriteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) } : current)}
                          />
                          <button type="button" aria-label="Шалгуур устгах" onClick={() => setProposal((current) => current ? { ...current, acceptanceCriteria: current.acceptanceCriteria.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={16} /></button>
                        </div>
                      ))}
                      {proposal.acceptanceCriteria.length < 4 && (
                        <button type="button" className={styles.addCriterion} onClick={() => setProposal((current) => current ? { ...current, acceptanceCriteria: [...current.acceptanceCriteria, ''] } : current)}><Plus size={16} /> Шалгуур нэмэх</button>
                      )}
                    </div>
                  </div>
                )}

                <div className={styles.confirmation}>
                  <ShieldCheck size={18} />
                  <div>
                    <strong>Owner баталгаажуулалт</strong>
                    <span>{proposal ? 'AI proposal автоматаар батлагдахгүй. Та засварласан нэр, үр дүн, done criteria-г баталсны дараа л durable Mission-д хадгална.' : 'AI ашиглахгүйгээр шууд үүсгэвэл таны бичсэн нэр ба үр дүн Goal болж хадгалагдана; done criteria хоосон үлдэнэ.'}</span>
                  </div>
                </div>
                <div className={styles.composerActions}>
                  {missions.length > 0 && <button type="button" className={styles.secondaryButton} onClick={() => setComposerOpen(false)}>Болих</button>}
                  {!proposal && (
                    <button type="button" className={styles.secondaryButton} onClick={() => void createMission(false)} disabled={creating || framing || !draft.title.trim() || !draft.intent.trim()}>
                      AI-гүйгээр үүсгэх
                    </button>
                  )}
                  {proposal && (
                    <button type="button" className={styles.primaryButton} onClick={() => void createMission(true)} disabled={creating || framing || !proposal.title.trim() || !proposal.outcome.trim() || proposal.acceptanceCriteria.filter((item) => item.trim()).length < 2}>
                      {creating ? <LoaderCircle size={18} className={styles.spinning} /> : <CheckCircle2 size={18} />}
                      {creating ? 'Mission хадгалж байна…' : 'Ойлголт ба done contract-ийг батлах'}
                    </button>
                  )}
                </div>
              </section>
            )}

            {error && <div className={styles.error}><AlertCircle size={17} /><span>{error}</span></div>}

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
                  {openDecisions.length === 0 ? <p className={styles.emptyText}>Одоогоор owner-оос шийдвэр шаардах зүйл алга.</p> : openDecisions.map((decision) => <div className={styles.decisionRow} key={decision.decision_id}><CircleDecision /><div><strong>{decision.title}</strong><span>{decision.rationale}</span></div></div>)}
                </section>

                <section className={styles.detailCard}>
                  <div className={styles.sectionTitle}><Clock3 size={19} /><div><span>PROGRESS &amp; LEASE</span><h2>Явцын timeline</h2></div></div>
                  <div className={styles.timelineRow}><div className={styles.timelineDot} /><div><strong>Mission үүссэн</strong><span>{formatDate(selected.created_at)}</span></div></div>
                  {recentOperations.map((operation) => <div className={styles.timelineRow} key={operation.operation_id}><div className={styles.timelineDot} /><div><strong>{operation.kind.replaceAll('_', ' ')}</strong><span>{operation.status} · {formatDate(operation.updated_at)}</span></div></div>)}
                  <div className={styles.leaseRow}><UserRound size={18} /><div><strong>{selected.writer_lease ? selected.writer_lease.holder_id : 'Идэвхтэй writer байхгүй'}</strong><span>{selected.writer_lease ? `Lease ${formatDate(selected.writer_lease.expires_at)} хүртэл` : 'Дараагийн агент lease авч өөрчлөлт хийнэ.'}</span></div></div>
                </section>
              </>
            )}

            {!composerOpen && !selected && !loading && (
              <section className={styles.emptyCard}>
                <Target size={26} />
                <h2>Эхний Mission-оо үүсгэнэ үү</h2>
                <p>Зорилгоо нэг удаа бичиж, дараагийн AI бүр ижил durable context-оос үргэлжлүүлэх суурь эндээс эхэлнэ.</p>
                <button type="button" className={styles.primaryButton} onClick={openComposer}><Plus size={18} /> Mission үүсгэх</button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ProposalList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return <div className={styles.proposalList}><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
}

function CircleDecision() {
  return <span className={styles.decisionIcon}>?</span>
}

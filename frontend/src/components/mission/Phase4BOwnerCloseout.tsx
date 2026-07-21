import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { createFileReference, createUrlReference, type IntentReference } from '../../lib/intentCapture'
import {
  createPhase4BCloseoutMission,
  evaluatePhase4BCloseout,
  findLatestPhase4BCloseoutMission,
  PHASE4B_CLOSEOUT_DECISIONS,
  resolvePhase4BCloseoutDecision,
} from '../../lib/phase4BCloseout'
import { getMission, type MissionRecord } from '../../lib/missionClient'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './Phase4BOwnerCloseout.module.css'

export function Phase4BOwnerCloseout() {
  const configured = useSettingsStore((state) => state.isConfigured())
  const [imageReference, setImageReference] = useState<IntentReference | null>(null)
  const [fileReference, setFileReference] = useState<IntentReference | null>(null)
  const [urlReference, setUrlReference] = useState<IntentReference | null>(null)
  const [urlInput, setUrlInput] = useState('https://github.com/enkhbat194/best-code-ide#phase4b-owner-test')
  const [mission, setMission] = useState<MissionRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeDecision, setActiveDecision] = useState('')
  const [error, setError] = useState('')
  const [setupMode, setSetupMode] = useState(false)

  const evaluation = useMemo(() => mission ? evaluatePhase4BCloseout(mission) : null, [mission])
  const references = useMemo(
    () => [imageReference, fileReference, urlReference].filter((item): item is IntentReference => Boolean(item)),
    [imageReference, fileReference, urlReference],
  )

  async function loadLatest() {
    if (!useSettingsStore.getState().isConfigured()) return
    setLoading(true)
    setError('')
    try {
      const latest = await findLatestPhase4BCloseoutMission()
      setMission(latest)
      setSetupMode(!latest)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (configured) void loadLatest()
  }, [configured]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectImage(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const reference = createFileReference(file)
    if (reference.kind !== 'image') {
      setError('Зураг сонгоно уу.')
      return
    }
    setImageReference(reference)
    setError('')
  }

  function selectFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const reference = createFileReference(file)
    if (reference.kind === 'image') {
      setError('Энэ хэсэгт зураг биш PDF, TXT, MD, JSON, CSV эсвэл DOC файл сонгоно уу.')
      return
    }
    setFileReference(reference)
    setError('')
  }

  function addUrl() {
    setError('')
    try {
      setUrlReference(createUrlReference(urlInput))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function createCanary() {
    setLoading(true)
    setError('')
    try {
      const created = await createPhase4BCloseoutMission(references)
      setMission(created)
      setSetupMode(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function refreshMission() {
    if (!mission) return loadLatest()
    setLoading(true)
    setError('')
    try {
      setMission(await getMission(mission.mission_id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function resolveDecision(spec: typeof PHASE4B_CLOSEOUT_DECISIONS[number]) {
    if (!mission) return
    setActiveDecision(spec.key)
    setError('')
    try {
      setMission(await resolvePhase4BCloseoutDecision(mission, spec))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setActiveDecision('')
    }
  }

  if (!configured) {
    return (
      <section className={styles.page}>
        <div className={styles.notice}>Settings дотор backend URL, token, owner болон repo-г тохируулсны дараа owner closeout test ажиллана.</div>
      </section>
    )
  }

  return (
    <section className={`${styles.page} scroll-y`}>
      <header className={styles.header}>
        <div>
          <span>PHASE 4B FORMAL CLOSEOUT</span>
          <h1>Owner-ийн эцсийн шалгалт</h1>
          <p>Нэг зураг, нэг файл, нэг URL metadata болон Decision inbox-ийн гурван төлөвийг production дээр батална.</p>
        </div>
        <button type="button" aria-label="Шалгалтын төлөв шинэчлэх" onClick={() => void refreshMission()} disabled={loading}>
          <RefreshCw size={19} className={loading ? styles.spinning : ''} />
        </button>
      </header>

      {error && <div className={styles.error}><XCircle size={18} /><span>{error}</span></div>}

      {setupMode && (
        <section className={styles.card}>
          <div className={styles.cardTitle}><ShieldCheck size={20} /><div><span>1. CAPTURE</span><h2>Зураг, файл, URL сонгох</h2></div></div>
          <p className={styles.help}>Binary агуулга upload хийхгүй. Зөвхөн нэр, MIME төрөл, хэмжээ болон цэвэрлэсэн URL Mission Goal-д хадгалагдана.</p>

          <div className={styles.pickerGrid}>
            <label className={styles.picker}>
              <ImageIcon size={20} />
              <strong>Зураг сонгох</strong>
              <small>Photos-оос screenshot эсвэл зураг</small>
              <input type="file" accept="image/*" onChange={(event) => { selectImage(event.target.files); event.target.value = '' }} />
            </label>
            <label className={styles.picker}>
              <FileText size={20} />
              <strong>Файл сонгох</strong>
              <small>PDF, TXT, MD, JSON, CSV эсвэл DOC</small>
              <input type="file" accept=".pdf,.txt,.md,.json,.csv,.doc,.docx" onChange={(event) => { selectFile(event.target.files); event.target.value = '' }} />
            </label>
          </div>

          <ReferenceRow icon={<ImageIcon size={17} />} label="Зураг" reference={imageReference} />
          <ReferenceRow icon={<FileText size={17} />} label="Файл" reference={fileReference} />

          <div className={styles.urlRow}>
            <Link2 size={18} />
            <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" />
            <button type="button" onClick={addUrl}>URL нэмэх</button>
          </div>
          <ReferenceRow icon={<Link2 size={17} />} label="URL" reference={urlReference} />

          <button type="button" className={styles.primary} onClick={() => void createCanary()} disabled={loading || references.length !== 3}>
            {loading ? <LoaderCircle size={18} className={styles.spinning} /> : <ShieldCheck size={18} />}
            Closeout canary Mission үүсгэх
          </button>
        </section>
      )}

      {!setupMode && mission && evaluation && (
        <>
          <section className={styles.card}>
            <div className={styles.cardTitle}><ShieldCheck size={20} /><div><span>CAPTURE EVIDENCE</span><h2>Metadata хадгалалтын шалгалт</h2></div></div>
            <div className={styles.missionMeta}>
              <strong>{mission.title}</strong>
              <span>{mission.mission_id}</span>
              <small>{mission.lifecycle} · v{mission.context_version} · {mission.context_hash}</small>
            </div>
            <StatusRow passed={evaluation.capture.image} label="Зургийн filename, MIME төрөл, хэмжээ хадгалагдсан" />
            <StatusRow passed={evaluation.capture.file} label="Файлын filename, MIME төрөл, хэмжээ хадгалагдсан" />
            <StatusRow passed={evaluation.capture.url} label="http/https URL normalize хийгдэж хадгалагдсан" />
            <StatusRow passed={evaluation.capture.binaryNotStored} label="Binary агуулга хадгалаагүй гэж тэмдэглэгдсэн" />
          </section>

          <section className={styles.card}>
            <div className={styles.cardTitle}><ShieldCheck size={20} /><div><span>2. DECISION INBOX</span><h2>Гурван owner үйлдлийг дарааллаар турших</h2></div></div>
            <p className={styles.help}>Доорх карт бүр дээр зөвхөн заасан товчийг нэг удаа дарна. Үйлдэл бүр active writer lease, current context version болон idempotency хамгаалалтаар хадгалагдана.</p>
            <div className={styles.decisionList}>
              {evaluation.decisionChecks.map(({ spec, decision, passed }) => (
                <article className={styles.decision} key={spec.key}>
                  <div>
                    {passed ? <CheckCircle2 size={19} /> : <ShieldCheck size={19} />}
                    <div><strong>{spec.title}</strong><span>{decision?.status ?? 'үүсээгүй'}</span></div>
                  </div>
                  <button type="button" onClick={() => void resolveDecision(spec)} disabled={!decision || decision.status !== 'open' || Boolean(activeDecision)}>
                    {activeDecision === spec.key ? <LoaderCircle size={17} className={styles.spinning} /> : spec.buttonLabel}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTitle}><ShieldCheck size={20} /><div><span>3. CLEANUP</span><h2>Lifecycle ба writer lease</h2></div></div>
            <StatusRow passed={evaluation.leaseReleased} label="Writer lease null буюу бүрэн суллагдсан" />
            <StatusRow passed={evaluation.lifecycleRecovered} label="Бүх шийдвэр хаагдаж lifecycle planned төлөвт буцсан" />

            {evaluation.complete ? (
              <div className={styles.success}>
                <CheckCircle2 size={24} />
                <div><strong>Phase 4B owner closeout амжилттай</strong><span>Зураг, файл, URL capture болон accepted/rejected/superseded бүх production evidence бүрдлээ.</span></div>
              </div>
            ) : (
              <div className={styles.pending}>Ногоон болоогүй мөрүүдийг дээрх дарааллаар гүйцээнэ.</div>
            )}

            <button type="button" className={styles.secondary} onClick={() => { setMission(null); setSetupMode(true); setImageReference(null); setFileReference(null); setUrlReference(null) }}>
              <RotateCcw size={17} /> Шинэ canary тест эхлүүлэх
            </button>
          </section>
        </>
      )}

      {!setupMode && !mission && !loading && (
        <section className={styles.card}>
          <p className={styles.help}>Өмнөх closeout canary олдсонгүй.</p>
          <button type="button" className={styles.primary} onClick={() => setSetupMode(true)}>Шалгалт эхлүүлэх</button>
        </section>
      )}
    </section>
  )
}

function ReferenceRow({ icon, label, reference }: { icon: React.ReactNode; label: string; reference: IntentReference | null }) {
  return (
    <div className={`${styles.reference} ${reference ? styles.referenceReady : ''}`}>
      {icon}
      <div><strong>{label}</strong><span>{reference ? `${reference.label} · ${reference.detail}` : 'Сонгоогүй'}</span></div>
      {reference ? <CheckCircle2 size={18} /> : null}
    </div>
  )
}

function StatusRow({ passed, label }: { passed: boolean; label: string }) {
  return (
    <div className={`${styles.status} ${passed ? styles.statusPassed : ''}`}>
      {passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      <span>{label}</span>
      <strong>{passed ? 'passed' : 'pending'}</strong>
    </div>
  )
}

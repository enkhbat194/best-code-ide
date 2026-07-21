import { useRef, useState } from 'react'
import {
  CheckCircle2,
  FileUp,
  Image,
  Link2,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import {
  createFileReference,
  createUrlReference,
  serializeIntentWithReferences,
  startSpeechCapture,
  type IntentReference,
} from '../../lib/intentCapture'
import { createMissionFromIntent, type MissionIntentDraft, type MissionRecord } from '../../lib/missionClient'
import { frameMissionIntent, type MissionFramingProposal } from '../../lib/missionFraming'
import styles from './MissionCanvas.module.css'

const emptyDraft: MissionIntentDraft = { title: '', intent: '' }

export function MissionComposer({
  hasExistingMissions,
  onCreated,
  onCancel,
}: {
  hasExistingMissions: boolean
  onCreated: (mission: MissionRecord) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<MissionIntentDraft>(emptyDraft)
  const [proposal, setProposal] = useState<MissionFramingProposal | null>(null)
  const [references, setReferences] = useState<IntentReference[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [recording, setRecording] = useState(false)
  const [framing, setFraming] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const stopSpeechRef = useRef<(() => void) | null>(null)

  function updateDraft(field: keyof MissionIntentDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setProposal(null)
  }

  function addReference(reference: IntentReference) {
    setReferences((current) => [...current, reference].slice(0, 5))
    setProposal(null)
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files).slice(0, 5 - references.length)) addReference(createFileReference(file))
  }

  function addUrl() {
    setError('')
    try {
      addReference(createUrlReference(urlInput))
      setUrlInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function toggleSpeech() {
    if (recording) {
      stopSpeechRef.current?.()
      stopSpeechRef.current = null
      setRecording(false)
      return
    }
    setError('')
    const stop = startSpeechCapture({
      onTranscript: (text) => {
        setDraft((current) => ({ ...current, intent: `${current.intent}${current.intent.trim() ? ' ' : ''}${text}`.slice(0, 1000) }))
        setProposal(null)
      },
      onEnd: () => {
        stopSpeechRef.current = null
        setRecording(false)
      },
      onError: (message) => {
        setError(message)
        stopSpeechRef.current = null
        setRecording(false)
      },
    })
    if (!stop) {
      setError('Энэ browser дуу таних Web Speech API-г дэмжихгүй байна. Keyboard-ийн микрофон эсвэл текст ашиглана уу.')
      return
    }
    stopSpeechRef.current = stop
    setRecording(true)
  }

  function creationDraft(source: MissionIntentDraft, criteria?: string[]) {
    return {
      title: source.title,
      intent: serializeIntentWithReferences(source.intent, references),
      acceptanceCriteria: criteria,
    }
  }

  async function frameIntent() {
    setFraming(true)
    setError('')
    try {
      const framedDraft = { ...draft, intent: serializeIntentWithReferences(draft.intent, references) }
      setProposal(await frameMissionIntent(framedDraft))
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
        ? creationDraft({ title: proposal.title, intent: proposal.outcome }, proposal.acceptanceCriteria)
        : creationDraft(draft)
      const mission = await createMissionFromIntent(source)
      await onCreated(mission)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  return (
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

      <div className={styles.captureTools}>
        <button type="button" onClick={toggleSpeech} className={recording ? styles.captureActive : ''}>
          {recording ? <MicOff size={17} /> : <Mic size={17} />}
          {recording ? 'Зогсоох' : 'Дуугаар хэлэх'}
        </button>
        <label className={styles.fileButton}>
          <FileUp size={17} /> Файл/зураг
          <input type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx" onChange={(event) => { handleFiles(event.target.files); event.target.value = '' }} />
        </label>
      </div>

      <div className={styles.urlCapture}>
        <Link2 size={17} />
        <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://... лавлагаа нэмэх" inputMode="url" autoCapitalize="off" autoCorrect="off" />
        <button type="button" onClick={addUrl} disabled={!urlInput.trim() || references.length >= 5}><Plus size={17} /></button>
      </div>

      {references.length > 0 && (
        <div className={styles.referenceList}>
          <div className={styles.referenceHeader}><strong>Лавлагаа metadata</strong><span>{references.length}/5 · binary хадгалахгүй</span></div>
          {references.map((reference) => (
            <div className={styles.referenceRow} key={reference.referenceId}>
              {reference.kind === 'image' ? <Image size={17} /> : reference.kind === 'url' ? <Link2 size={17} /> : <FileUp size={17} />}
              <div><strong>{reference.label}</strong><span>{reference.detail}</span></div>
              <button type="button" aria-label="Лавлагаа хасах" onClick={() => { setReferences((current) => current.filter((item) => item.referenceId !== reference.referenceId)); setProposal(null) }}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}

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
                <input value={criterion} maxLength={180} onChange={(event) => setProposal((current) => current ? { ...current, acceptanceCriteria: current.acceptanceCriteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) } : current)} />
                <button type="button" aria-label="Шалгуур устгах" onClick={() => setProposal((current) => current ? { ...current, acceptanceCriteria: current.acceptanceCriteria.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={16} /></button>
              </div>
            ))}
            {proposal.acceptanceCriteria.length < 4 && <button type="button" className={styles.addCriterion} onClick={() => setProposal((current) => current ? { ...current, acceptanceCriteria: [...current.acceptanceCriteria, ''] } : current)}><Plus size={16} /> Шалгуур нэмэх</button>}
          </div>
        </div>
      )}

      {error && <div className={styles.composerError}>{error}</div>}

      <div className={styles.confirmation}>
        <ShieldCheck size={18} />
        <div>
          <strong>Owner баталгаажуулалт</strong>
          <span>{proposal ? 'AI proposal автоматаар батлагдахгүй. Та засварласан нэр, үр дүн, done criteria-г баталсны дараа л durable Mission-д хадгална.' : 'AI ашиглахгүйгээр шууд үүсгэвэл таны бичсэн нэр, үр дүн болон bounded reference metadata Goal-д хадгалагдана; done criteria хоосон үлдэнэ.'}</span>
        </div>
      </div>
      <div className={styles.composerActions}>
        {hasExistingMissions && <button type="button" className={styles.secondaryButton} onClick={onCancel}>Болих</button>}
        {!proposal && <button type="button" className={styles.secondaryButton} onClick={() => void createMission(false)} disabled={creating || framing || !draft.title.trim() || !draft.intent.trim()}>AI-гүйгээр үүсгэх</button>}
        {proposal && (
          <button type="button" className={styles.primaryButton} onClick={() => void createMission(true)} disabled={creating || framing || !proposal.title.trim() || !proposal.outcome.trim() || proposal.acceptanceCriteria.filter((item) => item.trim()).length < 2}>
            {creating ? <LoaderCircle size={18} className={styles.spinning} /> : <CheckCircle2 size={18} />}
            {creating ? 'Mission хадгалж байна…' : 'Ойлголт ба done contract-ийг батлах'}
          </button>
        )}
      </div>
    </section>
  )
}

function ProposalList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return <div className={styles.proposalList}><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
}

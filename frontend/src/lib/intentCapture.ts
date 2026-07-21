export type IntentReferenceKind = 'url' | 'file' | 'image'

export interface IntentReference {
  referenceId: string
  kind: IntentReferenceKind
  label: string
  detail: string
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike
  }
}

function compact(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

export function createFileReference(file: File): IntentReference {
  const image = file.type.startsWith('image/')
  const sizeKb = Math.max(1, Math.round(file.size / 1024))
  return {
    referenceId: crypto.randomUUID(),
    kind: image ? 'image' : 'file',
    label: compact(file.name || (image ? 'Зураг' : 'Файл'), 100),
    detail: compact(`${file.type || 'unknown'} · ${sizeKb} KB`, 120),
  }
}

export function createUrlReference(raw: string): IntentReference {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('URL зөв хэлбэртэй биш байна.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Зөвхөн http эсвэл https URL ашиглана.')
  url.username = ''
  url.password = ''
  url.hash = ''
  const normalized = url.toString().slice(0, 500)
  return {
    referenceId: crypto.randomUUID(),
    kind: 'url',
    label: compact(url.hostname, 100),
    detail: normalized,
  }
}

export function serializeIntentWithReferences(intent: string, references: IntentReference[]): string {
  const base = intent.trim().slice(0, 760)
  if (references.length === 0) return base
  const lines = references.slice(0, 5).map((reference) => {
    const type = reference.kind === 'image' ? 'зураг' : reference.kind === 'file' ? 'файл' : 'URL'
    return `- ${type}: ${compact(reference.label, 70)} (${compact(reference.detail, 120)})`
  })
  return `${base}\n\nХавсаргасан лавлагаа (binary хадгалаагүй):\n${lines.join('\n')}`.slice(0, 1000)
}

export function startSpeechCapture(options: {
  onTranscript: (text: string) => void
  onEnd: () => void
  onError: (message: string) => void
}): (() => void) | null {
  const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Constructor) return null

  const recognition = new Constructor()
  recognition.lang = 'mn-MN'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.onresult = (event) => {
    const transcripts: string[] = []
    for (let index = 0; index < event.results.length; index += 1) {
      const text = event.results[index]?.[0]?.transcript
      if (typeof text === 'string' && text.trim()) transcripts.push(text.trim())
    }
    if (transcripts.length > 0) options.onTranscript(transcripts.join(' '))
  }
  recognition.onerror = (event) => options.onError(event.error ? `Дуу таних алдаа: ${event.error}` : 'Дуу таних үед алдаа гарлаа.')
  recognition.onend = options.onEnd
  recognition.start()
  return () => recognition.stop()
}

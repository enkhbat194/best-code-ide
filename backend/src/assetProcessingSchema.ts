export const PROCESSING_JOB_SCHEMA_VERSION = 'processing-job-v1' as const
export const PROCESSING_RESULT_SCHEMA_VERSION = 'processing-result-v1' as const

export type AssetProcessingJobStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported'

export interface ProcessorIdentity {
  name: string
  version: string
}

export interface AssetProcessingJob {
  schema: typeof PROCESSING_JOB_SCHEMA_VERSION
  job_id: string
  asset_id: string
  project_id: string
  mission_id: string | null
  status: AssetProcessingJobStatus
  attempt_count: number
  processor_name: string
  processor_version: string
  started_at: string | null
  completed_at: string | null
  safe_error_code: string | null
  idempotency_key: string
  cache_key: string
  source_checksum: string
  result_object_id: string | null
  created_at: string
  updated_at: string
}

export interface ProcessingProvenance {
  contract: 'provider-neutral-vision-v1'
  processor_name: string
  processor_version: string
  derived_interpretation: true
  extracted_text_untrusted: true
  provider_request_id: string | null
}

export interface AssetProcessingResult {
  schema: typeof PROCESSING_RESULT_SCHEMA_VERSION
  asset_id: string
  project_id: string
  mission_id: string | null
  media_type: string
  summary: string
  visible_text: string
  objects: string[]
  concepts: string[]
  code_or_ui_detected: boolean
  language: string | null
  confidence: number
  warnings: string[]
  provenance: ProcessingProvenance
  source_checksum: string
  created_at: string
}

export interface VisionProcessorOutput {
  summary: unknown
  visible_text?: unknown
  objects?: unknown
  concepts?: unknown
  code_or_ui_detected?: unknown
  language?: unknown
  confidence?: unknown
  warnings?: unknown
  provider_request_id?: unknown
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|api[_-]?key|access[_-]?token|auth[_-]?token)[=: _-]+[A-Za-z0-9._~+\/-]{12,}/gi,
]

const PROMPT_INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)|system\s+(?:prompt|instruction)|developer\s+message|reveal\s+(?:the\s+)?(?:token|secret|key)|(?:run|execute)\s+(?:this\s+)?(?:command|code)|token\s+(?:өг|өгнө|өгөөрэй)|command\s+(?:ажиллуул|гүйцэтгэ))/i

function redact(value: string): string {
  let output = value
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '[REDACTED]')
  return output
}

function text(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return redact(value.replace(/\u0000/g, '').trim()).slice(0, max)
}

function textList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => text(item, maxChars)).filter(Boolean))].slice(0, maxItems)
}

export function containsPromptInjectionMarker(value: string): boolean {
  return PROMPT_INJECTION_PATTERN.test(value)
}

export function normalizeProcessingResult(
  asset: { asset_id: string; project_id: string; mission_id: string | null; media_type: string; sha256: string },
  processor: ProcessorIdentity,
  output: VisionProcessorOutput,
  createdAt = new Date().toISOString(),
): AssetProcessingResult {
  const summary = text(output.summary, 4_000)
  if (!summary) throw new Error('processor_result_invalid')
  const visibleText = text(output.visible_text, 20_000)
  const warnings = textList(output.warnings, 30, 240)
  if (containsPromptInjectionMarker(visibleText)) warnings.push('prompt_injection_text_detected')
  const confidenceValue = Number(output.confidence)
  const confidence = Number.isFinite(confidenceValue) ? Math.min(1, Math.max(0, confidenceValue)) : 0
  const language = text(output.language, 32) || null
  const providerRequestId = text(output.provider_request_id, 180) || null

  return {
    schema: PROCESSING_RESULT_SCHEMA_VERSION,
    asset_id: asset.asset_id,
    project_id: asset.project_id,
    mission_id: asset.mission_id,
    media_type: asset.media_type,
    summary,
    visible_text: visibleText,
    objects: textList(output.objects, 100, 120),
    concepts: textList(output.concepts, 100, 120),
    code_or_ui_detected: output.code_or_ui_detected === true,
    language,
    confidence,
    warnings: [...new Set(warnings)].slice(0, 30),
    provenance: {
      contract: 'provider-neutral-vision-v1',
      processor_name: text(processor.name, 64, 'unknown'),
      processor_version: text(processor.version, 64, 'unknown'),
      derived_interpretation: true,
      extracted_text_untrusted: true,
      provider_request_id: providerRequestId,
    },
    source_checksum: asset.sha256,
    created_at: createdAt,
  }
}

export function processingJobFromAttributes(value: unknown): AssetProcessingJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.processing_schema !== PROCESSING_JOB_SCHEMA_VERSION) return null
  const job = input.job
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null
  const parsed = job as Partial<AssetProcessingJob>
  if (
    parsed.schema !== PROCESSING_JOB_SCHEMA_VERSION ||
    typeof parsed.job_id !== 'string' ||
    typeof parsed.asset_id !== 'string' ||
    typeof parsed.project_id !== 'string' ||
    !['queued', 'processing', 'ready', 'failed', 'unsupported'].includes(String(parsed.status))
  ) return null
  return parsed as AssetProcessingJob
}

export function processingResultFromAttributes(value: unknown): AssetProcessingResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.processing_schema !== PROCESSING_RESULT_SCHEMA_VERSION) return null
  const result = input.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const parsed = result as Partial<AssetProcessingResult>
  if (
    parsed.schema !== PROCESSING_RESULT_SCHEMA_VERSION ||
    typeof parsed.asset_id !== 'string' ||
    typeof parsed.project_id !== 'string' ||
    typeof parsed.summary !== 'string'
  ) return null
  return parsed as AssetProcessingResult
}

import {
  getAssetProcessing,
  getAssetProcessingResult,
  hashFileSha256,
  processAsset,
  registerChatAsset,
  retryAssetProcessing,
  uploadAssetContent,
} from './assetClient'

export type VisionSmokeStepStatus = 'pending' | 'passed' | 'failed'

export interface VisionSmokeStep {
  key: 'fixture' | 'private_upload' | 'provider' | 'recognition' | 'integrity'
  label: string
  status: VisionSmokeStepStatus
  detail: string
}

export interface VisionSmokeReport {
  ok: boolean
  assetId: string | null
  resultObjectId: string | null
  processor: string | null
  processorVersion: string | null
  summary: string | null
  completedAt: string
  steps: VisionSmokeStep[]
}

const EXPECTED_PROCESSOR = 'cloudflare-workers-ai-moondream3.1'
const CANARY_MARKER = 'BESTCODE-VISION-7265'

function initialSteps(): VisionSmokeStep[] {
  return [
    { key: 'fixture', label: '1. Owner canary зураг', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'private_upload', label: '2. Private R2 upload', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'provider', label: '3. Workers AI processing', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'recognition', label: '4. Image recognition', status: 'pending', detail: 'Хүлээгдэж байна' },
    { key: 'integrity', label: '5. Result integrity', status: 'pending', detail: 'Хүлээгдэж байна' },
  ]
}

function updateStep(steps: VisionSmokeStep[], key: VisionSmokeStep['key'], status: VisionSmokeStepStatus, detail: string): void {
  const step = steps.find((item) => item.key === key)
  if (step) Object.assign(step, { status, detail })
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canary PNG үүсгэж чадсангүй.'))
    }, 'image/png')
  })
}

async function canaryFile(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 540
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas API ашиглах боломжгүй байна.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111111'
  context.font = '700 64px Arial, sans-serif'
  context.fillText(CANARY_MARKER, 45, 95)
  context.font = '700 38px Arial, sans-serif'
  context.fillText('PRIVATE IMAGE PIPELINE TEST V2', 45, 155)

  context.fillStyle = '#2464dc'
  context.beginPath()
  context.arc(170, 335, 90, 0, Math.PI * 2)
  context.fill()
  context.lineWidth = 6
  context.strokeStyle = '#111111'
  context.stroke()

  context.fillStyle = '#28b45a'
  context.fillRect(380, 255, 340, 165)
  context.strokeRect(380, 255, 340, 165)

  context.fillStyle = '#111111'
  context.font = '700 34px Arial, sans-serif'
  context.fillText('BLUE CIRCLE', 70, 485)
  context.fillText('GREEN RECTANGLE', 375, 485)

  return new File([await canvasBlob(canvas)], 'bestcode-vision-owner-canary-v2.png', {
    type: 'image/png',
    lastModified: 1_753_248_000_001,
  })
}

function semanticRecognition(value: string): boolean {
  const lower = value.toLowerCase()
  const compact = lower.normalize('NFKD').replace(/[^a-z0-9]+/g, '')
  const marker = compact.includes('bestcodevision7265')
  const circle = /circle|тойрог|дугуй/.test(lower)
  const rectangle = /rectangle|тэгш өнцөгт|дөрвөлжин/.test(lower)
  return marker || (circle && rectangle)
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value
}

export async function runVisionOwnerSmokeTest(): Promise<VisionSmokeReport> {
  const steps = initialSteps()
  let activeKey: VisionSmokeStep['key'] = 'fixture'
  let assetId: string | null = null
  let resultObjectId: string | null = null
  let processor: string | null = null
  let processorVersion: string | null = null
  let summary: string | null = null

  try {
    activeKey = 'fixture'
    const file = await canaryFile()
    const sha256 = await hashFileSha256(file)
    const requestedAssetId = `asset-vision-smoke-${sha256.slice(0, 20)}`
    updateStep(steps, 'fixture', 'passed', `${file.name} · ${file.size} bytes · ${short(sha256)}`)

    activeKey = 'private_upload'
    const registration = await registerChatAsset(file, sha256, requestedAssetId)
    let asset = registration.asset
    assetId = asset.asset_id
    if (asset.upload_status !== 'stored') {
      const uploaded = await uploadAssetContent(asset.asset_id, file, () => undefined)
      asset = uploaded.asset
    }
    if (asset.upload_status !== 'stored' || asset.sha256 !== sha256 || asset.media_type !== 'image/png') {
      throw new Error('Private upload metadata canary зурагтай таарахгүй байна.')
    }
    updateStep(steps, 'private_upload', 'passed', `${registration.duplicate ? 'Existing Asset reused' : 'Private Asset stored'} · ${short(asset.asset_id)}`)

    activeKey = 'provider'
    const current = await getAssetProcessing(asset.asset_id, asset.project_id)
    if (current.status === 'failed' || current.status === 'unsupported') {
      await retryAssetProcessing(asset.asset_id, asset.project_id)
    } else if (current.status !== 'ready') {
      await processAsset(asset.asset_id, asset.project_id)
    }
    const finalState = await getAssetProcessing(asset.asset_id, asset.project_id)
    if (finalState.status !== 'ready' || finalState.job?.processor_name !== EXPECTED_PROCESSOR) {
      throw new Error(finalState.job?.safe_error_code || `Processing ready болсонгүй: ${finalState.status}`)
    }
    processor = finalState.job.processor_name
    processorVersion = finalState.job.processor_version
    updateStep(steps, 'provider', 'passed', `${processor} · ${processorVersion} · attempt ${finalState.job.attempt_count}`)

    activeKey = 'recognition'
    const ready = await getAssetProcessingResult(asset.asset_id, asset.project_id)
    resultObjectId = ready.result_object_id
    summary = ready.result.summary
    const semanticText = [
      ready.result.summary,
      ready.result.visible_text,
      ...ready.result.objects,
      ...ready.result.concepts,
    ].join(' ')
    if (!semanticRecognition(semanticText)) {
      throw new Error('Provider canary text эсвэл дүрсүүдийг бодитоор таньсан нотолгоо буцаасангүй.')
    }
    updateStep(steps, 'recognition', 'passed', ready.result.visible_text.includes(CANARY_MARKER)
      ? `${CANARY_MARKER} OCR танигдсан`
      : 'Blue circle болон green rectangle дүрс танигдсан')

    activeKey = 'integrity'
    if (
      ready.result.asset_id !== asset.asset_id
      || ready.result.project_id !== asset.project_id
      || ready.result.source_checksum !== sha256
      || ready.result.provenance.processor_name !== EXPECTED_PROCESSOR
      || ready.result.provenance.derived_interpretation !== true
      || ready.result.provenance.extracted_text_untrusted !== true
    ) throw new Error('Processing result provenance эсвэл checksum Asset-тай таарахгүй байна.')
    updateStep(steps, 'integrity', 'passed', `Checksum, provider provenance, untrusted marker зөв · ${short(ready.result_object_id)}`)
  } catch (error) {
    updateStep(steps, activeKey, 'failed', error instanceof Error ? error.message : String(error))
  }

  return {
    ok: steps.every((step) => step.status === 'passed'),
    assetId,
    resultObjectId,
    processor,
    processorVersion,
    summary,
    completedAt: new Date().toISOString(),
    steps,
  }
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CLOUDFLARE_MOONDREAM_MODEL,
  CLOUDFLARE_MOONDREAM_PROCESSOR,
  CloudflareMoondreamVisionProcessor,
  VisionProviderError,
  resolveVisionProcessor,
} from './visionProcessor.ts'

const visionSmokeSource = await readFile(new URL('../../frontend/src/lib/visionSmoke.ts', import.meta.url), 'utf8')
const visionSmokeCardSource = await readFile(new URL('../../frontend/src/components/settings/VisionSmokeCard.tsx', import.meta.url), 'utf8')
const settingsViewSource = await readFile(new URL('../../frontend/src/components/settings/SettingsView.tsx', import.meta.url), 'utf8')

const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 2, 0, 0, 0, 3,
  8, 2, 0, 0, 0, 0, 0, 0, 0,
])

function input() {
  return {
    assetId: 'asset-vision-test',
    projectId: 'bestcode',
    mediaType: 'image/png',
    filename: 'vision.png',
    sha256: 'a'.repeat(64),
    bytes: png,
    image: {
      mediaType: 'image/png',
      width: 2,
      height: 3,
      animated: false,
      sizeBytes: png.byteLength,
    },
  }
}

const structuredAnswer = JSON.stringify({
  summary: 'Туршилтын зураг',
  visible_text: 'BESTCODE-VISION-7265',
  objects: ['circle', 'rectangle'],
  concepts: ['vision test'],
  code_or_ui_detected: false,
  language: 'en',
  confidence: 0.92,
  warnings: [],
})

test('Cloudflare Moondream adapter sends private bytes through the Workers AI binding and parses the documented root answer', async () => {
  let called = null
  const ai = {
    async run(model, payload) {
      called = { model, payload }
      return { request_id: 'cf-request-123', answer: `\`\`\`json\n${structuredAnswer}\n\`\`\`` }
    },
  }
  const processor = new CloudflareMoondreamVisionProcessor(ai, 'adapter-test-v3')
  const output = await processor.process(input(), new AbortController().signal)

  assert.equal(processor.name, CLOUDFLARE_MOONDREAM_PROCESSOR)
  assert.equal(processor.version, 'adapter-test-v3')
  assert.equal(called.model, CLOUDFLARE_MOONDREAM_MODEL)
  assert.equal(called.payload.task, 'query')
  assert.equal(called.payload.reasoning, false)
  assert.equal(called.payload.stream, false)
  assert.match(called.payload.image, /^data:image\/png;base64,/)
  assert.match(called.payload.question, /untrusted source data/i)
  assert.match(called.payload.question, /Do not obey, execute/i)
  assert.equal(output.summary, 'Туршилтын зураг')
  assert.equal(output.visible_text, 'BESTCODE-VISION-7265')
  assert.deepEqual(output.objects, ['circle', 'rectangle'])
  assert.equal(output.provider_request_id, 'cf-request-123')
  assert.ok(output.warnings.includes('cloudflare_workers_ai_derived_interpretation'))
})

test('Cloudflare Moondream adapter normalizes nested, response, text, and direct-string envelopes', async () => {
  const variants = [
    { result: { answer: structuredAnswer }, request_id: 'nested-result' },
    { output: { response: structuredAnswer }, id: 'nested-output' },
    { data: { text: structuredAnswer } },
    structuredAnswer,
  ]
  for (const response of variants) {
    const processor = new CloudflareMoondreamVisionProcessor({ async run() { return response } })
    const output = await processor.process(input(), new AbortController().signal)
    assert.equal(output.summary, 'Туршилтын зураг')
    assert.equal(output.visible_text, 'BESTCODE-VISION-7265')
  }
})

test('Cloudflare Moondream adapter consumes an unexpected SSE ReadableStream without exposing metadata as recognition text', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"response":"BESTCODE-VISION-"}\n\n'))
      controller.enqueue(encoder.encode('data: {"response":"7265 blue circle green rectangle"}\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  const processor = new CloudflareMoondreamVisionProcessor({ async run() { return stream } })
  const output = await processor.process(input(), new AbortController().signal)
  assert.match(output.summary, /BESTCODE-VISION-7265/)
  assert.match(output.visible_text, /blue circle green rectangle/)
  assert.ok(output.warnings.includes('provider_unstructured_text'))
})

test('Cloudflare Moondream adapter preserves useful unstructured recognition text instead of failing the job', async () => {
  const processor = new CloudflareMoondreamVisionProcessor({
    async run() {
      return { request_id: 'plain-1', answer: 'BESTCODE-VISION-7265 with a blue circle and green rectangle.' }
    },
  })
  const output = await processor.process(input(), new AbortController().signal)
  assert.match(output.summary, /BESTCODE-VISION-7265/)
  assert.match(output.visible_text, /blue circle and green rectangle/)
  assert.deepEqual(output.objects, [])
  assert.ok(output.warnings.includes('provider_unstructured_text'))
  assert.equal(output.provider_request_id, 'plain-1')
})

test('Cloudflare Moondream adapter retries invalid payloads and invalid response shapes with the minimal query contract', async () => {
  for (const first of [new Error('Invalid data type for base64 input'), { finish_reason: 'stop', metrics: {} }]) {
    const calls = []
    const processor = new CloudflareMoondreamVisionProcessor({
      async run(model, payload) {
        calls.push({ model, payload })
        if (calls.length === 1) {
          if (first instanceof Error) {
            first.code = 5004
            throw first
          }
          return first
        }
        return { result: { answer: '{"summary":"fallback ok","visible_text":"BESTCODE-VISION-7265"}' } }
      },
    })
    const output = await processor.process(input(), new AbortController().signal)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].model, CLOUDFLARE_MOONDREAM_MODEL)
    assert.equal(calls[1].payload.task, 'query')
    assert.equal(calls[1].payload.stream, false)
    assert.equal('temperature' in calls[1].payload, false)
    assert.equal('max_tokens' in calls[1].payload, false)
    assert.equal(output.summary, 'fallback ok')
  }
})

test('Cloudflare Moondream adapter exposes safe provider codes, rejects empty metadata, and honors abort', async () => {
  const unavailable = new CloudflareMoondreamVisionProcessor({
    async run() {
      const error = new Error('No such model')
      error.code = 5007
      throw error
    },
  })
  await assert.rejects(
    () => unavailable.process(input(), new AbortController().signal),
    (error) => error instanceof VisionProviderError && error.code === 'provider_model_unavailable',
  )

  let emptyCalls = 0
  const empty = new CloudflareMoondreamVisionProcessor({ async run() { emptyCalls += 1; return { answer: '', metrics: {} } } })
  await assert.rejects(
    () => empty.process(input(), new AbortController().signal),
    (error) => error instanceof VisionProviderError && error.code === 'provider_result_invalid',
  )
  assert.equal(emptyCalls, 2)

  const controller = new AbortController()
  const hanging = new CloudflareMoondreamVisionProcessor({ run: () => new Promise(() => undefined) })
  const pending = hanging.process(input(), controller.signal)
  controller.abort()
  await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError')
})

test('processor resolution requires explicit production mode and an AI binding', () => {
  const ai = { async run() { return { answer: '{"summary":"ok"}' } } }
  assert.equal(resolveVisionProcessor({ VISION_PROCESSOR_MODE: 'workers-ai' }), null)
  assert.equal(resolveVisionProcessor({ AI: ai }), null)
  const processor = resolveVisionProcessor({
    AI: ai,
    VISION_PROCESSOR_MODE: 'workers-ai',
    VISION_PROCESSOR_VERSION: 'production-v3',
  })
  assert.ok(processor instanceof CloudflareMoondreamVisionProcessor)
  assert.equal(processor.version, 'production-v3')
})

test('Wrangler enables the private Workers AI binding without adding provider secrets or public R2', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')
  const activeConfig = wrangler
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  assert.match(activeConfig, /\[ai\]\s*binding = "AI"/)
  assert.match(activeConfig, /VISION_PROCESSOR_MODE = "workers-ai"/)
  assert.match(activeConfig, /VISION_PROCESSOR_VERSION = "2026-07-23\.prompt-v3"/)
  assert.doesNotMatch(activeConfig, /r2\.dev|custom_domain|CLOUDFLARE_API_TOKEN\s*=/i)
})

test('installed PWA exposes a deterministic owner-visible private image recognition smoke test', () => {
  assert.match(visionSmokeSource, /BESTCODE-VISION-7265/)
  assert.match(visionSmokeSource, /PRIVATE IMAGE PIPELINE TEST V2/)
  assert.doesNotMatch(visionSmokeSource, /const CANARY_MARKER = 'BESTCODE-VISION-7264'/)
  assert.match(visionSmokeSource, /asset-vision-smoke-/)
  assert.doesNotMatch(visionSmokeSource, /asset:vision-smoke:/)
  assert.match(visionSmokeSource, /registerChatAsset/)
  assert.match(visionSmokeSource, /uploadAssetContent/)
  assert.match(visionSmokeSource, /processAsset/)
  assert.match(visionSmokeSource, /retryAssetProcessing/)
  assert.match(visionSmokeSource, /getAssetProcessingResult/)
  assert.match(visionSmokeSource, /cloudflare-workers-ai-moondream3\.1/)
  assert.match(visionSmokeSource, /source_checksum !== sha256/)
  assert.match(visionSmokeSource, /derived_interpretation !== true/)
  assert.match(visionSmokeSource, /extracted_text_untrusted !== true/)
  assert.match(visionSmokeCardSource, /Image recognition smoke test ажиллуулах/)
  assert.match(visionSmokeCardSource, /Chat 6 owner image recognition амжилттай/)
  assert.match(settingsViewSource, /<VisionSmokeCard \/>/)
})

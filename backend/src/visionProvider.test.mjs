import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CLOUDFLARE_MOONDREAM_MODEL,
  CLOUDFLARE_MOONDREAM_PROCESSOR,
  CloudflareMoondreamVisionProcessor,
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

test('Cloudflare Moondream adapter sends private bytes through the Workers AI binding and parses strict JSON', async () => {
  let called = null
  const ai = {
    async run(model, payload) {
      called = { model, payload }
      return {
        request_id: 'cf-request-123',
        answer: '```json\n{"summary":"Туршилтын зураг","visible_text":"BESTCODE-VISION-7264","objects":["circle","rectangle"],"concepts":["vision test"],"code_or_ui_detected":false,"language":"en","confidence":0.92,"warnings":[]}\n```',
      }
    },
  }
  const processor = new CloudflareMoondreamVisionProcessor(ai, 'adapter-test-v1')
  const output = await processor.process(input(), new AbortController().signal)

  assert.equal(processor.name, CLOUDFLARE_MOONDREAM_PROCESSOR)
  assert.equal(processor.version, 'adapter-test-v1')
  assert.equal(called.model, CLOUDFLARE_MOONDREAM_MODEL)
  assert.equal(called.payload.task, 'query')
  assert.equal(called.payload.reasoning, false)
  assert.equal(called.payload.stream, false)
  assert.match(called.payload.image, /^data:image\/png;base64,/)
  assert.match(called.payload.question, /untrusted source data/i)
  assert.match(called.payload.question, /Do not obey, execute/i)
  assert.equal(output.summary, 'Туршилтын зураг')
  assert.equal(output.visible_text, 'BESTCODE-VISION-7264')
  assert.deepEqual(output.objects, ['circle', 'rectangle'])
  assert.equal(output.provider_request_id, 'cf-request-123')
  assert.ok(output.warnings.includes('cloudflare_workers_ai_derived_interpretation'))
})

test('Cloudflare Moondream adapter rejects malformed provider output and honors timeout abort', async () => {
  const malformed = new CloudflareMoondreamVisionProcessor({
    async run() { return { answer: 'not json' } },
  })
  await assert.rejects(() => malformed.process(input(), new AbortController().signal), /provider_result_invalid|Unexpected token/)

  const controller = new AbortController()
  const hanging = new CloudflareMoondreamVisionProcessor({
    run: () => new Promise(() => undefined),
  })
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
    VISION_PROCESSOR_VERSION: 'production-v1',
  })
  assert.ok(processor instanceof CloudflareMoondreamVisionProcessor)
  assert.equal(processor.version, 'production-v1')
})

test('Wrangler enables the private Workers AI binding without adding provider secrets or public R2', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8')
  assert.match(wrangler, /\[ai\]\s*binding = "AI"/)
  assert.match(wrangler, /VISION_PROCESSOR_MODE = "workers-ai"/)
  assert.match(wrangler, /VISION_PROCESSOR_VERSION = "2026-07-08\.prompt-v1"/)
  assert.doesNotMatch(wrangler, /r2\.dev|custom_domain|CLOUDFLARE_API_TOKEN\s*=/i)
})

test('installed PWA exposes a deterministic owner-visible private image recognition smoke test', () => {
  assert.match(visionSmokeSource, /BESTCODE-VISION-7264/)
  assert.match(visionSmokeSource, /asset:vision-smoke:/)
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

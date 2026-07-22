import type { Env } from './types'
import type { ProcessorIdentity, VisionProcessorOutput } from './assetProcessingSchema'

export const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface ImagePolicy {
  maxBytes: number
  maxWidth: number
  maxHeight: number
  maxPixels: number
}

export interface ImageDescriptor {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
  animated: boolean
  sizeBytes: number
}

export interface VisionProcessorInput {
  assetId: string
  projectId: string
  mediaType: string
  filename: string
  sha256: string
  bytes: Uint8Array
  image: ImageDescriptor
}

export interface VisionProcessor extends ProcessorIdentity {
  process(input: VisionProcessorInput, signal: AbortSignal): Promise<VisionProcessorOutput>
}

export class VisionPolicyError extends Error {
  constructor(readonly code: string) { super(code) }
}

function configuredInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

export function imagePolicy(env: Pick<Env, 'VISION_MAX_IMAGE_BYTES' | 'VISION_MAX_IMAGE_WIDTH' | 'VISION_MAX_IMAGE_HEIGHT' | 'VISION_MAX_IMAGE_PIXELS'>): ImagePolicy {
  return {
    maxBytes: configuredInteger(env.VISION_MAX_IMAGE_BYTES, 10 * 1024 * 1024, 100 * 1024 * 1024),
    maxWidth: configuredInteger(env.VISION_MAX_IMAGE_WIDTH, 12_000, 65_535),
    maxHeight: configuredInteger(env.VISION_MAX_IMAGE_HEIGHT, 12_000, 65_535),
    maxPixels: configuredInteger(env.VISION_MAX_IMAGE_PIXELS, 40_000_000, 250_000_000),
  }
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function inspectPng(bytes: Uint8Array): ImageDescriptor {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value) || ascii(bytes, 12, 4) !== 'IHDR') {
    throw new VisionPolicyError('image_signature_mismatch')
  }
  const width = u32be(bytes, 16)
  const height = u32be(bytes, 20)
  let animated = false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    if (type === 'acTL') animated = true
    const next = offset + 12 + length
    if (next <= offset || next > bytes.length) break
    offset = next
  }
  return { mediaType: 'image/png', width, height, animated, sizeBytes: bytes.byteLength }
}

function inspectJpeg(bytes: Uint8Array): ImageDescriptor {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new VisionPolicyError('image_signature_mismatch')
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.length) break
    const length = u16be(bytes, offset)
    if (length < 2 || offset + length > bytes.length) break
    if (sof.has(marker) && length >= 7) {
      return {
        mediaType: 'image/jpeg',
        width: u16be(bytes, offset + 5),
        height: u16be(bytes, offset + 3),
        animated: false,
        sizeBytes: bytes.byteLength,
      }
    }
    offset += length
  }
  throw new VisionPolicyError('image_dimensions_unreadable')
}

function inspectWebp(bytes: Uint8Array): ImageDescriptor {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new VisionPolicyError('image_signature_mismatch')
  }
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    const flags = bytes[20]
    return {
      mediaType: 'image/webp',
      width: 1 + u24le(bytes, 24),
      height: 1 + u24le(bytes, 27),
      animated: (flags & 0x02) !== 0,
      sizeBytes: bytes.byteLength,
    }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f || bytes.length < 25) throw new VisionPolicyError('image_dimensions_unreadable')
    const b1 = bytes[21]
    const b2 = bytes[22]
    const b3 = bytes[23]
    const b4 = bytes[24]
    return {
      mediaType: 'image/webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      animated: false,
      sizeBytes: bytes.byteLength,
    }
  }
  if (chunk === 'VP8 ') {
    for (let offset = 20; offset + 9 < bytes.length; offset += 1) {
      if (bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a) {
        return {
          mediaType: 'image/webp',
          width: (bytes[offset + 3] | (bytes[offset + 4] << 8)) & 0x3fff,
          height: (bytes[offset + 5] | (bytes[offset + 6] << 8)) & 0x3fff,
          animated: false,
          sizeBytes: bytes.byteLength,
        }
      }
    }
  }
  throw new VisionPolicyError('image_dimensions_unreadable')
}

export function inspectImage(bytes: Uint8Array, mediaType: string, policy: ImagePolicy): ImageDescriptor {
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)) throw new VisionPolicyError('unsupported_media_type')
  if (bytes.byteLength <= 0 || bytes.byteLength > policy.maxBytes) throw new VisionPolicyError('image_size_policy_exceeded')
  const image = mediaType === 'image/png'
    ? inspectPng(bytes)
    : mediaType === 'image/jpeg'
      ? inspectJpeg(bytes)
      : inspectWebp(bytes)
  if (image.mediaType !== mediaType) throw new VisionPolicyError('image_mime_mismatch')
  if (image.animated) throw new VisionPolicyError('animated_image_unsupported')
  if (image.width <= 0 || image.height <= 0) throw new VisionPolicyError('image_dimensions_unreadable')
  if (image.width > policy.maxWidth || image.height > policy.maxHeight || image.width * image.height > policy.maxPixels) {
    throw new VisionPolicyError('image_dimensions_policy_exceeded')
  }
  return image
}

export class MockVisionProcessor implements VisionProcessor {
  readonly name = 'bestcode-mock-vision'
  readonly version: string

  constructor(version = '1') { this.version = version }

  async process(input: VisionProcessorInput, signal: AbortSignal): Promise<VisionProcessorOutput> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return {
      summary: `Mock processor ${input.image.width}×${input.image.height} хэмжээтэй зургийн pipeline-ийг шалгав.`,
      visible_text: '',
      objects: ['image'],
      concepts: ['attachment-processing-test'],
      code_or_ui_detected: false,
      language: null,
      confidence: 0,
      warnings: ['mock_processor_no_semantic_recognition'],
    }
  }
}

export function resolveVisionProcessor(env: Pick<Env, 'VISION_PROCESSOR_MODE' | 'VISION_PROCESSOR_VERSION'>): VisionProcessor | null {
  if (env.VISION_PROCESSOR_MODE?.trim().toLowerCase() === 'mock') {
    return new MockVisionProcessor(env.VISION_PROCESSOR_VERSION?.trim() || '1')
  }
  return null
}

export function processingTimeoutMs(env: Pick<Env, 'VISION_PROCESSOR_TIMEOUT_MS'>): number {
  return configuredInteger(env.VISION_PROCESSOR_TIMEOUT_MS, 30_000, 120_000)
}

export const ACTION_DESCRIPTION_LIMIT = 280

function normalizeDescriptionPart(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * Build a compact Custom GPT action description without splitting a Unicode
 * code point. The 280-character soft limit leaves room below ChatGPT's
 * 300-character operation-description limit.
 */
export function buildActionDescription(
  description: string,
  safetyNote: string,
  maxLength = ACTION_DESCRIPTION_LIMIT,
): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('maxLength must be a positive integer')
  }

  const normalized = [description, safetyNote]
    .map(normalizeDescriptionPart)
    .filter(Boolean)
    .join(' ')

  const characters = Array.from(normalized)
  if (characters.length <= maxLength) return normalized
  if (maxLength === 1) return '…'

  return `${characters.slice(0, maxLength - 1).join('').trimEnd()}…`
}

export interface PatchResult {
  content: string
  oldLineCount: number
  newLineCount: number
}

interface HunkHeader {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

function splitLines(content: string): string[] {
  return content === '' ? [] : content.replace(/\r\n/g, '\n').split('\n')
}

function parseHunkHeader(line: string): HunkHeader {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!match) throw new Error(`Invalid unified patch hunk header: ${line}`)
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  }
}

function assertPatchPath(header: string, expectedPath: string): void {
  const raw = header.slice(4).trim().split(/\s+/)[0] ?? ''
  if (raw === '/dev/null') return
  const normalized = raw.replace(/^[ab]\//, '').replace(/^\/+/, '')
  if (normalized && normalized !== expectedPath) {
    throw new Error(`Patch path ${normalized} does not match requested path ${expectedPath}`)
  }
}

/** Apply a bounded single-file unified diff with exact context matching. */
export function applyUnifiedPatch(original: string, patch: string, expectedPath: string): PatchResult {
  if (!patch.trim()) throw new Error('patch is required')
  if (patch.length > 250_000) throw new Error('patch exceeds the 250000 character limit')

  const patchLines = patch.replace(/\r\n/g, '\n').split('\n')
  const oldHeaderIndex = patchLines.findIndex((line) => line.startsWith('--- '))
  const newHeaderIndex = patchLines.findIndex((line, index) => index > oldHeaderIndex && line.startsWith('+++ '))
  if (oldHeaderIndex < 0 || newHeaderIndex < 0) throw new Error('Unified patch must contain --- and +++ file headers')
  assertPatchPath(patchLines[oldHeaderIndex], expectedPath)
  assertPatchPath(patchLines[newHeaderIndex], expectedPath)

  const originalLines = splitLines(original)
  const output: string[] = []
  let sourceIndex = 0
  let patchIndex = newHeaderIndex + 1
  let sawHunk = false

  while (patchIndex < patchLines.length) {
    const line = patchLines[patchIndex]
    if (!line.startsWith('@@ ')) {
      if (line === '' || line.startsWith('diff --git ') || line.startsWith('index ')) {
        patchIndex += 1
        continue
      }
      throw new Error(`Unexpected patch line before hunk: ${line}`)
    }

    sawHunk = true
    const header = parseHunkHeader(line)
    const hunkSourceIndex = header.oldStart === 0 ? 0 : header.oldStart - 1
    if (hunkSourceIndex < sourceIndex || hunkSourceIndex > originalLines.length) {
      throw new Error(`Patch hunk starts outside the source file at old line ${header.oldStart}`)
    }

    output.push(...originalLines.slice(sourceIndex, hunkSourceIndex))
    sourceIndex = hunkSourceIndex
    patchIndex += 1

    let consumedOld = 0
    let producedNew = 0
    while (patchIndex < patchLines.length && !patchLines[patchIndex].startsWith('@@ ')) {
      const hunkLine = patchLines[patchIndex]
      if (hunkLine.startsWith('\\ No newline at end of file')) {
        patchIndex += 1
        continue
      }
      if (hunkLine === '' && patchIndex === patchLines.length - 1) {
        patchIndex += 1
        break
      }

      const marker = hunkLine[0]
      const text = hunkLine.slice(1)
      if (marker === ' ') {
        if (originalLines[sourceIndex] !== text) {
          throw new Error(`Patch context mismatch at source line ${sourceIndex + 1}`)
        }
        output.push(text)
        sourceIndex += 1
        consumedOld += 1
        producedNew += 1
      } else if (marker === '-') {
        if (originalLines[sourceIndex] !== text) {
          throw new Error(`Patch deletion mismatch at source line ${sourceIndex + 1}`)
        }
        sourceIndex += 1
        consumedOld += 1
      } else if (marker === '+') {
        output.push(text)
        producedNew += 1
      } else {
        throw new Error(`Unsupported patch hunk line: ${hunkLine}`)
      }
      patchIndex += 1
    }

    if (consumedOld !== header.oldCount || producedNew !== header.newCount) {
      throw new Error(
        `Patch hunk count mismatch: expected -${header.oldCount}/+${header.newCount}, received -${consumedOld}/+${producedNew}`,
      )
    }
  }

  if (!sawHunk) throw new Error('Unified patch contains no hunks')
  output.push(...originalLines.slice(sourceIndex))
  return { content: output.join('\n'), oldLineCount: originalLines.length, newLineCount: output.length }
}

function range(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`
}

/** Generate one bounded unified hunk using common prefix/suffix context. */
export function createUnifiedDiff(path: string, before: string | null, after: string | null, context = 3): string {
  const oldLines = splitLines(before ?? '')
  const newLines = splitLines(after ?? '')

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  if (prefix === oldLines.length && prefix === newLines.length) return ''

  const oldChangeEnd = oldLines.length - suffix
  const newChangeEnd = newLines.length - suffix
  const contextStart = Math.max(0, prefix - context)
  const trailingContext = Math.min(context, suffix)
  const oldHunkEnd = oldChangeEnd + trailingContext
  const newHunkEnd = newChangeEnd + trailingContext
  const oldCount = oldHunkEnd - contextStart
  const newCount = newHunkEnd - contextStart
  const oldStart = oldCount === 0 ? 0 : contextStart + 1
  const newStart = newCount === 0 ? 0 : contextStart + 1

  const lines = [
    `--- ${before === null ? '/dev/null' : `a/${path}`}`,
    `+++ ${after === null ? '/dev/null' : `b/${path}`}`,
    `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`,
  ]

  for (const line of oldLines.slice(contextStart, prefix)) lines.push(` ${line}`)
  for (const line of oldLines.slice(prefix, oldChangeEnd)) lines.push(`-${line}`)
  for (const line of newLines.slice(prefix, newChangeEnd)) lines.push(`+${line}`)
  for (const line of oldLines.slice(oldChangeEnd, oldHunkEnd)) lines.push(` ${line}`)

  return lines.join('\n')
}

export type ToolFeatureDiffChange = 'ins' | 'del'

/** Classify authored changes without mistaking header-like source inside a hunk for file metadata. */
export function classifyToolFeatureDiffLines(source: string): (ToolFeatureDiffChange | undefined)[] {
  const lines = source.split('\n')
  let oldRemaining = 0
  let newRemaining = 0
  return lines.map((line, index) => {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1)
      newRemaining = Number(hunk[2] ?? 1)
      return undefined
    }
    const inHunk = oldRemaining > 0 || newRemaining > 0
    if (!inHunk && (/^---[\t ]/.test(line) && /^\+\+\+[\t ]/.test(lines[index + 1] ?? '')
      || /^\+\+\+[\t ]/.test(line) && /^---[\t ]/.test(lines[index - 1] ?? ''))) return undefined
    const tag = line.startsWith('+') ? 'ins' : line.startsWith('-') ? 'del' : undefined
    if (inHunk) {
      if (tag === 'del' || line.startsWith(' ')) oldRemaining--
      if (tag === 'ins' || line.startsWith(' ')) newRemaining--
    }
    return tag
  })
}

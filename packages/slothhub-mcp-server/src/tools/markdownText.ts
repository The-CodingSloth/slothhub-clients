export const formatEnumLabel = (value: string): string => value.replaceAll('_', ' ')

export const escapeMarkdownText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/([`*_{}[\]()#!<>|])/g, '\\$1')

export const toMarkdownInlineCode = (value: string): string => {
  let longestFence = 0
  let currentFence = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '`') {
      currentFence += 1
      longestFence = Math.max(longestFence, currentFence)
    } else {
      currentFence = 0
    }
  }
  const fence = '`'.repeat(longestFence + 1)
  const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value
  return `${fence}${padded}${fence}`
}

export const toMarkdownCodeBlock = (value: string, language = 'text'): string => {
  const longestBacktickRun = Math.max(
    0,
    ...[...value.matchAll(/`+/gu)].map((match) => match[0].length),
  )
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1))
  const safeLanguage = language.replace(/[^a-z0-9_+-]/giu, '')
  return `${fence}${safeLanguage}\n${value}\n${fence}`
}

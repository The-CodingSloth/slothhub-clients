import {buildSafeMarkdownLink, escapeMarkdownText, toMarkdownInlineCode} from './markdownSafety.js'
import {PORTABILITY_LABELS, type PublicToolPortability} from './toolPortability.js'

export function renderToolPortabilityMarkdown(portability: PublicToolPortability): string {
  const evidence = (claim: {checkedAt: string; evidence: {title: string; url: string}[]}) =>
    `Checked ${claim.checkedAt}. Sources: ${claim.evidence.map((source) => buildSafeMarkdownLink(source.title, source.url)).join(', ')}.`
  const lines = [
    '## Portability and migrations',
    '',
    'Editor-reviewed facts. Missing or unknown information does not mean unsupported. Migration directions are relative to this tool.',
  ]
  for (const format of portability.formats) {
    lines.push(
      '',
      `### ${escapeMarkdownText(format.name)} · ${PORTABILITY_LABELS[format.direction]}`,
      '',
      `Support: ${PORTABILITY_LABELS[format.supportMode]}.`,
    )
    if (format.supportMode === 'unknown') continue
    if (format.version) lines.push(`Version: ${toMarkdownInlineCode(format.version)}.`)
    if (format.profile) lines.push(`Profile: ${escapeMarkdownText(format.profile)}.`)
    if (format.note) lines.push(escapeMarkdownText(format.note))
    lines.push(evidence(format))
  }
  for (const exit of portability.exits) {
    lines.push(
      '',
      `### Exit: ${PORTABILITY_LABELS[exit.scope]}`,
      '',
      `Coverage: ${PORTABILITY_LABELS[exit.state]}.`,
    )
    if (exit.state === 'unknown') continue
    if (exit.note) lines.push(escapeMarkdownText(exit.note))
    lines.push(evidence(exit))
  }
  for (const migration of portability.migrations) {
    lines.push(
      '',
      `### ${PORTABILITY_LABELS[migration.direction]} ${buildSafeMarkdownLink(migration.counterpart.name, migration.counterpart.url)}`,
      '',
      `Scope: ${migration.scope.map((value) => PORTABILITY_LABELS[value]).join(', ')}. Status: ${PORTABILITY_LABELS[migration.status]}.`,
    )
    if (migration.counterpart.kind === 'external')
      lines.push(`Counterpart identity: ${evidence(migration.counterpart)}`)
    if (migration.status === 'unknown') continue
    lines.push(`Method: ${PORTABILITY_LABELS[migration.method]}.`)
    if (migration.instructions)
      lines.push(
        '',
        `Instructions (review before acting): ${toMarkdownInlineCode(migration.instructions)}`,
      )
    lines.push(evidence(migration))
  }
  return lines.join('\n')
}

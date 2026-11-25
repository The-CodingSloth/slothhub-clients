import {buildSafeMarkdownLink} from './markdownSafety.js'
import {
  TOOL_RELEASE_MODEL_LABELS,
  TOOL_MAINTENANCE_STATUS_LABELS,
  type PublicToolLifecycle,
} from './toolLifecycle.js'

/** Editorial assertions remain attributed, inert data in every text surface. */
export function renderToolLifecycleMarkdown(lifecycle: PublicToolLifecycle): string {
  const evidence = (claim: {checkedAt: string; evidence: {title: string; url: string}[]}) =>
    `Checked ${claim.checkedAt}. Sources: ${claim.evidence.map((source) => buildSafeMarkdownLink(source.title, source.url)).join(', ')}.`
  const model = lifecycle.releaseModel
  const lines = [
    '## Lifecycle',
    '',
    'Editor-reviewed facts; unknown does not mean supported or unsupported.',
    '',
    `Release model: ${TOOL_RELEASE_MODEL_LABELS[model.value]}.`,
  ]
  if (lifecycle.maintenanceStatus) lines.push(`Maintenance: ${TOOL_MAINTENANCE_STATUS_LABELS[lifecycle.maintenanceStatus]}.`)
  if (lifecycle.maintenanceEvidence) lines.push(`Maintenance sources: ${lifecycle.maintenanceEvidence.map((source) => buildSafeMarkdownLink(source.title, source.url)).join(', ')}.`)
  if ('evidence' in model) lines.push(evidence(model))
  return lines.join('\n')
}

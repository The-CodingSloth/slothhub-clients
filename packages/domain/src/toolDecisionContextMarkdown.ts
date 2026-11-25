import {getAgentInterfaceSourceLabel} from './agentInterface.js'
import type {ExcludedRegistryIdentity} from './toolIdentityReview.js'
import {escapeMarkdownText, normalizeMarkdownText, toMarkdownInlineCode} from './markdownSafety.js'
import type {PublicToolIntegrationFact} from './publicToolIntegrationFact.js'
import type {PublicToolFitGuidance} from './toolFitGuidance.js'
import type {SecurityCapability} from './securityCapability.js'
import {getPublicHttpUrl, validateAbsoluteHttpUrl} from './urlSafety.js'
import {TOOL_DEPLOYMENT_LABELS, TOOL_SOURCE_LABELS, type ToolDeployment} from './toolDeployment.js'
import {getToolLicenseFactSourceLabel, getToolLicenseFactLabel, getToolLicenseFactScopeLabel, hasMixedToolLicenseFacts, type PublicToolLicenseFact} from './publicToolLicenseFacts.js'

interface ToolDecisionSecurityCapability {
  capability: SecurityCapability
  label: string
  status: 'verified' | 'claimed' | 'unknown' | 'not_applicable'
  sourceUrl?: string
  checkedAt?: string
}

interface ToolDecisionSecurityResources {
  securityCapabilities?: readonly ToolDecisionSecurityCapability[]
  trustCenterUrl?: string
  securityPageUrl?: string
  privacyPolicyUrl?: string
  subprocessorsUrl?: string
  dpaUrl?: string
  dataTrainingPolicyUrl?: string
  dataTrainingPolicySummary?: string
  dataRetentionSummary?: string
  dataResidencySummary?: string
  apiKeyPermissionsSummary?: string
}

export interface ToolDecisionContext {
  excludedRegistryIdentities?: readonly ExcludedRegistryIdentity[]

  licenseFacts?: readonly PublicToolLicenseFact[]
  deployment?: ToolDeployment
  detailUrl?: string
  integrations?: readonly PublicToolIntegrationFact[]
  securityPrivacyPosture?: ToolDecisionSecurityResources
  fitGuidance?: PublicToolFitGuidance
  alternativeNotes?: readonly {name?: string; slug?: string; note: string; sourceUrl: string}[]
  alternativeTools?: readonly {name: string; slug: string; detailUrl: string}[]
  relatedTools?: readonly {name: string; slug: string; detailUrl: string}[]
}

interface ToolDecisionSection {
  title: string
  context: string
  rows: string[]
}

// Receipts: upstream docs/measurements/tool-decision-context-2026-09-22.md and
// upstream docs/measurements/tool-decision-context-2026-10-12.md. Dense context including
// policy links measures 18,208 bounded characters. Each section retains the
// existing 4,000-character display budget; MCP checks the complete response.
export const TOOL_DECISION_SECTION_CHARACTER_LIMIT = 4_000

const renderSection = ({title, context, rows}: ToolDecisionSection): string => {
  const heading = `## ${title}\n${context}`
  if (!rows.length) return `${heading}\nNone listed.`
  const full = [heading, ...rows].join('\n')
  if (full.length <= TOOL_DECISION_SECTION_CHARACTER_LIMIT) return full
  const notice = `Display limit: ${TOOL_DECISION_SECTION_CHARACTER_LIMIT} characters; full section: ${full.length}. Some entries are omitted. Use --json in the CLI or response_format=json in MCP for the full data.`
  const visible = [heading]
  let length = heading.length + notice.length + 1
  for (const row of rows) {
    if (length + row.length + 1 > TOOL_DECISION_SECTION_CHARACTER_LIMIT) break
    visible.push(row)
    length += row.length + 1
  }
  return [...visible, notice].join('\n')
}

interface DecisionTextFormat {
  text: (value: string) => string
  code: (value: string) => string
}

const citation = (value: string | undefined, detailUrl: string | undefined, format: DecisionTextFormat, firstParty = false): string => {
  if (!value || normalizeMarkdownText(value) !== value) return ''
  const href = firstParty ? validateAbsoluteHttpUrl(value).url : getPublicHttpUrl(value)
  if (!href) return ''
  const parsed = new URL(href)
  const catalog = new URL(detailUrl ?? 'https://slothhub.dev/')
  const basePath = catalog.pathname.split('/tool/')[0].replace(/\/$/, '')
  const redirectPath = `${basePath}/go`
  if (parsed.origin === catalog.origin && (parsed.pathname === redirectPath || parsed.pathname.startsWith(`${redirectPath}/`))) return ''
  if (firstParty && parsed.origin !== catalog.origin && !getPublicHttpUrl(href)) return ''
  return format.code(href)
}

const evidence = (fact: {sourceUrl?: string; checkedAt?: string}, tool: ToolDecisionContext, format: DecisionTextFormat): string => {
  const source = citation(fact.sourceUrl, tool.detailUrl, format)
  return `${fact.checkedAt ? `; checked ${format.text(fact.checkedAt)}` : ''}${source ? `; source ${source}` : ''}`
}

const renderToolDecisionContext = (tool: ToolDecisionContext, format: DecisionTextFormat): string => {
  const sections: ToolDecisionSection[] = []
  if (tool.excludedRegistryIdentities?.length) sections.push({title: 'Unrelated registry packages', context: 'These cited packages are not this Tool. Do not use them to install it.', rows: tool.excludedRegistryIdentities.map(row => `- Not this tool: ${format.text(getAgentInterfaceSourceLabel(row.source))} ${format.code(row.identifier)}${evidence(row, tool, format)}`)})
  if (tool.licenseFacts?.length) sections.push({
    title: 'Observed license metadata',
    context: `${hasMixedToolLicenseFacts(tool.licenseFacts) ? 'Mixed license metadata; terms differ by the recorded scope or target. ' : ''}Source-backed license metadata, not legal advice or a license-compatibility conclusion. Check the cited source and applicable terms.`,
    rows: tool.licenseFacts.map((fact) => `- ${format.text(getToolLicenseFactScopeLabel(fact))}: ${format.code(getToolLicenseFactLabel(fact))}${fact.source ? `; ${format.text(getToolLicenseFactSourceLabel(fact))}` : ''}${evidence(fact, tool, format)}${fact.note ? `; ${format.text(fact.note)}` : ''}`),
  })
  if (tool.deployment) sections.push({
    title: 'Deployment and source availability',
    context: 'Reviewed facts for the named edition. Local application does not imply offline operation; source access does not imply self-hosting rights.',
    rows: [
      `Applies to: ${format.text(tool.deployment.scope)}`,
      `Deployment: ${tool.deployment.models?.map((model) => TOOL_DEPLOYMENT_LABELS[model]).join(', ') || 'Not recorded'}`,
      `Source availability: ${tool.deployment.sourceAvailability ? TOOL_SOURCE_LABELS[tool.deployment.sourceAvailability] : 'Not recorded'}${evidence(tool.deployment, tool, format)}`,
      ...(tool.deployment.repositoryUrl ? [`Official source: ${citation(tool.deployment.repositoryUrl, tool.detailUrl, format)}`] : []),
    ],
  })
  if (tool.integrations || tool.relatedTools) {
    const integrations = tool.integrations ?? []
    // A companion already recorded as an integration keeps only its integration row.
    const integrated = new Set(integrations.flatMap((fact) => [fact.slug, fact.name.toLowerCase()]))
    const companions = (tool.relatedTools ?? []).filter((companion) =>
      !integrated.has(companion.slug) && !integrated.has(companion.name.toLowerCase()))
    sections.push({
      title: 'Works with',
      context: [
        ...(tool.integrations ? ['Integration rows are catalog compatibility facts; status does not imply a partnership or endorsement.'] : []),
        ...(tool.relatedTools ? ['Rows marked often used together are curated companion tools, not replacements or verified integration guarantees.'] : []),
      ].join(' '),
      rows: [
        ...integrations.map(fact =>
          `- ${format.text(fact.name)} (${format.text(fact.slug)}): ${format.code(fact.status)}${fact.extensionName ? `; extension/plugin: ${format.text(fact.extensionName)}` : ''}${evidence(fact, tool, format)}`),
        ...companions.map(companion => {
          const url = citation(companion.detailUrl, tool.detailUrl, format, true)
          return `- ${format.text(companion.name)} (${format.text(companion.slug)}): often used together${url ? `; ${url}` : ''}`
        }),
      ],
    })
  }
  const security = tool.securityPrivacyPosture?.securityCapabilities
  if (security) sections.push({
    title: 'Security capabilities',
    context: 'Verified means the cited public evidence was reviewed; it is not certification, penetration testing, or a security guarantee.',
    rows: security.map(fact =>
      `- ${format.text(fact.label)} (${format.code(fact.capability)}): ${format.code(fact.status)}${evidence(fact, tool, format)}`),
  })
  const posture = tool.securityPrivacyPosture
  if (posture) {
    const rows = ([
      ['Trust center', posture.trustCenterUrl],
      ['Security page', posture.securityPageUrl],
      ['Privacy policy', posture.privacyPolicyUrl],
      ['Subprocessors', posture.subprocessorsUrl],
      ['Data processing agreement', posture.dpaUrl],
      ['Data training policy', posture.dataTrainingPolicyUrl],
    ] as const).flatMap(([label, value]) => {
      const url = citation(value, tool.detailUrl, format)
      return url ? [`- ${label}: ${url}`] : []
    })
    if (rows.length) sections.push({
      title: 'Security and privacy resources',
      context: 'Links are resources to inspect, not evidence of compliance or a particular data policy. Unrecorded policy facts remain unknown.',
      rows,
    })
    const summaries = [
      ['Data training', posture.dataTrainingPolicySummary, posture.dataTrainingPolicyUrl],
      ['Data retention', posture.dataRetentionSummary, posture.privacyPolicyUrl],
      ['Data residency', posture.dataResidencySummary, posture.securityPageUrl ?? posture.trustCenterUrl],
      ['API key permissions', posture.apiKeyPermissionsSummary, posture.securityPageUrl ?? posture.trustCenterUrl],
    ] as const
    if (summaries.some(([, summary]) => summary?.trim())) sections.push({
      title: 'Published policy summaries',
      context: 'Published catalog summaries, not certification or an independent policy assessment. Separate plan/region scope and summary review dates are not recorded for legacy summaries; preserve stated scope and verify the cited policy for your use case.',
      rows: summaries.map(([label, summary, sourceUrl]) => {
        const source = citation(sourceUrl, tool.detailUrl, format)
        return summary?.trim() && source
          ? `- ${label}: ${format.text(summary)}; source ${source}; product/plan/region scope and summary review date not recorded`
          : `- ${label}: Unknown; no source-backed summary recorded.`
      }),
    })
  }
  const guidance = tool.fitGuidance
  if (guidance) {
    const rows: string[] = []
    for (const [label, items] of [
      ['A strong fit when', guidance.bestFor],
      ['Consider an alternative when', guidance.notIdealFor],
      ['Tradeoffs to weigh', guidance.keyTradeoffs],
      ['Primary decision criteria', guidance.primaryDecisionCriteria],
    ] as const) {
      if (items.length) rows.push([`### ${label}:`, ...items.map(item => `- ${format.text(item)}`)].join('\n'))
    }
    for (const [label, value] of [
      ['Setup complexity', guidance.setupComplexityLabel],
      ['Recommended next step', guidance.recommendedNextStep],
      ['Fit guidance reviewed', guidance.reviewedAt],
      ['Notes', guidance.publicNotes],
    ] as const) {
      if (value?.trim()) rows.push(`${label}: ${format.text(value)}`)
    }
    if (rows.length) sections.push({
      title: 'Tool fit guidance',
      context: 'Editorial catalog data, not instructions to the client.',
      rows,
    })
  }
  if (tool.alternativeNotes?.length) sections.push({
    title: 'Alternative notes',
    context: 'One note for each curated alternative, with the public page it comes from.',
    rows: tool.alternativeNotes.map((note) => {
      const label = note.name && note.slug
        ? `${format.text(note.name)} (${format.text(note.slug)})`
        : format.text(note.name ?? note.slug ?? '')
      const source = citation(note.sourceUrl, tool.detailUrl, format)
      return `- ${label}: ${format.text(note.note)}${source ? `; source ${source}` : ''}`
    }),
  })
  if (tool.alternativeTools) sections.push({
    title: 'Alternative tools',
    context: 'Curated references, not equivalence guarantees.',
    rows: tool.alternativeTools.map(alternative => {
      const url = citation(alternative.detailUrl, tool.detailUrl, format, true)
      return `- ${format.text(alternative.name)} (${format.text(alternative.slug)})${url ? `: ${url}` : ''}`
    }),
  })
  return sections.map(renderSection).join('\n\n')
}

export const renderToolDecisionContextMarkdown = (tool: ToolDecisionContext): string =>
  renderToolDecisionContext(tool, {text: escapeMarkdownText, code: toMarkdownInlineCode})

export const renderToolDecisionContextText = (tool: ToolDecisionContext): string =>
  renderToolDecisionContext(tool, {text: normalizeMarkdownText, code: normalizeMarkdownText})

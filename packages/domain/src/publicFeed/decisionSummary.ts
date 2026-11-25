import type {AgentToolDetail} from './types.js'

/**
 * The facts an agent usually decides on, without the evidence, feature prose,
 * fit guidance and alternatives that make a full Tool detail 20-40 KB.
 * Every value is copied from the published detail; nothing is summarized or
 * inferred. Callers that need sources and checked dates use the full detail.
 * Receipt: upstream docs/measurements/agent-client-value-ab-2026-11-17.md.
 */
export const toToolDecisionSummary = (tool: AgentToolDetail) => {
  const {personaCosts: _personaCosts, ...pricingDetails} = tool.pricingDetails ?? {}
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    resourceKind: tool.resourceKind,
    pricing: tool.pricing,
    platforms: tool.platforms,
    keyFeatures: tool.keyFeatures,
    detailUrl: tool.detailUrl,
    website: tool.website,
    officialLinks: {
      canonicalUrl: tool.resourceIdentity.canonicalUrl,
      repositoryUrl: tool.resourceIdentity.repositoryUrl,
      docsUrl: tool.resourceIdentity.docsUrl,
    },
    ...(tool.pricingDetails ? {pricingDetails} : undefined),
    ...(tool.licenseFacts?.length ? {licenseFacts: tool.licenseFacts} : undefined),
    ...(tool.deployment ? {deployment: {scope: tool.deployment.scope, models: tool.deployment.models,
      sourceAvailability: tool.deployment.sourceAvailability, repositoryUrl: tool.deployment.repositoryUrl}} : undefined),
    ...(tool.runtimeRequirements?.length ? {runtimeRequirements: tool.runtimeRequirements.map(({subjectKind, subjectName, environmentRange, toolRange, status}) =>
      ({subjectKind, subjectName, environmentRange, toolRange, status}))} : undefined),
    ...(tool.productLimits?.length ? {productLimits: tool.productLimits} : undefined),
    ...(tool.agentInterfaces?.length ? {agentInterfaces: tool.agentInterfaces.map((agentInterface) => ({
      kind: agentInterface.kind, status: agentInterface.status, label: agentInterface.label,
      identifier: agentInterface.identifier, docsUrl: agentInterface.docsUrl,
      installCommand: agentInterface.installCommand, authRequirement: agentInterface.authRequirement,
      remoteUrl: agentInterface.setupFacts?.mcpUrl ?? undefined,
    }))} : undefined),
  }
}

export type ToolDecisionSummary = ReturnType<typeof toToolDecisionSummary>

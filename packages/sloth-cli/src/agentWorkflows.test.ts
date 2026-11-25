import {describe, expect, it} from 'vite-plus/test'

import {buildImplementationPlan, compareTools, recommendTools} from './agentWorkflows.js'
import {searchIndexFeed, toolDetailFeed} from './fixtures.js'

const capabilities = {
  agentInterfaceKindsAvailable: true,
  securityCapabilitiesAvailable: true,
  integrationsAvailable: true,
  availableFilters: {
    categories: [],
    tags: [],
    useCases: [],
  },
}

describe('recommendTools editorial verification', () => {
  it('uses only a valid non-future verifiedAt claim for recommendation caveats', () => {
    const tool = searchIndexFeed.data.tools[0]
    if (!tool) throw new Error('Expected a search Tool fixture.')

    const verified = recommendTools(
      [{...tool, freshness: {verifiedAt: '2026-07-01T00:00:00.000Z'}}],
      {requirements: 'figma', searchCapabilities: capabilities},
    )
    const future = recommendTools(
      [{...tool, freshness: {verifiedAt: '2999-01-01T00:00:00.000Z'}}],
      {requirements: 'figma', searchCapabilities: capabilities},
    )
    const absent = recommendTools(
      [{...tool, freshness: {}}],
      {requirements: 'figma', searchCapabilities: capabilities},
    )

    expect(verified.selected?.caveats).not.toContain(
      'Figma is not marked verified in the public feed.',
    )
    expect(future.selected?.caveats).toContain('Figma is not marked verified in the public feed.')
    expect(absent.selected?.caveats).toContain('Figma is not marked verified in the public feed.')
  })
})

describe('comparison decision facts', () => {
  it('compares deduplicated current actionable interface kinds without reviving deprecated ones', () => {
    const result = compareTools([{...toolDetailFeed.data, agentInterfaces: [
      {kind: 'cli', status: 'official', label: 'CLI', docsUrl: 'https://example.com/cli'},
      {kind: 'cli', status: 'community', label: 'Other CLI', docsUrl: 'https://example.com/other-cli'},
      {kind: 'sdk', status: 'deprecated', label: 'Old SDK', docsUrl: 'https://example.com/old'},
      {kind: 'api', status: 'unknown', label: 'Unspecified API'},
    ]}])
    expect(result.tools[0].agentInterfaceKinds).toEqual(['cli'])
    expect(result.criteria).toContain('Agent interfaces')
    expect(result.gaps.some((gap) => gap.includes('agent interface kinds'))).toBe(false)
  })

  it('preserves assessment states and evidence without tracked citations', () => {
    const statuses = ['claimed', 'verified', 'unknown', 'not_applicable'] as const
    const result = compareTools([{
      ...toolDetailFeed.data,
      integrations: [{name: 'GitHub', slug: 'github', status: 'native', sourceUrl: 'https://example.com/integrations', checkedAt: '2026-09-29'}],
      securityPrivacyPosture: {securityCapabilities: statuses.map((status) => ({
        capability: 'sso_saml', label: 'SSO/SAML', status, checkedAt: '2026-09-29',
        sourceUrl: status === 'claimed' ? 'https://slothhub.dev/go/example' : 'https://example.com/security',
      }))},
    }])
    expect(result.criteria).toEqual(expect.arrayContaining(['Integrations', 'Security capabilities']))
    expect(result.tools[0].integrations).toEqual([expect.objectContaining({status: 'native', sourceUrl: 'https://example.com/integrations', checkedAt: '2026-09-29'})])
    expect(result.tools[0].securityPrivacyPosture?.securityCapabilities?.map((fact) => fact.status)).toEqual(statuses)
    expect(result.tools[0].securityPrivacyPosture?.securityCapabilities?.[0].sourceUrl).toBeUndefined()
    expect(result.tools[0].securityPrivacyPosture?.securityCapabilities?.[1]).toMatchObject({sourceUrl: 'https://example.com/security', checkedAt: '2026-09-29'})
    expect(JSON.stringify(result)).not.toContain('/go/')
  })

  it('compares plan prices with billing cadence and license terms, and names missing plans as a gap', () => {
    const priced = compareTools([{
      ...toolDetailFeed.data,
      pricingDetails: {currency: 'USD', pricingUrl: 'https://example.com/pricing', plans: [
        {name: 'Pro', listPrice: 25, billing: 'per month, billed monthly ($20/mo billed annually)', billingPeriod: 'month'},
      ], usageAddOns: [{planName: 'Pro', unit: 'additional SSO connection', rate: 75, billing: 'monthly'}]},
      licenseFacts: [{scope: 'resource', status: 'observed', spdxExpression: 'MIT', source: 'github', sourceUrl: 'https://example.com/LICENSE', checkedAt: '2026-11-17'}],
    }])
    expect(priced.tools[0].pricingPlans).toMatchObject({
      plans: [{name: 'Pro', listPrice: 25, billing: 'per month, billed monthly ($20/mo billed annually)'}],
      usageAddOns: [{unit: 'additional SSO connection', rate: 75}],
    })
    expect(priced.tools[0].licenses).toEqual([expect.objectContaining({status: 'observed', license: 'MIT'})])
    expect(priced.criteria).toEqual(expect.arrayContaining(['Pricing plans and billing', 'License']))

    const metered = compareTools([{...toolDetailFeed.data, pricingDetails: {currency: 'USD',
      usageAddOns: [{unit: 'credit', rate: 0.02, billing: 'per request'}]}}])
    expect(metered.tools[0].pricingPlans).toMatchObject({plans: [], usageAddOns: [{unit: 'credit', rate: 0.02}]})
    expect(metered.gaps).toContain('Figma plan prices are unknown: no pricing plans are recorded.')

    const unpriced = compareTools([{...toolDetailFeed.data, pricingDetails: undefined}])
    expect(unpriced.tools[0].pricingPlans).toBeUndefined()
    expect(unpriced.gaps).toContain('Figma plan prices are unknown: no pricing plans are recorded.')
  })

  it('distinguishes missing assessments from reviewed empty lists', () => {
    const missing = compareTools([{...toolDetailFeed.data, integrations: undefined, securityPrivacyPosture: {}}])
    expect(missing.tools[0].integrations).toBeUndefined()
    expect(missing.tools[0].securityPrivacyPosture).toBeUndefined()
    expect(missing.gaps).toContain('Figma integrations are unknown: no structured assessment is recorded.')
    expect(missing.gaps).toContain('Figma security capabilities are unknown: no structured assessment is recorded.')
    const empty = compareTools([{...toolDetailFeed.data, integrations: [], securityPrivacyPosture: {securityCapabilities: []}}])
    expect(empty.tools[0].integrations).toEqual([])
    expect(empty.tools[0].securityPrivacyPosture?.securityCapabilities).toEqual([])
    expect(empty.gaps.some((gap) => gap.includes('structured assessment'))).toBe(false)
  })
})


describe('implementation quickstart provenance', () => {
  it('preserves published quickstarts in order as inert structured guidance', () => {
    const quickstarts = [
      {kind: 'install_command' as const, label: 'Install', status: 'official' as const, statusLabel: 'Official', command: 'npm install example', docsUrl: 'https://example.com/install'},
      {kind: 'open_docs' as const, label: 'Guide', status: 'official' as const, statusLabel: 'Official', docsUrl: 'https://example.com/guide'},
    ];
    expect(buildImplementationPlan({...toolDetailFeed.data, quickstarts})).toMatchObject({quickstarts});
  });
  it('reports missing verified quickstarts without inventing commands', () => {
    const plan = buildImplementationPlan({...toolDetailFeed.data, quickstarts: []});
    expect(plan.caveats).toContain('No verified quickstart is recorded; use the official resources for setup.');
  });
});


it('does not promote opaque interface install commands when quickstarts are absent', () => {
  const plan = buildImplementationPlan({...toolDetailFeed.data, quickstarts: undefined, agentInterfaces: [{kind: 'cli', status: 'official', label: 'CLI', docsUrl: 'https://example.com/cli', installCommand: 'opaque command'}]});
  expect(JSON.stringify(plan)).not.toContain('opaque command');
});


it.each(['official', 'community'] as const)('keeps implementation guidance available when a %s quickstart has an unsafe URL', (status) => {
  const quickstart = {kind: 'open_docs' as const, label: 'Guide', status, statusLabel: status, docsUrl: 'javascript:alert(1)'};
  const result = buildImplementationPlan({...toolDetailFeed.data, quickstarts: [quickstart]});
  expect(result.quickstarts).toEqual([{kind: 'open_docs', label: 'Guide', status, statusLabel: status}]);
  expect(JSON.stringify(result)).not.toContain('javascript:');
  expect(result.steps.length).toBeGreaterThan(0);
});

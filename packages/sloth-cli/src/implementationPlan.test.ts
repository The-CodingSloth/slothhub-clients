import {describe, expect, it} from 'vite-plus/test';
import {buildImplementationPlan, compareTools, recommendTools, getCitationResult} from './agentWorkflows.js';
import {toolDetailFeed} from './fixtures.js';

describe('implementation prerequisites', () => {
  it.each(['http://example.com/setup', 'javascript:alert(1)', 'not a URL'])('omits unusable setup citations with a caveat: %s', (docsUrl) => {
    const plan = buildImplementationPlan({...toolDetailFeed.data,
      agentInterfaces: [{kind: 'sdk', status: 'official', label: 'SDK', docsUrl, installCommand: 'npm install example'}],
      quickstarts: [{kind: 'install_command', label: 'Quickstart', status: 'official', statusLabel: 'Official', docsUrl, command: 'npm install example'}],
    });
    expect(plan.citations.every((source) => source.url !== docsUrl)).toBe(true);
    expect(plan.steps.map(({detail}) => detail).join(' ')).not.toContain('npm install example');
    expect(plan.quickstarts?.[0]).not.toHaveProperty('docsUrl');
    expect(plan.quickstarts?.[0]).not.toHaveProperty('command');
    expect(plan.caveats.join(' ')).toContain('SDK');
    expect(plan.caveats.join(' ')).toContain('Quickstart');
    expect(plan.caveats.join(' ')).toContain('HTTPS');
  });

  it('preserves sourced quickstart fields in feed order and explicitly marks missing quickstarts', () => {
    const quickstarts = [
      {kind: 'open_docs' as const, status: 'official' as const, statusLabel: 'Official', label: 'Guide', docsUrl: 'https://example.com/guide', source: 'manual' as const},
      {kind: 'install_command' as const, status: 'official' as const, statusLabel: 'Official', label: 'Install', docsUrl: 'https://example.com/install', command: 'npm install example', source: 'npm' as const},
    ];
    expect(buildImplementationPlan({...toolDetailFeed.data, quickstarts})).toMatchObject({quickstarts});
    expect(buildImplementationPlan({...toolDetailFeed.data, quickstarts: []}).caveats).toContain('No verified quickstart is recorded; use the official resources for setup.');
  });
  it('retains official identity and auth without promoting an unsourced install command', () => {
    const plan = buildImplementationPlan({...toolDetailFeed.data,
      agentInterfaces: [{kind: 'sdk', status: 'official', label: 'SDK', identifier: '@example/sdk', installCommand: 'npm install @example/sdk', authRequirement: 'Read token for drafts', checkedAt: '2026-10-12T00:00:00.000Z'}],
      quickstarts: [{kind: 'install_command', status: 'official', statusLabel: 'Official', label: 'Install SDK', command: 'npm install @example/sdk'}],
    });
    const step = plan.steps.find(({title}) => title === 'Review SDK setup');
    expect(step).toMatchObject({sourceUrl: toolDetailFeed.data.detailUrl});
    expect(step?.detail).toContain('@example/sdk');
    expect(step?.detail).toContain('Read token for drafts');
    expect(step?.detail).toContain('2026-10-12');
    expect(step?.detail).toContain('Official setup docs are not recorded; verify them before installing.');
    expect(plan.steps.map(({detail}) => detail).join('\n')).not.toContain('npm install @example/sdk');
    expect(plan.caveats).toContain('Install SDK has no official setup docs recorded; retrieve version-specific documentation before running its command.');
  });

  it('offers only recorded official setup commands and preserves auth, provenance and notices', () => {
    const plan = buildImplementationPlan({...toolDetailFeed.data,
      agentInterfaces: [{kind: 'sdk', status: 'official', label: 'SDK', identifier: '@example/sdk', docsUrl: 'https://example.com/setup', installCommand: 'npm install @example/sdk@2.3.1', authRequirement: 'Read token for private drafts', checkedAt: '2026-10-12T00:00:00.000Z'}, {kind: 'sdk', status: 'deprecated', label: 'Old SDK', docsUrl: 'https://example.com/old', installCommand: 'npm install old'}, {kind: 'sdk', status: 'community', label: 'Unofficial', docsUrl: 'https://example.com/community', installCommand: 'npm install unofficial'}],
      quickstarts: [{kind: 'install_command', status: 'official', statusLabel: 'Official', label: 'Install SDK', docsUrl: 'https://example.com/quickstart', command: 'npm install @example/sdk@2.3.1', notice: 'Confirm the pinned version fits the project.'}],
    });
    const details = plan.steps.map(({detail}) => detail).join('\n');
    expect(details).toContain('npm install @example/sdk@2.3.1');
    expect(details).toContain('Read token for private drafts');
    expect(details).toContain('2026-10-12');
    expect(details).toContain('Confirm the pinned version fits the project.');
    expect(details).not.toContain('npm install old');
    expect(details).not.toContain('npm install unofficial');
    expect(plan.steps).toContainEqual(expect.objectContaining({sourceUrl: 'https://example.com/quickstart'}));
  });

  it.each(['partial', 'required'] as const)('preserves the version scope, %s status and evidence of a runtime prerequisite', (status) => {
    const requirement = {...toolDetailFeed.data.runtimeRequirements![0]!, toolRange: 'v2 only', status};
    const plan = buildImplementationPlan({...toolDetailFeed.data, runtimeRequirements: [requirement]});
    const step = plan.steps.find(({title}) => title === 'Review Node.js requirement');
    expect(step).toMatchObject({sourceUrl: requirement.evidence[0]!.url});
    expect(step?.detail).toContain('>=20 <23');
    expect(step?.detail).toContain('v2 only');
    expect(step?.detail).toContain(status);
    expect(step?.detail).toContain(requirement.note);
    expect(step?.detail).toContain(requirement.reviewedAt);
    expect(plan.citations).toContainEqual(expect.objectContaining({url: requirement.evidence[0]!.url}));
  });

  it.each([false, true])('keeps runtime guidance when evidence includes HTTP (safe alternative: %s)', (includeSafeEvidence) => {
    const original = toolDetailFeed.data.runtimeRequirements![0]!;
    const unsafe = {...original.evidence[0]!, title: 'HTTP runtime reference', url: 'http://example.com/runtime'};
    const requirement = {...original, evidence: [unsafe, ...(includeSafeEvidence ? original.evidence : [])]};
    const plan = buildImplementationPlan({...toolDetailFeed.data, runtimeRequirements: [requirement]});
    const step = plan.steps.find(({title}) => title === 'Review Node.js requirement');
    expect(step).toMatchObject({sourceUrl: includeSafeEvidence ? original.evidence[0]!.url : toolDetailFeed.data.detailUrl});
    expect(step?.detail).toContain(original.environmentRange);
    expect(step?.detail).toContain(original.reviewedAt);
    expect(plan.citations.some(({url}) => url === unsafe.url)).toBe(false);
    if (includeSafeEvidence) expect(plan.citations).toContainEqual(expect.objectContaining({url: original.evidence[0]!.url, kind: 'runtime_requirement'}));
    expect(plan.caveats).toContain('HTTP runtime reference evidence for Node.js is not a safe HTTPS citation; verify official runtime documentation before installing.');
  });

  it.each([
    ['https://example.com/stacks/workflow', true],
    ['http://localhost:4321/stacks/workflow', false],
    ['javascript:alert(1)', false],
    ['not a URL', false],
  ] as const)('preserves stack context while screening its citation: %s', (url, safe) => {
    const stack = {name: 'Example workflow', slug: 'example-workflow', url, description: 'A workflow', tags: [],
      tools: [{role: 'Editor', description: 'Write the project content', tool: toolDetailFeed.data}]};
    const plan = buildImplementationPlan(toolDetailFeed.data, stack);
    expect(plan.stack).toMatchObject({name: stack.name, slug: stack.slug, role: 'Editor'});
    const step = plan.steps.find(({title}) => title.includes('Example workflow'));
    expect(step?.detail).toBe('Editor: Write the project content');
    expect(step?.sourceUrl).toBe(safe ? url : toolDetailFeed.data.detailUrl);
    if (safe) {
      expect(plan.stack?.url).toBe(url);
      expect(plan.citations).toContainEqual(expect.objectContaining({url, kind: 'tool_stack'}));
    } else {
      expect(plan.stack).not.toHaveProperty('url');
      expect(JSON.stringify(plan)).not.toContain(url);
      expect(plan.caveats).toContain('Example workflow stack URL is not a safe HTTPS citation; use the Tool profile and verify the stack documentation before implementation.');
    }
  });

  it.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321'])('supports read-only workflows against the local catalog: %s', (origin) => {
    const tool = {...toolDetailFeed.data, detailUrl: `${origin}/tool/figma`};
    const other = {...tool, slug: 'other-tool', detailUrl: `${origin}/tool/other-tool`};
    expect(buildImplementationPlan(tool, undefined, origin).tool.detailUrl).toBe(tool.detailUrl);
    expect(compareTools([tool, other], new Map([[tool.slug, origin], [other.slug, origin]])).tools).toHaveLength(2);
    const recommendation = recommendTools([tool], {siteUrl: origin, requirements: 'figma', searchCapabilities: {agentInterfaceKindsAvailable: true, securityCapabilitiesAvailable: true, integrationsAvailable: true, availableFilters: {categories: [], tags: [], useCases: []}}});
    expect(recommendation.selected?.detailUrl).toBe(tool.detailUrl);
    expect(getCitationResult(tool, origin).sources[0]?.url).toBe(tool.detailUrl);
    expect(() => getCitationResult(tool)).toThrow();
  });

  it.each([undefined, 'https://example.com', 'http://localhost:9999'])('rejects loopback profiles without matching feed context: %s', (siteUrl) => {
    const tool = {...toolDetailFeed.data, detailUrl: 'http://localhost:4321/tool/figma'};
    expect(() => buildImplementationPlan(tool, undefined, siteUrl)).toThrow();
    expect(() => compareTools([tool, {...tool, slug: 'other', detailUrl: 'http://localhost:4321/tool/other'}], siteUrl ? new Map([['figma', siteUrl], ['other', siteUrl]]) : undefined)).toThrow();
    expect(() => recommendTools([tool], {siteUrl, requirements: 'figma', searchCapabilities: {agentInterfaceKindsAvailable: true, securityCapabilitiesAvailable: true, availableFilters: {categories: [], tags: [], useCases: []}}})).toThrow();
  });

  it.each(['http://example.com/tool/figma', 'http://localhost:4321/go/figma', 'http://user:secret@localhost:4321/tool/figma'])('keeps noncanonical HTTP profile links out of workflow citations: %s', (detailUrl) => {
    const tool = {...toolDetailFeed.data, detailUrl};
    expect(() => buildImplementationPlan(tool)).toThrow();
    expect(() => getCitationResult(tool)).toThrow();
  });

  it('exposes missing runtime guidance and does not treat a public link as a compatibility check', () => {
    const plan = buildImplementationPlan({...toolDetailFeed.data, runtimeRequirements: []});
    expect(plan.caveats).toContain('No runtime requirements are recorded; check version-specific official documentation before installing.');
    expect(plan.steps.find(({title}) => title === 'Open Official docs')?.detail).toContain(
      'Use this official resource for tool-specific setup, configuration, and integration steps. Its presence does not establish compatibility with this project.',
    );
  });

  it('keeps official wiring and recovery notes reachable beyond the first resource', () => {
    const plan = buildImplementationPlan({...toolDetailFeed.data, resourceLinks: [
      ...toolDetailFeed.data.resourceLinks!,
      {label: 'Recover initialization', kind: 'official_docs', isOfficial: true, url: 'https://example.com/recovery', checkedAt: '2026-10-12T00:00:00.000Z', note: 'Inspect imports and stderr when initialization fails.'},
    ]});
    expect(plan.steps).toContainEqual(expect.objectContaining({sourceUrl: 'https://example.com/recovery', detail: expect.stringContaining('Inspect imports and stderr when initialization fails.')}));
  });
});

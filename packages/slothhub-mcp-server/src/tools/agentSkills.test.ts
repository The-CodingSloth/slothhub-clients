import { describe, expect, it } from 'vite-plus/test';

import type { AgentSearchIndexFeed, AgentSearchIndexTool } from '../types.js';
import { ResponseFormat } from '../constants.js';
import { listAgentSkillsInputSchema } from '../schemas/inputs.js';
import { handleListAgentSkills } from './handlers.js';

const skillTool = (overrides: Partial<AgentSearchIndexTool> = {}): AgentSearchIndexTool => ({
  name: 'Example Skill',
  slug: 'example-skill',
  description: 'An example agent skill for catalogs',
  resourceKind: { value: 'agent_skill', label: 'Agent skill' },
  resourceIdentity: {
    kind: 'npm_package',
    kindLabel: 'npm package',
    canonicalUrl: 'https://www.npmjs.com/package/@example/skill',
    ctaLabel: 'Open npm package',
  },
  pricing: 'free',
  platforms: ['cli'],
  categories: [{ name: 'Developer Tools', slug: 'developer-tools' }],
  tags: [],
  useCases: [],
  freshness: { verifiedAt: '2026-07-01T00:00:00.000Z' },
  detailUrl: 'https://slothhub.dev/tool/example-skill',
  visitUrl: 'https://slothhub.dev/go/example-skill?surface=agent',
  keyFeatures: ['Search'],
  securityCapabilities: [],
  agentInterfaceKinds: ['agent_skill'],
  search: {
    text: 'example skill catalogs',
    tokens: ['example', 'skill', 'catalogs'],
    fields: {
      name: 'Example Skill',
      description: 'An example agent skill for catalogs',
      keyFeatures: ['Search'],
      platforms: ['cli'],
      categories: ['developer-tools'],
      tags: [],
      useCases: [],
      resourceKind: ['Agent skill', 'agent_skill'],
      agentInterfaceKinds: ['agent_skill'],
    },
  },
  ...overrides,
});

const searchFeed = (tools: AgentSearchIndexTool[]): AgentSearchIndexFeed => ({
  version: '17.1.0',
  siteUrl: 'https://slothhub.dev',
  generatedAt: '2026-07-08T00:00:00.000Z',
  data: {
    tools,
    filters: {
      pricing: [],
      platforms: [],
      resourceKinds: [{ value: 'agent_skill', label: 'Agent skill', count: tools.length }],
      securityCapabilities: [],
      agentInterfaceKinds: [],
      categories: [],
      tags: [],
      useCases: [],
    },
    queryContract: {},
  },
});

const skillDetail = {
  data: {
    agentInterfaces: [
      {
        kind: 'agent_skill',
        status: 'official',
        label: 'Agent skill',
        source: 'npm',
        identifier: '@example/skill',
        installCommand: 'npx skills@latest add @example/skill',
        docsUrl: 'https://example.com/skill/docs',
      },
      {
        kind: 'cli',
        status: 'official',
        label: 'CLI',
        installCommand: 'npm i -g example-cli',
      },
    ],
  },
};

const skillsClient = (
  tools: AgentSearchIndexTool[] = [skillTool()],
  detail: unknown = skillDetail,
) => ({
  searchIndex: async () => searchFeed(tools),
  toolDetail: async () => detail,
});

const listParams = {
  limit: 20,
  offset: 0,
  response_format: ResponseFormat.MARKDOWN,
};

describe('handleListAgentSkills', () => {
  it('lists agent skills with detailUrl and skill install quickstart', async () => {
    const result = await handleListAgentSkills(skillsClient() as never, listParams);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({ total: 1, count: 1, offset: 0, has_more: false });
    const skills = structured.agent_skills as Array<Record<string, unknown>>;
    expect(skills[0]).toMatchObject({
      name: 'Example Skill',
      slug: 'example-skill',
      detailUrl: 'https://slothhub.dev/tool/example-skill',
    });
    const interfaces = skills[0]?.agentInterfaces as Array<Record<string, unknown>>;
    expect(interfaces).toHaveLength(1);
    expect(interfaces[0]).toMatchObject({
      kind: 'agent_skill',
      identifier: '@example/skill',
      installCommand: 'npx skills@latest add @example/skill',
    });

    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('Example Skill');
    expect(markdown).toContain('npx skills@latest add @example/skill');
    expect(markdown).toContain('Cite: https://slothhub.dev/tool/example-skill');
    expect(markdown).not.toContain('/go/');
  });

  it.each(['interface', 'source reference'])('exposes commands derived from a %s in structured and Markdown results', async (source) => {
    const docsUrl = 'https://github.com/anthropics/skills/tree/main/skills/frontend-design';
    const detail = {data: {
      agentInterfaces: source === 'interface' ? [
        {kind: 'agent_skill', status: 'official', label: 'Agent skill', docsUrl},
      ] : [],
      sourceReferences: source === 'source reference'
        ? [{title: 'Skill source', url: docsUrl, sourceType: 'repository'}] : undefined,
    }};
    const result = await handleListAgentSkills(skillsClient([skillTool()], detail) as never, listParams);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({agent_skills: [{agentInterfaces: [
      {docsUrl, installCommand: `npx skills@latest add ${docsUrl}`},
    ]}]});
    expect(result.content[0]?.text).toContain(`npx skills@latest add ${docsUrl}`);
  });

  it('returns a valid empty result for an empty catalog', async () => {
    const result = await handleListAgentSkills(skillsClient([]) as never, listParams);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 0,
      count: 0,
      has_more: false,
      agent_skills: [],
    });
  });

  it('returns a valid empty result on a query miss', async () => {
    const result = await handleListAgentSkills(
      skillsClient() as never,
      { ...listParams, query: 'zzqxnonexistent' },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 0, count: 0, agent_skills: [] });
  });

  it('filters listings by query', async () => {
    const other = skillTool({
      name: 'Unrelated Skill',
      slug: 'unrelated-skill',
      detailUrl: 'https://slothhub.dev/tool/unrelated-skill',
      search: {
        text: 'unrelated skill nothing',
        tokens: ['unrelated'],
        fields: {
          name: 'Unrelated Skill',
          description: 'Nothing matching',
          keyFeatures: [],
          platforms: [],
          categories: [],
          tags: [],
          useCases: [],
          resourceKind: ['Agent skill', 'agent_skill'],
          agentInterfaceKinds: ['agent_skill'],
        },
      },
    });
    const result = await handleListAgentSkills(
      skillsClient([skillTool(), other]) as never,
      { ...listParams, query: 'catalogs' },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 1, count: 1 });
  });

  it('paginates with stable metadata', async () => {
    const tools = Array.from({ length: 3 }, (_, index) =>
      skillTool({
        name: `Skill ${index}`,
        slug: `skill-${index}`,
        detailUrl: `https://slothhub.dev/tool/skill-${index}`,
        search: {
          text: `skill ${index}`,
          tokens: ['skill', `${index}`],
          fields: {
            name: `Skill ${index}`,
            description: 'Skill',
            keyFeatures: [],
            platforms: [],
            categories: [],
            tags: [],
            useCases: [],
            resourceKind: ['Agent skill', 'agent_skill'],
            agentInterfaceKinds: ['agent_skill'],
          },
        },
      }),
    );
    const result = await handleListAgentSkills(
      skillsClient(tools) as never,
      { ...listParams, limit: 2, offset: 1 },
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      total: 3,
      count: 2,
      offset: 1,
      has_more: false,
    });
  });

  it('maps feed failures to a structured error', async () => {
    const client = {
      searchIndex: async () => {
        throw new Error('HTTP 500');
      },
      toolDetail: async () => skillDetail,
    };
    const result = await handleListAgentSkills(client as never, listParams);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'feed_load_error' });
  });

  it('escapes catalog-controlled text in markdown', async () => {
    const hostile = skillTool({
      name: 'Skill <img src=x onerror=alert(1)>',
      description: 'Click [here](javascript:alert(1))',
    });
    const result = await handleListAgentSkills(
      skillsClient([hostile]) as never,
      listParams,
    );

    expect(result.isError).toBeFalsy();
    const markdown = result.content[0]?.text ?? '';
    expect(markdown).toContain('\\<img');
    expect(markdown).toContain('\\[here\\]');
  });
});

describe('listAgentSkillsInputSchema', () => {
  it('rejects unknown fields such as resource_kind at the boundary', () => {
    const parsed = listAgentSkillsInputSchema.safeParse({
      resource_kind: 'agent_skill',
      response_format: 'json',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects out-of-range limit and offset', () => {
    expect(
      listAgentSkillsInputSchema.safeParse({ limit: 0, response_format: 'json' }).success,
    ).toBe(false);
    expect(
      listAgentSkillsInputSchema.safeParse({ offset: -1, response_format: 'json' }).success,
    ).toBe(false);
  });
});

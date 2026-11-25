import {
  buildProjectToolPinManifest,
  PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
  PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
  PROJECT_TOOL_PIN_MANIFEST_VERSION,
  serializeProjectToolPinManifest,
  type ProjectToolPinManifestInput,
} from '@slothhub/domain/project-tool-pin-manifest';
import { describe, expect, it } from 'vite-plus/test';

import { ResponseFormat } from '../constants.js';
import { pinManifestInputSchema } from '../schemas/inputs.js';
import {
  handleRenderPinManifest,
  handleValidatePinManifest,
} from './pinManifest.js';

const manifestInput = (): ProjectToolPinManifestInput => ({
  producer: { name: 'slothhub-web', version: '0.1.0' },
  createdAt: '2026-07-14T12:00:00.000Z',
  source: { kind: 'saved_list', id: 'list-1', name: 'Launch stack' },
  tools: [
    {
      slug: 'figma',
      detailUrl: 'https://slothhub.dev/tool/figma',
      snapshot: {
        name: 'Figma',
        resourceKind: 'app',
        resourceIdentity: {
          kind: 'website' as const,
          key: 'figma.com',
          url: 'https://figma.com/',
        },
      },
      agentInterfaces: [
        { kind: 'api' as const, status: 'official' as const, identifier: 'figma-rest' },
      ],
      role: 'Design system',
      note: 'Keep `$()` and **Markdown** inert.',
      citations: ['https://slothhub.dev/tool/figma', 'https://figma.com/'],
    },
  ],
});

const validManifestText = (): string =>
  serializeProjectToolPinManifest(buildProjectToolPinManifest(manifestInput()));

const validate = (manifest: string, response_format = ResponseFormat.MARKDOWN) =>
  handleValidatePinManifest({ manifest, response_format });

const render = (manifest: string, response_format = ResponseFormat.MARKDOWN) =>
  handleRenderPinManifest({ manifest, response_format });

describe('handleValidatePinManifest', () => {
  it('validates and renders legacy v1 declarations and v2 component declarations', () => {
    const legacy = {...buildProjectToolPinManifest(manifestInput()), version: 1 as const};
    const component = manifestInput();
    component.tools[0]!.snapshot.resourceKind = 'ui_component';
    const current = buildProjectToolPinManifest(component);
    for (const manifest of [legacy, current]) {
      const text = serializeProjectToolPinManifest(manifest);
      expect(validate(text).structuredContent).toMatchObject({valid: true, version: manifest.version});
      const rendered = render(text);
      expect(rendered.isError).toBeUndefined();
      expect(rendered.content[0]?.text).toContain(`Resource: ${manifest.tools[0]?.snapshot.resourceKind}`);
    }
  });
  it('reports a valid manifest with artifact, version, and tool count', () => {
    const result = validate(validManifestText());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      valid: true,
      artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
      version: PROJECT_TOOL_PIN_MANIFEST_VERSION,
      toolCount: 1,
    });
    expect(result.content[0]?.text).toContain('Valid Project Tool pin manifest');
    expect(result.content[0]?.text).toContain('1 tool');
  });

  it('rejects an empty manifest string at the schema boundary', () => {
    expect(pinManifestInputSchema.safeParse({ manifest: '' }).success).toBe(false);
    expect(
      pinManifestInputSchema.safeParse({ manifest: validManifestText(), extra: 1 })
        .success,
    ).toBe(false);
    expect(
      pinManifestInputSchema.safeParse({ manifest: validManifestText() }).success,
    ).toBe(true);
  });

  it('returns the same summary as parseable json text when response_format is json', () => {
    const result = validate(validManifestText(), ResponseFormat.JSON);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(
      result.structuredContent,
    );
  });

  it.each([
    ['{', 'malformed-json'],
    [
      JSON.stringify({ artifact: 'slothhub.other-artifact', version: 1, tools: [] }),
      'wrong-artifact-type',
    ],
    [
      JSON.stringify({
        artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
        version: 99,
      }),
      'unsupported-version',
    ],
    [
      `{"artifact":${JSON.stringify(PROJECT_TOOL_PIN_MANIFEST_ARTIFACT)},"version":1,"__proto__":{"polluted":true}}`,
      'dangerous-key',
    ],
    [
      JSON.stringify({
        artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
        version: PROJECT_TOOL_PIN_MANIFEST_VERSION,
        producer: { name: 'x', version: '1' },
        createdAt: '2026-07-14T12:00:00.000Z',
        tools: [
          {
            slug: 'figma',
            detailUrl: 'https://slothhub.dev/tool/figma',
            snapshot: {
              name: 'Figma',
              resourceKind: 'app',
              resourceIdentity: { kind: 'website', url: 'https://figma.com/' },
            },
            agentInterfaces: [],
            citations: ['https://slothhub.dev/go/figma'],
          },
        ],
      }),
      'invalid-manifest',
    ],
  ])('fails with the named domain reason: %s', (manifest, reason) => {
    const result = validate(manifest);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_manifest',
      message: expect.stringContaining(reason),
    });
    expect(result.content[0]?.text).toContain(reason);
  });

  it('rejects oversized input with the configured byte limit and observed bytes', () => {
    const manifest = `${' '.repeat(PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES + 1)}`;
    const result = validate(manifest);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining('oversized'),
      configuredLimitBytes: PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
      observedBytes: PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES + 1,
    });
  });

  it('never echoes rejected manifest content into the error', () => {
    const sentinel = 's3ntinel-unique-string';
    const result = validate(`{"artifact":"${sentinel}"`);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).not.toContain(sentinel);
    expect(JSON.stringify(result.structuredContent)).not.toContain(sentinel);
  });
});

describe('handleRenderPinManifest', () => {
  it('renders a valid manifest through the shared domain renderer', () => {
    const result = render(validManifestText());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
      version: PROJECT_TOOL_PIN_MANIFEST_VERSION,
    });
    // SAFETY: The success branch of the handler always returns the render payload.
    const rendered = (result.structuredContent as { rendered: string }).rendered;
    expect(rendered).toContain('Unverified project declaration');
    expect(rendered).toContain('Figma');
    expect(result.content[0]?.text).toBe(rendered);
  });

  it('returns the rendered payload as parseable json text when response_format is json', () => {
    const result = render(validManifestText(), ResponseFormat.JSON);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(
      result.structuredContent,
    );
  });

  it('keeps markdown metacharacters inert in rendered output', () => {
    const hostile = manifestInput();
    hostile.tools[0]!.snapshot.name = '<img src=x> **bold**';
    const manifest = serializeProjectToolPinManifest(
      buildProjectToolPinManifest(hostile),
    );

    const result = render(manifest);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('&lt;img src=x&gt;');
    expect(result.content[0]?.text).not.toContain('<img');
  });

  it('fails with the named domain reason on invalid input', () => {
    const result = render('{');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_manifest',
      message: expect.stringContaining('malformed-json'),
    });
  });
});

import {
  DECISION_RECEIPT_MAX_JSON_BYTES,
  DECISION_RECEIPT_MAX_MARKDOWN_BYTES,
  DECISION_RECEIPT_VERSION,
  serializeDecisionReceiptJson,
  type DecisionReceipt,
} from '@slothhub/domain/decision-receipt';
import { describe, expect, it } from 'vite-plus/test';

import { ResponseFormat } from '../constants.js';
import { decisionReceiptInputSchema } from '../schemas/inputs.js';
import {
  handleRenderDecisionReceipt,
  handleValidateDecisionReceipt,
} from './decisionReceipt.js';

const receipt = (): DecisionReceipt => ({
  schemaVersion: '1',
  receiptId: 'decision-2026-07-22-figma-linear',
  createdAt: '2026-07-22T18:00:00.000Z',
  catalogSnapshotAt: '2026-07-22T17:00:00.000Z',
  versions: {
    catalog: '2026-07-22',
    producer: 'slothhub-web@1.0.0',
    schema: '1',
  },
  requirements: [
    { id: 'requirement-1', text: 'Works offline', state: 'present' },
  ],
  criteria: [
    { id: 'criterion-1', label: 'Security', description: 'Security posture' },
  ],
  candidates: [
    {
      tool: {
        id: 'tool-figma',
        slug: 'figma',
        name: 'Figma',
        url: 'https://slothhub.dev/tool/figma',
      },
      evaluations: [
        {
          criterionId: 'criterion-1',
          state: 'unknown',
          note: 'No verified data in the snapshot',
        },
      ],
      facts: [],
    },
  ],
  selectedTool: null,
  rejectedCandidates: [],
  rationale: 'Still evaluating the shortlist.',
  tradeoffs: ['Offline support matters more than integrations.'],
  citations: [
    {
      id: 'citation-1',
      title: 'Figma help',
      url: 'https://help.figma.com/hc/en-us/articles/360040328273',
      checkedAt: '2026-07-20T12:00:00.000Z',
    },
  ],
  extensions: {},
});

const validReceiptText = (): string => serializeDecisionReceiptJson(receipt());

const validate = (source: string, response_format = ResponseFormat.MARKDOWN) =>
  handleValidateDecisionReceipt({ receipt: source, response_format });

const render = (source: string, response_format = ResponseFormat.MARKDOWN) =>
  handleRenderDecisionReceipt({ receipt: source, response_format });

describe('handleValidateDecisionReceipt', () => {
  it('reports a valid receipt with id, schema version, and candidate count', () => {
    const result = validate(validReceiptText());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      valid: true,
      receiptId: 'decision-2026-07-22-figma-linear',
      schemaVersion: DECISION_RECEIPT_VERSION,
      candidateCount: 1,
    });
    expect(result.content[0]?.text).toContain(
      'Valid decision receipt decision-2026-07-22-figma-linear',
    );
  });

  it('returns the same summary as parseable json text when response_format is json', () => {
    const result = validate(validReceiptText(), ResponseFormat.JSON);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(
      result.structuredContent,
    );
  });

  it('rejects an empty receipt string at the schema boundary', () => {
    expect(decisionReceiptInputSchema.safeParse({ receipt: '' }).success).toBe(
      false,
    );
    expect(
      decisionReceiptInputSchema.safeParse({
        receipt: validReceiptText(),
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      decisionReceiptInputSchema.safeParse({ receipt: validReceiptText() })
        .success,
    ).toBe(true);
  });

  it('accepts a rendered markdown artifact and round-trips it', () => {
    const rendered = render(validReceiptText());
    // SAFETY: The success branch of the handler always returns the render payload.
    const markdown = (rendered.structuredContent as { rendered: string })
      .rendered;

    const result = validate(markdown);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ valid: true });
  });

  it.each([
    ['{', 'malformed JSON'],
    [
      `{"schemaVersion":"1","receiptId":"x","__proto__":{"polluted":true}}`,
      'dangerous key',
    ],
    [JSON.stringify({ schemaVersion: '2' }), 'unsupported major version'],
  ])('fails with the named domain rule: %s', (source, rule) => {
    const result = validate(source);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_receipt',
      message: expect.stringContaining(rule),
    });
    expect(result.content[0]?.text).toContain(rule);
  });

  it('rejects /go/ citation URLs with the named rule', () => {
    const unsafe = receipt();
    unsafe.citations = [
      {
        id: 'citation-1',
        url: 'https://slothhub.dev/go/figma',
        checkedAt: '2026-07-20T12:00:00.000Z',
      },
    ];
    // serialize refuses unsafe receipts, so construct the raw artifact directly.
    const raw = JSON.stringify(unsafe);
    const result = validate(raw);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_receipt',
      message: expect.stringContaining('/go/'),
    });
  });

  it('rejects oversized JSON input with the configured byte limit', () => {
    const source = `{"schemaVersion":"1","pad":"${'x'.repeat(DECISION_RECEIPT_MAX_JSON_BYTES)}"}`;
    const result = validate(source);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'payload_too_large',
      configuredLimitBytes: DECISION_RECEIPT_MAX_JSON_BYTES,
    });
  });

  it('rejects input beyond the markdown code-unit bound', () => {
    const source = 'x'.repeat(DECISION_RECEIPT_MAX_MARKDOWN_BYTES + 1);
    const result = validate(source);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'payload_too_large',
    });
  });

  it('escapes control characters carried through error paths', () => {
    // The JSON source carries the escape \u001b so JSON.parse materializes a
    // real ESC inside the object key, which the failure path then echoes.
    const source =
      "{\"schemaVersion\":\"1\",\"receiptId\":\"x\",\"createdAt\":\"2026-07-22T18:00:00.000Z\",\"catalogSnapshotAt\":\"2026-07-22T17:00:00.000Z\",\"versions\":{\"catalog\":\"c\",\"producer\":\"p\",\"schema\":\"1\"},\"requirements\":[],\"criteria\":[],\"candidates\":[],\"selectedTool\":null,\"rejectedCandidates\":[],\"rationale\":\"r\",\"tradeoffs\":[],\"citations\":[],\"extensions\":{},\"bad\\u001bkey\":1}";
    const result = validate(source);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/\u001b/);
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/\u001b/);
  });
});

describe('handleRenderDecisionReceipt', () => {
  it('renders a valid receipt through the shared domain renderer', () => {
    const result = render(validReceiptText());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      receiptId: 'decision-2026-07-22-figma-linear',
      schemaVersion: DECISION_RECEIPT_VERSION,
    });
    // SAFETY: The success branch of the handler always returns the render payload.
    const rendered = (result.structuredContent as { rendered: string }).rendered;
    expect(rendered).toContain('# SlothHub decision receipt');
    expect(rendered).toContain('Figma');
    expect(result.content[0]?.text).toBe(rendered);
  });

  it('returns the rendered payload as parseable json text when response_format is json', () => {
    const result = render(validReceiptText(), ResponseFormat.JSON);

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(
      result.structuredContent,
    );
  });

  it('fails with the named domain rule on invalid input', () => {
    const result = render('{');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: 'invalid_receipt',
      message: expect.stringContaining('malformed JSON'),
    });
  });
});

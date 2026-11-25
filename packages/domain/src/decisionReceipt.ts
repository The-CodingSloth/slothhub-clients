import {hasRuntimeObjectType, isRuntimeBoolean, isRuntimeNumber, isRuntimeString, isRuntimeSymbol} from './runtimeValidation.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
export const DECISION_RECEIPT_VERSION = '1' as const;
export const DECISION_RECEIPT_MAX_JSON_BYTES = 128 * 1024;
export const DECISION_RECEIPT_MAX_DEPTH = 12;
export const DECISION_RECEIPT_MAX_ARRAY_ITEMS = 100;
export const DECISION_RECEIPT_MAX_STRING_BYTES = 16 * 1024;
// A source byte expands to at most the six-byte `&#124;` entity. Human-readable
// values are rendered once, the canonical JSON contributes one unescaped copy,
// and one additional JSON-sized allowance plus 64 KiB covers bounded list syntax.
export const DECISION_RECEIPT_MAX_MARKDOWN_BYTES = DECISION_RECEIPT_MAX_JSON_BYTES * 8 + 64 * 1024;
// Part of the immutable v1 encoding despite the one-h spelling; a v2 should
// use SLOTHHUB_ (see the versioning section of the receipt documentation).
export const DECISION_RECEIPT_JSON_BEGIN = '<!-- SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN -->';
export const DECISION_RECEIPT_JSON_END = '<!-- SLOTHUB_DECISION_RECEIPT_JSON_V1_END -->';
export const DECISION_RECEIPT_DEFAULT_FILENAME = 'slothhub.receipt.json' as const;
export const DECISION_RECEIPT_MARKDOWN_FILENAME = 'slothhub.receipt.md' as const;

export const DECISION_RECEIPT_FACT_STATES = [
  'present',
  'user_asserted_absent',
  'unknown',
  'not_applicable',
  'not_evaluated',
] as const;

export type DecisionReceiptFactState = (typeof DECISION_RECEIPT_FACT_STATES)[number];

export interface DecisionReceiptRequirement {
  id: string;
  text: string;
  state: DecisionReceiptFactState;
}

export interface DecisionReceiptCriterion {
  id: string;
  label: string;
  description?: string;
}

export interface DecisionReceiptToolSnapshot {
  id: string;
  slug: string;
  name: string;
  url?: string;
}

export interface DecisionReceiptEvaluation {
  criterionId: string;
  state: DecisionReceiptFactState;
  value?: string | number | boolean | string[];
  note?: string;
  citationIds?: string[];
  evidenceCheckedAt?: string;
}

export interface DecisionReceiptFact {
  key: string;
  label: string;
  state: DecisionReceiptFactState;
  value?: string | number | boolean | string[];
  citationIds?: string[];
  evidenceCheckedAt?: string;
}

export interface DecisionReceiptCandidate {
  tool: DecisionReceiptToolSnapshot;
  evaluations: DecisionReceiptEvaluation[];
  facts: DecisionReceiptFact[];
  note?: string;
}

export interface DecisionReceiptRejection {
  toolId: string;
  rationale: string;
}

export interface DecisionReceiptCitation {
  id: string;
  title?: string;
  url: string;
  checkedAt: string;
}

export interface DecisionReceipt {
  schemaVersion: typeof DECISION_RECEIPT_VERSION;
  receiptId: string;
  createdAt: string;
  catalogSnapshotAt: string;
  versions: {
    catalog: string;
    producer: string;
    schema: typeof DECISION_RECEIPT_VERSION;
  };
  requirements: DecisionReceiptRequirement[];
  criteria: DecisionReceiptCriterion[];
  candidates: DecisionReceiptCandidate[];
  selectedTool: string | null;
  rejectedCandidates: DecisionReceiptRejection[];
  rationale: string;
  tradeoffs: string[];
  citations: DecisionReceiptCitation[];
  extensions: JsonObject;
}

const fail = (path: string, message: string): never => {
  throw new TypeError(`Invalid decision receipt at ${path}: ${message}`);
};

const record = (value: JsonValue, path: string): JsonObject => {
  if (value === null || !hasRuntimeObjectType(value) || Array.isArray(value)) {
    return fail(path, 'expected an object');
  }
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  return value as JsonObject;
};

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const sortReceiptKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(sortReceiptKeys);
  if (value === null || !hasRuntimeObjectType(value)) return value;
  // SAFETY: The adjacent boundary checks validate the JSON container and every member read after this point.
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => [key, sortReceiptKeys(entry)]),
  );
};

const receiptCanonicalJson = (value: DecisionReceipt): string =>
  JSON.stringify(sortReceiptKeys(validateTree(value)));

type JsonSnapshot = null | boolean | number | string | JsonSnapshot[] | { [key: string]: JsonSnapshot };

const validateTree = <Input>(value: Input, path = '$', depth = 0): JsonSnapshot => {
  if (depth > DECISION_RECEIPT_MAX_DEPTH) fail(path, 'excessive nesting depth');
  if (isRuntimeString(value)) {
    if (utf8Bytes(value) > DECISION_RECEIPT_MAX_STRING_BYTES) fail(path, 'string byte limit exceeded');
    return value;
  }
  if (Array.isArray(value)) {
    // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
      return fail(path, 'expected a JSON array length');
    }
    // SAFETY: The preceding parser or closed-vocabulary check establishes this primitive value.
    const length = lengthDescriptor.value as number;
    if (length > DECISION_RECEIPT_MAX_ARRAY_ITEMS) fail(path, 'array item limit exceeded');
    const snapshot: JsonSnapshot[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index];
      if (descriptor === undefined) fail(`${path}[${index}]`, 'expected a JSON array value');
      if (!('value' in descriptor)) fail(`${path}[${index}]`, 'accessors are not allowed');
      snapshot.push(validateTree(descriptor.value, `${path}[${index}]`, depth + 1));
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (isRuntimeSymbol(key) || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) {
        fail(path, 'non-JSON array property is not allowed');
      }
    }
    return snapshot;
  }
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  if (value === null || isRuntimeBoolean(value)) return /* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ value as JsonSnapshot;
  if (isRuntimeNumber(value)) {
    if (!Number.isFinite(value)) fail(path, 'expected a finite JSON number');
    return value;
  }
  if (!hasRuntimeObjectType(value)) fail(path, 'expected a JSON value');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'expected a plain JSON object');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: { [key: string]: JsonSnapshot } = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (isRuntimeSymbol(key)) fail(path, 'symbol keys are not allowed in a JSON object');
    // SAFETY: The preceding parser or closed-vocabulary check establishes this primitive value.
    const stringKey = key as string;
    const descriptor = descriptors[stringKey]!;
    if (DANGEROUS_KEYS.has(stringKey)) fail(`${path}.${stringKey}`, 'dangerous key is not allowed');
    if (utf8Bytes(stringKey) > 128) fail(`${path}.${stringKey}`, 'key byte limit exceeded');
    if (!descriptor.enumerable) fail(`${path}.${stringKey}`, 'non-enumerable properties are not allowed');
    if (!('value' in descriptor)) fail(`${path}.${stringKey}`, 'accessors are not allowed');
    snapshot[stringKey] = validateTree(descriptor.value, `${path}.${stringKey}`, depth + 1);
  }
  return snapshot;
};

const onlyKeys = (value: JsonObject, path: string, allowed: readonly string[]): void => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${path}.${key}`, 'extra key is not allowed');
  }
};

const string = (value: JsonValue, path: string): string => {
  if (!isRuntimeString(value) || value.length === 0) return fail(path, 'expected a non-empty string');
  return value;
};

const optionalString = (value: JsonValue, path: string): string | undefined =>
  value === undefined ? undefined : string(value, path);

const array = <Value>(value: JsonValue, path: string, normalize: (entry: JsonValue, path: string) => Value): Value[] => {
  if (!Array.isArray(value)) return fail(path, 'expected an array');
  return value.map((entry, index) => normalize(entry, `${path}[${index}]`));
};

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const factState = (value: JsonValue, path: string): DecisionReceiptFactState => {
  if (!isRuntimeString(value) || !(DECISION_RECEIPT_FACT_STATES as readonly string[]).includes(value)) {
    return fail(path, 'unsupported fact state');
  }
  // SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
  return value as DecisionReceiptFactState;
};

const timestamp = (value: JsonValue, path: string): string => {
  const normalized = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) {
    return fail(path, 'expected an exact UTC timestamp');
  }
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    return fail(path, 'expected a valid UTC timestamp');
  }
  return normalized;
};

const httpsUrl = (value: JsonValue, path: string): string => {
  const raw = string(value, path);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(path, 'expected a valid URL');
  }
  if (url.protocol !== 'https:') fail(path, 'only HTTPS URLs are allowed');
  if (url.username || url.password) fail(path, 'URL credentials are not allowed');
  let decodedPathname = url.pathname;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(decodedPathname);
      if (decoded === decodedPathname) break;
      decodedPathname = decoded;
    }
  } catch {
    return fail(path, 'URL pathname contains malformed percent encoding');
  }
  const normalizedPathname = decodedPathname.replaceAll('\\', '/').toLowerCase();
  if (normalizedPathname === '/go' || normalizedPathname.startsWith('/go/')) {
    fail(path, '/go/ redirect URLs are not allowed');
  }
  const normalized = url.href;
  if (utf8Bytes(normalized) > DECISION_RECEIPT_MAX_STRING_BYTES) {
    fail(path, 'normalized URL string byte limit exceeded');
  }
  return normalized;
};

const stringArray = (value: JsonValue, path: string): string[] => array(value, path, string);

const optionalCitationIds = (value: JsonValue, path: string): string[] | undefined =>
  value === undefined ? undefined : stringArray(value, path);

const normalizeFactValue = (value: JsonValue, path: string): string | number | boolean | string[] | undefined => {
  if (value === undefined) return undefined;
  if (isRuntimeString(value) || isRuntimeBoolean(value)) return value;
  if (isRuntimeNumber(value) && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return stringArray(value, path);
  return fail(path, 'expected a string, finite number, boolean, or string array');
};

const uniqueIds = (values: readonly { id: string }[], path: string): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) fail(path, `duplicate id ${value.id}`);
    seen.add(value.id);
  }
};

const assertNotAfter = (value: string, upperBound: string, path: string): void => {
  if (value > upperBound) fail(path, 'must not be after receipt createdAt');
};

export const normalizeDecisionReceipt = <Input>(value: Input): DecisionReceipt => {
  const input = record(validateTree(value), '$');
  onlyKeys(input, '$', [
    'schemaVersion',
    'receiptId',
    'createdAt',
    'catalogSnapshotAt',
    'versions',
    'requirements',
    'criteria',
    'candidates',
    'selectedTool',
    'rejectedCandidates',
    'rationale',
    'tradeoffs',
    'citations',
    'extensions',
  ]);
  if (input.schemaVersion !== DECISION_RECEIPT_VERSION) {
    fail('$.schemaVersion', 'unsupported major version');
  }

  const versionsInput = record(input.versions, '$.versions');
  onlyKeys(versionsInput, '$.versions', ['catalog', 'producer', 'schema']);
  if (versionsInput.schema !== DECISION_RECEIPT_VERSION) {
    fail('$.versions.schema', 'must match schemaVersion');
  }

  const createdAt = timestamp(input.createdAt, '$.createdAt');
  const catalogSnapshotAt = timestamp(input.catalogSnapshotAt, '$.catalogSnapshotAt');
  assertNotAfter(catalogSnapshotAt, createdAt, '$.catalogSnapshotAt');

  const requirements = array(input.requirements, '$.requirements', (entry, path) => {
    const requirement = record(entry, path);
    onlyKeys(requirement, path, ['id', 'text', 'state']);
    return {
      id: string(requirement.id, `${path}.id`),
      text: string(requirement.text, `${path}.text`),
      state: factState(requirement.state, `${path}.state`),
    };
  });

  const criteria = array(input.criteria, '$.criteria', (entry, path) => {
    const criterion = record(entry, path);
    onlyKeys(criterion, path, ['id', 'label', 'description']);
    const description = optionalString(criterion.description, `${path}.description`);
    return {
      id: string(criterion.id, `${path}.id`), label: string(criterion.label, `${path}.label`),
      ...(!(description === undefined) ? { description } : undefined)
    };
  });

  const candidates = array(input.candidates, '$.candidates', (entry, path) => {
    const candidate = record(entry, path);
    onlyKeys(candidate, path, ['tool', 'evaluations', 'facts', 'note']);
    const toolInput = record(candidate.tool, `${path}.tool`);
    onlyKeys(toolInput, `${path}.tool`, ['id', 'slug', 'name', 'url']);
    const url = toolInput.url === undefined ? undefined : httpsUrl(toolInput.url, `${path}.tool.url`);
    const tool: DecisionReceiptToolSnapshot = {
      id: string(toolInput.id, `${path}.tool.id`), slug: string(toolInput.slug, `${path}.tool.slug`), name: string(toolInput.name, `${path}.tool.name`),
      ...(!(url === undefined) ? { url } : undefined)
    };
    const evaluations = array(candidate.evaluations, `${path}.evaluations`, (item, itemPath) => {
      const evaluation = record(item, itemPath);
      onlyKeys(evaluation, itemPath, ['criterionId', 'state', 'value', 'note', 'citationIds', 'evidenceCheckedAt']);
      const note = optionalString(evaluation.note, `${itemPath}.note`);
      const evaluationValue = normalizeFactValue(evaluation.value, `${itemPath}.value`);
      const citationIds = optionalCitationIds(evaluation.citationIds, `${itemPath}.citationIds`);
      const evidenceCheckedAt =
        evaluation.evidenceCheckedAt === undefined
          ? undefined
          : timestamp(evaluation.evidenceCheckedAt, `${itemPath}.evidenceCheckedAt`);
      const state = factState(evaluation.state, `${itemPath}.state`);
      if (evaluationValue !== undefined && state !== 'present') {
        fail(`${itemPath}.value`, 'only a present evaluation may carry a value');
      }
      if (evidenceCheckedAt !== undefined) {
        assertNotAfter(evidenceCheckedAt, createdAt, `${itemPath}.evidenceCheckedAt`);
      }
      return {
        criterionId: string(evaluation.criterionId, `${itemPath}.criterionId`), state,
        ...(!(evaluationValue === undefined) ? { value: evaluationValue } : undefined),
        ...(!(note === undefined) ? { note } : undefined),
        ...(!(citationIds === undefined) ? { citationIds } : undefined),
        ...(!(evidenceCheckedAt === undefined) ? { evidenceCheckedAt } : undefined)
      };
    });
    const facts = array(candidate.facts, `${path}.facts`, (item, itemPath) => {
      const fact = record(item, itemPath);
      onlyKeys(fact, itemPath, ['key', 'label', 'state', 'value', 'citationIds', 'evidenceCheckedAt']);
      const factValue = normalizeFactValue(fact.value, `${itemPath}.value`);
      const citationIds = optionalCitationIds(fact.citationIds, `${itemPath}.citationIds`);
      const evidenceCheckedAt =
        fact.evidenceCheckedAt === undefined
          ? undefined
          : timestamp(fact.evidenceCheckedAt, `${itemPath}.evidenceCheckedAt`);
      const state = factState(fact.state, `${itemPath}.state`);
      if (factValue !== undefined && state !== 'present') {
        fail(`${itemPath}.value`, 'only a present fact may carry a value');
      }
      if (evidenceCheckedAt !== undefined) {
        assertNotAfter(evidenceCheckedAt, createdAt, `${itemPath}.evidenceCheckedAt`);
      }
      return {
        key: string(fact.key, `${itemPath}.key`), label: string(fact.label, `${itemPath}.label`), state,
        ...(!(factValue === undefined) ? { value: factValue } : undefined),
        ...(!(citationIds === undefined) ? { citationIds } : undefined),
        ...(!(evidenceCheckedAt === undefined) ? { evidenceCheckedAt } : undefined)
      };
    });
    const note = optionalString(candidate.note, `${path}.note`);
    return {
      tool, evaluations, facts,
      ...(!(note === undefined) ? { note } : undefined)
    };
  });

  uniqueIds(requirements, '$.requirements');
  uniqueIds(criteria, '$.criteria');
  uniqueIds(
    candidates.map(({ tool }) => tool),
    '$.candidates',
  );

  const candidateIds = new Set(candidates.map(({ tool }) => tool.id));
  const selectedTool = input.selectedTool === null ? null : string(input.selectedTool, '$.selectedTool');
  if (selectedTool !== null && !candidateIds.has(selectedTool)) {
    fail('$.selectedTool', 'must reference a candidate Tool snapshot');
  }

  const rejectedCandidates = array(input.rejectedCandidates, '$.rejectedCandidates', (entry, path) => {
    const rejection = record(entry, path);
    onlyKeys(rejection, path, ['toolId', 'rationale']);
    const toolId = string(rejection.toolId, `${path}.toolId`);
    if (!candidateIds.has(toolId)) fail(`${path}.toolId`, 'must reference a candidate Tool snapshot');
    return { toolId, rationale: string(rejection.rationale, `${path}.rationale`) };
  });
  const rejectedToolIds = new Set<string>();
  for (const rejection of rejectedCandidates) {
    if (rejectedToolIds.has(rejection.toolId)) {
      fail('$.rejectedCandidates', `duplicate rejected toolId ${rejection.toolId}`);
    }
    rejectedToolIds.add(rejection.toolId);
  }

  if (selectedTool !== null && rejectedCandidates.some(({ toolId }) => toolId === selectedTool)) {
    fail('$.rejectedCandidates', 'the selected Tool cannot also be rejected');
  }

  const citations = array(input.citations, '$.citations', (entry, path) => {
    const citation = record(entry, path);
    onlyKeys(citation, path, ['id', 'title', 'url', 'checkedAt']);
    const title = optionalString(citation.title, `${path}.title`);
    return {
      id: string(citation.id, `${path}.id`),
      ...(!(title === undefined) ? { title } : undefined),
      url: httpsUrl(citation.url, `${path}.url`), checkedAt: timestamp(citation.checkedAt, `${path}.checkedAt`)
    };
  });
  uniqueIds(citations, '$.citations');
  for (const [citationIndex, citation] of citations.entries()) {
    assertNotAfter(citation.checkedAt, createdAt, `$.citations[${citationIndex}].checkedAt`);
  }

  const criterionIds = new Set(criteria.map(({ id }) => id));
  const citationIds = new Set(citations.map(({ id }) => id));
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const evaluationCriterionIds = new Set<string>();
    for (const [evaluationIndex, evaluation] of candidate.evaluations.entries()) {
      const path = `$.candidates[${candidateIndex}].evaluations[${evaluationIndex}]`;
      if (!criterionIds.has(evaluation.criterionId)) {
        fail(`${path}.criterionId`, 'must reference a criterion');
      }
      if (evaluationCriterionIds.has(evaluation.criterionId)) {
        fail(`${path}.criterionId`, 'each criterion must have exactly one evaluation');
      }
      evaluationCriterionIds.add(evaluation.criterionId);
      for (const citationId of evaluation.citationIds ?? []) {
        if (!citationIds.has(citationId)) fail(`${path}.citationIds`, 'must reference a citation');
      }
    }
    if (evaluationCriterionIds.size !== criterionIds.size) {
      fail(`$.candidates[${candidateIndex}].evaluations`, 'each declared criterion must have exactly one evaluation');
    }
    const factKeys = new Set<string>();
    for (const [factIndex, fact] of candidate.facts.entries()) {
      const path = `$.candidates[${candidateIndex}].facts[${factIndex}]`;
      if (factKeys.has(fact.key)) fail(`${path}.key`, `duplicate fact key ${fact.key}`);
      factKeys.add(fact.key);
      for (const citationId of fact.citationIds ?? []) {
        if (!citationIds.has(citationId)) fail(`${path}.citationIds`, 'must reference a citation');
      }
    }
  }

  return {
    schemaVersion: DECISION_RECEIPT_VERSION,
    receiptId: string(input.receiptId, '$.receiptId'),
    createdAt,
    catalogSnapshotAt,
    versions: {
      catalog: string(versionsInput.catalog, '$.versions.catalog'),
      producer: string(versionsInput.producer, '$.versions.producer'),
      schema: DECISION_RECEIPT_VERSION,
    },
    requirements,
    criteria,
    candidates,
    selectedTool,
    rejectedCandidates,
    rationale: string(input.rationale, '$.rationale'),
    tradeoffs: stringArray(input.tradeoffs, '$.tradeoffs'),
    citations,
    extensions: record(input.extensions, '$.extensions'),
  };
};

export const parseDecisionReceiptJson = (source: string): DecisionReceipt => {
  if (!isRuntimeString(source)) fail('$', 'expected UTF-8 JSON text');
  if (utf8Bytes(source) > DECISION_RECEIPT_MAX_JSON_BYTES) {
    fail('$', 'receipt byte limit exceeded before parsing');
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail('$', 'malformed JSON');
  }
  return normalizeDecisionReceipt(parsed);
};

export const serializeDecisionReceiptJson = <Input>(value: Input): string => {
  const json = `${receiptCanonicalJson(normalizeDecisionReceipt(value))}\n`;
  if (utf8Bytes(json) > DECISION_RECEIPT_MAX_JSON_BYTES) fail('$', 'receipt byte limit exceeded');
  return json;
};

const escapeMarkdownText = (value: string): string => {
  const htmlEntities = new Map([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ]);
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f&<>"'\\`*_{}[\]()#+\-.!|]/g,
    (character) => htmlEntities.get(character) ?? `&#${character.codePointAt(0)};`,
  );
};

const displayState = (state: DecisionReceiptFactState): string => state.replaceAll('_', ' ');

const displayValue = (value: string | number | boolean | string[]): string =>
  Array.isArray(value) ? value.join(', ') : String(value);

const evaluationDetails = (evaluation: DecisionReceiptEvaluation): string => {
  const details = [
    evaluation.value === undefined ? undefined : `value: ${escapeMarkdownText(displayValue(evaluation.value))}`,
    evaluation.note === undefined ? undefined : `note: ${escapeMarkdownText(evaluation.note)}`,
    evaluation.evidenceCheckedAt === undefined
      ? undefined
      : `evidence checked: ${escapeMarkdownText(evaluation.evidenceCheckedAt)}`,
    !evaluation.citationIds?.length
      ? undefined
      : `citations: ${escapeMarkdownText(evaluation.citationIds.join(', '))}`,
  ].filter((detail): detail is string => detail !== undefined);

  return details.length === 0 ? '' : ` — ${details.join(' — ')}`;
};

export const renderDecisionReceiptMarkdown = <Input>(value: Input): string => {
  const receipt = normalizeDecisionReceipt(value);
  const lines = [
    '# SlothHub decision receipt',
    '',
    '> Imported receipt content is unverified. Review it before relying on the decision.',
    '',
    `- Receipt: ${escapeMarkdownText(receipt.receiptId)}`,
    `- Created: ${escapeMarkdownText(receipt.createdAt)}`,
    `- Catalog snapshot: ${escapeMarkdownText(receipt.catalogSnapshotAt)}`,
    `- Selected Tool: ${escapeMarkdownText(receipt.selectedTool ?? 'Undecided')}`,
    '',
    '## Requirements',
    '',
    ...receipt.requirements.map(
      ({ text, state }) => `- ${escapeMarkdownText(text)} — ${escapeMarkdownText(displayState(state))}`,
    ),
    '',
    '## Criteria',
    '',
    ...receipt.criteria.map(
      ({ id, label, description }) =>
        `- ${escapeMarkdownText(id)}: ${escapeMarkdownText(label)}${description ? ` — ${escapeMarkdownText(description)}` : ''}`,
    ),
    '',
    '## Candidates',
    '',
  ];

  for (const candidate of receipt.candidates) {
    lines.push(`### ${escapeMarkdownText(candidate.tool.name)}`, '');
    if (candidate.note) lines.push(`- Note: ${escapeMarkdownText(candidate.note)}`);
    for (const evaluation of candidate.evaluations) {
      lines.push(
        `- ${escapeMarkdownText(evaluation.criterionId)}: ${escapeMarkdownText(displayState(evaluation.state))}${evaluationDetails(evaluation)}`,
      );
    }
    for (const fact of candidate.facts) {
      const valueText =
        fact.value === undefined ? '' : ` — ${displayValue(fact.value)}`;
      lines.push(
        `- ${escapeMarkdownText(fact.label)}: ${escapeMarkdownText(displayState(fact.state))}${escapeMarkdownText(valueText)}`,
      );
    }
    lines.push('');
  }

  lines.push('## Rationale', '', escapeMarkdownText(receipt.rationale), '', '## Tradeoffs', '');
  lines.push(...receipt.tradeoffs.map((tradeoff) => `- ${escapeMarkdownText(tradeoff)}`));
  if (receipt.rejectedCandidates.length > 0) {
    lines.push('', '## Rejected candidates', '');
    lines.push(
      ...receipt.rejectedCandidates.map(
        ({ toolId, rationale }) => `- ${escapeMarkdownText(toolId)} — ${escapeMarkdownText(rationale)}`,
      ),
    );
  }
  if (receipt.citations.length > 0) {
    lines.push('', '## Citations', '');
    lines.push(
      ...receipt.citations.map(
        ({ title, url, checkedAt }) =>
          `- ${escapeMarkdownText(title ?? url)} — ${escapeMarkdownText(url)} — checked ${escapeMarkdownText(checkedAt)}`,
      ),
    );
  }

  const json = serializeDecisionReceiptJson(receipt).trimEnd();
  lines.push('', DECISION_RECEIPT_JSON_BEGIN, '```json', json, '```', DECISION_RECEIPT_JSON_END, '');
  const markdown = lines.join('\n');
  if (utf8Bytes(markdown) > DECISION_RECEIPT_MAX_MARKDOWN_BYTES) {
    fail('$', 'rendered Markdown byte limit exceeded');
  }
  return markdown;
};

export const extractDecisionReceiptJson = (markdown: string): string => {
  if (!isRuntimeString(markdown) || utf8Bytes(markdown) > DECISION_RECEIPT_MAX_MARKDOWN_BYTES) {
    fail('$', 'Markdown byte limit exceeded');
  }
  const blockStart = `${DECISION_RECEIPT_JSON_BEGIN}\n\`\`\`json\n`;
  const blockEnd = `\n\`\`\`\n${DECISION_RECEIPT_JSON_END}`;
  const start = markdown.indexOf(blockStart);
  const end = start < 0 ? -1 : markdown.indexOf(blockEnd, start + blockStart.length);
  if (
    start < 0 ||
    end < 0 ||
    markdown.indexOf(blockStart, start + blockStart.length) >= 0 ||
    markdown.indexOf(DECISION_RECEIPT_JSON_END, end + blockEnd.length) >= 0
  ) {
    fail('$', 'expected exactly one complete decision receipt delimiter block');
  }
  const json = `${markdown.slice(start + blockStart.length, end).trimEnd()}\n`;
  parseDecisionReceiptJson(json);
  return json;
};

export const parseDecisionReceiptArtifact = (source: string): DecisionReceipt => {
  if (!isRuntimeString(source) || source.length > DECISION_RECEIPT_MAX_MARKDOWN_BYTES) {
    fail('$', 'artifact must be a string within the Markdown byte limit');
  }
  const blockStart = `${DECISION_RECEIPT_JSON_BEGIN}\n\`\`\`json\n`;
  return source.includes(blockStart)
    ? parseDecisionReceiptJson(extractDecisionReceiptJson(source))
    : parseDecisionReceiptJson(source);
};

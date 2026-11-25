import {hasRuntimeObjectType, isRuntimeString} from './runtimeValidation.js'
import type {JsonObject, JsonValue} from './jsonValue.js'
import {getOsRuntimeRequirementIssues} from './osRuntimeRequirementValidation.js'
import {
  buildUniquePublicSourceReferenceUrlMap,
  normalizePublicSourceReferenceUrl,
  type SourceReferenceInput,
} from './sourceReference.js'

export const RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES = [
  'runtime',
  'os',
  'architecture',
  'framework',
] as const

// Required means the Tool cannot install or run outside the opaque environment range.
export const RUNTIME_REQUIREMENT_STATUS_VALUES = [
  'required',
  'supported',
  'partial',
  'unsupported',
  'unknown',
] as const

export const RUNTIME_REQUIREMENT_MAX_ROWS = 12
export const RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH = 400
export const RUNTIME_REQUIREMENT_MAX_EVIDENCE = 3

export type RuntimeRequirementSubjectKind =
  (typeof RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES)[number]
export type RuntimeRequirementStatus =
  (typeof RUNTIME_REQUIREMENT_STATUS_VALUES)[number]

export interface RuntimeRequirementInput {
  _key?: string
  subjectKind?: string
  subjectName?: string
  environmentRange?: string
  toolRange?: string | null
  status?: string
  note?: string | null
  evidenceUrls?: string[]
  reviewedAt?: string
}

export interface PublicRuntimeRequirementEvidence {
  title: string
  url: string
  checkedAt: string
}

export interface PublicRuntimeRequirement {
  subjectKind: RuntimeRequirementSubjectKind
  subjectName: string
  environmentRange: string
  toolRange?: string
  status: RuntimeRequirementStatus
  note?: string
  evidence: PublicRuntimeRequirementEvidence[]
  reviewedAt: string
}

export type PublicRuntimeRequirementIssueCode =
  | 'expected_array'
  | 'too_many_rows'
  | 'invalid_row_shape'
  | 'invalid_subject_kind'
  | 'invalid_text'
  | 'invalid_status'
  | 'invalid_datetime'
  | 'invalid_evidence_collection'
  | 'assertive_evidence_required'
  | 'invalid_evidence_shape'
  | 'invalid_evidence_url'
  | 'duplicate_evidence_url'
  | 'duplicate_exact_key'
  | 'conflicting_exact_key'
  | 'os-name-list'
  | 'os-version-required'

export interface PublicRuntimeRequirementIssue {
  code: PublicRuntimeRequirementIssueCode
  path: ReadonlyArray<string | number>
  message: string
}

export type ParsePublicRuntimeRequirementsResult =
  | {success: true; value: PublicRuntimeRequirement[]}
  | {success: false; issues: PublicRuntimeRequirementIssue[]}

const CONTROL_OR_FORMAT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const PUBLIC_REQUIREMENT_KEYS = new Set([
  'subjectKind',
  'subjectName',
  'environmentRange',
  'toolRange',
  'status',
  'note',
  'evidence',
  'reviewedAt',
])
const PUBLIC_EVIDENCE_KEYS = new Set(['title', 'url', 'checkedAt'])

const isRecord = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: JsonObject, allowed: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => allowed.has(key))

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const isSubjectKind = (value: JsonValue): value is RuntimeRequirementSubjectKind =>
  isRuntimeString(value) &&
  (RUNTIME_REQUIREMENT_SUBJECT_KIND_VALUES as readonly string[]).includes(value)

// SAFETY: The source is a closed or validated string collection; widening only enables collection operations.
const isStatus = (value: JsonValue): value is RuntimeRequirementStatus =>
  isRuntimeString(value) &&
  (RUNTIME_REQUIREMENT_STATUS_VALUES as readonly string[]).includes(value)

const isSafeText = (value: JsonValue, maxLength: number): value is string =>
  isRuntimeString(value) &&
  value.trim().length > 0 &&
  value.length <= maxLength &&
  !CONTROL_OR_FORMAT.test(value)

const isIsoDateTime = (value: JsonValue): value is string => {
  if (!isRuntimeString(value) || !ISO_DATE_PATTERN.test(value)) return false
  const timestamp = Date.parse(value)
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === canonical
}

const isValidatedPublicRuntimeRequirementEvidence = (
  value: JsonValue,
): value is JsonObject & PublicRuntimeRequirementEvidence =>
  isRecord(value) &&
  hasOnlyKeys(value, PUBLIC_EVIDENCE_KEYS) &&
  isSafeText(value.title, 160) &&
  isRuntimeString(value.url) &&
  normalizeRuntimeRequirementEvidenceUrl(value.url) === value.url &&
  isIsoDateTime(value.checkedAt)

const isValidatedPublicRuntimeRequirement = (
  value: JsonObject,
): value is JsonObject & PublicRuntimeRequirement =>
  hasOnlyKeys(value, PUBLIC_REQUIREMENT_KEYS) &&
  isSubjectKind(value.subjectKind) &&
  isSafeText(value.subjectName, 80) &&
  isSafeText(value.environmentRange, 120) &&
  (value.toolRange === undefined || isSafeText(value.toolRange, 120)) &&
  isStatus(value.status) &&
  (value.note === undefined || isSafeText(value.note, RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH)) &&
  Array.isArray(value.evidence) &&
  value.evidence.every(isValidatedPublicRuntimeRequirementEvidence) &&
  isIsoDateTime(value.reviewedAt)

const normalizeSubjectName = (value: string): string => value.replace(/\s+/g, ' ').trim()

const normalizeRuntimeRequirementEvidenceUrl = normalizePublicSourceReferenceUrl

const getRuntimeRequirementKey = (requirement: RuntimeRequirementInput): string => [
  requirement.subjectKind ?? '',
  isRuntimeString(requirement.subjectName)
    ? normalizeSubjectName(requirement.subjectName).toLocaleLowerCase('en-US')
    : '',
  requirement.toolRange ?? '',
  requirement.environmentRange ?? '',
].join('\u0000')

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
export const parsePublicRuntimeRequirements = (
  input: JsonValue,
): ParsePublicRuntimeRequirementsResult => {
  if (!Array.isArray(input)) {
    return {
      success: false,
      issues: [{
        code: 'expected_array',
        path: [],
        message: 'runtime requirements must be an array.',
      }],
    }
  }
  if (input.length > RUNTIME_REQUIREMENT_MAX_ROWS) {
    return {
      success: false,
      issues: [{
        code: 'too_many_rows',
        path: [],
        message: `expected at most ${RUNTIME_REQUIREMENT_MAX_ROWS} rows.`,
      }],
    }
  }

  const issues: PublicRuntimeRequirementIssue[] = []
  const value: PublicRuntimeRequirement[] = []
  const statusesByKey = new Map<string, RuntimeRequirementStatus>()
  const addIssue = (
    code: PublicRuntimeRequirementIssueCode,
    path: ReadonlyArray<string | number>,
    message: string,
  ) => issues.push({code, path, message})

  for (const [index, candidate] of input.entries()) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, PUBLIC_REQUIREMENT_KEYS)) {
      addIssue('invalid_row_shape', [index], 'each row must be a strict object.')
      continue
    }
    const row = candidate

    const rowIssueStart = issues.length
    for (const issue of getOsRuntimeRequirementIssues(row)) {
      addIssue(issue.code, [index, issue.field], issue.message)
    }
    if (!isSubjectKind(row.subjectKind)) {
      addIssue('invalid_subject_kind', [index, 'subjectKind'], 'invalid subject kind.')
    }
    if (!isSafeText(row.subjectName, 80) || !isSafeText(row.environmentRange, 120)) {
      addIssue('invalid_text', [index], 'invalid subject or environment range.')
    }
    if (row.toolRange !== undefined && !isSafeText(row.toolRange, 120)) {
      addIssue('invalid_text', [index, 'toolRange'], 'invalid Tool range.')
    }
    if (!isStatus(row.status)) {
      addIssue('invalid_status', [index, 'status'], 'invalid status.')
    }
    if (row.note !== undefined
      && !isSafeText(row.note, RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH)) {
      addIssue('invalid_text', [index, 'note'], 'invalid note.')
    }
    if (!isIsoDateTime(row.reviewedAt)) {
      addIssue('invalid_datetime', [index, 'reviewedAt'], 'invalid review date.')
    }

    const evidence = row.evidence
    if (!Array.isArray(evidence) || evidence.length > RUNTIME_REQUIREMENT_MAX_EVIDENCE) {
      addIssue(
        'invalid_evidence_collection',
        [index, 'evidence'],
        `expected at most ${RUNTIME_REQUIREMENT_MAX_EVIDENCE} evidence references.`,
      )
    } else {
      if (row.status !== 'unknown' && evidence.length === 0) {
        addIssue(
          'assertive_evidence_required',
          [index, 'evidence'],
          'assertive rows require public evidence.',
        )
      }

      const evidenceUrls = new Set<string>()
      let duplicateEvidenceReported = false
      for (const [evidenceIndex, source] of evidence.entries()) {
        const sourcePath = [index, 'evidence', evidenceIndex] as const
        if (!isRecord(source) || !hasOnlyKeys(source, PUBLIC_EVIDENCE_KEYS)) {
          addIssue(
            'invalid_evidence_shape',
            sourcePath,
            'each evidence reference must be a strict object.',
          )
          continue
        }
        const evidenceInput = source
        if (!isSafeText(evidenceInput.title, 160) || !isRuntimeString(evidenceInput.url)) {
          addIssue('invalid_text', sourcePath, 'invalid evidence title or URL.')
        }
        const normalizedUrl = normalizeRuntimeRequirementEvidenceUrl(evidenceInput.url)
        if (!normalizedUrl || evidenceInput.url !== normalizedUrl) {
          addIssue(
            'invalid_evidence_url',
            [...sourcePath, 'url'],
            'evidence URL must be public HTTP(S).',
          )
        } else if (evidenceUrls.has(normalizedUrl)) {
          if (!duplicateEvidenceReported) {
            addIssue(
              'duplicate_evidence_url',
              [index, 'evidence'],
              'evidence URLs must be unique within a row.',
            )
            duplicateEvidenceReported = true
          }
        } else {
          evidenceUrls.add(normalizedUrl)
        }
        if (!isIsoDateTime(evidenceInput.checkedAt)) {
          addIssue(
            'invalid_datetime',
            [...sourcePath, 'checkedAt'],
            'invalid evidence checked date.',
          )
        }
      }
    }

    if (issues.length !== rowIssueStart) continue

    if (!isValidatedPublicRuntimeRequirement(row)) {
      addIssue('invalid_row_shape', [index], 'each row must contain validated public values.')
      continue
    }
    const requirement = row
    const key = getRuntimeRequirementKey(requirement)
    const previousStatus = statusesByKey.get(key)
    if (previousStatus !== undefined) {
      addIssue(
        previousStatus === requirement.status
          ? 'duplicate_exact_key'
          : 'conflicting_exact_key',
        [index],
        previousStatus === requirement.status
          ? 'duplicate exact requirement key.'
          : 'conflicting statuses for one exact requirement key.',
      )
      continue
    }
    statusesByKey.set(key, requirement.status)
    value.push(requirement)
  }

  return issues.length > 0 ? {success: false, issues} : {success: true, value}
}

const reconstructCollection = (
  requirements: RuntimeRequirementInput[] | null | undefined,
  sourceReferences: SourceReferenceInput[] | null | undefined,
) => {
  if (requirements == null) return {value: []}
  if (!Array.isArray(requirements)) {
    return {error: 'Runtime requirements must be an array.'}
  }
  if (requirements.length === 0) return {value: []}
  if (requirements.length > RUNTIME_REQUIREMENT_MAX_ROWS) {
    return {error: `Runtime requirements must contain at most ${RUNTIME_REQUIREMENT_MAX_ROWS} rows.`}
  }

  const evidenceByUrl = buildUniquePublicSourceReferenceUrlMap(sourceReferences)
  const result: PublicRuntimeRequirement[] = []
  const statusesByKey = new Map<string, RuntimeRequirementStatus>()

  for (const requirement of requirements) {
    const osIssues = requirement && getOsRuntimeRequirementIssues(requirement)
    if (osIssues?.length) return {error: osIssues.map(({code, message}) => `${code}: ${message}`).join(' ')}
    if (!requirement || !hasRuntimeObjectType(requirement)
      || !isSubjectKind(requirement.subjectKind)
      || !isSafeText(requirement.subjectName, 80)
      || !isSafeText(requirement.environmentRange, 120)
      || !isStatus(requirement.status)
      || !isIsoDateTime(requirement.reviewedAt)) {
      return {error: 'Runtime requirements contain an invalid row.'}
    }
    if (requirement.toolRange != null && !isSafeText(requirement.toolRange, 120)) {
      return {error: 'Runtime requirements contain an invalid Tool range.'}
    }
    if (requirement.note != null
      && !isSafeText(requirement.note, RUNTIME_REQUIREMENT_MAX_NOTE_LENGTH)) {
      return {error: 'Runtime requirements contain an invalid note.'}
    }
    const evidenceUrls = requirement.evidenceUrls ?? []
    if (!Array.isArray(evidenceUrls)
      || evidenceUrls.length > RUNTIME_REQUIREMENT_MAX_EVIDENCE
      || (requirement.status !== 'unknown' && evidenceUrls.length === 0)) {
      return {error: 'Assertive runtime requirements need one to three public evidence references.'}
    }

    const evidence: PublicRuntimeRequirementEvidence[] = []
    const seenEvidence = new Set<string>()
    for (const url of evidenceUrls) {
      const normalizedUrl = normalizeRuntimeRequirementEvidenceUrl(url)
      const source = normalizedUrl ? evidenceByUrl.get(normalizedUrl) : undefined
      if (!source?.checkedAt
        || !isIsoDateTime(source.checkedAt)
        || !normalizedUrl
        || seenEvidence.has(normalizedUrl)) {
        return {error: 'Runtime requirement evidence must resolve to unique, public, checked Source References.'}
      }
      seenEvidence.add(normalizedUrl)
      evidence.push({
        title: source.title,
        url: normalizedUrl,
        checkedAt: source.checkedAt,
      })
    }

    const key = getRuntimeRequirementKey(requirement)
    const previousStatus = statusesByKey.get(key)
    if (previousStatus === requirement.status) {
      return {error: 'Runtime requirements contain a duplicate exact key.'}
    }
    if (previousStatus !== undefined) {
      return {error: 'Runtime requirements contain conflicting statuses for one exact key.'}
    }
    statusesByKey.set(key, requirement.status)

    result.push({
      subjectKind: requirement.subjectKind, subjectName: normalizeSubjectName(requirement.subjectName), environmentRange: requirement.environmentRange,
      ...(requirement.toolRange != null ? { toolRange: requirement.toolRange } : undefined),
      status: requirement.status,
      ...(requirement.note != null ? { note: requirement.note.trim() } : undefined),
      evidence, reviewedAt: requirement.reviewedAt
    })
  }

  return {value: result}
}

export const validateRuntimeRequirements = (
  requirements: RuntimeRequirementInput[] | null | undefined,
  sourceReferences: SourceReferenceInput[] | null | undefined,
): true | string => reconstructCollection(requirements, sourceReferences).error ?? true

export const normalizePublicRuntimeRequirements = (
  requirements: RuntimeRequirementInput[] | null | undefined,
  sourceReferences: SourceReferenceInput[] | null | undefined,
): PublicRuntimeRequirement[] => {
  if (!Array.isArray(requirements) || requirements.length > RUNTIME_REQUIREMENT_MAX_ROWS) return []
  // Keep collection-level duplicate/conflict checks strict, while a malformed
  // individual row no longer erases unrelated, verified requirements.
  const validRows = requirements.filter((row) => reconstructCollection([row], sourceReferences).error === undefined)
  return reconstructCollection(validRows, sourceReferences).value ?? []
}

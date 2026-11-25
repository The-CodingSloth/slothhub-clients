import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'

interface OsRuntimeRequirementCandidate {
  subjectKind?: JsonValue
  subjectName?: JsonValue
  environmentRange?: JsonValue
}

export interface OsRuntimeRequirementIssue {
  code: 'os-name-list' | 'os-version-required'
  field: 'subjectName' | 'environmentRange'
  message: string
}

/** OS ranges remain ecosystem-native, including named releases such as Sonoma.
 * Version-free availability belongs in Platforms, not a runtime requirement.
 */
export function getOsRuntimeRequirementIssues(row: OsRuntimeRequirementCandidate | null | undefined): OsRuntimeRequirementIssue[] {
  if (row?.subjectKind !== 'os') return []
  const issues: OsRuntimeRequirementIssue[] = []
  if (isRuntimeString(row.subjectName) && /[,;|]|\s(?:and|or|&)\s/iu.test(row.subjectName)) {
    issues.push({code: 'os-name-list', field: 'subjectName', message: 'Record one operating system per runtime requirement. Use Platforms for version-free OS support.'})
  }
  if (!isRuntimeString(row.environmentRange) || !row.environmentRange.trim()
    || /^(?:\*|any|all|any\s+versions?|all\s+versions?|latest|unknown|unspecified|unrestricted|n\/?a|not\s+applicable)$/iu.test(row.environmentRange.trim())) {
    issues.push({code: 'os-version-required', field: 'environmentRange', message: 'Record a sourced OS version constraint, such as >=14 or Sonoma or newer. Use Platforms for version-free OS support and remove this runtime row.'})
  }
  return issues
}

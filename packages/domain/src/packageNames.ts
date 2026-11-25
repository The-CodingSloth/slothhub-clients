import type {JsonValue} from './jsonValue.js'
import {isRuntimeString} from './runtimeValidation.js'

// npm package names use the same grammar the Resource Identity submission parser
// applies, tightened to the documented registry rules: an optional lowercase
// `@scope/` prefix, then name segments built from lowercase letters, digits, and
// `-._~`, never starting with a separator (npm rejects leading `-`, `_`, and `.`,
// so flag-shaped identifiers like `--help` cannot reach a command); 214 characters
// max. Canonical npm names are lowercase, so the authored value must already match.
// Strict so a derived copy-only command can never interpolate spaces, version pins,
// or shell metacharacters.
const NPM_PACKAGE_NAME_PATTERN = /^(@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/

export const isValidNpmPackageName = (value: JsonValue): value is string =>
  isRuntimeString(value) && value.length <= 214 && NPM_PACKAGE_NAME_PATTERN.test(value)

// PyPI project names use the PEP 503 packaging grammar the Resource Identity
// submission parser applies: letters, digits, and `.`/`_`/`-` separators between
// alphanumeric segments. Strict so a derived copy-only command can never interpolate
// version specifiers, extras, or shell metacharacters.
const PYPI_PROJECT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

export const isValidPypiProjectName = (value: JsonValue): value is string =>
  isRuntimeString(value) && PYPI_PROJECT_NAME_PATTERN.test(value)

/** PEP 503 compares case and runs of package-name separators equivalently. */
export const normalizePypiProjectName = (value: string): string =>
  value.toLowerCase().replace(/[-_.]+/g, '-')

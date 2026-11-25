/**
 * Canonical Go module paths as declared in a `module` directive or `require`
 * line. Grammar follows golang.org/x/mod/module.checkPath: path elements are
 * ASCII letters, digits, and the punctuation `-`, `.`, `_`, `~`, `!`; no
 * element may begin or end with a dot; the leading element is a domain and
 * must contain a dot. A `/vN` element is part of the canonical module path —
 * it is not a version pin. Module versions (`@v1.2.3`) never appear inside a
 * declared path, so `@` is outside the grammar entirely.
 */
import {isRuntimeString} from './runtimeValidation.js'

export const GO_MODULE_PATH_MAX_LENGTH = 512

const GO_MODULE_ELEMENT_PATTERN = /^[A-Za-z0-9\-_~!](?:[A-Za-z0-9.\-_~!]*[A-Za-z0-9\-_~!])?$/

export const isCanonicalGoModulePath = (value: string): boolean => {
  if (!value || value.length > GO_MODULE_PATH_MAX_LENGTH || value !== value.trim()) {
    return false
  }
  const elements = value.split('/')
  if (elements.length < 2 || !elements[0]!.includes('.')) {
    return false
  }
  return elements.every((element) => GO_MODULE_ELEMENT_PATTERN.test(element))
}

/** Fixed pkg.go.dev identity URL for a canonical module path. */
export const goModuleCanonicalUrl = (modulePath: string | null | undefined): string | null =>
  isRuntimeString(modulePath) && isCanonicalGoModulePath(modulePath)
    ? `https://pkg.go.dev/${modulePath}`
    : null

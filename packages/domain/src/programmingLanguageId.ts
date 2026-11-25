import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'

/** Shared ID grammar for authoring validation and small browser filter controls. */
export const PROGRAMMING_LANGUAGE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export const isProgrammingLanguageId = (value: JsonValue): value is string =>
  isRuntimeString(value) && PROGRAMMING_LANGUAGE_ID_PATTERN.test(value)

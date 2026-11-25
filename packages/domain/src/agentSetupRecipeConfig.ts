import {stringify as stringifyYaml} from 'yaml'
import type {JsonObject} from './jsonValue.js'
import type {AgentSetupRecipeHostMeta} from './agentSetupRecipeHosts.js'
import type {SetupRecipeSnippetInput} from './mcpRegistry.js'

const headerEnvVarName = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]/g, '_')

/** The `${NAME}` fill-in marker a header gets inside a JSON snippet. */
const headerPlaceholder = (name: string): string =>
  `\${${headerEnvVarName(name)}}`

/**
 * TOML escaping for snippet values. Basic strings escape backslash and quote
 * plus the control characters TOML forbids raw; `\n` `\r` `\t` keep their
 * familiar escapes. A hostile `serverKey` can therefore never break out of
 * the quoted string — `]`, newlines, and further `[` headers stay inert.
 */
const tomlBasicString = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(
      // eslint-disable-next-line no-control-regex -- TOML requires escaping C0 controls and DEL.
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )}"`

/** TOML bare keys are limited to letters, digits, `_`, and `-`; anything else is quoted. */
const TOML_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * A TOML key safe to interpolate into a table path. Quoting a key keeps even
 * `.` and `]` inside it — `[mcp_servers."a.b"]` is one server named `a.b`,
 * never a nested path or a second table.
 */
const tomlKey = (key: string): string =>
  TOML_BARE_KEY_PATTERN.test(key) ? key : tomlBasicString(key)

/**
 * The TOML fragment Codex CLI reads: `[mcp_servers.<key>]` with `url`, plus
 * `env_http_headers` mapping declared header names to env-var names — never a
 * token value. One builder serves both snippet shapes because a TOML table
 * header is inherently mergeable: pasting it never replaces sibling servers.
 */
const buildTomlSetupRecipeSnippet = (
  host: {rootKey: string; remoteField: string},
  recipe: Extract<SetupRecipeSnippetInput, {url: string}>,
): string => {
  const lines = [
    `[${host.rootKey}.${tomlKey(recipe.serverKey)}]`,
    `${host.remoteField} = ${tomlBasicString(recipe.url)}`,
  ]
  const headers = recipe.headers ?? []
  // Codex maps Authorization onto the dedicated bearer_token_env_var field;
  // every other declared header goes through env_http_headers. Both carry
  // env-var names only — a secret value can never be emitted.
  const bearer = headers.find(
    (header) => header.name.toLowerCase() === 'authorization',
  )
  if (bearer) {
    lines.push(
      `bearer_token_env_var = ${tomlBasicString(headerEnvVarName(bearer.name))}`,
    )
  }
  const rest = headers.filter((header) => header !== bearer)
  if (rest.length) {
    const entries = rest
      .map(
        (header) =>
          `${tomlKey(header.name)} = ${tomlBasicString(headerEnvVarName(header.name))}`,
      )
      .join(', ')
    lines.push(`env_http_headers = { ${entries} }`)
  }
  return lines.join('\n')
}

/** Goose's documented Streamable HTTP entry, without optional auth or timeouts. */
const buildGooseSetupRecipeEntry = (
  recipe: Extract<SetupRecipeSnippetInput, {url: string}>,
): JsonObject => ({
  [recipe.serverKey]: {
    name: recipe.serverKey,
    type: 'streamable_http',
    uri: recipe.url,
    enabled: true,
  },
})

/** One encoding for both the full JSON file and the mergeable entry. */
const buildJsonSetupRecipeEntry = (
  host: Exclude<AgentSetupRecipeHostMeta, {configFormat: 'shell'}>,
  recipe: Extract<SetupRecipeSnippetInput, {url: string}>,
): JsonObject => {
  const entry: JsonObject = {}
  if (host.remoteType) entry.type = host.remoteType
  entry[host.remoteField] = recipe.url
  if (host.headerMode !== 'omit' && recipe.headers?.length) {
    entry.headers = Object.fromEntries(
      recipe.headers.map((header) => [header.name, headerPlaceholder(header.name)]),
    )
  }
  return {[recipe.serverKey]: entry}
}

/** Serialize a full configuration or an entry without replacing sibling settings. */
export const formatAgentSetupRecipeConfig = (
  recipe: SetupRecipeSnippetInput,
  host: Exclude<AgentSetupRecipeHostMeta, {configFormat: 'shell'}>,
  target: 'file' | 'entry',
): string => {
  if ('command' in recipe) {
    const entry = {[recipe.serverKey]: {type: 'stdio', command: recipe.command, args: recipe.args}}
    return JSON.stringify(target === 'file' ? {[host.rootKey]: entry} : entry, null, 2)
  }
  if (host.configFormat === 'toml') return buildTomlSetupRecipeSnippet(host, recipe)
  if (recipe.host === 'continue') {
    const servers = [{name: recipe.serverKey, type: 'streamable-http', url: recipe.url}]
    return stringifyYaml(target === 'entry' ? servers : {name: `SlothHub ${recipe.serverKey}`, version: '1.0.0', schema: 'v1', mcpServers: servers})
  }
  if (recipe.host === 'goose') {
    const entry = buildGooseSetupRecipeEntry(recipe)
    return target === 'file' ? stringifyYaml({extensions: entry}) : stringifyYaml(entry).replace(/^(.+)$/gm, '  $1')
  }
  const entry = buildJsonSetupRecipeEntry(host, recipe)
  return JSON.stringify(target === 'file' ? {[host.rootKey]: entry} : entry, null, 2)
}

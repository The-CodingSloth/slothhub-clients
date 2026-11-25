import {ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES, EcosystemManifestInventoryError, inventoryEcosystemManifest, resolveInventoryEcosystem, type EcosystemManifestInventoryReport, type ManifestEcosystem} from '@slothhub/domain/ecosystem-manifest-inventory';
import {BREWFILE_INVENTORY_MAX_BYTES, BrewfileInventoryError, inventoryBrewfile, type BrewfileInventoryReport} from '@slothhub/domain/brewfile-inventory';
import {GO_MOD_INVENTORY_MAX_BYTES, GoModInventoryError, inventoryGoMod, isGoModuleInventorySource, type GoModInventoryReport} from '@slothhub/domain/go-mod-inventory';
import {NPM_MANIFEST_INVENTORY_MAX_BYTES, NpmManifestInventoryError, inventoryNpmManifest, type NpmManifestInventoryReport} from '@slothhub/domain/npm-manifest-inventory';
import {ToolLookupArtifactLimitError, type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';

import type {CliResult} from './types.js'
import {failForOutput, jsonLine, ok, safeDiagnostic} from './cliOutput.js'
import {
  BoundedUtf8SourceError,
  readBoundedUtf8Source,
} from '@slothhub/domain/bounded-utf8-source'

const MANIFEST_LABEL = {
  npm: 'Workspace dependency manifest',
  pypi: 'PyPI dependency manifest',
  crates: 'crates dependency manifest',
} satisfies Record<ManifestEcosystem, string>
const MANIFEST_MAX_BYTES = {
  npm: NPM_MANIFEST_INVENTORY_MAX_BYTES,
  pypi: ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES,
  crates: ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES,
} satisfies Record<ManifestEcosystem, number>
const MANIFEST_RECOVERY =
  'Provide one explicit package.json, pyproject.toml, or Cargo.toml no larger than 65536 bytes, or pipe it through stdin with -.'
const BREWFILE_LABEL = 'Brewfile'
const BREWFILE_RECOVERY =
  'Provide one explicit Brewfile no larger than 65536 bytes, or pipe it through stdin with -.'

export const readDependencyManifest = (
  path: string,
  ecosystem: ManifestEcosystem,
): Promise<string> =>
  readBoundedUtf8Source(path, {
    maxBytes: MANIFEST_MAX_BYTES[ecosystem],
    label: MANIFEST_LABEL[ecosystem],
    recovery: MANIFEST_RECOVERY,
  })

export const readWorkspaceDependencyManifest = (path: string): Promise<string> =>
  readDependencyManifest(path, 'npm')
export const readBrewfileSource = (path: string): Promise<string> =>
  readBoundedUtf8Source(path, {
    maxBytes: BREWFILE_INVENTORY_MAX_BYTES,
    label: BREWFILE_LABEL,
    recovery: BREWFILE_RECOVERY,
  })

const GO_MOD_LABEL = 'Go module file'
const GO_MOD_RECOVERY =
  'Provide one explicit go.mod or go.work file no larger than 65536 bytes, or pipe it through stdin with -.'

export const readGoModSource = (path: string): Promise<string> =>
  readBoundedUtf8Source(path, {
    maxBytes: GO_MOD_INVENTORY_MAX_BYTES,
    label: GO_MOD_LABEL,
    recovery: GO_MOD_RECOVERY,
  })

export interface InventoryCliInput {
  sources: string[]
  json: boolean
  ecosystem?: string
  brewfile?: boolean
}

export interface InventoryCliDependencies {
  readSource?: (path: string, ecosystem?: ManifestEcosystem) => Promise<string>
  loadLookup: () => Promise<ToolLookupArtifact | null>
}

interface InventoryFailurePayload {
  code: string
  message: string
  configuredLimit?: number
  observedValue?: number
  recovery: string
}

interface SourceFailurePayload {
  code: string
  message: string
  configuredLimitBytes?: number
  observedBytes?: number
  recovery: string
}

const visibleTerminalText = (value: string): string =>
  value.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  )

const REPORT_TITLE = {
  npm: 'Workspace dependency inventory',
  pypi: 'PyPI dependency inventory',
  crates: 'crates dependency inventory',
} satisfies Record<ManifestEcosystem, string>

const formatReport = (
  report: NpmManifestInventoryReport | EcosystemManifestInventoryReport,
  ecosystem: ManifestEcosystem,
): string => {
  const lines = [
    REPORT_TITLE[ecosystem],
    `${report.summary.total} declared dependenc${report.summary.total === 1 ? 'y' : 'ies'}`,
    ...report.dependencies.map((dependency) => {
      const name = visibleTerminalText(dependency.name)
      const maps = dependency.declaredIn.join(', ')
      if (dependency.tool) {
        const toolName = visibleTerminalText(dependency.tool.name)
        const detailUrl = visibleTerminalText(dependency.tool.detailUrl)
        return `${dependency.state}: ${name} -> ${toolName} (${detailUrl}) [${maps}]`
      }
      return `${dependency.state}: ${name} [${maps}]`
    }),
    report.disclaimer,
  ]
  return `${lines.join('\n')}\n`
}

const formatBrewfileReport = (report: BrewfileInventoryReport): string => {
  const lines = [
    'Brewfile formula inventory',
    `${report.summary.total} declared formula${report.summary.total === 1 ? '' : 's'}`,
    ...report.formulas.map((formula) => {
      const name = visibleTerminalText(formula.name)
      if (formula.tool) {
        const toolName = visibleTerminalText(formula.tool.name)
        const detailUrl = visibleTerminalText(formula.tool.detailUrl)
        return `${formula.state}: ${name} -> ${toolName} (${detailUrl})`
      }
      return `${formula.state}: ${name}`
    }),
    report.disclaimer,
  ]
  return `${lines.join('\n')}\n`
}

const formatGoModReport = (report: GoModInventoryReport): string => {
  const lines = [
    'Go module inventory',
    `module ${visibleTerminalText(report.modulePath)}`,
    `${report.summary.total} required module${report.summary.total === 1 ? '' : 's'}`,
    ...report.requirements.map((requirement) => {
      const modulePath = visibleTerminalText(requirement.modulePath)
      const version = visibleTerminalText(requirement.version)
      if (requirement.tool) {
        const toolName = visibleTerminalText(requirement.tool.name)
        const detailUrl = visibleTerminalText(requirement.tool.detailUrl)
        return `${requirement.state}: ${modulePath} -> ${toolName} (${detailUrl}) [${version}]`
      }
      return `${requirement.state}: ${modulePath} [${version}]`
    }),
    ...report.skippedDirectives.map(
      (skipped) =>
        `skipped: ${skipped.count} ${skipped.directive} directive${skipped.count === 1 ? '' : 's'} (${skipped.rule})`,
    ),
    report.disclaimer,
  ]
  return `${lines.join('\n')}\n`
}

export const inventoryInputFailure = <Value>(json: boolean, error: Value): CliResult => {
  const message = safeDiagnostic(error instanceof Error ? error.message : error)
  if (
    error instanceof NpmManifestInventoryError ||
    error instanceof EcosystemManifestInventoryError ||
    error instanceof BrewfileInventoryError ||
    error instanceof GoModInventoryError
  ) {
    const payload: InventoryFailurePayload = {
      code: error.code,
      message,
      recovery: error.recovery,
    }
    if (error.configuredLimit !== undefined) payload.configuredLimit = error.configuredLimit
    if (error.observedValue !== undefined) payload.observedValue = error.observedValue
    return failForOutput(
      json,
      payload,
      `${error.code}: ${message} Recovery: ${error.recovery}\n`,
    )
  }
  if (error instanceof BoundedUtf8SourceError) {
    const payload: SourceFailurePayload = {
      code: error.code,
      message,
      recovery: error.recovery,
    }
    if (error.configuredLimitBytes !== undefined) {
      payload.configuredLimitBytes = error.configuredLimitBytes
    }
    if (error.observedBytes !== undefined) payload.observedBytes = error.observedBytes
    return failForOutput(
      json,
      payload,
      `${error.code}: ${message}\n`,
    )
  }
  return failForOutput(
    json,
    {
      code: 'source_unreadable',
      message,
      recovery: MANIFEST_RECOVERY,
    },
    `source_unreadable: ${message} Recovery: ${MANIFEST_RECOVERY}\n`,
  )
}

export const runInventoryCommand = async (
  input: InventoryCliInput,
  dependencies: InventoryCliDependencies,
): Promise<CliResult> => {
  if (input.sources.length !== 1) {
    const sourceName = input.brewfile ? 'Brewfile' : 'manifest'
    const usage = input.brewfile
      ? 'slothhub inventory <Brewfile|-> --brewfile'
      : 'slothhub inventory <package.json|pyproject.toml|Cargo.toml|go.mod|->'
    return failForOutput(
      input.json,
      {
        code: 'invalid_input',
        message: `Inventory requires exactly one explicit ${sourceName} path or - for stdin.`,
        recovery: `Run ${usage}.`,
      },
      `Inventory requires exactly one explicit ${sourceName} path or - for stdin.
`,
    )
  }

  const source = input.sources[0]!
  const goModuleByName = isGoModuleInventorySource(source, '')
  let raw: string
  let ecosystem: ManifestEcosystem | undefined
  try {
    if (input.brewfile) {
      raw = await (dependencies.readSource ?? readBrewfileSource)(source)
    } else if (goModuleByName) {
      raw = await (dependencies.readSource ?? readGoModSource)(source)
    } else {
      ecosystem = resolveInventoryEcosystem(input.ecosystem, source)
      raw = await (dependencies.readSource ?? readDependencyManifest)(source, ecosystem)
    }
  } catch (error) {
    return inventoryInputFailure(input.json, error)
  }

  let lookup: ToolLookupArtifact | null = null
  try {
    lookup = await dependencies.loadLookup()
  } catch (error) {
    if (error instanceof ToolLookupArtifactLimitError || error instanceof UnsupportedFeedVersionError) throw error
    // A missing, malformed, stale, or unavailable public projection is factual
    // capability absence, never evidence that a dependency is unknown.
  }

  try {
    if (input.brewfile) {
      const report = inventoryBrewfile(raw, lookup)
      return ok(input.json ? jsonLine(report) : formatBrewfileReport(report))
    }
    if (isGoModuleInventorySource(source, raw)) {
      const report = inventoryGoMod(raw, lookup)
      return ok(input.json ? jsonLine(report) : formatGoModReport(report))
    }
    const report = ecosystem === 'npm'
      ? inventoryNpmManifest(raw, lookup)
      : inventoryEcosystemManifest(raw, ecosystem!, lookup)
    return ok(input.json ? jsonLine(report) : formatReport(report, ecosystem!))
  } catch (error) {
    return inventoryInputFailure(input.json, error)
  }
}

import {z} from 'zod'
import {valid} from 'semver'
import {isValidNpmPackageName, isValidPypiProjectName} from './packageNames.js'
export {getToolInstallCommands} from './toolFeaturePresentation.js'

export const TOOL_INSTALL_ECOSYSTEMS = ['js', 'python', 'system'] as const
export const TOOL_INSTALL_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'deno', 'pip', 'uv', 'brew', 'winget', 'scoop', 'choco'] as const
export const TOOL_INSTALL_ECOSYSTEM_MANAGERS = {
  js: ['npm', 'pnpm', 'yarn', 'bun', 'deno'], python: ['pip', 'uv'], system: ['brew', 'winget', 'scoop', 'choco'],
} satisfies { [Ecosystem in typeof TOOL_INSTALL_ECOSYSTEMS[number]]: readonly string[] }
export const toolInstallFields = {
  ecosystem: z.enum(TOOL_INSTALL_ECOSYSTEMS),
  packageName: z.string().trim().regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9/._~+-]*(?:@[a-z0-9][a-z0-9._+-]*)?$/i, 'Use one registry package name, optionally with an exact @version. For ranges, extras, URLs, or other install syntax, use a terminal feature.'),
  managers: z.array(z.enum(TOOL_INSTALL_MANAGERS)).min(1).refine((values) => new Set(values).size === values.length, 'Select each package manager once.').describe('Ordered, distinct managers explicitly documented by the source. Enforce ecosystem compatibility and supported dev/exact options using toolFeatureDetailSchema; the generated Draft-7 schema does not encode these cross-field checks.'),
  dev: z.boolean().optional(), exact: z.boolean().optional(), extraArgs: z.string().trim().min(1).optional(),
}
export const toolInstallCommandSchema = z.object({manager: z.enum(TOOL_INSTALL_MANAGERS), command: z.string()})
const installInputSchema = z.object(toolInstallFields)
export type ToolInstallInput = z.infer<typeof installInputSchema>
export function validateToolInstall(input: ToolInstallInput, context: z.RefinementCtx<ToolInstallInput>): void {
  const versionAt = input.packageName.lastIndexOf('@')
  const npmName = versionAt > 0 ? input.packageName.slice(0, versionAt) : input.packageName
  const version = versionAt > 0 ? input.packageName.slice(versionAt + 1) : undefined
  if ((input.ecosystem === 'js' && (!isValidNpmPackageName(npmName) || (version !== undefined && !valid(version)))) ||
    (input.ecosystem === 'python' && !isValidPypiProjectName(input.packageName))) context.addIssue({code: 'custom', path: ['packageName'], message: 'Use a valid npm package name with an optional exact semantic @version, or a plain PyPI project name. Use terminal variants for other package specifications.'})
  for (const [index, manager] of input.managers.entries()) {
    if (!TOOL_INSTALL_ECOSYSTEM_MANAGERS[input.ecosystem].some((supported) => supported === manager)) context.addIssue({code: 'custom', path: ['managers', index], message: `${manager} does not support the ${input.ecosystem} ecosystem. Choose a manager from that ecosystem or use a terminal feature.`})
    if (input.dev && !['npm', 'pnpm', 'yarn', 'bun', 'deno', 'uv'].includes(manager)) context.addIssue({code: 'custom', path: ['dev'], message: `${manager} has no supported development dependency preset. Clear Development dependency or use a terminal feature.`})
    if (input.exact && !['npm', 'pnpm', 'yarn', 'bun', 'deno', 'uv'].includes(manager)) context.addIssue({code: 'custom', path: ['exact'], message: `${manager} has no supported exact dependency preset. Clear Exact version or use a terminal feature.`})
  }
}

import {isValidJsrPackageName, type AgentInterfaceInput} from './agentInterface.js'
import {resolveAgentSkillSource} from './agentSkillSource.js'
import {isValidNpmPackageName, isValidPypiProjectName, normalizePypiProjectName} from './packageNames.js'
import {isValidGithubRepositoryId, parseGithubRepositoryId} from './registryEnrichment.js'
import {resolveResourceIdentity, type ResourceIdentityInput} from './resourceIdentity.js'
import {getComponentRegistryItemUrl} from './uiComponentRegistry.js'

/**
 * Which catalog commands `slothhub implement --run` may execute, and what the Studio and admin
 * publication checks reject. Catalog commands come from tool owners and submitters, and agents
 * often run them without a person reading them, so this is an allowlist: each program has a
 * fixed set of forms (subcommand, value-less flags, package arguments), every package must be a
 * plain registry name with an optional version or tag, and every package must be one the Tool's
 * own record names. A "run a package" form runs only when the program resolves the name from its
 * registry rather than from the working directory, and a helper package (skills, jsr, shadcn)
 * runs only under the exact program and form it was vetted for. Anything else is shown to the
 * reader to run by hand, never executed. The rationale and the full table live in
 * upstream docs/runnable-commands.md.
 */

/** Package managers the CLI may run with --run, without a shell. */
export const IMPLEMENTATION_RUNNABLE_PROGRAMS = ['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'uv', 'uvx', 'pip', 'pipx'] as const
export type ImplementationRunnableProgram = (typeof IMPLEMENTATION_RUNNABLE_PROGRAMS)[number]

export type RunnablePackageEcosystem = 'npm' | 'pypi'

/** Why a command is not run automatically. Stable machine-readable codes. */
export const RUNNABLE_COMMAND_REFUSAL_CODES = [
  'not_shell',
  'shell_syntax',
  'unsupported_characters',
  'program_not_allowed',
  'form_not_allowed',
  'flag_not_allowed',
  'package_missing',
  'package_source_not_allowed',
  'argument_not_allowed',
  'package_not_bound',
  'resolution_depends_on_directory',
  'package_link_unverified',
] as const
export type RunnableCommandRefusalCode = (typeof RUNNABLE_COMMAND_REFUSAL_CODES)[number]

/** Which part of the Tool's record names a package a step may install. */
export const RUNNABLE_PACKAGE_BINDING_BASES = ['resource_identity', 'agent_interface', 'component'] as const
export type RunnablePackageBindingBasis = (typeof RUNNABLE_PACKAGE_BINDING_BASES)[number]

/**
 * Whether a registry check has recorded that the package's own registry metadata links back to
 * the Tool's repository or site. `not_required` is a package the Tool's resource identity or
 * SlothHub's own component registry names, which needs no link.
 */
export const RUNNABLE_PACKAGE_LINK_STATES = ['verified', 'missing', 'stale', 'mismatch', 'not_required'] as const
export type RunnablePackageLinkState = (typeof RUNNABLE_PACKAGE_LINK_STATES)[number]

/** A runnable step's packages whose link back to the Tool is not verified (named only by an interface row). */
export const unverifiedRunnablePackages = (run: Extract<RunnableCommand, {runnable: true}>): RunnableCommandPackage[] =>
  run.packages.filter((pkg) => pkg.link !== 'verified' && pkg.link !== 'not_required')

export interface RunnableCommandPackage {
  ecosystem: RunnablePackageEcosystem | 'jsr' | 'github' | 'slothhub_component'
  /** The package (or skill repository, JSR package, component URL) the Tool's record names. */
  name: string
  /** What names it: the resource identity, an Agent Interface row, or SlothHub's component registry. */
  basis: RunnablePackageBindingBasis
  link: RunnablePackageLinkState
}

export type RunnableCommand =
  | {runnable: true; program: ImplementationRunnableProgram; args: string[]; packages: RunnableCommandPackage[]}
  | {runnable: false; reason: string; code: RunnableCommandRefusalCode; part?: string}

/** How one package came to be named by the Tool's record, and whether its link back is verified. */
export interface RunnablePackageBinding {
  basis: RunnablePackageBindingBasis
  link: RunnablePackageLinkState
  /** For an unverified link: what is missing, in words an editor can act on. */
  linkDetail?: string
}

/** The registry identities a Tool's record carries; a runnable step may only install these. */
export interface RunnablePackageBindings {
  npm: ReadonlyMap<string, RunnablePackageBinding>
  /** PEP 503 normalized names. */
  pypi: ReadonlyMap<string, RunnablePackageBinding>
  jsr: ReadonlyMap<string, RunnablePackageBinding>
  /** Lowercase `owner/repo`. */
  githubRepositories: ReadonlyMap<string, RunnablePackageBinding>
  /** The SlothHub component registry item for this Tool, when it has a component. */
  componentItemUrl?: string
}

export const EMPTY_RUNNABLE_PACKAGE_BINDINGS: RunnablePackageBindings = {
  npm: new Map(), pypi: new Map(), jsr: new Map(), githubRepositories: new Map(),
}

/**
 * Whether a package named only by an Agent Interface row needs a verified link before a step may
 * run it. 'require' refuses it with `package_link_unverified` (the step is still shown); 'report'
 * runs it and reports the link state. Shipped as 'require': on 2026-11-24 every step that ran was
 * bound by the Tool's resource identity, so requiring links stopped none of them, while no
 * registry check records links yet (upstream docs/runnable-commands.md, "Package links"). The one switch
 * for the CLI, the MCP kit, Studio and readiness.
 */
export type RunnablePackageLinkPolicy = 'report' | 'require'
export const RUNNABLE_PACKAGE_LINK_POLICY: RunnablePackageLinkPolicy = 'require'

export interface RunnableCommandOptions {
  packageLinks?: RunnablePackageLinkPolicy
}

interface CommandForm {
  /** Words after the program, such as ['install'] or ['tool', 'install']. */
  subcommand: readonly string[]
  /** Value-less flags; anything else starting with '-' is refused. */
  flags: readonly string[]
  ecosystem: RunnablePackageEcosystem
  /** 'install' takes one or more packages; 'run' takes one package then plain-word arguments for it. */
  mode: 'install' | 'run'
  /**
   * For 'run' forms, how the program finds the package (upstream docs/runnable-commands.md, "How each
   * program finds a package"): 'registry' never looks in the working directory; 'pinned' looks
   * there for a bare name or a range, so it runs only with an exact version or a dist-tag;
   * 'directory' always looks there first, so it never runs.
   */
  resolution?: 'registry' | 'pinned' | 'directory'
}

const NPM_INSTALL_FLAGS = ['-g', '--global', '-D', '--save-dev', '-E', '--save-exact', '-O', '--save-optional'] as const

/**
 * The allowlist. Each form names the program, the subcommand and the flags it accepts.
 * Package arguments are checked separately by ecosystem. Keep upstream docs/runnable-commands.md in step.
 */
export const RUNNABLE_COMMAND_FORMS = {
  npm: [
    {subcommand: ['install'], flags: NPM_INSTALL_FLAGS, ecosystem: 'npm', mode: 'install'},
    {subcommand: ['i'], flags: NPM_INSTALL_FLAGS, ecosystem: 'npm', mode: 'install'},
    {subcommand: ['add'], flags: NPM_INSTALL_FLAGS, ecosystem: 'npm', mode: 'install'},
  ],
  npx: [{subcommand: [], flags: ['-y', '--yes'], ecosystem: 'npm', mode: 'run', resolution: 'pinned'}],
  pnpm: [
    {subcommand: ['add'], flags: ['-g', '--global', '-D', '--save-dev', '-E', '--save-exact', '-O', '--save-optional'], ecosystem: 'npm', mode: 'install'},
    {subcommand: ['dlx'], flags: [], ecosystem: 'npm', mode: 'run', resolution: 'registry'},
  ],
  yarn: [
    {subcommand: ['add'], flags: ['-D', '--dev', '-E', '--exact', '-O', '--optional'], ecosystem: 'npm', mode: 'install'},
    {subcommand: ['global', 'add'], flags: [], ecosystem: 'npm', mode: 'install'},
    {subcommand: ['dlx'], flags: [], ecosystem: 'npm', mode: 'run', resolution: 'registry'},
  ],
  bun: [
    {subcommand: ['add'], flags: ['-d', '-D', '--dev', '-g', '--global', '-E', '--exact', '--optional'], ecosystem: 'npm', mode: 'install'},
    {subcommand: ['install'], flags: ['-d', '-D', '--dev', '-g', '--global', '-E', '--exact', '--optional'], ecosystem: 'npm', mode: 'install'},
    {subcommand: ['i'], flags: ['-d', '-D', '--dev', '-g', '--global', '-E', '--exact', '--optional'], ecosystem: 'npm', mode: 'install'},
  ],
  bunx: [{subcommand: [], flags: [], ecosystem: 'npm', mode: 'run', resolution: 'pinned'}],
  uv: [
    {subcommand: ['add'], flags: ['--dev'], ecosystem: 'pypi', mode: 'install'},
    {subcommand: ['tool', 'install'], flags: [], ecosystem: 'pypi', mode: 'install'},
    {subcommand: ['pip', 'install'], flags: ['-U', '--upgrade'], ecosystem: 'pypi', mode: 'install'},
  ],
  uvx: [{subcommand: [], flags: [], ecosystem: 'pypi', mode: 'run', resolution: 'registry'}],
  pip: [{subcommand: ['install'], flags: ['-U', '--upgrade', '--user'], ecosystem: 'pypi', mode: 'install'}],
  pipx: [
    {subcommand: ['install'], flags: [], ecosystem: 'pypi', mode: 'install'},
    {subcommand: ['run'], flags: [], ecosystem: 'pypi', mode: 'run', resolution: 'directory'},
  ],
} as const satisfies Readonly<Record<ImplementationRunnableProgram, readonly CommandForm[]>>

/** Shell syntax is never run: the command would mean something different without a shell. */
const SHELL_SYNTAX = /[;&|<>`$(){}\\!*?[\]#~"'\n\r]/u
/** Printable ASCII and spaces only, so what the terminal shows is exactly what runs. */
const PRINTABLE_ASCII_COMMAND = /^[\x20-\x7e]*$/u
/** Versions, ranges and dist-tags: no colon, slash or '@', so no alias, URL, path or Git source. */
const NPM_VERSION = /^[A-Za-z0-9^.+_-]+$/u
const PYPI_VERSION = /^[A-Za-z0-9.+_-]+$/u
/** npm and pip treat these as local or remote archives, not registry names. */
const NPM_ARCHIVE = /\.(?:tgz|tar|tar\.gz)$/iu
const PYPI_ARCHIVE = /\.(?:whl|zip|egg|tgz|tar|tar\.gz|tar\.bz2|tar\.xz)$/iu
/** Arguments passed to a run package: plain words such as `mcp` or `init`, never flags, paths or URLs. */
const PLAIN_WORD = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

const RECOVERY = 'Read the command and run it yourself if you trust it.'

const refuse = (code: RunnableCommandRefusalCode, reason: string, part?: string): RunnableCommand =>
  part === undefined ? {runnable: false, code, reason: `${reason} ${RECOVERY}`} : {runnable: false, code, part, reason: `${reason} ${RECOVERY}`}

/** What follows the name: nothing, an exact version, a dist-tag such as `latest`, or a range. */
type PackageVersion = 'none' | 'exact' | 'tag' | 'range'
type PackageSpec = {ok: true; name: string; version: PackageVersion} | {ok: false}

/** An exact semver version; anything with range syntax is a range; a word is a dist-tag. */
const EXACT_SEMVER = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const DIST_TAG = /^[A-Za-z][A-Za-z0-9._-]*$/u
const npmVersionKind = (version: string | undefined): PackageVersion =>
  version === undefined ? 'none' : EXACT_SEMVER.test(version) ? 'exact' : DIST_TAG.test(version) ? 'tag' : 'range'

const parseNpmSpec = (token: string): PackageSpec => {
  const at = token.lastIndexOf('@')
  const [name, version] = at > 0 ? [token.slice(0, at), token.slice(at + 1)] : [token, undefined]
  if (!isValidNpmPackageName(name) || NPM_ARCHIVE.test(name)) return {ok: false}
  if (version !== undefined && !NPM_VERSION.test(version)) return {ok: false}
  return {ok: true, name, version: npmVersionKind(version)}
}

const parsePypiSpec = (token: string, allowAtVersion: boolean): PackageSpec => {
  const pinned = token.indexOf('==')
  const at = allowAtVersion ? token.indexOf('@') : -1
  const [name, version] = pinned > 0 ? [token.slice(0, pinned), token.slice(pinned + 2)]
    : at > 0 ? [token.slice(0, at), token.slice(at + 1)] : [token, undefined]
  if (!isValidPypiProjectName(name) || PYPI_ARCHIVE.test(name)) return {ok: false}
  if (version !== undefined && !PYPI_VERSION.test(version)) return {ok: false}
  return {ok: true, name: normalizePypiProjectName(name), version: version === undefined ? 'none' : version === 'latest' ? 'tag' : 'exact'}
}

/**
 * Helper packages SlothHub itself derives commands for. Each exception names the npm package, the
 * exact programs and forms it was vetted for, and the target that binds the step to the Tool: the
 * skill's repository, the JSR package, or this Tool's SlothHub component item. Under any other
 * program the same name is a different package (`uvx skills` is a PyPI project), so it gets no
 * exception and must be bound like any other package.
 */
type HelperTarget = {ok: true; pkg: RunnableCommandPackage} | {ok: false; code: RunnableCommandRefusalCode; reason: string; part: string}
const githubRepositoryOf = (target: string): string | undefined => {
  if (isValidGithubRepositoryId(target)) return target.toLowerCase()
  const source = resolveAgentSkillSource(target)
  if (!source) return undefined
  const [owner, repository] = new URL(source.directoryUrl).pathname.split('/').filter(Boolean)
  return owner && repository ? `${owner}/${repository}`.toLowerCase() : undefined
}
const boundPackage = (ecosystem: RunnableCommandPackage['ecosystem'], name: string, binding: RunnablePackageBinding): RunnableCommandPackage =>
  ({ecosystem, name, basis: binding.basis, link: binding.link})
type HelperCheck = (target: string, bindings: RunnablePackageBindings) => HelperTarget
interface HelperException {
  /** The npm package name of the helper; the ecosystem is always npm. */
  helper: string
  /** `program subcommand` labels the exception was vetted for, such as `npx` or `pnpm dlx`. */
  forms: readonly string[]
  check: HelperCheck
}
const HELPER_EXCEPTIONS: readonly HelperException[] = [
  {helper: 'skills', forms: ['npx', 'pnpm dlx', 'yarn dlx', 'bunx'], check: (target, bindings) => {
    const repository = githubRepositoryOf(target)
    if (!repository) return {ok: false, code: 'package_source_not_allowed', part: target, reason: `The skill source ${target} is not a GitHub repository or skill folder.`}
    const binding = bindings.githubRepositories.get(repository)
    return binding
      ? {ok: true, pkg: boundPackage('github', repository, binding)}
      : {ok: false, code: 'package_not_bound', part: target, reason: `The skill repository ${repository} is not a repository this Tool's record names.`}
  }},
  {helper: 'jsr', forms: ['npx'], check: (target, bindings) => {
    if (!isValidJsrPackageName(target)) return {ok: false, code: 'package_source_not_allowed', part: target, reason: `${target} is not a JSR package name.`}
    const binding = bindings.jsr.get(target)
    return binding
      ? {ok: true, pkg: boundPackage('jsr', target, binding)}
      : {ok: false, code: 'package_not_bound', part: target, reason: `The JSR package ${target} is not a package this Tool's record names.`}
  }},
  {helper: 'shadcn', forms: ['npx', 'pnpm dlx'], check: (target, bindings) => bindings.componentItemUrl !== undefined && target === bindings.componentItemUrl
    ? {ok: true, pkg: {ecosystem: 'slothhub_component', name: target, basis: 'component', link: 'not_required'}}
    : {ok: false, code: 'package_not_bound', part: target, reason: `${target} is not this Tool's SlothHub component registry item.`}},
]

const helperTarget = (formLabel: string, ecosystem: RunnablePackageEcosystem, pkg: string, trailing: readonly string[], bindings: RunnablePackageBindings): HelperTarget | undefined => {
  if (ecosystem !== 'npm') return undefined
  const exception = HELPER_EXCEPTIONS.find((entry) => entry.helper === pkg && entry.forms.includes(formLabel))
  const [verb, target, ...extra] = trailing
  if (!exception || verb !== 'add' || target === undefined || extra.length) return undefined
  return exception.check(target, bindings)
}

const bindingOf = (ecosystem: RunnablePackageEcosystem, name: string, bindings: RunnablePackageBindings): RunnablePackageBinding | undefined =>
  ecosystem === 'npm' ? bindings.npm.get(name) : bindings.pypi.get(name)

/** Why a program that finds packages in the working directory is not run, and what to record instead. */
const directoryResolution = (label: string, token: string, name: string): string => label === 'pipx run'
  ? `pipx run ${token} first runs a file named ${name} in the working directory, or an app in its __pypackages__ folder, before it looks at PyPI, so what runs depends on the folder it runs in. Record pipx install ${name} or uvx ${name} instead.`
  : `${label} ${token} first uses a ${name} it finds in the working directory (its node_modules, node_modules/.bin or package.json), so what runs depends on the folder it runs in. Record ${label} ${name}@<exact version> or ${label} ${name}@latest, or pnpm dlx ${token}, instead.`

/** A package named only by an Agent Interface row needs a verified link when the policy requires one. */
const linkRefusal = (pkg: RunnableCommandPackage, binding: RunnablePackageBinding, policy: RunnablePackageLinkPolicy): RunnableCommand | undefined =>
  policy === 'require' && binding.link !== 'verified' && binding.link !== 'not_required'
    ? refuse('package_link_unverified', `${pkg.name} is named only by an Agent Interface row, and ${binding.linkDetail ?? 'no registry check shows it links back to this Tool'}.`, pkg.name)
    : undefined

const matchForm = (forms: readonly CommandForm[], rest: readonly string[]): CommandForm | undefined =>
  forms.filter((form) => form.subcommand.every((word, index) => rest[index] === word))
    .sort((left, right) => right.subcommand.length - left.subcommand.length)[0]

/**
 * Decide whether a catalog command may run without a shell. On success, `program` and `args`
 * are the exact argument vector to execute and to display; nothing else is.
 */
export const parseRunnableCommand = (
  command: string,
  language: 'shell' | 'yaml',
  bindings: RunnablePackageBindings,
  options: RunnableCommandOptions = {},
): RunnableCommand => {
  const policy = options.packageLinks ?? RUNNABLE_PACKAGE_LINK_POLICY
  if (language !== 'shell') return refuse('not_shell', 'Not a shell command.')
  if (!PRINTABLE_ASCII_COMMAND.test(command)) return refuse('unsupported_characters', 'Contains control, invisible or non-ASCII characters, so the displayed text could differ from what runs.')
  const syntax = SHELL_SYNTAX.exec(command)
  if (syntax) return refuse('shell_syntax', `Uses shell syntax (${JSON.stringify(syntax[0])}), which only means the same thing inside a shell, and --run never uses one.`, syntax[0])
  const [program, ...rest] = command.trim().split(/ +/u)
  const allowed = IMPLEMENTATION_RUNNABLE_PROGRAMS.find((name) => name === program)
  if (!allowed || program === undefined) {
    return refuse('program_not_allowed', `Only ${IMPLEMENTATION_RUNNABLE_PROGRAMS.join(', ')} commands run automatically; ${program || 'this command'} is not one of them.`, program || undefined)
  }
  const form = matchForm(RUNNABLE_COMMAND_FORMS[allowed], rest)
  if (!form) {
    const subcommand = rest[0]
    return subcommand === undefined
      ? refuse('package_missing', `${allowed} needs a package to install or run.`)
      : refuse('form_not_allowed', `${allowed} ${subcommand} is not an allowed form; only installing or running a registry package is.`, `${allowed} ${subcommand}`)
  }
  const tokens = rest.slice(form.subcommand.length)
  const label = [allowed, ...form.subcommand].join(' ')
  const packages: RunnableCommandPackage[] = []
  const parseSpec = (token: string): PackageSpec => form.ecosystem === 'npm' ? parseNpmSpec(token) : parsePypiSpec(token, allowed === 'uvx')
  const badSource = (token: string): RunnableCommand => refuse('package_source_not_allowed',
    `${token} is not a plain ${form.ecosystem === 'npm' ? 'npm' : 'PyPI'} package name with an optional version or tag; URLs, Git, file, path, archive and alias sources are not run.`, token)

  let index = 0
  for (; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if (token.startsWith('-')) {
      if (!form.flags.includes(token)) return refuse('flag_not_allowed', `${label} does not allow ${token}${form.flags.length ? `; allowed flags: ${form.flags.join(', ')}` : ''}.`, token)
      continue
    }
    const spec = parseSpec(token)
    if (!spec.ok) return badSource(token)
    if (form.mode === 'run') {
      // Where the program looks for the name decides what runs, before any binding matters.
      if (form.resolution === 'directory' || (form.resolution === 'pinned' && (spec.version === 'none' || spec.version === 'range'))) {
        return refuse('resolution_depends_on_directory', directoryResolution(label, token, spec.name), token)
      }
      const trailing = tokens.slice(index + 1)
      const helper = helperTarget(label, form.ecosystem, spec.name, trailing, bindings)
      if (helper) {
        if (!helper.ok) return refuse(helper.code, helper.reason, helper.part)
        const binding = helper.pkg.ecosystem === 'github' ? bindings.githubRepositories.get(helper.pkg.name)
          : helper.pkg.ecosystem === 'jsr' ? bindings.jsr.get(helper.pkg.name) : undefined
        const unverified = binding && linkRefusal(helper.pkg, binding, policy)
        if (unverified) return unverified
        return {runnable: true, program: allowed, args: rest, packages: [helper.pkg]}
      }
      const argument = trailing.find((word) => !PLAIN_WORD.test(word))
      if (argument !== undefined) return refuse('argument_not_allowed', `Arguments after the package must be plain words such as a subcommand; ${argument} is not.`, argument)
      const binding = bindingOf(form.ecosystem, spec.name, bindings)
      if (!binding) return refuse('package_not_bound', `${spec.name} is not a package this Tool's record names.`, spec.name)
      const pkg = boundPackage(form.ecosystem, spec.name, binding)
      const unverified = linkRefusal(pkg, binding, policy)
      if (unverified) return unverified
      return {runnable: true, program: allowed, args: rest, packages: [pkg]}
    }
    const binding = bindingOf(form.ecosystem, spec.name, bindings)
    if (!binding) return refuse('package_not_bound', `${spec.name} is not a package this Tool's record names.`, spec.name)
    const pkg = boundPackage(form.ecosystem, spec.name, binding)
    const unverified = linkRefusal(pkg, binding, policy)
    if (unverified) return unverified
    packages.push(pkg)
  }
  if (packages.length === 0) return refuse('package_missing', `${label} needs a package name.`)
  return {runnable: true, program: allowed, args: rest, packages}
}

/**
 * What a registry check recorded about a package an Agent Interface row names: the package, the
 * URLs its own registry metadata points to (npm `repository` and `homepage`, PyPI project URLs,
 * a GitHub repository's homepage), and when that was checked. The registry sweep is the intended
 * producer; owners and submitters never supply it.
 */
export interface PackageLinkEvidence {
  registry: 'npm' | 'pypi' | 'jsr' | 'github'
  identifier: string
  linkedUrls: readonly string[]
  checkedAt: string
}

/**
 * How old a recorded link may be. The registry sweep rechecks daily
 * (REGISTRY_OBSERVATION_RECHECK_INTERVAL_MS); seven days tolerates a week of missed sweeps before
 * a step stops running. Unmeasured: no link is recorded yet (upstream docs/runnable-commands.md).
 */
export const PACKAGE_LINK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface RunnableBindingInput {
  slug?: string | null
  website?: string | null
  resourceIdentity?: ResourceIdentityInput | null
  agentInterfaces?: ReadonlyArray<(Pick<AgentInterfaceInput, 'kind' | 'status' | 'source' | 'identifier' | 'docsUrl'> & {packageLink?: PackageLinkEvidence | null}) | null> | null
  /** Present when the Tool publishes a SlothHub UI component. */
  hasUiComponent?: boolean
}

export interface RunnableBindingOptions {
  siteUrl?: string
  /** The clock a link's age is measured against; tests pass one. */
  now?: Date
}

const hostOf = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname.toLowerCase().replace(/^www\./u, '') : undefined
}
const githubRepositoryOfUrl = (url: string): string | undefined => {
  const plain = url.replace(/^git\+/u, '').replace(/\.git$/u, '')
  if (!URL.canParse(plain)) return undefined
  const parsed = new URL(plain)
  if (parsed.hostname.toLowerCase() !== 'github.com') return undefined
  const [owner, repository] = parsed.pathname.split('/').filter(Boolean)
  return owner && repository && isValidGithubRepositoryId(`${owner}/${repository}`) ? `${owner}/${repository}`.toLowerCase() : undefined
}

/** The Tool's own repository and site, which a package's registry metadata must point to. */
interface ToolLinks {repositories: ReadonlySet<string>; hosts: ReadonlySet<string>}
const toolLinksOf = (input: RunnableBindingInput): ToolLinks => {
  const repositories = new Set<string>()
  const hosts = new Set<string>()
  const identity = resolveResourceIdentity({resourceIdentity: input.resourceIdentity, website: input.website})
  if (identity?.kind === 'github_repository') {
    const repository = parseGithubRepositoryId(identity)
    if (repository) repositories.add(repository.toLowerCase())
  }
  for (const url of [input.website, input.resourceIdentity?.canonicalUrl]) {
    if (!url) continue
    const repository = githubRepositoryOfUrl(url)
    if (repository) repositories.add(repository)
    else {
      const host = hostOf(url)
      if (host) hosts.add(host)
    }
  }
  return {repositories, hosts}
}

/**
 * Whether a recorded link shows the package belongs to this Tool. Fails closed: no record, a
 * record for another package, an unparseable or future date, an old record, or a link to anything
 * but the Tool's own repository or site is not verified, and the detail says which.
 */
export const evaluatePackageLink = (
  registry: PackageLinkEvidence['registry'], identifier: string, evidence: PackageLinkEvidence | null | undefined, tool: ToolLinks, now: Date,
): Pick<RunnablePackageBinding, 'link' | 'linkDetail'> => {
  const what = `${registry} package ${identifier}`
  if (!evidence || evidence.registry !== registry || evidence.identifier !== identifier) {
    return {link: 'missing', linkDetail: `no registry check has recorded where the ${what} links to`}
  }
  const checked = Date.parse(evidence.checkedAt)
  if (!Number.isFinite(checked) || checked > now.getTime() || now.getTime() - checked > PACKAGE_LINK_MAX_AGE_MS) {
    return {link: 'stale', linkDetail: `the registry check of the ${what} (${evidence.checkedAt}) is older than ${PACKAGE_LINK_MAX_AGE_MS / 86_400_000} days or not a valid date`}
  }
  const matches = evidence.linkedUrls.some((url) => {
    const repository = githubRepositoryOfUrl(url)
    const host = hostOf(url)
    return repository ? tool.repositories.has(repository) : host !== undefined && tool.hosts.has(host)
  })
  if (!matches) {
    const own = [...tool.repositories].map((entry) => `github.com/${entry}`).concat([...tool.hosts])
    const linked = evidence.linkedUrls.length ? evidence.linkedUrls.join(', ') : 'nothing'
    return {link: 'mismatch', linkDetail: `the ${what} links to ${linked}, which is not this Tool's repository or site (${own.length ? own.join(', ') : 'none recorded'})`}
  }
  return {link: 'verified'}
}

/**
 * The identities a Tool's record names: its resource identity and the identifiers of its
 * current Agent Interfaces (plus an agent skill's GitHub source). Deprecated interfaces bind
 * nothing. A package the resource identity names needs no link; one only an interface row names
 * carries the state of its recorded link back to the Tool.
 */
export const collectRunnablePackageBindings = (input: RunnableBindingInput, options: RunnableBindingOptions = {}): RunnablePackageBindings => {
  const npm = new Map<string, RunnablePackageBinding>()
  const pypi = new Map<string, RunnablePackageBinding>()
  const jsr = new Map<string, RunnablePackageBinding>()
  const githubRepositories = new Map<string, RunnablePackageBinding>()
  const identityBinding: RunnablePackageBinding = {basis: 'resource_identity', link: 'not_required'}
  const identity = resolveResourceIdentity({resourceIdentity: input.resourceIdentity, website: input.website})
  if (identity?.kind === 'npm_package' && isValidNpmPackageName(identity.registryId)) npm.set(identity.registryId, identityBinding)
  if (identity?.kind === 'pypi_project' && isValidPypiProjectName(identity.registryId)) pypi.set(normalizePypiProjectName(identity.registryId), identityBinding)
  if (identity?.kind === 'jsr_package' && isValidJsrPackageName(identity.registryId)) jsr.set(identity.registryId, identityBinding)
  if (identity?.kind === 'github_repository') {
    const repository = parseGithubRepositoryId(identity)
    if (repository) githubRepositories.set(repository.toLowerCase(), identityBinding)
  }
  const tool = toolLinksOf(input)
  const now = options.now ?? new Date()
  // The resource identity wins over an interface row naming the same package.
  const bindRow = (map: Map<string, RunnablePackageBinding>, registry: PackageLinkEvidence['registry'], name: string, evidence: PackageLinkEvidence | null | undefined) => {
    const current = map.get(name)
    const binding: RunnablePackageBinding = {basis: 'agent_interface', ...evaluatePackageLink(registry, name, evidence, tool, now)}
    if (!current || (current.basis === 'agent_interface' && current.link !== 'verified' && binding.link === 'verified')) map.set(name, binding)
  }
  for (const entry of input.agentInterfaces ?? []) {
    if (!entry || entry.status === 'deprecated') continue
    const identifier = entry.identifier?.trim()
    const evidence = entry.packageLink
    if (identifier && entry.source === 'npm' && isValidNpmPackageName(identifier)) bindRow(npm, 'npm', identifier, evidence)
    if (identifier && entry.source === 'pypi' && isValidPypiProjectName(identifier)) {
      const name = normalizePypiProjectName(identifier)
      bindRow(pypi, 'pypi', name, evidence && evidence.registry === 'pypi' ? {...evidence, identifier: normalizePypiProjectName(evidence.identifier)} : evidence)
    }
    if (identifier && entry.source === 'jsr' && isValidJsrPackageName(identifier)) bindRow(jsr, 'jsr', identifier, evidence)
    if (identifier && entry.source === 'github') {
      const repository = identifier.split('/').slice(0, 2).join('/')
      if (isValidGithubRepositoryId(repository)) {
        bindRow(githubRepositories, 'github', repository.toLowerCase(), evidence && evidence.registry === 'github' ? {...evidence, identifier: evidence.identifier.toLowerCase()} : evidence)
      }
    }
    if (entry.kind === 'agent_skill' && entry.docsUrl) {
      const repository = githubRepositoryOf(entry.docsUrl) ?? githubRepositoryOf(entry.docsUrl.replace(/^https:\/\/github\.com\//u, '').replace(/\/$/u, ''))
      if (repository) bindRow(githubRepositories, 'github', repository, evidence && evidence.registry === 'github' ? {...evidence, identifier: evidence.identifier.toLowerCase()} : evidence)
    }
  }
  const bindings: RunnablePackageBindings = {npm, pypi, jsr, githubRepositories}
  if (input.hasUiComponent && input.slug && options.siteUrl) bindings.componentItemUrl = getComponentRegistryItemUrl(options.siteUrl, input.slug)
  return bindings
}

/** The exact argument vector, as one line, for prompts and listings. Tokens never contain spaces. */
export const formatRunnableArgv = (run: Extract<RunnableCommand, {runnable: true}>): string => [run.program, ...run.args].join(' ')

/** A command an editor would publish that `slothhub implement --run` would refuse to run. */
export interface RefusedRunnableCommand {
  /** Index of the Agent Interface row that authors the command. */
  index: number
  key?: string
  command: string
  code: RunnableCommandRefusalCode
  part?: string
  /** What is wrong and how to fix it, for Studio and the admin draft checks. */
  message: string
}

export interface RunnableCommandValidationInput extends Omit<RunnableBindingInput, 'agentInterfaces' | 'hasUiComponent'> {
  agentInterfaces?: ReadonlyArray<(Pick<AgentInterfaceInput, 'kind' | 'status' | 'source' | 'identifier' | 'docsUrl' | 'installCommand'> & {_key?: string | null; packageLink?: PackageLinkEvidence | null}) | null> | null
}

/** Refusals that mean "show it, never run it" rather than a command that pretends to be runnable. */
const DISPLAY_ONLY_REFUSALS: ReadonlySet<RunnableCommandRefusalCode> = new Set(['not_shell', 'shell_syntax', 'program_not_allowed', 'resolution_depends_on_directory', 'package_link_unverified'])

const fixFor = (refusal: Extract<RunnableCommand, {runnable: false}>, program: string): string => {
  if (refusal.code === 'package_link_unverified') {
    return 'It stays visible for people to run. To let slothhub implement --run run it, the package\'s own registry metadata (npm repository or homepage, PyPI project URLs) must point to this Tool\'s repository or site and a registry check must have recorded that within the last week; or, if it is the Tool\'s main package, set it as the resource identity.'
  }
  if (refusal.code === 'resolution_depends_on_directory') {
    return 'It stays visible for people to run; to let slothhub implement --run run it, record the form the reason names.'
  }
  if (refusal.code !== 'package_not_bound') {
    return 'SlothHub never runs this form. Record a plain install or run of the Tool\'s own registry package (see docs/runnable-commands.md), or link the setup docs instead.'
  }
  if (program === 'npx' && refusal.part && /[/:]/u.test(refusal.part)) {
    return 'Set the skill interface\'s docs URL to the skill\'s GitHub folder, or give this Tool that repository as its resource identity.'
  }
  const registry = ['pip', 'pipx', 'uv', 'uvx'].includes(program) ? 'pypi' : 'npm'
  return `If ${refusal.part ?? 'the package'} is this Tool's package, set this interface's Source to ${registry} and its Identifier to ${refusal.part ?? 'the package name'}; otherwise link the setup docs instead.`
}

/** A note for an editor about an authored command: what --run will do with it and how to change that. */
export interface RunnableCommandNotice extends RefusedRunnableCommand {
  /** 'blocker' would let --run treat the command differently than it reads; 'warning' is display-only or a link to verify. */
  severity: 'blocker' | 'warning'
}

/**
 * Every authored install command that starts with a runnable package manager, checked by the same
 * rule the CLI applies against the same Tool record. Blockers are commands --run refuses although
 * they look runnable; warnings are commands it only shows (their resolution depends on the working
 * directory) and, while the link policy is 'report', steps that run although the package's link
 * back to the Tool is not verified.
 */
export const findRunnableCommandNotices = (input: RunnableCommandValidationInput, options: RunnableBindingOptions & RunnableCommandOptions = {}): RunnableCommandNotice[] => {
  const bindings = collectRunnablePackageBindings(input, options)
  const policy = options.packageLinks ?? RUNNABLE_PACKAGE_LINK_POLICY
  return (input.agentInterfaces ?? []).flatMap((entry, index): RunnableCommandNotice[] => {
    const command = entry?.installCommand?.trim()
    if (!entry || !command || entry.status === 'deprecated') return []
    const [program = ''] = command.split(/\s+/u)
    if (!IMPLEMENTATION_RUNNABLE_PROGRAMS.some((name) => name === program)) return []
    const result = parseRunnableCommand(command, command.startsWith('uses: ') ? 'yaml' : 'shell', bindings, {packageLinks: policy})
    const base: Pick<RunnableCommandNotice, 'index' | 'command' | 'key'> = {index, command}
    if (entry._key) base.key = entry._key
    if (result.runnable) {
      const unverified = result.packages.filter((pkg) => pkg.link !== 'verified' && pkg.link !== 'not_required')
      return unverified.map((pkg) => {
        const binding = (pkg.ecosystem === 'npm' ? bindings.npm : pkg.ecosystem === 'pypi' ? bindings.pypi : pkg.ecosystem === 'jsr' ? bindings.jsr : bindings.githubRepositories).get(pkg.name)
        return {...base, severity: 'warning', code: 'package_link_unverified', part: pkg.name,
          message: `${command}: runs today, but ${pkg.name} is named only by this interface row and ${binding?.linkDetail ?? 'its link back to this Tool is not verified'}. When SlothHub requires verified package links it will only be shown. If it is the Tool's main package, set it as the resource identity.`}
      })
    }
    if (result.code === 'not_shell' || result.code === 'shell_syntax' || result.code === 'program_not_allowed') return []
    const notice: RunnableCommandNotice = {
      ...base, code: result.code, severity: DISPLAY_ONLY_REFUSALS.has(result.code) ? 'warning' : 'blocker',
      message: `${command}: ${result.reason.replace(` ${RECOVERY}`, '')} ${fixFor(result, program)}`,
    }
    if (result.part !== undefined) notice.part = result.part
    return [notice]
  })
}

/**
 * The publication side of the allowlist: every authored install command that --run would refuse
 * although it looks runnable, so nothing is published that `--run` would silently treat differently.
 */
export const findRefusedRunnableCommands = (input: RunnableCommandValidationInput, options: RunnableBindingOptions & RunnableCommandOptions = {}): RefusedRunnableCommand[] =>
  findRunnableCommandNotices(input, options).flatMap((notice) => {
    if (notice.severity !== 'blocker') return []
    const refused: RefusedRunnableCommand = {index: notice.index, command: notice.command, code: notice.code, message: notice.message}
    if (notice.key !== undefined) refused.key = notice.key
    if (notice.part !== undefined) refused.part = notice.part
    return [refused]
  })

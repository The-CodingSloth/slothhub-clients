import {isValidNpmPackageName} from './packageNames.js'
import {isValidToolPublicSlug} from './toolLookup.js'
import type {ToolFeatureDetail} from './toolFeatureDetails.js'
import type {PublicToolQuickstart} from './toolQuickstart.js'
import {getComponentInstallQuickstart, UI_COMPONENT_NOTE_SECTIONS, type ComponentInstallQuickstart, type UiComponent} from './uiComponent.js'
import {isComponentLicenseFilename, isComponentSourceFilename, isComponentUsageFilename, isSafeComponentFilePath} from './uiComponentFiles.js'
import {getComponentCodeFiles, type ComponentCodeFile} from './uiComponentPrompt.js'

/**
 * SlothHub serves its UI components as a shadcn registry so `npx shadcn add`, the shadcn MCP
 * server and any client of the registry format can install them. The registry directory requires
 * a flat layout: `{base}/registry.json` plus `{base}/{name}.json`.
 * https://ui.shadcn.com/docs/registry/registry-index
 */
export const COMPONENT_REGISTRY_BASE_PATH = '/r'
export const COMPONENT_REGISTRY_INDEX_NAME = 'registry'
export const COMPONENT_REGISTRY_NAMESPACE = '@slothhub'
export const SHADCN_REGISTRY_ITEM_SCHEMA_URL = 'https://ui.shadcn.com/schema/registry-item.json'
export const SHADCN_REGISTRY_SCHEMA_URL = 'https://ui.shadcn.com/schema/registry.json'

export interface ComponentBundleInput {
  slug: string
  name: string
  description?: string | null
  detailUrl: string
  uiComponent: UiComponent
  keyFeatures?: readonly string[] | null
  keyFeatureDetails?: readonly ToolFeatureDetail[] | null
  quickstarts?: readonly PublicToolQuickstart[] | null
}

/** Files an agent writes into a project (source), reads to learn the API (usage), or keeps beside the source (notices). */
export interface ComponentFiles {
  source: ComponentCodeFile[]
  usage: ComponentCodeFile[]
  notices: ComponentCodeFile[]
}

export const COMPONENT_REGISTRY_INELIGIBILITY_VALUES = [
  'no_source_files', 'not_react', 'duplicate_file_path', 'reserved_slug', 'invalid_slug',
] as const
export type ComponentRegistryIneligibility = (typeof COMPONENT_REGISTRY_INELIGIBILITY_VALUES)[number]

export type ComponentInstallPlan =
  /** The creator publishes an install command; SlothHub points to it instead of mirroring the files. */
  | {kind: 'upstream'; command: string; quickstart: ComponentInstallQuickstart}
  | {kind: 'slothhub_registry'; command: string; itemUrl: string; namespacedName: string}
  | {kind: 'manual'; reason: ComponentRegistryIneligibility}

export interface ComponentBundle {
  slug: string
  name: string
  description: string
  detailUrl: string
  component: UiComponent
  files: ComponentFiles
  /** npm package names the component imports; shadcn installs these. */
  dependencies: string[]
  /** Authored requirements that are not npm package names (for example `Tailwind CSS v4`); they are never installed. */
  otherRequirements: string[]
  install: ComponentInstallPlan
}

const REACT_FRAMEWORK = /\b(?:react|next(?:\.js)?)\b/iu
const NON_DOM_REACT = /\breact[ -]native\b/iu
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/iu

const isReactComponent = (frameworks: readonly string[]): boolean =>
  frameworks.some((framework) => REACT_FRAMEWORK.test(framework) && !NON_DOM_REACT.test(framework))

const trimSiteUrl = (siteUrl: string): string => siteUrl.replace(/\/+$/u, '')

export const getComponentRegistryItemUrl = (siteUrl: string, slug: string): string =>
  `${trimSiteUrl(siteUrl)}${COMPONENT_REGISTRY_BASE_PATH}/${slug}.json`

export const getComponentRegistryIndexUrl = (siteUrl: string): string =>
  getComponentRegistryItemUrl(siteUrl, COMPONENT_REGISTRY_INDEX_NAME)

/** The `components.json` entry that lets the shadcn CLI and MCP server resolve `@slothhub/<slug>`. */
export interface ComponentRegistryConfig {
  [COMPONENT_REGISTRY_NAMESPACE]: string
}
export const getComponentRegistryConfig = (siteUrl: string): ComponentRegistryConfig => ({
  [COMPONENT_REGISTRY_NAMESPACE]: `${trimSiteUrl(siteUrl)}${COMPONENT_REGISTRY_BASE_PATH}/{name}.json`,
})

export const getShadcnAddCommand = (target: string): string => `npx shadcn@latest add ${target}`

/** Split authored code features into files with project-relative paths; unsafe paths and project metadata never leave. */
export function getComponentFiles(features: readonly string[], details: readonly ToolFeatureDetail[]): ComponentFiles {
  const files = getComponentCodeFiles(features, details).filter(({filename}) => isSafeComponentFilePath(filename))
  return {
    source: files.filter(({filename}) => isComponentSourceFilename(filename)),
    usage: files.filter(({filename}) => isComponentUsageFilename(filename)),
    notices: files.filter(({filename}) => isComponentLicenseFilename(filename)),
  }
}

const getRegistryIneligibility = (input: ComponentBundleInput, files: ComponentFiles): ComponentRegistryIneligibility | undefined => {
  if (!isValidToolPublicSlug(input.slug)) return 'invalid_slug'
  if (input.slug === COMPONENT_REGISTRY_INDEX_NAME) return 'reserved_slug'
  if (files.source.length === 0) return 'no_source_files'
  if (!isReactComponent(input.uiComponent.frameworks)) return 'not_react'
  const paths = [...files.source, ...files.notices].map(({filename}) => filename.toLowerCase())
  if (new Set(paths).size !== paths.length) return 'duplicate_file_path'
  return undefined
}

/** Everything an agent needs to add one component to a project, from the public Tool detail. */
export function buildComponentBundle(input: ComponentBundleInput, siteUrl: string): ComponentBundle {
  const files = getComponentFiles(input.keyFeatures ?? [], input.keyFeatureDetails ?? [])
  const authored = input.uiComponent.dependencies ?? []
  const upstream = getComponentInstallQuickstart(input.quickstarts ?? [])
  const ineligibility = getRegistryIneligibility(input, files)
  const install: ComponentInstallPlan = upstream
    ? {kind: 'upstream', command: upstream.command, quickstart: upstream}
    : ineligibility
      ? {kind: 'manual', reason: ineligibility}
      : {
        kind: 'slothhub_registry',
        itemUrl: getComponentRegistryItemUrl(siteUrl, input.slug),
        command: getShadcnAddCommand(getComponentRegistryItemUrl(siteUrl, input.slug)),
        namespacedName: `${COMPONENT_REGISTRY_NAMESPACE}/${input.slug}`,
      }
  return {
    slug: input.slug,
    name: input.name,
    description: input.description?.trim() || input.name,
    detailUrl: input.detailUrl,
    component: input.uiComponent,
    files,
    dependencies: authored.filter((value) => isValidNpmPackageName(value)),
    otherRequirements: authored.filter((value) => !isValidNpmPackageName(value)),
    install,
  }
}

export type ShadcnRegistryFileType = 'registry:component' | 'registry:file'

export interface ShadcnRegistryFile {
  path: string
  type: ShadcnRegistryFileType
  target: string
  content: string
}

export interface ShadcnRegistryItem {
  $schema: typeof SHADCN_REGISTRY_ITEM_SCHEMA_URL
  name: string
  type: 'registry:component'
  title: string
  description: string
  author: string
  dependencies?: string[]
  files: ShadcnRegistryFile[]
  docs: string
  meta: {
    detailUrl: string
    sourceUrl: string
    license: string
    licenseUrl: string
    original: boolean
    frameworks: string[]
    otherRequirements?: string[]
  }
}

export type ShadcnRegistryIndexItem = Omit<ShadcnRegistryItem, '$schema' | 'files'> & {
  files: Omit<ShadcnRegistryFile, 'content'>[]
}

export interface ShadcnRegistryIndex {
  $schema: typeof SHADCN_REGISTRY_SCHEMA_URL
  name: string
  homepage: string
  items: ShadcnRegistryIndexItem[]
}

const buildRegistryDocs = (bundle: ComponentBundle): string => [
  `${bundle.name} from SlothHub: ${bundle.detailUrl}`,
  `License: ${bundle.component.license} (${bundle.component.licenseUrl}). Keep the copyright and license notices with these files.`,
  ...(bundle.otherRequirements.length ? [`Also requires: ${bundle.otherRequirements.join(', ')}.`] : []),
  ...(bundle.files.usage.length ? [`Usage examples and props: ${bundle.detailUrl}`] : []),
].join('\n')

/**
 * Every file lands in its own `components/<slug>/` folder so relative imports between a
 * component's files keep working and its license notice stays beside the code.
 * Returns undefined unless the bundle installs from SlothHub's registry.
 */
export function buildShadcnRegistryItem(bundle: ComponentBundle): ShadcnRegistryItem | undefined {
  if (bundle.install.kind !== 'slothhub_registry') return undefined
  const {component} = bundle
  const meta: ShadcnRegistryItem['meta'] = {
    detailUrl: bundle.detailUrl,
    sourceUrl: component.sourceUrl,
    license: component.license,
    licenseUrl: component.licenseUrl,
    original: component.original,
    frameworks: component.frameworks,
  }
  if (bundle.otherRequirements.length) meta.otherRequirements = bundle.otherRequirements
  const item: ShadcnRegistryItem = {
    $schema: SHADCN_REGISTRY_ITEM_SCHEMA_URL,
    name: bundle.slug,
    type: 'registry:component',
    title: bundle.name,
    description: bundle.description,
    author: component.authorUrl ? `${component.authorName} <${component.authorUrl}>` : component.authorName,
    files: [...bundle.files.source, ...bundle.files.notices].map(({filename, code}) => ({
      path: `${bundle.slug}/${filename}`,
      type: SCRIPT_FILE.test(filename) && isComponentSourceFilename(filename) ? 'registry:component' : 'registry:file',
      target: `@components/${bundle.slug}/${filename}`,
      content: code,
    })),
    docs: buildRegistryDocs(bundle),
    meta,
  }
  if (bundle.dependencies.length) item.dependencies = bundle.dependencies
  return item
}

/** The registry catalog lists items without file contents, as the shadcn registry directory requires. */
export function buildShadcnRegistryIndex(items: readonly ShadcnRegistryItem[], siteUrl: string): ShadcnRegistryIndex {
  return {
    $schema: SHADCN_REGISTRY_SCHEMA_URL,
    name: 'slothhub',
    homepage: trimSiteUrl(siteUrl),
    items: items.map(({$schema: _schema, files, ...item}) => ({...item, files: files.map(({content: _content, ...file}) => file)})),
  }
}

export const COMPONENT_FILE_ROLE_VALUES = ['source', 'usage', 'notice'] as const
export type ComponentFileRole = (typeof COMPONENT_FILE_ROLE_VALUES)[number]

export const COMPONENT_MANUAL_INSTALL_MESSAGES = {
  no_source_files: 'SlothHub has no source files for this component; follow the source link.',
  not_react: 'The shadcn registry installs React components; create the files in the project yourself.',
  duplicate_file_path: 'Two authored files share a path, so there is no one-command install; create the files yourself.',
  reserved_slug: 'This slug is reserved by the registry catalog; create the files yourself.',
  invalid_slug: 'This slug cannot be used as a registry name; create the files yourself.',
} as const satisfies Record<ComponentRegistryIneligibility, string>

export interface ComponentHandoffFile {
  path: string
  language: string
  role: ComponentFileRole
  content: string
}

export type ComponentHandoffInstall =
  | {kind: 'upstream'; command: string; source?: string; docsUrl?: string}
  | {kind: 'slothhub_registry'; command: string; itemUrl: string; namespacedName: string; componentsJsonRegistries: ComponentRegistryConfig}
  | {kind: 'manual'; reason: ComponentRegistryIneligibility; message: string}

export type ComponentNotes = Partial<Record<(typeof UI_COMPONENT_NOTE_SECTIONS)[number]['key'], string[]>>

/** The one shape MCP and the CLI hand to an agent adding a component to a project. */
export interface ComponentHandoff {
  slug: string
  name: string
  description: string
  detailUrl: string
  license: {name: string; url: string; original: boolean; author: string; authorUrl?: string; sourceUrl: string}
  frameworks: string[]
  dependencies: string[]
  otherRequirements: string[]
  install: ComponentHandoffInstall
  files: ComponentHandoffFile[]
  integrationPrompt?: string
  apiReference?: NonNullable<UiComponent['apiReference']>
  keyboard?: NonNullable<UiComponent['keyboard']>
  notes: ComponentNotes
  previewUrl?: string
  previewImageUrl: string
}

const toHandoffInstall = (bundle: ComponentBundle, siteUrl: string): ComponentHandoffInstall => {
  const {install} = bundle
  if (install.kind === 'upstream') {
    const {sourceLabel, docsUrl} = install.quickstart
    const upstream: Extract<ComponentHandoffInstall, {kind: 'upstream'}> = {kind: 'upstream', command: install.command}
    if (sourceLabel) upstream.source = sourceLabel
    if (docsUrl) upstream.docsUrl = docsUrl
    return upstream
  }
  if (install.kind === 'manual') return {...install, message: COMPONENT_MANUAL_INSTALL_MESSAGES[install.reason]}
  return {...install, componentsJsonRegistries: getComponentRegistryConfig(siteUrl)}
}

export function buildComponentHandoff(bundle: ComponentBundle, siteUrl: string): ComponentHandoff {
  const {component} = bundle
  const notes: ComponentNotes = {}
  for (const {key} of UI_COMPONENT_NOTE_SECTIONS) {
    const value = component[key]
    if (value?.length) notes[key] = value
  }
  const roles: [ComponentFileRole, ComponentCodeFile[]][] = [['source', bundle.files.source], ['usage', bundle.files.usage], ['notice', bundle.files.notices]]
  const license: ComponentHandoff['license'] = {
    name: component.license, url: component.licenseUrl, original: component.original, author: component.authorName, sourceUrl: component.sourceUrl,
  }
  if (component.authorUrl) license.authorUrl = component.authorUrl
  const handoff: ComponentHandoff = {
    slug: bundle.slug, name: bundle.name, description: bundle.description, detailUrl: bundle.detailUrl, license,
    frameworks: component.frameworks, dependencies: bundle.dependencies, otherRequirements: bundle.otherRequirements,
    install: toHandoffInstall(bundle, siteUrl),
    files: roles.flatMap(([role, files]) => files.map(({filename, language, code}) => ({path: filename, language, role, content: code}))),
    notes,
    previewImageUrl: component.previewImageUrl,
  }
  if (component.prompt) handoff.integrationPrompt = component.prompt
  if (component.apiReference) handoff.apiReference = component.apiReference
  if (component.keyboard) handoff.keyboard = component.keyboard
  if (component.previewUrl) handoff.previewUrl = component.previewUrl
  return handoff
}

/** Shown where a creator-authored install command would appear, labelled with SlothHub as its source. */
export function buildRegistryInstallQuickstart(bundle: ComponentBundle): ComponentInstallQuickstart | undefined {
  if (bundle.install.kind !== 'slothhub_registry') return undefined
  return {
    kind: 'install_command',
    label: 'Install with the shadcn CLI',
    status: bundle.component.original ? 'official' : 'community',
    statusLabel: 'SlothHub registry',
    command: bundle.install.command,
    commandLanguage: 'shell',
  }
}

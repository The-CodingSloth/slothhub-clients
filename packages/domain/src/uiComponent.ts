import {z} from 'zod'
import {toolFeatureSourceUrlSchema} from './toolFeatureDetails.js'
import {isSafePublicText} from './publicText.js'
import {buildSafeMarkdownLink, escapeMarkdownText, toMarkdownCodeBlock, toMarkdownInlineCode} from './markdownSafety.js'
import type {PublicToolQuickstart} from './toolQuickstart.js'

// Keep filename rules independent of schemas so browser copy controls can import them alone.
export {isSafeComponentFilePath, isComponentUsageFilename, isComponentLicenseFilename, isComponentSourceFilename} from './uiComponentFiles.js'

const label = z.string().min(1).refine(isSafePublicText, 'Use trimmed text without control characters.')

/** Dedicated sandbox hosts only; never render catalog code on the SlothHub origin. */
export const UI_COMPONENT_FRAME_SOURCES = ['https://*.csb.app', 'https://*.stackblitz.io', 'https://cdn.21st.dev'] as const
export const uiComponentPreviewUrlSchema = toolFeatureSourceUrlSchema.regex(
  /^https:\/\/(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:csb\.app|stackblitz\.io)|cdn\.21st\.dev)(?:\/|$)/u,
  'Use a dedicated preview subdomain on csb.app or stackblitz.io, or a cdn.21st.dev preview bundle; otherwise provide an image and source link.',
)

const notes = z.array(label).min(1).optional()
export const uiComponentPropSchema = z.object({
  name: label,
  type: label,
  description: label,
  defaultValue: label.optional(),
  required: z.boolean().optional(),
})
/** Documentation a reader needs before adopting a component; every section is optional and omitted when empty. */
export const uiComponentApiReferenceSchema = z.object({
  exportName: label,
  summary: label.optional(),
  props: z.array(uiComponentPropSchema).min(1),
})
export const uiComponentKeyboardSchema = z.object({keys: z.array(label).min(1), action: label})

export const uiComponentSchema = z.object({
  sourceUrl: toolFeatureSourceUrlSchema,
  authorName: label,
  authorUrl: toolFeatureSourceUrlSchema.optional(),
  original: z.boolean(),
  license: label,
  licenseUrl: toolFeatureSourceUrlSchema,
  frameworks: z.array(label).min(1),
  dependencies: z.array(label).optional(),
  variants: z.array(label).optional(),
  prompt: z.string().refine((value) => value.trim().length > 0, 'Add a recreation prompt.').optional(),
  previewImageUrl: toolFeatureSourceUrlSchema.regex(/^https:\/\/cdn\.sanity\.io\/images\//u, 'Upload a preview image to Sanity and use its cdn.sanity.io/images URL.'),
  previewAlt: label,
  previewUrl: uiComponentPreviewUrlSchema.optional(),
  apiReference: uiComponentApiReferenceSchema.optional(),
  keyboard: z.array(uiComponentKeyboardSchema).min(1).optional(),
  accessibility: notes,
  motion: notes,
  responsive: notes,
  performance: notes,
})

/** Image metadata is derived from the first gallery image; it has no second authoring store. */
export const uiComponentAuthoringSchema = uiComponentSchema.omit({previewImageUrl: true, previewAlt: true})
export const UI_COMPONENT_PUBLIC_PROJECTION = `"uiComponent": select(resourceKind == "ui_component" => uiComponent{
  sourceUrl, authorName, original, license, licenseUrl, frameworks,
  defined(authorUrl) => {authorUrl},
  defined(dependencies) => {dependencies},
  defined(variants) => {variants},
  defined(prompt) => {prompt},
  defined(previewUrl) => {previewUrl},
  defined(apiReference) => {"apiReference": apiReference{exportName, defined(summary) => {summary}, "props": props[]{name, type, description, defined(defaultValue) => {defaultValue}, defined(required) => {required}}}},
  defined(keyboard) => {"keyboard": keyboard[]{keys, action}},
  defined(accessibility) => {accessibility},
  defined(motion) => {motion},
  defined(responsive) => {responsive},
  defined(performance) => {performance},
  "previewImageUrl": ^.mediaGallery[type == "image"][0].image.asset->url,
  "previewAlt": ^.mediaGallery[type == "image"][0].image.alt
})`

export type UiComponent = z.infer<typeof uiComponentSchema>

/** Parse at each catalog/HTTP boundary; incomplete metadata never becomes a runnable preview. */
export function normalizeUiComponent<Input>(input: Input): UiComponent | undefined {
  const parsed = uiComponentSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
}

export interface ComponentInstallQuickstart extends PublicToolQuickstart {
  command: string
}

/** Select the first current shell install step with its provenance; clones, YAML and deprecated steps never qualify. */
export function getComponentInstallQuickstart(quickstarts: readonly PublicToolQuickstart[]): ComponentInstallQuickstart | undefined {
  return quickstarts.find((step): step is ComponentInstallQuickstart => step.kind === 'install_command' && Boolean(step.command) && step.commandLanguage !== 'yaml' && step.status !== 'deprecated')
}

export const UI_COMPONENT_NOTE_SECTIONS = [
  {key: 'accessibility', title: 'Accessibility'},
  {key: 'motion', title: 'Motion'},
  {key: 'responsive', title: 'Responsive behavior'},
  {key: 'performance', title: 'Performance'},
] as const satisfies readonly {key: keyof UiComponent; title: string}[]

export function renderUiComponentMarkdown(component: UiComponent): string {
  return [
    '## UI component',
    `Source: ${buildSafeMarkdownLink(component.original ? 'SlothHub original' : 'Original component', component.sourceUrl)}`,
    `Creator: ${component.authorUrl ? buildSafeMarkdownLink(component.authorName, component.authorUrl) : escapeMarkdownText(component.authorName)}`,
    `License: ${buildSafeMarkdownLink(component.license, component.licenseUrl)}`,
    `Frameworks: ${component.frameworks.map(escapeMarkdownText).join(', ')}`,
    ...(component.dependencies?.length ? [`Dependencies: ${component.dependencies.map(escapeMarkdownText).join(', ')}`] : []),
    ...(component.variants?.length ? [`Variants: ${component.variants.map(escapeMarkdownText).join(', ')}`] : []),
    `Preview image: ${buildSafeMarkdownLink(component.previewAlt, component.previewImageUrl)}`,
    ...(component.previewUrl ? [`Live preview: ${buildSafeMarkdownLink('Open isolated preview', component.previewUrl)}`] : []),
    ...(component.apiReference ? [
      `### API reference: ${escapeMarkdownText(component.apiReference.exportName)}`,
      ...(component.apiReference.summary ? [escapeMarkdownText(component.apiReference.summary)] : []),
      component.apiReference.props.map((prop) => `- ${toMarkdownInlineCode(prop.name)}${prop.required ? ' (required)' : ''}: ${toMarkdownInlineCode(prop.type)}${prop.defaultValue ? `, default ${toMarkdownInlineCode(prop.defaultValue)}` : ''}. ${escapeMarkdownText(prop.description)}`).join('\n'),
    ] : []),
    ...(component.keyboard ? ['### Keyboard interactions', component.keyboard.map(({keys, action}) => `- ${keys.map(toMarkdownInlineCode).join(' / ')}: ${escapeMarkdownText(action)}`).join('\n')] : []),
    ...UI_COMPONENT_NOTE_SECTIONS.flatMap(({key, title}) => component[key] ? [`### ${title}`, component[key].map((note) => `- ${escapeMarkdownText(note)}`).join('\n')] : []),
    ...(component.prompt ? ['### Recreation prompt', toMarkdownCodeBlock(component.prompt, 'text')] : []),
  ].join('\n\n')
}

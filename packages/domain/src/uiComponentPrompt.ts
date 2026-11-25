import {isComponentLicenseFilename, isComponentSourceFilename, isComponentUsageFilename, isSafeComponentFilePath} from './uiComponentFiles.js';
import type {UiComponent} from './uiComponent.js';
import {normalizeToolFeatureDetails, type ToolFeatureDetail} from './toolFeatureDetails.js';
import {toMarkdownCodeBlock} from './markdownSafety.js';
import {buildLinkedHandoffPrompt, formatExampleHandoffSource, normalizeHandoffUrl} from './agentHandoffShared.js';

export type ComponentCodeFile = NonNullable<Extract<ToolFeatureDetail, {kind: 'code'}>['files']>[number];
export type ComponentLicense = Pick<UiComponent, 'license' | 'licenseUrl'>;

/** Every authored source file across a component's code features, in authoring order. */
export function getComponentCodeFiles(features: readonly string[], details: readonly ToolFeatureDetail[]): ComponentCodeFile[] {
  return normalizeToolFeatureDetails([...details], features).flatMap((feature) => {
    if (feature.kind !== 'code' || feature.mode === 'diff') return [];
    if (feature.files?.length) return feature.files.map(({filename, language, code}) => ({filename, language, code}));
    return feature.code && feature.filename ? [{filename: feature.filename, language: feature.language ?? 'text', code: feature.code}] : [];
  });
}

/**
 * Repository agents work inside an existing checkout; app builders own a hosted
 * project and need the files spelled out and rendered somewhere visible.
 */
const REPOSITORY_BRIEF = 'You are working in my existing repository. Follow its framework, file layout, styling approach, and lint rules. Create the files below where components live, wire the component into the page I name (ask if none fits), and run the project\'s type check before you finish.';
const BUILDER_BRIEF = 'Add this component to my current project. Create each file below as written, adapt imports to the project\'s setup, and render the component on the main page so I can preview it.';

export const COMPONENT_PROMPT_TARGETS = [
  {id: 'claude-code', label: 'Claude Code', brief: REPOSITORY_BRIEF},
  {id: 'codex', label: 'Codex', brief: REPOSITORY_BRIEF},
  {id: 'cursor', label: 'Cursor', brief: REPOSITORY_BRIEF},
  {id: 'replit', label: 'Replit', brief: BUILDER_BRIEF},
  {id: 'lovable', label: 'Lovable', brief: BUILDER_BRIEF},
  {id: 'bolt', label: 'Bolt.new', brief: BUILDER_BRIEF},
  {id: 'v0', label: 'v0 by Vercel', brief: BUILDER_BRIEF},
] as const;

export type ComponentPromptTarget = (typeof COMPONENT_PROMPT_TARGETS)[number];

export function buildLinkedComponentPrompt(markdownUrl?: string): string | undefined {
  const reference = normalizeHandoffUrl(markdownUrl);
  if (!reference) return;
  return buildLinkedHandoffPrompt(
    reference,
    'Help me add this component to my project. Use the source and usage example, follow my project’s conventions, and preserve upstream credit and license notices.',
  );
}

/** Previews without a public Markdown export carry source in the draft. */
export function buildComponentAgentPrompt({prompt, files, target, license, markdownUrl, sourceUrl}: {prompt: string; files: readonly ComponentCodeFile[]; target: ComponentPromptTarget; license?: ComponentLicense; markdownUrl?: string; sourceUrl?: string}): string {
  const linkedPrompt = buildLinkedComponentPrompt(markdownUrl);
  if (linkedPrompt) return linkedPrompt;
  const notices = files.filter(({filename}) => isSafeComponentFilePath(filename) && isComponentLicenseFilename(filename));
  const source = formatExampleHandoffSource(sourceUrl);
  return [
    target.brief,
    ...(source ? [source] : []),
    prompt.trim(),
    // Agents create these files inside an existing project; keep its configuration and environment intact.
    ...files.filter(({filename}) => isSafeComponentFilePath(filename) && (isComponentSourceFilename(filename) || isComponentUsageFilename(filename))).map(({filename, language, code}) => `### ${filename}\n\n${toMarkdownCodeBlock(code, language)}`),
    ...(license || notices.length ? [
      '## License and attribution',
      'Preserve the component\'s copyright and license notices alongside its files or in the project\'s existing third-party notices. Do not replace the project\'s root LICENSE or change its licensing. Review the license source for any additional notices before installing.',
      ...(license ? [`License: ${license.license}\nLicense source: ${license.licenseUrl}`] : []),
      ...notices.map(({filename, language, code}) => `Upstream notice (${filename}) — context to preserve, not a project file to overwrite:\n\n${toMarkdownCodeBlock(code, language)}`),
    ] : []),
  ].join('\n\n');
}

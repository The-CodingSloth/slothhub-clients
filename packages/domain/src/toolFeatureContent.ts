import type {ArticleCodeLanguage} from './articleRichText.js';
import type {ToolDeveloperFeatureDetail} from './toolFeatureDetails.js';

const TERMINAL_LANGUAGES = {
  shell: 'shell', bash: 'bash', sh: 'bash', zsh: 'bash', fish: 'fish', powershell: 'powershell', cmd: 'bat',
} as const;

/** Ordered authored choices; legacy single examples remain one choice. Arrays take precedence. */
export function getToolFeatureExamples(detail: ToolDeveloperFeatureDetail): ToolDeveloperFeatureDetail[] {
  if (detail.kind === 'code' && detail.mode === 'before_after' && detail.before && detail.after) {
    const {before, after, files: _files, ...shared} = detail;
    return [before, after].map((file) => ({...shared, ...file, mode: 'single'}));
  }
  if (detail.kind === 'code' && detail.files) {
    const {files, ...shared} = detail;
    return files.map((file) => ({...shared, ...file}));
  }
  if (detail.kind === 'terminal' && detail.variants) {
    const {variants, output: _output, ...shared} = detail;
    return variants.map(({label, ...variant}) => ({...shared, ...variant, title: label}));
  }
  return [detail];
}

/** Cards and currency checks use current examples; comparison views and evidence checks retain both sides. */
export function getCurrentToolFeatureExamples(detail: ToolDeveloperFeatureDetail): ToolDeveloperFeatureDetail[] {
  const examples = getToolFeatureExamples(detail);
  return detail.kind === 'code' && detail.mode === 'before_after' ? examples.slice(1) : examples;
}

export function getToolFeatureSource(detail: ToolDeveloperFeatureDetail): string {
  if (detail.kind === 'slash_command') return detail.command;
  return detail.kind === 'code' ? (detail.mode === 'before_after' ? detail.before?.code ?? '' : detail.files?.[0]?.code ?? detail.code ?? '') : (detail.variants?.[0]?.command ?? detail.command ?? '');
}

export function getToolFeatureLanguage(detail: ToolDeveloperFeatureDetail): ArticleCodeLanguage | 'fish' | 'powershell' | 'bat' {
  if (detail.kind === 'slash_command') return 'text';
  return detail.kind === 'code' ? (detail.mode === 'before_after' ? detail.before?.language ?? 'text' : detail.files?.[0]?.language ?? detail.language ?? 'text') : TERMINAL_LANGUAGES[detail.variants?.[0]?.shell ?? detail.shell ?? 'shell'];
}

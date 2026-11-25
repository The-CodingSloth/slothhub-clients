import {formatToolCapabilityCount, TOOL_CAPABILITY_EFFECT_LABELS, TOOL_FEATURE_OUTPUT_UNAVAILABLE_LABELS, getToolInstallCommands, formatToolFeatureLimitEntry} from './toolFeaturePresentation.js';
import type {ToolFeatureDetail} from './toolFeatureDetails.js';
import {buildSafeMarkdownLink, escapeMarkdownText, toMarkdownInlineCode, toMarkdownCodeBlock} from './markdownSafety.js';
import {getToolFeatureExamples, getToolFeatureLanguage, getToolFeatureSource} from './toolFeatureContent.js';

/** Preserve authored examples as source so they cannot inject structure into the surrounding artifact. */
export function renderToolFeatureDetailsMarkdown(details: readonly ToolFeatureDetail[]): string {
  return details.map((detail) => {
    const content = renderFeatureContent(detail);
    const checked = detail.checkedAt && detail.sourceUrl ? `\n\nFeature checked: ${toMarkdownInlineCode(detail.checkedAt)}` : '';
    const image = detail.image;
    const screenshot = image ? [
      image.url ? buildSafeMarkdownLink(image.alt, image.url) : `Screenshot: ${escapeMarkdownText(image.alt)}`,
      image.caption ? escapeMarkdownText(image.caption) : '',
      image.sourceUrl ? buildSafeMarkdownLink('Screenshot source', image.sourceUrl) : '',
      image.checkedAt && image.sourceUrl ? `Screenshot checked: ${toMarkdownInlineCode(image.checkedAt)}` : '',
    ].filter(Boolean).join('\n\n') : '';
    return `${content}${screenshot ? `\n\n${screenshot}` : ''}${detail.sourceUrl ? `\n\n${buildSafeMarkdownLink('Docs', detail.sourceUrl)}` : ''}${checked}`;
  }).join('\n\n');
}

function renderFeatureContent(detail: ToolFeatureDetail): string {
  const heading = `### ${escapeMarkdownText(detail.title)}\n\n${escapeMarkdownText(detail.summary)}`;
  if (detail.kind === 'capability_list') return `${heading}\n\n${formatToolCapabilityCount(detail.listKind, detail.items.length)}\n\n${detail.items.map((item) => `- ${toMarkdownInlineCode(item.name)}${item.effect ? ` — ${TOOL_CAPABILITY_EFFECT_LABELS[item.effect]}` : ''}: ${escapeMarkdownText(item.description)}${item.requiresAuth === undefined ? '' : item.requiresAuth ? ' Authentication required.' : ' Authentication not required.'}`).join('\n')}`;
  if (detail.kind === 'install') return `${heading}\n\n${getToolInstallCommands(detail).map(({manager, command}) => `#### ${manager}\n\n${toMarkdownCodeBlock(command, 'shell')}`).join('\n\n')}`;
  if (detail.kind === 'feature') return [heading, detail.body.split('\n').map(escapeMarkdownText).join('\n'), detail.bullets?.map((bullet) => `- ${escapeMarkdownText(bullet)}`).join('\n')].filter(Boolean).join('\n\n');
  if (detail.kind === 'markdown') return `${heading}\n\n${toMarkdownCodeBlock(detail.body, 'markdown')}`;
  if (detail.kind === 'limits') return `${heading}\n\n${detail.entries.map((entry) => `- ${escapeMarkdownText(formatToolFeatureLimitEntry(entry))}${entry.sourceUrl ? ` (${buildSafeMarkdownLink('Source', entry.sourceUrl)})` : ''}`).join('\n')}`;
  if (detail.kind === 'shortcuts') return `${heading}${detail.context ? `\n\n${escapeMarkdownText(detail.context)}` : ''}\n\n${detail.entries.map((entry) => `- ${escapeMarkdownText(entry.action)}: ${([['mac', 'macOS'], ['windows', 'Windows'], ['linux', 'Linux']] as const).flatMap(([key, label]) => entry[key] ? [`${label}: ${toMarkdownInlineCode(entry[key])}`] : []).join('; ')}`).join('\n')}`;
  if (detail.kind === 'permissions') return `${heading}\n\nPermission model: ${detail.model}\n\n${detail.entries.map((entry) => `- ${toMarkdownInlineCode(entry.permission)} — ${entry.required ? 'Required' : 'Optional'}${entry.scope ? ` (${escapeMarkdownText(entry.scope)})` : ''}${entry.reason ? `: ${escapeMarkdownText(entry.reason)}` : ''}`).join('\n')}`;
  if (detail.kind === 'reference') return `${heading}\n\nReference: ${detail.tableKind}\n\n${detail.rows.map((row) => `- ${toMarkdownInlineCode(row.name)}${row.type ? ` (${escapeMarkdownText(row.type)})` : ''}${row.required === undefined ? '' : row.required ? ' — Required' : ' — Optional'}: ${escapeMarkdownText(row.description)}${row.default === undefined ? '' : ` Default: ${row.default === '' ? '(empty string)' : toMarkdownInlineCode(row.default)}`}${row.sourceUrl ? ` (${buildSafeMarkdownLink('Source', row.sourceUrl)})` : ''}`).join('\n')}`;
  if (detail.kind === 'benchmark') {
    return [
      heading,
      detail.claimant === 'vendor' ? 'Vendor benchmark' : 'Independent benchmark',
      escapeMarkdownText(`${detail.metric}: ${detail.value} ${detail.unit}`),
      detail.comparedTo ? `Compared with: ${escapeMarkdownText(detail.comparedTo)}` : '',
      `Hardware: ${escapeMarkdownText(detail.environment.hardware)}`,
      `Version: ${escapeMarkdownText(detail.environment.version)}`,
      `Measured: ${detail.environment.date}`,
      buildSafeMarkdownLink('Methodology', detail.methodologyUrl),
    ].filter(Boolean).join('\n\n');
  }
  if (detail.kind === 'compatibility') {
    const rows = (detail.rows ?? []).map((row) => {
      const status = {required: 'Required', supported: 'Supported', partial: 'Partial', unsupported: 'Unsupported', unknown: 'Unknown'}[row.status];
      const subject = escapeMarkdownText(`${row.subjectName} ${row.environmentRange}: ${status}`);
      const scope = row.toolRange ? ` (Tool ${escapeMarkdownText(row.toolRange)})` : '';
      const note = row.note ? ` — ${escapeMarkdownText(row.note)}` : '';
      const evidence = row.evidence.map((source) => `  ${buildSafeMarkdownLink(source.title, source.url)} (checked ${toMarkdownInlineCode(source.checkedAt)})`);
      return [`- ${subject}${scope}${note}`, `  Reviewed: ${toMarkdownInlineCode(row.reviewedAt)}`, ...evidence].join('\n');
    });
    return `${heading}\n\n${rows.join('\n')}`;
  }
  const examples = getToolFeatureExamples(detail).map((example, index) => {
    const metadata = example.kind === 'code'
      ? (example.filename ? `File: ${toMarkdownInlineCode(example.filename)}\n\n` : '')
      : example.kind === 'slash_command' ? `Run in ${escapeMarkdownText(example.host)}\n\n`
      : `Shell: ${example.shell === 'shell' ? 'not specified; check the tool documentation' : example.shell}\n\n${example.workingDirectory ? `Working directory: ${toMarkdownInlineCode(example.workingDirectory)}\n\n` : ''}${example.pairedWith ? `Uses: ${escapeMarkdownText(example.pairedWith)}\n\n` : ''}`;
    const output = (example.kind === 'terminal' || example.kind === 'slash_command') && example.output
      ? `\n\nExample output:\n\n${toMarkdownCodeBlock(example.output, 'text')}`
      : '';
    const label = detail.kind === 'code' && detail.mode === 'before_after' ? `#### ${index === 0 ? 'Before' : 'After'}\n\n` : detail.kind === 'terminal' && detail.variants ? `#### ${escapeMarkdownText(example.title)}\n\n` : '';
    const placeholderNote = example.placeholderNote ? `\n\n${escapeMarkdownText(example.placeholderNote)}` : '';
    const args = example.kind === 'slash_command' && example.args?.length
      ? '\n\nArguments:\n\n' + example.args.map((arg) => `- ${toMarkdownInlineCode(arg.name)}${arg.required === undefined ? '' : arg.required ? ' (required)' : ' (optional)'}: ${escapeMarkdownText(arg.description)}`).join('\n') : '';
    const highlights = example.kind === 'code' && example.highlightLines ? `\n\nHighlighted lines: ${example.highlightLines}` : '';
    const isDiff = example.kind === 'code' && example.mode === 'diff';
    const syntax = isDiff ? `Syntax: ${toMarkdownInlineCode(getToolFeatureLanguage(example))}\n\n` : '';
    return `${label}${metadata}${syntax}${toMarkdownCodeBlock(getToolFeatureSource(example), isDiff ? 'diff' : getToolFeatureLanguage(example))}${highlights}${placeholderNote}${args}${output}`;
  }).join('\n\n');
  const playgrounds = detail.kind === 'slash_command' ? '' : detail.playgrounds?.map(({provider, url}) => buildSafeMarkdownLink(`Try in ${provider}`, new URL(url).href)).join('\n') ?? '';
  const caption = detail.kind === 'code' && detail.caption ? `\n\n${escapeMarkdownText(detail.caption)}` : '';
  const outputUnavailable = detail.kind === 'terminal' && detail.outputUnavailable
    ? `\n\nOutput unavailable (${TOOL_FEATURE_OUTPUT_UNAVAILABLE_LABELS[detail.outputUnavailable.type]}): ${escapeMarkdownText(detail.outputUnavailable.reason)}` : '';
  const illustrative = detail.kind !== 'slash_command' && detail.copyable === false ? '\n\nIllustrative example; not intended for copying.' : '';
  return `${heading}\n\n${examples}${caption}${illustrative}${outputUnavailable}${playgrounds ? `\n\n${playgrounds}` : ''}`;
}

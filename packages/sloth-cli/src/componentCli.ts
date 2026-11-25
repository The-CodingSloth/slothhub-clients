import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';
import {UI_COMPONENT_NOTE_SECTIONS} from '@slothhub/domain/ui-component';
import {buildComponentBundle, buildComponentHandoff, type ComponentHandoff} from '@slothhub/domain/ui-component-registry';
import {stripTerminalControls} from './catalogFormat.js';
import {failForOutput, jsonLine, ok} from './cliOutput.js';
import {FeedClientError, type FeedClient} from './feedClient.js';
import type {CliResult} from './types.js';

interface ComponentCliRequest {
  positionals: string[];
  json: boolean;
}

/** Catalog text is untrusted: keep line breaks and indentation, drop terminal control sequences. */
const safeBlock = (value: string): string => value.split('\n').map((line) => stripTerminalControls(line.replaceAll('\t', '  '))).join('\n');
const safe = stripTerminalControls;

export const formatComponentHandoff = (handoff: ComponentHandoff): string => {
  const {install} = handoff;
  const lines = [
    safe(handoff.name),
    safe(handoff.description),
    `Cite: ${safe(handoff.detailUrl)}`,
    `License: ${safe(handoff.license.name)} (${safe(handoff.license.url)}) by ${safe(handoff.license.author)}${handoff.license.original ? ', original to SlothHub' : ''}. Keep the license notice with the files.`,
    `Frameworks: ${handoff.frameworks.map(safe).join(', ')}`,
    ...(handoff.dependencies.length ? [`npm dependencies: ${handoff.dependencies.map(safe).join(', ')}`] : []),
    ...(handoff.otherRequirements.length ? [`Other requirements: ${handoff.otherRequirements.map(safe).join(', ')}`] : []),
    '',
    'Install',
    ...(install.kind === 'manual'
      ? [`  ${safe(install.message)}`]
      : [
        `  ${install.kind === 'upstream' ? 'Creator command' : 'SlothHub registry (writes components/<slug>/ and installs npm dependencies)'}:`,
        `  ${safe(install.command)}`,
        ...(install.kind === 'slothhub_registry' ? [`  Or map ${install.namespacedName} in components.json registries: ${JSON.stringify(install.componentsJsonRegistries)}`] : []),
      ]),
    ...(handoff.integrationPrompt ? ['', 'Integration notes from the creator', safeBlock(handoff.integrationPrompt)] : []),
    ...(handoff.apiReference ? ['', `Props: ${safe(handoff.apiReference.exportName)}`, ...handoff.apiReference.props.map((prop) =>
      `  ${safe(prop.name)}${prop.required ? ' (required)' : ''}: ${safe(prop.type)}${prop.defaultValue ? `, default ${safe(prop.defaultValue)}` : ''}. ${safe(prop.description)}`)] : []),
    ...(handoff.keyboard ? ['', 'Keyboard', ...handoff.keyboard.map(({keys, action}) => `  ${keys.map(safe).join(' / ')}: ${safe(action)}`)] : []),
    ...UI_COMPONENT_NOTE_SECTIONS.flatMap(({key, title}) => handoff.notes[key]?.length ? ['', title, ...(handoff.notes[key] ?? []).map((note) => `  - ${safe(note)}`)] : []),
    ...handoff.files.flatMap((file) => ['', `--- ${safe(file.path)} (${file.role}) ---`, safeBlock(file.content)]),
  ];
  return `${lines.join('\n')}\n`;
};

export const runComponentCommand = async (client: Pick<FeedClient, 'tool'>, request: ComponentCliRequest): Promise<CliResult> => {
  const [slug] = request.positionals;
  if (request.positionals.length !== 1 || !isValidToolPublicSlug(slug)) {
    return failForOutput(request.json, {
      code: 'invalid_input', message: 'Usage: slothhub component <slug>.',
      recovery: 'Find components with slothhub search --kind ui_component, then pass one slug.',
    });
  }
  let feed;
  try {
    feed = await client.tool(slug);
  } catch (error) {
    if (!(error instanceof FeedClientError) || error.code !== 'transport' || error.httpStatus !== 404 || error.path !== `/api/tools/${slug}.json`) throw error;
    return failForOutput(request.json, {
      code: 'not_found', message: `Tool not found: ${slug}.`,
      recovery: 'Find components with slothhub search --kind ui_component.',
    });
  }
  const {data: tool, siteUrl} = feed;
  if (tool.slug !== slug) {
    throw new FeedClientError('schema_invalid', `/api/tools/${slug}.json`, 'Tool detail identity does not match the requested slug.');
  }
  if (!tool.uiComponent) {
    return failForOutput(request.json, {
      code: 'not_a_component', message: `${slug} is a ${tool.resourceKind.label}, not a UI component.`,
      detailUrl: tool.detailUrl, recovery: `Use slothhub tool ${slug} for its details.`,
    });
  }
  const handoff = buildComponentHandoff(buildComponentBundle({...tool, uiComponent: tool.uiComponent}, siteUrl), siteUrl);
  return ok(request.json ? jsonLine(handoff) : formatComponentHandoff(handoff));
};

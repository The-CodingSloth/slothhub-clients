import {checkToolAssembly, parseToolAssemblyRequirements, TOOL_ASSEMBLY_MAX_TOOLS, TOOL_ASSEMBLY_MIN_TOOLS, type ToolAssemblyFinding, type ToolAssemblyReport} from '@slothhub/domain/tool-assembly';
import {getCanonicalToolDetailUrl} from '@slothhub/domain/public-agent-url';
import {isValidToolPublicSlug} from '@slothhub/domain/tool-lookup';
import type { z } from 'zod';

import type { checkToolAssemblyInputSchema } from '../schemas/inputs.js';
import { FeedRequestError, type FeedClient } from '../services/feeds.js';
import type { AgentToolDetail } from '../types.js';
import {
  feedLoadError,
  formatToolResult,
  toolError,
  type ToolContentResult,
} from './format.js';
import { escapeMarkdownText, toMarkdownInlineCode } from './markdown.js';

type CheckToolAssemblyInput = z.infer<typeof checkToolAssemblyInputSchema>;

type AssemblySelection = {
  selectedSlug: string;
  tool: AgentToolDetail | null;
};

const SLUG_INPUT_SUGGESTION =
  'Pass between two and five unique lowercase public Tool slugs, for example slugs=["figma", "linear"].';
const REQUIREMENT_INPUT_SUGGESTION =
  'Pass valid require_integrations, require_platforms, and require_agent_interface_kinds values.';

const slugCountError = (observedCount: number, format: CheckToolAssemblyInput['response_format']) =>
  toolError(
    `Assembly requires ${TOOL_ASSEMBLY_MIN_TOOLS}-${TOOL_ASSEMBLY_MAX_TOOLS} unique Tool slugs after duplicates are removed.`,
    {
      code: 'invalid_input',
      suggestion: SLUG_INPUT_SUGGESTION,
      responseFormat: format,
      details: {
        configuredLimit: TOOL_ASSEMBLY_MAX_TOOLS,
        observedCount,
      },
    },
  );

const findingLines = (
  entries: readonly ToolAssemblyFinding[],
  emptyText: string,
): string[] =>
  entries.length > 0
    ? entries.map(
        (entry) =>
          `- **${escapeMarkdownText(entry.label)}** — ${escapeMarkdownText(entry.reason)}`,
      )
    : [`- ${emptyText}`];

export const formatToolAssemblyMarkdown = (
  report: ToolAssemblyReport,
  resolved: readonly AgentToolDetail[],
): string => {
  const lines = [
    '# Tool Assembly evidence',
    '',
    `- Report: ${toMarkdownInlineCode(report.identity)}`,
    `- Selected: ${
      report.selectedTools
        .map((tool) => `**${escapeMarkdownText(tool.name)}** (${toMarkdownInlineCode(tool.slug)})`)
        .join(', ') || 'none resolved'
    }`,
    '',
    '## Confirmed overlap',
    ...findingLines(report.confirmedOverlap, 'None. Missing evidence never becomes a positive claim.'),
    '',
    '## Explicit conflicts',
    ...findingLines(report.explicitConflicts, 'None found in structured negative facts.'),
    '',
    '## Missing evidence',
    ...findingLines(report.missingEvidence, 'None in the evaluated facts.'),
  ];

  if (report.unresolvedTools.length > 0) {
    lines.push(
      '',
      '## Unresolved Tools',
      ...report.unresolvedTools.map(
        (tool) => `- ${toMarkdownInlineCode(tool.slug)} — ${escapeMarkdownText(tool.reason)}`,
      ),
    );
  }

  lines.push(
    '',
    '## Not evaluated in v1',
    ...report.notEvaluatedAxes.map(
      (axis) => `- ${toMarkdownInlineCode(axis.axis)} — ${escapeMarkdownText(axis.reason)}`,
    ),
  );

  if (resolved.length > 0) {
    lines.push(
      '',
      '## Cite',
      ...resolved.map((tool) => `- ${escapeMarkdownText(tool.name)} — ${tool.detailUrl}`),
    );
  }

  lines.push('', `> ${report.disclaimer}`);
  return `${lines.join('\n')}\n`;
};

export const handleCheckToolAssembly = async (
  client: FeedClient,
  params: CheckToolAssemblyInput,
  signal?: AbortSignal,
  allowedTemplates?: ReadonlySet<string>,
): Promise<ToolContentResult> => {
  // Validate slugs and requirements before any feed fetch so a bad argument
  // wins over a transport failure.
  const requestedSlugs = [
    ...new Set(
      params.slugs
        .map((slug) => slug.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (requestedSlugs.some((slug) => !isValidToolPublicSlug(slug))) {
    return toolError('Assembly accepts public Tool slugs only.', {
      code: 'invalid_input',
      suggestion: SLUG_INPUT_SUGGESTION,
      responseFormat: params.response_format,
    });
  }
  if (
    requestedSlugs.length < TOOL_ASSEMBLY_MIN_TOOLS ||
    requestedSlugs.length > TOOL_ASSEMBLY_MAX_TOOLS
  ) {
    return slugCountError(requestedSlugs.length, params.response_format);
  }

  const requirements = parseToolAssemblyRequirements({
    integrations: params.require_integrations,
    platforms: params.require_platforms,
    agentInterfaceKinds: params.require_agent_interface_kinds,
  });
  if (!requirements.ok) {
    return toolError(requirements.errors.join(' '), {
      code: 'invalid_input',
      suggestion: REQUIREMENT_INPUT_SUGGESTION,
      responseFormat: params.response_format,
    });
  }

  try {
    const selections: AssemblySelection[] = await Promise.all(
      requestedSlugs.map(async (slug) => {
        try {
          const feed = await client.toolDetail(slug, signal);
          if (!getCanonicalToolDetailUrl(feed.data, feed.siteUrl)) {
            throw new Error(`Tool detail '${slug}' has no safe canonical citation URL.`);
          }
          return { selectedSlug: feed.data.slug, tool: feed.data };
        } catch (error) {
          // A confirmed 404 is an unresolved selection, not a crash; every
          // other fetch failure fails closed below.
          if (error instanceof FeedRequestError && error.status === 404 &&
            error.path === `/api/tools/${slug}.json`) {
            return { selectedSlug: slug, tool: null };
          }
          throw error;
        }
      }),
    );

    const selectedSlugs = [
      ...new Set(selections.map(({ selectedSlug }) => selectedSlug)),
    ].sort();
    if (
      selectedSlugs.length < TOOL_ASSEMBLY_MIN_TOOLS ||
      selectedSlugs.length > TOOL_ASSEMBLY_MAX_TOOLS
    ) {
      return slugCountError(selectedSlugs.length, params.response_format);
    }

    // Two requested slugs can resolve to the same canonical Tool (aliases);
    // the checker dedupes internally, so keep citations and resource links
    // deduped too rather than listing the same Tool twice.
    const resolved = [...new Map(
      selections
        .filter(
          (selection): selection is AssemblySelection & { tool: AgentToolDetail } =>
            selection.tool !== null,
        )
        .map((selection) => [selection.tool.slug, selection.tool] as const),
    ).values()];

    let report: ToolAssemblyReport;
    try {
      report = checkToolAssembly({
        selectedSlugs,
        tools: resolved.map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          detailUrl: tool.detailUrl,
          platforms: tool.platforms,
          integrations: tool.integrations,
          agentInterfaces: tool.agentInterfaces,
        })),
        requirements: {
          integrations: params.require_integrations,
          platforms: params.require_platforms,
          agentInterfaceKinds: params.require_agent_interface_kinds,
        },
      });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error), {
        code: 'invalid_input',
        suggestion: REQUIREMENT_INPUT_SUGGESTION,
        responseFormat: params.response_format,
      });
    }

    return formatToolResult(
      params.response_format,
      formatToolAssemblyMarkdown(report, resolved),
      { report },
      resolved.map((tool) => ({
        kind: 'tool' as const,
        slug: tool.slug,
        name: tool.name,
      })),
      allowedTemplates,
    );
  } catch (error) {
    return feedLoadError('checking Tool Assembly', error, params.response_format);
  }
};

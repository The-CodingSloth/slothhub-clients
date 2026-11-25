import {
  PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
  parseProjectToolPinManifest,
  renderProjectToolPinManifest,
  type ProjectToolPinManifestParseReason,
} from '@slothhub/domain/project-tool-pin-manifest';
import { z } from 'zod';

import { ResponseFormat } from '../constants.js';
import { pinManifestInputSchema } from '../schemas/inputs.js';
import {
  formatToolResult,
  toolError,
  type ToolContentResult,
  type ToolErrorPayload,
} from './format.js';

export type PinManifestInput = z.infer<typeof pinManifestInputSchema>;

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const manifestParseError = (
  reason: ProjectToolPinManifestParseReason,
  manifest: string,
  responseFormat: ResponseFormat,
): ToolContentResult<ToolErrorPayload> =>
  reason === 'oversized'
    ? toolError(`Manifest validation failed: ${reason}.`, {
        code: 'payload_too_large',
        responseFormat,
        suggestion: `Keep the manifest at or below ${PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES} bytes.`,
        details: {
          field: 'manifest',
          configuredLimitBytes: PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
          observedBytes: utf8Bytes(manifest),
        },
      })
    : toolError(`Manifest validation failed: ${reason}.`, {
        code: 'invalid_manifest',
        responseFormat,
        suggestion:
          'Fix the manifest content and retry. slothhub manifest validate <file> runs the same check locally.',
        details: { field: 'manifest' },
      });

export const handleValidatePinManifest = (
  params: PinManifestInput,
): ToolContentResult<
  | { valid: true; artifact: string; version: number; toolCount: number }
  | ToolErrorPayload
> => {
  const result = parseProjectToolPinManifest(params.manifest);
  if (!result.ok) {
    return manifestParseError(
      result.reason,
      params.manifest,
      params.response_format,
    );
  }

  const summary = {
    valid: true as const,
    artifact: result.value.artifact,
    version: result.value.version,
    toolCount: result.value.tools.length,
  };
  return formatToolResult(
    params.response_format,
    `Valid Project Tool pin manifest v${summary.version} with ${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'}.\n`,
    summary,
  );
};

export const handleRenderPinManifest = (
  params: PinManifestInput,
): ToolContentResult<
  { artifact: string; version: number; rendered: string } | ToolErrorPayload
> => {
  const result = parseProjectToolPinManifest(params.manifest);
  if (!result.ok) {
    return manifestParseError(
      result.reason,
      params.manifest,
      params.response_format,
    );
  }

  const rendered = renderProjectToolPinManifest(result.value);
  const structured = {
    artifact: result.value.artifact,
    version: result.value.version,
    rendered,
  };

  if (params.response_format === ResponseFormat.JSON) {
    return {
      content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    };
  }
  // The rendered text is the deliverable: return it whole instead of routing
  // through the presentation truncation used for catalog listings.
  return {
    content: [{ type: 'text', text: rendered }],
    structuredContent: structured,
  };
};

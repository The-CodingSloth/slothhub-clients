import { z } from "zod";
import type { JsonValue } from "./jsonValue.js";
import {
  isValidNpmPackageName,
  isValidPypiProjectName,
} from "./packageNames.js";
import {
  readMcpRegistryStdio,
  type McpRegistryStdio,
} from "./mcpRegistryStdio.js";

type McpRegistryPackageIdentity = {
  registryType: "npm" | "pypi";
  identifier: string;
};
/** Install identity, with complete validated stdio metadata when available. */
export type McpRegistryPackage =
  McpRegistryPackageIdentity | (McpRegistryPackageIdentity & McpRegistryStdio);

// 2026-09-22 receipt: 800 official records, 705 packages, max 2 per record
// and 39 identifier characters. Eight gives 4x package headroom; 256 gives
// >6x identifier headroom and accommodates npm's existing 214-character rule.
// See upstream docs/measurements/mcp-registry-packages-2026-09-22.md.
export const MAX_MCP_REGISTRY_PACKAGES = 8;
const MAX_PACKAGE_IDENTIFIER_LENGTH = 256;

const packageSchema = z.discriminatedUnion("registryType", [
  z.object({
    registryType: z.literal("npm"),
    identifier: z.string().refine(isValidNpmPackageName),
    registryBaseUrl: z
      .enum(["https://registry.npmjs.org", "https://registry.npmjs.org/"])
      .optional(),
  }),
  z.object({
    registryType: z.literal("pypi"),
    identifier: z.string().refine(isValidPypiProjectName),
    registryBaseUrl: z
      .enum(["https://pypi.org", "https://pypi.org/"])
      .optional(),
  }),
]);

export const readMcpRegistryPackages = (
  value: JsonValue,
): McpRegistryPackage[] => {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_MCP_REGISTRY_PACKAGES) {
    throw Object.assign(
      new Error(
        `MCP Registry packages exceed limit: limit=${MAX_MCP_REGISTRY_PACKAGES}, actual=${value.length}. Review the record and remeasure before raising the limit.`,
      ),
      { code: "REGISTRY_INVALID_RESPONSE" },
    );
  }
  const packages: McpRegistryPackage[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const parsed = packageSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const { registryType, identifier } = parsed.data;
    if (identifier.length > MAX_PACKAGE_IDENTIFIER_LENGTH) {
      throw Object.assign(
        new Error(
          `MCP Registry package identifier exceeds limit: limit_chars=${MAX_PACKAGE_IDENTIFIER_LENGTH}, actual_chars=${identifier.length}. Review the record and remeasure before raising the limit.`,
        ),
        { code: "REGISTRY_INVALID_RESPONSE" },
      );
    }
    const stdio = readMcpRegistryStdio(candidate, registryType);
    const entry = { registryType, identifier, ...stdio };
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    packages.push(entry);
  }
  return packages;
};

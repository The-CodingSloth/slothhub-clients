import { z } from "zod";
import { valid as validSemver } from "semver";
import type { JsonObject, JsonValue } from "./jsonValue.js";
import {hasRuntimeObjectType} from './runtimeValidation.js';

// Receipt: upstream docs/measurements/mcp-registry-stdio-2026-09-22.md. The 800-record
// sample has at most 3 arguments, 9 environment names, and 13 version chars.
export const MAX_MCP_STDIO_ARGUMENTS = 12;
export const MAX_MCP_STDIO_ENVIRONMENT_NAMES = 18;
const MAX_LITERAL_LENGTH = 128;

const literal = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_./:@=+!-]+$/);
const argumentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("positional"), value: literal }),
  z.object({
    type: z.literal("named"),
    name: z.string().regex(/^--?[A-Za-z][A-Za-z0-9-]*$/),
    value: literal.optional(),
  }),
]);
const environmentNameSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  isSecret: z.boolean().default(false),
});
const stdioSchema = z.object({
  transport: z.object({ type: z.literal("stdio") }),
  version: z.string().min(1),
  runtimeHint: z.enum(["npx", "uvx"]).optional(),
  runtimeArguments: z.array(argumentSchema).default([]),
  packageArguments: z.array(argumentSchema).default([]),
  environmentVariables: z.array(environmentNameSchema).default([]),
  // A shell string or a publisher-selected executable is never an input.
  command: z.never().optional(),
  args: z.never().optional(),
});
export type McpRegistryStdio = z.infer<typeof stdioSchema>;
export type McpRegistryEnvironmentName = z.infer<typeof environmentNameSchema>;

const bound = (field: string, actual: number, limit: number): void => {
  if (actual <= limit) return;
  throw Object.assign(
    new Error(
      `MCP Registry ${field} exceeds limit: limit=${limit}, actual=${actual}. Review the record and remeasure before raising the limit.`,
    ),
    { code: "REGISTRY_INVALID_RESPONSE" },
  );
};

const unresolvedArgumentSchema = z.object({
  isSecret: z.literal(false).optional(),
  variables: z.never().optional(),
  isRepeated: z.literal(false).optional(),
});

const isJsonObject = (value: JsonValue): value is JsonObject =>
  hasRuntimeObjectType(value) && value !== null && !Array.isArray(value);

/** Parse the same selected shape at registry intake and stored-observation reads. */
export const readMcpRegistryStdio = (
  value: JsonValue,
  registryType: "npm" | "pypi",
): McpRegistryStdio | undefined => {
  if (isJsonObject(value)) {
    if (Array.isArray(value.runtimeArguments)) bound('runtime arguments', value.runtimeArguments.length, MAX_MCP_STDIO_ARGUMENTS);
    if (Array.isArray(value.packageArguments)) bound('package arguments', value.packageArguments.length, MAX_MCP_STDIO_ARGUMENTS);
    if (Array.isArray(value.environmentVariables)) bound('environment names', value.environmentVariables.length, MAX_MCP_STDIO_ENVIRONMENT_NAMES);
  }
  const parsed = stdioSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  const runner = registryType === "npm" ? "npx" : "uvx";
  if (data.runtimeHint && data.runtimeHint !== runner) return undefined;
  if (
    registryType === "npm"
      ? validSemver(data.version) !== data.version
      : !/^\d+(?:\.\d+)*$/.test(data.version)
  )
    return undefined;
  bound("package version characters", data.version.length, 64);
  // Inspect flags before schema stripping: never copy secret/template arguments.
  const original = z
    .object({
      runtimeArguments: z.array(unresolvedArgumentSchema).optional(),
      packageArguments: z.array(unresolvedArgumentSchema).optional(),
    })
    .safeParse(value);
  if (!original.success) return undefined;
  for (const arg of [...data.runtimeArguments, ...data.packageArguments]) {
    if (arg.value)
      bound("argument characters", arg.value.length, MAX_LITERAL_LENGTH);
    if (arg.type === "named")
      bound("argument name characters", arg.name.length, MAX_LITERAL_LENGTH);
  }
  for (const env of data.environmentVariables)
    bound("environment name characters", env.name.length, MAX_LITERAL_LENGTH);
  // Runtime switches can change the executable or registry. Only npm's explicit
  // published consent flag is supported; never invent it or accept -c/--package.
  if (
    data.runtimeArguments.some(
      (arg) =>
        registryType !== "npm" ||
        (arg.type === "named"
          ? arg.value !== undefined || !["-y", "--yes"].includes(arg.name)
          : !["-y", "--yes"].includes(arg.value)),
    )
  )
    return undefined;
  if (data.packageArguments.some((arg) => arg.value === undefined))
    return undefined;
  return { ...data, runtimeHint: runner };
};

interface McpStdioCommand {
  command: "npx" | "uvx";
  args: string[];
}

/** Known runners receive a pinned package and literal argv, never shell text. */
export const buildMcpRegistryStdioCommand = (
  entry: McpRegistryStdio & {
    registryType: "npm" | "pypi";
    identifier: string;
  },
): McpStdioCommand => ({
  command: entry.registryType === "npm" ? "npx" : "uvx",
  args: [
    ...entry.runtimeArguments.map((arg) =>
      arg.type === "named" ? arg.name : arg.value,
    ),
    `${entry.identifier}@${entry.version}`,
    ...entry.packageArguments.flatMap((arg) =>
      arg.type === "named"
        ? [arg.name, ...(arg.value ? [arg.value] : [])]
        : [arg.value],
    ),
  ],
});

#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createSlothHubMcpServer } from './server.js';

export { createSlothHubMcpServer } from './server.js';

export const main = async (
  startServer: typeof serveStdio = serveStdio,
): Promise<void> => {
  startServer(() => createSlothHubMcpServer());
};

export const isDirectExecution = (
  moduleUrl: string,
  entryPath: string | undefined,
): boolean => {
  if (!entryPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
};

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

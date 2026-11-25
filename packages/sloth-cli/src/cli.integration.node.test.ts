import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, inject, it } from 'vite-plus/test';

declare module 'vite-plus/test' {
  interface ProvidedContext {
    builtArtifactsReady: boolean;
  }
}

import {buildProjectToolPinManifest, serializeProjectToolPinManifest} from '@slothhub/domain/project-tool-pin-manifest';
import {renderDecisionReceiptMarkdown, serializeDecisionReceiptJson} from '@slothhub/domain/decision-receipt';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryPath = join(packageDirectory, 'dist/bin/slothhub.js');

const receiptJson = serializeDecisionReceiptJson({
  schemaVersion: '1',
  receiptId: 'subprocess-receipt',
  createdAt: '2026-07-22T18:00:00.000Z',
  catalogSnapshotAt: '2026-07-22T17:00:00.000Z',
  versions: { catalog: '2026-07-22', producer: 'integration-test@1', schema: '1' },
  requirements: [{ id: 'security', text: 'Security', state: 'not_evaluated' }],
  criteria: [{ id: 'security', label: 'Security' }],
  candidates: [
    {
      tool: { id: 'tool:figma', slug: 'figma', name: 'Figma' },
      evaluations: [{ criterionId: 'security', state: 'unknown' }],
      facts: [{ key: 'pricing', label: 'Pricing', state: 'unknown' }],
    },
  ],
  selectedTool: null,
  rejectedCandidates: [],
  rationale: 'Still evaluating.',
  tradeoffs: [],
  citations: [],
  extensions: {},
});

const runBinary = async (
  args: string[],
  options: { cwd: string; stdin?: string; env?: NodeJS.ProcessEnv },
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binaryPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(options.stdin);
  });

beforeAll(async () => {
  // Raw Vitest invocations still prepare fresh artifacts. The checked task
  // graph has already built them and must not restore the shared domain twice.
  if (inject('builtArtifactsReady') === true) return;
  const build = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build', '--silent'],
    { cwd: packageDirectory, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  await new Promise<void>((resolve, reject) => {
    build.on('error', reject);
    build.on('close', (exitCode) => {
      if (exitCode === 0) resolve();
      else reject(new Error(`CLI build exited with status ${exitCode ?? 'unknown'}.`));
    });
  });
  // The readiness run exceeded the 30 s build guard (30.152 s, 2026-10-22).
  // A minute allows twice that observed loaded-build time.
}, 60_000);

// Four subprocess workflows exceeded the 5 s unit-test default on 2026-10-22.
// Allow twice the production feed deadline for multi-process workflows.
describe('built SlothHub CLI', {timeout: 30_000}, () => {
  it('prints help without loading the YAML setup and inventory runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-help-'));
    try {
      const loader = join(directory, 'help-loader.mjs');
      await writeFile(loader, `export async function resolve(specifier, context, next) {
        if (specifier === 'yaml') throw new Error('Help loaded the YAML command runtime');
        return next(specifier, context);
      }`);
      const result = await runBinary(['--help'], {cwd: directory, env: {
        ...process.env, NODE_OPTIONS: `--no-warnings --experimental-loader=${pathToFileURL(loader).href}`,
      }});
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: slothhub <command>');
      expect(result.stderr).toBe('');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('reads real stdin and a real file, then writes rendered output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-receipt-'));
    try {
      const sourcePath = join(directory, 'receipt.json');
      const outputPath = join(directory, 'receipt.md');
      await writeFile(sourcePath, receiptJson);

      const validated = await runBinary(['receipt', 'validate', '-'], {
        cwd: directory,
        stdin: receiptJson,
      });
      const rendered = await runBinary(['receipt', 'render', sourcePath, '--output', outputPath], {
        cwd: directory,
      });

      expect(validated).toEqual({
        exitCode: 0,
        stdout: 'Valid decision receipt subprocess-receipt (schema 1).\n',
        stderr: '',
      });
      expect(rendered).toEqual({ exitCode: 0, stdout: '', stderr: `Wrote ${outputPath}\n` });
      expect(await readFile(outputPath, 'utf8')).toContain('SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves existing output unless force is explicit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-receipt-'));
    try {
      const sourcePath = join(directory, 'receipt.json');
      const outputPath = join(directory, 'receipt.md');
      await writeFile(sourcePath, receiptJson);
      await writeFile(outputPath, 'existing\n');

      const refused = await runBinary(['receipt', 'render', sourcePath, '--output', outputPath], {
        cwd: directory,
      });

      expect(refused.exitCode).toBe(1);
      expect(refused.stdout).toBe('');
      expect(refused.stderr).toContain('Refusing to overwrite existing file');
      expect(await readFile(outputPath, 'utf8')).toBe('existing\n');

      const forced = await runBinary(['receipt', 'render', sourcePath, '--output', outputPath, '--force'], {
        cwd: directory,
      });

      expect(forced.exitCode).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toContain('SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports malformed input and invalid receipt flags through the process boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-receipt-'));
    try {
      const malformedPath = join(directory, 'malformed.json');
      await writeFile(malformedPath, '{not json');

      const malformed = await runBinary(['receipt', 'validate', malformedPath], {
        cwd: directory,
      });
      const invalidFlags = await runBinary(['receipt', 'render', malformedPath, '--json'], {
        cwd: directory,
      });

      expect(malformed.exitCode).toBe(1);
      expect(malformed.stdout).toBe('');
      expect(malformed.stderr).not.toBe('');
      expect(invalidFlags).toMatchObject({exitCode: 2, stderr: ''});
      expect(JSON.parse(invalidFlags.stdout)).toMatchObject({
        ok: false,
        code: 'invalid_input',
        message: '--json is not supported by receipt render.',
        recovery: expect.any(String),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('validates every artifact a live compare visitor can download', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slothhub-cli-compare-'));
    try {
      const receiptMarkdown = renderDecisionReceiptMarkdown(JSON.parse(receiptJson));
      const manifest = serializeProjectToolPinManifest(buildProjectToolPinManifest({
        producer: { name: 'slothhub-web', version: '0.1.0' },
        createdAt: '2026-07-22T18:00:00.000Z',
        provenance: {
          catalogFeedVersion: '1.2.0',
          catalogGeneratedAt: '2026-07-22T17:00:00.000Z',
          catalogRevision: `sha256:${'a'.repeat(64)}`,
        },
        source: { kind: 'saved_list', id: 'compare', name: 'Current compare' },
        tools: [
          {
            slug: 'figma',
            detailUrl: 'https://slothhub.dev/tool/figma',
            snapshot: {
              name: 'Figma',
              resourceKind: 'app',
              resourceIdentity: { kind: 'website', url: 'https://figma.example.com/' },
            },
            agentInterfaces: [{ kind: 'api', status: 'official', identifier: 'figma-api' }],
            citations: ['https://slothhub.dev/tool/figma'],
          },
        ],
      }));
      const jsonPath = join(directory, 'receipt.json');
      const markdownPath = join(directory, 'receipt.md');
      const manifestPath = join(directory, 'slothhub.tools.json');
      await writeFile(jsonPath, receiptJson);
      await writeFile(markdownPath, receiptMarkdown);
      await writeFile(manifestPath, manifest);

      const validatedJson = await runBinary(['receipt', 'validate', jsonPath], { cwd: directory });
      const validatedMarkdown = await runBinary(['receipt', 'validate', markdownPath], {
        cwd: directory,
      });
      const validatedManifest = await runBinary(['manifest', 'validate', manifestPath], {
        cwd: directory,
      });

      expect(validatedJson).toEqual({
        exitCode: 0,
        stdout: 'Valid decision receipt subprocess-receipt (schema 1).\n',
        stderr: '',
      });
      expect(validatedMarkdown).toEqual({
        exitCode: 0,
        stdout: 'Valid decision receipt subprocess-receipt (schema 1).\n',
        stderr: '',
      });
      expect(validatedManifest).toEqual({
        exitCode: 0,
        stdout: 'Valid Project Tool pin manifest v4 with 1 tool.\n',
        stderr: '',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

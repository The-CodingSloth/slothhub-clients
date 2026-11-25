#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {assertProvenanceEligible, readProvenanceEligibility} from './provenance-eligibility.mjs';

import {
  assertMcpParity,
  assertPackedFiles,
  assertPackedImportsDeclared,
  assertPackedManifest,
  assertReleaseMetadata,
  assertToolVersion,
  npmRegistry,
  parseNpmPublishDryRun,
  parseReleaseTag,
  releaseTargets,
  workspacePackages,
} from './release-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_PACKAGE_FILES = 500;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MCP_SMOKE_OUTPUT_BYTES = 256 * 1024;
const MCP_SMOKE_TIMEOUT_MS = 10_000;
const MCP_TERMINATION_GRACE_MS = 1_000;

const fail = (message) => {
  throw new Error(message);
};

const parseArguments = (arguments_) => {
  const values = {releaseMode: undefined, workspacePrerequisites: false};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--workspace-prerequisites') {
      values.workspacePrerequisites = true;
      continue;
    }
    if (argument === '--dry-run' || argument === '--tagged-release') {
      if (values.releaseMode) fail('Choose exactly one release mode.');
      values.releaseMode = argument === '--tagged-release' ? 'tagged' : 'dry-run';
      continue;
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value.`);
    if (argument === '--tag') values.tag = value;
    else if (argument === '--output') values.output = resolve(value);
    else fail(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (!values.tag) fail('--tag is required.');
  if (!values.output) fail('--output is required.');
  if (!values.releaseMode) fail('Choose exactly one release mode: --dry-run or --tagged-release.');
  if (values.releaseMode === 'tagged' && values.workspacePrerequisites) {
    fail('--workspace-prerequisites is available only in dry-run mode.');
  }
  return values;
};

const run = (command, arguments_, options = {}) => {
  const {capture = false, timeout = COMMAND_TIMEOUT_MS, ...execOptions} = options;
  return (
  execFileSync(command, arguments_, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    ...execOptions,
  }) ?? ''
  );
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const gitStatus = () =>
  run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {capture: true});

const packTarget = (target, destination) => {
  mkdirSyncSafe(destination);
  const before = new Set(readdirSync(destination));
  run('pnpm', ['pack', '--pack-destination', destination], {
    cwd: join(repoRoot, target.directory),
  });
  const archives = readdirSync(destination).filter(
    (entry) => entry.endsWith('.tgz') && !before.has(entry),
  );
  if (archives.length !== 1) {
    fail(`Expected exactly one tarball for ${target.packageName}; received ${archives.length}.`);
  }
  return join(destination, archives[0]);
};

const listFiles = (directory) => readdirSync(directory, {withFileTypes: true}).flatMap((entry) =>
  entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)]);

const assertTarballImportsDeclared = async (tarball, packedManifest) => {
  const directory = await mkdtemp(join(tmpdir(), 'slothhub-release-imports-'));
  try {
    run('tar', ['-xzf', tarball, '-C', directory]);
    const packageRoot = join(directory, 'package');
    const files = listFiles(packageRoot)
      .filter((path) => path.endsWith('.js') || path.endsWith('.d.ts'))
      .map((path) => ({path: path.slice(packageRoot.length + 1), text: readFileSync(path, 'utf8')}));
    assertPackedImportsDeclared({manifest: packedManifest, files});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
};

const mkdirSyncSafe = (path) => {
  mkdirSync(path, {recursive: true});
};

const smokeMcpServer = (binaryPath, cwd, expectedVersion) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(binaryPath, [], {cwd, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let stopRequested = false;
    let validated = false;
    let pendingError;
    let killTimer;

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      if (error) reject(error);
      else resolvePromise();
    };

    const requestStop = (error) => {
      pendingError ??= error;
      if (stopRequested) return;
      stopRequested = true;
      clearTimeout(timeoutTimer);
      child.stdin.end();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, MCP_TERMINATION_GRACE_MS);
    };

    const appendOutput = (current, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_MCP_SMOKE_OUTPUT_BYTES) {
        requestStop(
          new Error(`MCP install smoke exceeded ${MAX_MCP_SMOKE_OUTPUT_BYTES} output bytes.`),
        );
        return current;
      }
      return current + chunk.toString();
    };

    const timeoutTimer = setTimeout(() => {
      requestStop(new Error(`MCP install smoke timed out. stderr: ${stderr}`));
    }, MCP_SMOKE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk);
      if (stopRequested) return;
      for (const line of stdout.split('\n')) {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            if (message.result?.serverInfo?.version !== expectedVersion) {
              requestStop(new Error('Installed MCP server reported the wrong package version.'));
            } else {
              validated = true;
              requestStop();
            }
            return;
          }
        } catch {
          // Wait for a complete JSON line.
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once('error', (error) => settle(error));
    child.once('exit', (code, signal) => {
      if (pendingError) settle(pendingError);
      else if (validated) settle();
      else settle(new Error(`MCP install smoke exited ${code ?? signal ?? 'unknown'}: ${stderr}`));
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {name: 'release-smoke', version: '1.0.0'},
        },
      })}\n`,
    );
  });

const smokeInstall = async ({target, version, tarball, workspacePrerequisites}) => {
  const directory = await mkdtemp(join(tmpdir(), 'slothhub-release-smoke-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
    if (target.workspacePrerequisite && !target.bundledWorkspacePrerequisite && workspacePrerequisites) {
      const prerequisite = releaseTargets[target.workspacePrerequisite];
      const prerequisiteDirectory = join(directory, 'prerequisite');
      await mkdir(prerequisiteDirectory);
      const prerequisiteArchive = packTarget(prerequisite, prerequisiteDirectory);
      run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--no-package-lock',
          `--registry=${npmRegistry}`,
          prerequisiteArchive,
        ],
        {cwd: directory},
      );
    }
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        `--registry=${npmRegistry}`,
        tarball,
      ],
      {cwd: directory},
    );

    if (target.key === 'domain') {
      run(
        'node',
        ['--input-type=module', '--eval', "const api=await import('@slothhub/domain');if(!api.resolveResourceIdentity)process.exit(1)"],
        {cwd: directory},
      );
    } else if (target.key === 'cli') {
      const binary = join(directory, 'node_modules', '.bin', 'slothhub');
      const output = run(binary, ['--version'], {cwd: directory, capture: true}).trim();
      if (output !== version) fail(`Installed CLI reported ${output}; expected ${version}.`);
    } else {
      const packageRoot = join(directory, 'node_modules', target.packageName);
      const installedManifest = readJson(join(packageRoot, 'package.json'));
      const serverManifest = readJson(join(packageRoot, 'server.json'));
      assertMcpParity(installedManifest, serverManifest);
      await smokeMcpServer(
        join(directory, 'node_modules', '.bin', 'slothhub-mcp-server'),
        directory,
        version,
      );
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const {key, version} = parseReleaseTag(options.tag);
  const target = releaseTargets[key];
  if (options.releaseMode === 'tagged' && !target.taggedPublicationEnabled) {
    fail(`${target.packageName} tagged publication is disabled until the platform is public.`);
  }
  const provenance = readProvenanceEligibility(process.env.GITHUB_EVENT_PATH);
  if (options.releaseMode === 'tagged') assertProvenanceEligible(provenance);
  const packageRoot = join(repoRoot, target.directory);
  const manifest = readJson(join(packageRoot, 'package.json'));
  const lockfileText = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const changelogText = readFileSync(join(packageRoot, 'CHANGELOG.md'), 'utf8');

  assertToolVersion(process.versions.node, '22.14.0', 'Node.js');
  assertToolVersion(run('npm', ['--version'], {capture: true}).trim(), '11.15.0', 'npm');
  assertReleaseMetadata({target, version, manifest, lockfileText, changelogText});
  if (target.key === 'mcp') {
    assertMcpParity(manifest, readJson(join(packageRoot, 'server.json')));
  }

  const initialStatus = gitStatus();
  if (initialStatus && process.env.RELEASE_ALLOW_DIRTY !== '1') {
    fail('Release preparation requires a clean checkout. Commit version, changelog, lockfile, and generated metadata first.');
  }

  run('pnpm', ['--filter', workspacePackages.domain.packageName, 'build']);
  run('pnpm', ['--filter', target.packageName, 'test']);
  run('pnpm', ['--filter', target.packageName, 'type-check']);
  run('pnpm', ['--filter', target.packageName, 'build']);
  if (gitStatus() !== initialStatus) {
    fail('Build or tests changed tracked/generated files. Commit the generated result before releasing.');
  }

  await mkdir(options.output, {recursive: true});
  if (readdirSync(options.output).length > 0) fail('Release output directory must be empty.');
  const tarball = packTarget(target, options.output);
  const packedManifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json'], {capture: true}));
  assertPackedManifest({target, version, manifest: packedManifest});
  await assertTarballImportsDeclared(tarball, packedManifest);
  if (target.workspacePrerequisite && !target.bundledWorkspacePrerequisite) {
    const prerequisite = releaseTargets[target.workspacePrerequisite];
    const prerequisiteVersion = readJson(join(repoRoot, prerequisite.directory, 'package.json')).version;
    if (packedManifest.dependencies?.[prerequisite.packageName] !== prerequisiteVersion) {
      fail(`Packed prerequisite must resolve to ${prerequisite.packageName}@${prerequisiteVersion}.`);
    }
  }

  const dryRunOutput = run(
    'npm',
    [
      'publish',
      '--dry-run',
      '--json',
      '--access',
      'public',
      '--tag',
      'latest',
      `--registry=${npmRegistry}`,
      tarball,
    ],
    {capture: true},
  );
  const dryRunJson = JSON.parse(dryRunOutput);
  const dryRun = parseNpmPublishDryRun(dryRunJson, target.packageName);
  const files = dryRun?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PACKAGE_FILES) {
    fail(`Publish dry run must contain 1-${MAX_PACKAGE_FILES} files.`);
  }
  assertPackedFiles({target, files});

  const bytes = statSync(tarball).size;
  if (bytes > target.maxTarballBytes) {
    fail(`Tarball is ${bytes} bytes; ${target.packageName} is limited to ${target.maxTarballBytes}.`);
  }
  const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  await smokeInstall({
    target,
    version,
    tarball,
    workspacePrerequisites: options.workspacePrerequisites,
  });

  const artifactName = `npm-${target.key}-${version}`;
  const releaseManifest = {
    schemaVersion: 1,
    releaseMode: options.releaseMode,
    provenance,
    tag: options.tag,
    package: target.packageName,
    version,
    environment: target.environment,
    registry: npmRegistry,
    distTag: 'latest',
    tarball: basename(tarball),
    sha256,
    bytes,
    fileCount: files.length,
    files: files.map(({path, size}) => ({path, size})),
    nodeVersion: process.versions.node,
    npmVersion: run('npm', ['--version'], {capture: true}).trim(),
  };
  writeFileSync(join(options.output, 'npm-publish-dry-run.json'), `${JSON.stringify(dryRun, null, 2)}\n`);
  writeFileSync(join(options.output, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `artifact_name=${artifactName}`,
        `environment=${target.environment}`,
        `package_name=${target.packageName}`,
        `tarball=${basename(tarball)}`,
        `version=${version}`,
        `sha256=${sha256}`,
        `tag=${options.tag}`,
      ].join('\n') + '\n',
      {flag: 'a'},
    );
  }
  process.stdout.write(`${JSON.stringify(releaseManifest, null, 2)}\n`);
};

await main();

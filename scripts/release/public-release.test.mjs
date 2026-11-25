// Release contract of the public client repository: the packages, workflow
// and workspace settings that npm trusted publishing and provenance depend on.

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {parse} from 'yaml';

import {
  assertReleaseMetadata,
  parseReleaseTag,
  releaseRepository,
  releaseTargets,
  workspacePackages,
} from './release-lib.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const releaseWorkflow = parse(read('.github/workflows/release-npm.yml'));
const ciWorkflow = parse(read('.github/workflows/ci.yml'));
const lockfileText = read('pnpm-lock.yaml');

test('each published package names this repository exactly, as provenance requires', () => {
  assert.equal(releaseRepository, 'The-CodingSloth/slothhub-clients');
  for (const target of Object.values(releaseTargets)) {
    const manifest = JSON.parse(read(`${target.directory}/package.json`));
    assert.doesNotThrow(() => assertReleaseMetadata({
      target,
      version: manifest.version,
      manifest,
      lockfileText,
      changelogText: read(`${target.directory}/CHANGELOG.md`),
    }));
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.homepage, `https://github.com/${releaseRepository}/tree/main/${target.directory}#readme`);
    assert.equal(manifest.bugs?.url, `https://github.com/${releaseRepository}/issues`);
    assert.ok(manifest.files.includes('LICENSE'), `${target.packageName} ships its licence`);
  }
  const server = JSON.parse(read('packages/slothhub-mcp-server/server.json'));
  assert.equal(server.repository.url, `https://github.com/${releaseRepository}`);
});

test('the shared domain package stays private and only the two clients can be tagged', () => {
  const domain = JSON.parse(read(`${workspacePackages.domain.directory}/package.json`));
  assert.equal(domain.private, true);
  assert.deepEqual(Object.keys(releaseTargets).sort(), ['cli', 'mcp']);
  for (const target of Object.values(releaseTargets)) assert.equal(target.taggedPublicationEnabled, true);
  assert.deepEqual(parseReleaseTag('npm-cli-v1.2.3'), {key: 'cli', version: '1.2.3'});
  assert.throws(() => parseReleaseTag('npm-domain-v1.2.3'), /Invalid release tag/u);
});

test('tag triggers match the enabled release targets', () => {
  const tags = releaseWorkflow.on.push.tags;
  assert.deepEqual([...tags].sort(), Object.values(releaseTargets).map(({tagPrefix}) => `${tagPrefix}*`).sort());
});

test('only the staging job can request an OIDC token, and nothing reads an npm token', () => {
  assert.deepEqual(releaseWorkflow.permissions, {contents: 'read'});
  const writers = Object.entries(releaseWorkflow.jobs)
    .filter(([, job]) => job.permissions?.['id-token'] === 'write').map(([name]) => name);
  assert.deepEqual(writers, ['publish']);
  assert.deepEqual(releaseWorkflow.jobs.publish.permissions, {'id-token': 'write'});
  const text = read('.github/workflows/release-npm.yml');
  assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./u);
  const commands = releaseWorkflow.jobs.publish.steps.flatMap((step) => (step.run ? [step.run] : []));
  assert.equal(commands.filter((command) => /npm stage publish/u.test(command)).length, 1);
  assert.ok(commands.every((command) => !/(?:^|\s)npm publish\b/u.test(command)));
});

test('every job that installs dependencies disables install scripts', () => {
  for (const workflow of [releaseWorkflow, ciWorkflow]) {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.run || !/\bpnpm install\b/u.test(step.run)) continue;
        assert.match(step.run, /--frozen-lockfile/u, `${name}: ${step.name}`);
        assert.match(step.run, /--ignore-scripts/u, `${name}: ${step.name}`);
      }
    }
  }
});

test('actions are pinned to full commit SHAs and no workflow runs fork code with privileges', () => {
  for (const [file, workflow] of [['release-npm.yml', releaseWorkflow], ['ci.yml', ciWorkflow]]) {
    assert.ok(!('pull_request_target' in workflow.on), `${file} must not use pull_request_target`);
    assert.ok(!('workflow_run' in workflow.on), `${file} must not use workflow_run`);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, `${file}: ${step.uses}`);
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with?.['persist-credentials'], false);
      }
    }
  }
  assert.deepEqual(ciWorkflow.permissions, {contents: 'read'});
});

test('the workspace waits three days before a new dependency version can be locked', () => {
  const workspace = parse(read('pnpm-workspace.yaml'));
  assert.ok(workspace.minimumReleaseAge >= 3 * 24 * 60, `minimumReleaseAge=${workspace.minimumReleaseAge}`);
  assert.ok(!('minimumReleaseAgeExclude' in workspace), 'no package is exempt from the release-age wait');
  for (const [name, allowed] of Object.entries(workspace.allowBuilds ?? {})) assert.equal(allowed, false, name);
});

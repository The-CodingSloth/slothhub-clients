import assert from 'node:assert/strict';
import spawn from 'cross-spawn';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {z} from 'zod';
import {canonicalContentHashInput, canonicalIndexContentHashInput} from '@slothhub/domain/content-hash';
import {CATALOG_FEED_SUPPORTED_MAJORS, SEARCH_INDEX_SUPPORTED_MAJORS} from '@slothhub/domain/feed-compatibility';
import {PUBLIC_FEED_MAX_BYTES, PUBLIC_FEED_TIMEOUT_MS} from '@slothhub/domain/public-feed-transport';

// Build the domain, CLI and MCP packages first. This installs the CLI and MCP
// tarballs in an empty consumer, never publishes, and exercises the installed
// binaries over TCP/stdio. Both bundle @slothhub/domain, so it is not installed.
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.argv[2];
const startedAt = performance.now();
const temporaryRoot = await mkdtemp(join(tmpdir(), 'slothhub-client-readiness-'));
// npm writes each bin's Windows .cmd shim with an unquoted `SET dp0=%~dp0`, so
// an `&` (cmd.exe's command separator) anywhere above node_modules\.bin splits
// that line and the shim runs a path fragment instead of the bin. Every npm bin
// fails that way, whatever the package. On Windows the install path keeps
// spaces, Unicode and the parentheses of "Program Files (x86)"; the `&` moves to
// the CLI cache directory, which the clients' own code reads and writes.
const directory = join(temporaryRoot, process.platform === 'win32'
  ? 'Client workspace 空格 (x86) tools' : 'Client workspace 空格 & tools');
const cacheHome = join(directory, 'cache 空格 & state');
await mkdir(directory);
const requireMcp = createRequire(join(root, 'packages/slothhub-mcp-server/package.json'));
const {Client} = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client')).href);
const {StdioClientTransport} = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client/stdio')).href);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const hash = (body) => `sha256:${digest(canonicalContentHashInput(body))}`;
const jsonObject = z.record(z.string(), z.json());
const searchFixtureSchema = z.object({data: z.object({tools: z.array(jsonObject), filters: jsonObject, queryContract: jsonObject})});
const detailFixtureSchema = z.object({data: jsonObject});
// Public feed snapshots, kept beside this script so the public client
// repository can run the same check: /api/index.json and
// /api/search-index.json from 2026-10-15, and the current-contract Figma
// /api/tools/figma.json detail retained by the 2026-11-10 MCP evaluation packet.
const fixturePaths = {
  index: 'scripts/benchmarks/client-readiness-fixtures/index.json',
  detail: 'scripts/benchmarks/client-readiness-fixtures/tool-detail-figma.json',
  search: 'scripts/benchmarks/client-readiness-fixtures/search-index.json',
};
const fixtures = {};
const inputs = {};
for (const [name, path] of Object.entries(fixturePaths)) {
  const body = await readFile(join(root, path), 'utf8');
  fixtures[name] = jsonObject.parse(JSON.parse(body));
  inputs[path] = {bytes: Buffer.byteLength(body), sha256: digest(body)};
}
const originalSearch = searchFixtureSchema.parse(fixtures.search);
const originalDetail = detailFixtureSchema.parse(fixtures.detail);
const measurements = [];
const checks = [];
const run = (command, args, options = {}) => new Promise((resolveRun, reject) => {
  const started = performance.now();
  const {commandBudgetMs, input, closeOutput, ...spawnOptions} = options;
  const child = spawn(command, args, {cwd: directory, env: process.env, ...spawnOptions,
    // The existing release command guard is ten minutes. Individual CLI runs
    // get three existing feed deadlines: startup, request, and orderly exit.
    signal: AbortSignal.timeout(commandBudgetMs ?? 10 * 60 * 1000), stdio: 'pipe'});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (part) => {stdout += part;});
  if (closeOutput) child.stdout.destroy();
  child.stderr.setEncoding('utf8').on('data', (part) => {stderr += part;});
  child.once('error', reject);
  child.once('close', (code) => resolveRun({code, stdout, stderr, elapsedMs: performance.now() - started}));
  child.stdin.on('error', reject);
  child.stdin.end(input);
});
const command = async (executable, args, options) => {
  const result = await run(executable, args, options);
  assert.equal(result.code, 0, `${executable} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result;
};
const record = (name, details = {}) => {checks.push({name, ...details}); console.log(`PASS ${name}`);};
let routes = new Map();
let mode = 'healthy';
let hold;
const requests = [];
let rejectedBodiesClosed = 0;
const server = createServer((request, response) => {
  const path = request.url;
  requests.push(path);
  response.setHeader('content-type', 'application/json');
  if (path === '/api/index.json' && mode === 'missing-index') {
    response.writeHead(404); response.end('{}'); return;
  }
  if (path === '/api/search-index.json' && mode === 'unavailable') {
    response.writeHead(503);
    response.write('upstream unavailable');
    response.once('close', () => {rejectedBodiesClosed += 1;});
    return;
  }
  if (path === '/api/search-index.json' && mode === 'oversize') {
    response.setHeader('content-length', PUBLIC_FEED_MAX_BYTES + 1);
    response.flushHeaders();
    return;
  }
  const body = routes.get(path);
  if (!body) {response.writeHead(404); response.end('{}'); return;}
  const serialized = JSON.stringify(body);
  if (hold && path === '/api/tools/fixture-0.json') {
    hold.started();
    hold.releases.push(() => response.end(serialized));
    return;
  }
  response.end(path === '/api/search-index.json' && mode === 'corrupt'
    ? serialized.replace('Café design', 'Tampered name') : serialized);
});

// The retained 2026-10-15 index and search receipts predate the current feed
// majors, and clients accept only the current producer contract. Their bodies
// pass the current schemas, so serve them under the current majors; the
// installed clients still validate every body with their full feed schemas.
const catalogFeedVersion = `${CATALOG_FEED_SUPPORTED_MAJORS[0]}.0.0`;
const searchIndexVersion = `${SEARCH_INDEX_SUPPORTED_MAJORS[0]}.0.0`;
const populate = (count) => {
  const revision = `sha256:${digest(`readiness-${count}`)}`;
  const tools = Array.from({length: count}, (_, index) => {
    const source = originalSearch.data.tools[index % originalSearch.data.tools.length];
    return {...source, name: index === 0 ? 'Café design' : `Fixture ${index}`, slug: `fixture-${index}`,
      detailUrl: `https://slothhub.dev/tool/fixture-${index}`,
      visitUrl: `https://slothhub.dev/go/fixture-${index}?surface=agent`,
      search: {text: index === 0 ? 'Café design visual collaboration' : `Fixture ${index} developer software`}};
  });
  routes = new Map();
  for (let index = 0; index < 8; index += 1) {
    const body = {...fixtures.detail, siteUrl: 'https://slothhub.dev', catalogRevision: revision,
      data: {...originalDetail.data, name: tools[index].name, slug: tools[index].slug,
        description: tools[index].description, detailUrl: tools[index].detailUrl, visitUrl: tools[index].visitUrl}};
    routes.set(`/api/tools/fixture-${index}.json`, {...body, contentHash: hash(body)});
  }
  const searchBody = {...fixtures.search, version: searchIndexVersion, siteUrl: 'https://slothhub.dev', catalogRevision: revision,
    data: {...originalSearch.data, tools, articles: []}};
  routes.set('/api/search-index.json', {...searchBody, contentHash: hash(searchBody)});
  const indexBody = {...fixtures.index, version: catalogFeedVersion, siteUrl: 'https://slothhub.dev', catalogRevision: revision,
    contentHashes: Object.fromEntries([...routes].map(([path, body]) => [path, body.contentHash]))};
  const contentHash = `sha256:${digest(canonicalIndexContentHashInput(indexBody))}`;
  routes.set('/api/index.json', {...indexBody, contentHash,
    contentHashes: {...indexBody.contentHashes, '/api/index.json': contentHash}});
};

let baseUrl;
let cliPath;
let mcpPath;
const cli = async (args, expectedCode = 0) => {
  const result = await run(process.execPath, [cliPath, ...args, '--base-url', baseUrl, '--json'], {
    env: {...process.env, XDG_CACHE_HOME: cacheHome}, commandBudgetMs: 3 * PUBLIC_FEED_TIMEOUT_MS,
  });
  assert.equal(result.code, expectedCode, result.stderr || result.stdout);
  const parsed = jsonObject.parse(JSON.parse(result.stdout || result.stderr));
  measurements.push({surface: 'cli', command: args.join(' '), elapsedMs: result.elapsedMs});
  return parsed;
};
const connect = async (useNpmShim = false) => {
  const client = new Client({name: 'packed-readiness', version: '1.0.0'});
  const transport = new StdioClientTransport({
    command: useNpmShim ? 'npm' : process.execPath,
    args: useNpmShim ? ['exec', '--offline', '--no', '--', 'slothhub-mcp-server'] : [mcpPath], cwd: directory,
    env: {SLOTHHUB_BASE_URL: baseUrl}, stderr: 'pipe'});
  const started = performance.now();
  await client.connect(transport, {timeout: PUBLIC_FEED_TIMEOUT_MS});
  measurements.push({surface: 'mcp', command: 'cold initialize', elapsedMs: performance.now() - started});
  return client;
};
const call = async (client, name, args = {}, options = {}) => {
  const started = performance.now();
  // search and fetch always answer in JSON; fetch's strict schema rejects response_format.
  const result = await client.callTool({name, arguments: args},
    {timeout: PUBLIC_FEED_TIMEOUT_MS, ...options});
  const parsed = z.object({isError: z.boolean().optional(), structuredContent: jsonObject,
    content: z.array(z.looseObject({type: z.string(), text: z.string().optional()}))}).parse(result);
  assert.deepEqual(jsonObject.parse(JSON.parse(parsed.content[0].text)), parsed.structuredContent);
  measurements.push({surface: 'mcp', command: name, elapsedMs: performance.now() - started,
    bytes: Buffer.byteLength(JSON.stringify(result))});
  return parsed;
};

try {
  await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  const packages = ['sloth-cli', 'slothhub-mcp-server'];
  for (const name of packages) await command('pnpm', ['pack', '--pack-destination', directory], {cwd: join(root, 'packages', name)});
  const tarballs = (await readdir(directory)).filter((name) => name.endsWith('.tgz'));
  const installation = await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', ...tarballs.map((name) => join(directory, name))]);
  const installedPackages = await Promise.all([
    '@slothhub/cli', 'slothhub-mcp-server',
    '@modelcontextprotocol/server', 'yaml', 'zod', 'split2',
  ].map(async (name) => z.object({name: z.string(), version: z.string()})
    .parse(JSON.parse(await readFile(join(directory, 'node_modules', name, 'package.json'), 'utf8')))));
  await assert.rejects(stat(join(directory, 'node_modules/@slothhub/domain')), {code: 'ENOENT'},
    'installed CLI and MCP packages must not need a separate @slothhub/domain install');
  cliPath = join(directory, 'node_modules/@slothhub/cli/dist/bin/slothhub.js');
  mcpPath = join(directory, 'node_modules/slothhub-mcp-server/dist/index.js');
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = z.object({port: z.number()}).parse(server.address());
  baseUrl = `http://127.0.0.1:${address.port}`;
  record('clean npm tarball installation', {tarballs: await Promise.all(tarballs.map(async (name) =>
    ({name, bytes: (await stat(join(directory, name))).size, sha256: digest(await readFile(join(directory, name)))})))});

  const shim = await command('npm', ['exec', '--offline', '--no', '--', 'slothhub', '--version']);
  assert.equal(shim.stdout.trim(), installedPackages.find(({name}) => name === '@slothhub/cli').version);
  const shimClient = await connect(true);
  try {
    const shimTools = (await shimClient.listTools()).tools.map(({name}) => name);
    assert.ok(shimTools.includes('search') && shimTools.includes('fetch'), shimTools.join(', '));
  } finally {await shimClient.close();}
  record('npm CLI and MCP shims run from a path containing spaces, Unicode and shell metacharacters');

  const receiptPath = 'packages/domain/src/__fixtures__/decision-receipt-v1.golden.json';
  const receiptSource = await readFile(join(root, receiptPath), 'utf8');
  inputs[receiptPath] = {bytes: Buffer.byteLength(receiptSource), sha256: digest(receiptSource)};
  const validation = await command(process.execPath, [cliPath, 'receipt', 'validate', '-', '--json'], {input: receiptSource});
  assert.deepEqual(jsonObject.parse(JSON.parse(validation.stdout)), jsonObject.parse(JSON.parse(receiptSource)));
  record('installed CLI reads piped decision artifacts without catalog access');
  const closedPipe = await command(process.execPath, [cliPath, '--help'], {closeOutput: true});
  assert.equal(closedPipe.stderr, '');
  record('installed CLI exits cleanly when its output pipe closes');

  for (const count of [90, 1000]) {
    populate(count);
    const found = await cli(['search', 'cafe']);
    assert.equal(found.count, 1);
    assert.equal(found.results[0].slug, 'fixture-0');
    const cliPage = await cli(['search', '--limit', '50', '--offset', '50']);
    assert.equal(cliPage.total, count);
    assert.equal(cliPage.results[0].slug, 'fixture-50');
    assert.equal(cliPage.count, Math.min(50, count - 50));
    const client = await connect();
    try {
      const listed = await client.listTools({}, {timeout: PUBLIC_FEED_TIMEOUT_MS});
      assert.ok(listed.tools.some(({name}) => name === 'search'));
      const result = await call(client, 'search', {query: 'cafe'});
      assert.ok(!result.isError);
      assert.equal(result.structuredContent.total, 1);
      assert.equal(result.structuredContent.results[0].slug, found.results[0].slug);
      assert.equal(result.structuredContent.results[0].id, found.results[0].slug);
      const page = await call(client, 'search', {limit: 50, offset: 50});
      assert.equal(page.structuredContent.total, count);
      assert.equal(page.structuredContent.results[0].slug, 'fixture-50');
      assert.equal(page.structuredContent.count, Math.min(50, count - 50));
      assert.deepEqual(page.structuredContent.results.map(({slug}) => slug), cliPage.results.map(({slug}) => slug));
      record('installed CLI/MCP search parity, Unicode and pagination', {tools: count,
        searchBytes: Buffer.byteLength(JSON.stringify(routes.get('/api/search-index.json')))});
    } finally {await client.close();}
  }

  requests.length = 0;
  const unusableCache = join(directory, 'cache directory is a file');
  await writeFile(unusableCache, 'unrelated file');
  const uncached = await command(process.execPath, [cliPath, 'tool', 'fixture-0', '--base-url', baseUrl, '--json'], {
    env: {...process.env, XDG_CACHE_HOME: unusableCache}, commandBudgetMs: 3 * PUBLIC_FEED_TIMEOUT_MS,
  });
  assert.equal(jsonObject.parse(JSON.parse(uncached.stdout)).slug, 'fixture-0');
  assert.deepEqual(requests, ['/api/index.json', '/api/tools/fixture-0.json']);
  assert.equal(await readFile(unusableCache, 'utf8'), 'unrelated file');
  record('unusable OS cache falls back to authenticated network data');

  mode = 'missing-index';
  // Transport failures use the documented retry-later exit code.
  const missingIndex = await cli(['tool', 'fixture-0'], 5);
  assert.equal(missingIndex.code, 'transport');
  assert.equal(missingIndex.path, '/api/index.json');
  mode = 'healthy';
  record('missing catalog index is a transport failure for a Tool command');

  requests.length = 0;
  const cold = await Promise.all(Array.from({length: 8}, (_, index) => cli(['tool', `fixture-${index}`])));
  cold.forEach((tool, index) => assert.equal(tool.slug, `fixture-${index}`));
  assert.equal(requests.filter((path) => path.startsWith('/api/tools/')).length, 8);
  requests.length = 0;
  await Promise.all(Array.from({length: 8}, (_, index) => cli(['tool', `fixture-${index}`])));
  assert.deepEqual(requests, Array(8).fill('/api/index.json'));
  record('eight simultaneous CLI processes retain all eight atomic cache entries');
  // `cite` was removed; `tool` now carries the canonical detail and official sources.
  const citations = await cli(['tool', 'fixture-0']);
  assert.equal(citations.detailUrl, 'https://slothhub.dev/tool/fixture-0');
  record('installed CLI citation uses canonical Tool source');

  const client = await connect();
  try {
    requests.length = 0;
    const results = await Promise.all(Array.from({length: 8}, () => call(client, 'fetch', {id: 'fixture-0', full_detail: true})));
    assert.ok(results.every((result) => !result.isError && result.structuredContent.id === 'fixture-0'
      && jsonObject.parse(JSON.parse(result.structuredContent.text)).slug === 'fixture-0'));
    assert.equal(requests.filter((path) => path === '/api/index.json').length, 1);
    assert.equal(requests.filter((path) => path === '/api/tools/fixture-0.json').length, 1);
    record('eight simultaneous MCP calls share one authenticated detail download');
    const resource = await client.readResource({uri: 'slothhub://tool/fixture-0'}, {timeout: PUBLIC_FEED_TIMEOUT_MS});
    const resourceTool = jsonObject.parse(JSON.parse(resource.contents[0].text));
    assert.equal(resourceTool.slug, 'fixture-0');
    assert.deepEqual(resourceTool, jsonObject.parse(JSON.parse(results[0].structuredContent.text)));
    record('installed MCP resource returns the same Tool');
  } finally {await client.close();}

  for (const fault of ['unavailable', 'corrupt', 'oversize']) {
    mode = fault;
    const failed = await cli(['search', 'cafe', '--no-cache'], fault === 'unavailable' ? 5 : 1);
    assert.equal(failed.code, fault === 'unavailable' ? 'transport' : fault === 'corrupt' ? 'hash_mismatch' : 'feed_payload_too_large');
    const client = await connect();
    try {
      const failedCall = await call(client, 'search', {query: 'cafe'});
      assert.equal(failedCall.isError, true);
      assert.equal(failedCall.structuredContent.code, fault === 'oversize' ? 'feed_payload_too_large' : 'feed_load_error');
      if (fault === 'oversize') {
        for (const failure of [failed, failedCall.structuredContent]) {
          assert.equal(failure.configuredLimitBytes, PUBLIC_FEED_MAX_BYTES);
          assert.equal(failure.observedBytes, PUBLIC_FEED_MAX_BYTES + 1);
          assert.ok(z.string().min(1).safeParse(failure.recovery).success);
        }
      }
      mode = 'healthy';
      const recovered = await call(client, 'search', {query: 'cafe'});
      assert.ok(!recovered.isError);
      assert.equal(recovered.structuredContent.results[0].slug, 'fixture-0');
      assert.equal((await cli(['search', 'cafe', '--no-cache'])).results[0].slug, 'fixture-0');
      const faultDetails = {fault, cliCode: failed.code, mcpCode: failedCall.structuredContent.code};
      if (fault === 'oversize') {
        faultDetails.configuredLimitBytes = PUBLIC_FEED_MAX_BYTES;
        faultDetails.observedBytes = PUBLIC_FEED_MAX_BYTES + 1;
      }
      record('explicit failure and recovery without restarting MCP', faultDetails);
    } finally {await client.close(); mode = 'healthy';}
  }
  assert.equal(rejectedBodiesClosed, 2);
  record('both installed clients close rejected streaming HTTP bodies');

  const cancelling = await connect();
  try {
    let started;
    const received = new Promise((resolveReceived) => {started = resolveReceived;});
    hold = {started, releases: []};
    requests.length = 0;
    const controller = new AbortController();
    const cancelled = call(cancelling, 'fetch', {id: 'fixture-0'}, {signal: controller.signal});
    const cancelledCheck = assert.rejects(cancelled);
    const survivor = call(cancelling, 'fetch', {id: 'fixture-0'});
    await received;
    controller.abort();
    hold.releases.forEach((release) => release());
    await cancelledCheck;
    const survived = (await survivor).structuredContent;
    assert.equal(survived.id, 'fixture-0');
    assert.equal(jsonObject.parse(JSON.parse(survived.text)).slug, 'fixture-0');
    assert.equal(requests.filter((path) => path === '/api/tools/fixture-0.json').length, 1);
    record('real MCP cancellation preserves another caller sharing the download');
  } finally {hold = undefined; await cancelling.close();}

  const receipt = {recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    elapsedMs: performance.now() - startedAt, installMs: installation.elapsedMs, installedPackages,
    method: 'Real npm tarballs installed together in a clean temporary consumer. Installed CLI subprocesses and SDK stdio clients use a localhost HTTP server. Retained 90-Tool fixtures plus a synthetic 1,000-Tool growth catalog. No internet catalog latency claim. Measurements are observations, not latency budgets.',
    inputs, checks, measurements};
  if (output) await writeFile(resolve(root, output), `${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  // Windows releases file handles of exited children a moment later.
  await rm(temporaryRoot, {recursive: true, force: true, maxRetries: 10});
}

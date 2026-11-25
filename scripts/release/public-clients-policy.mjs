// What may appear in the public client repository (The-CodingSloth/slothhub-clients).
//
// The private monorepo's export (scripts/release/export-public-clients.mjs)
// and the public repository's CI (scripts/release/check-public-tree.mjs) both
// enforce these rules, so a mistaken manual commit to the public repository
// fails the same way an export would. This file is copied into the public
// repository unchanged; keep it free of the strings it forbids (patterns below
// spell them with character classes for that reason).

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

export const PUBLIC_CLIENT_REPOSITORY = 'The-CodingSloth/slothhub-clients';

/** Paths that are never exported. Matched against forward-slash relative paths. */
export const FORBIDDEN_PATHS = Object.freeze([
  {id: 'admin-cli', pattern: /^packages\/slothhub-admin-cli(?:\/|$)/u,
    reason: 'the unpublished admin CLI for the private admin API'},
  {id: 'admin-entry', pattern: /(?:^|\/)(?:src\/)?admin(?:\/|\.[cm]?[jt]sx?$)|(?:^|\/)admin-smoke/u,
    reason: 'admin entry points and their smoke tests'},
  {id: 'hosted-mcp', pattern: /^packages\/slothhub-mcp-server\/src\/(?:http|hostedMcpAdmission|httpOAuth|hostedResponseBudget)\b/u,
    reason: 'the hosted MCP deployment and its abuse-admission limits; the published package does not ship it'},
  {id: 'evaluations', pattern: /(?:^|\/)evaluations(?:\/|$)|\.(?:packet|frozen|corpus|requests)\.json$/u,
    reason: 'evaluation harnesses and packets with internal data'},
  {id: 'private-surface', pattern: /^(?:(?:astro|studio)-sloth-hu[b]|batches|plans|security|\.agents|\.claude|\.codex|\.cursor|\.vite-hooks)(?:\/|$)/u,
    reason: 'private site, Studio, editorial records, plans and security records'},
  {id: 'internal-docs', pattern: /^docs\/(?!(?:runnable-commands|untrusted-catalog-content)\.md$)/u,
    reason: 'internal documentation; only the reviewed public rewrites are allowed'},
  {id: 'measurements', pattern: /(?:^|\/)(?:measurements|performance|qa)(?:\/|$)/u,
    reason: 'measurement and QA packets'},
  {id: 'environment', pattern: /(?:^|\/)\.env(?:rc)?(?:[._-][^/]*)?$|(?:^|\/)\.npmrc$/u,
    reason: 'environment and registry credential files'},
  {id: 'git-history', pattern: /(?:^|\/)\.git(?:\/|$)/u,
    reason: 'git history of the private repository'},
  {id: 'credential-file', pattern: /(?:^|\/)(?:[^/]*[._-])?(?:credentials?|secrets?|private[._-]?key)(?:[._-][^/]*)?$|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.[^/]*)?$|\.(?:pem|key|p12|pfx|crt|cer)$/iu,
    reason: 'credential material'},
  {id: 'private-domain-module', pattern: /^packages\/domain\/src\/[^/]*(?:admin|sponsor|billing|stripe|checkout|payout|invoice|owner)[^/]*$/iu,
    reason: 'admin, sponsorship, owner and billing rules of the private site'},
]);

const EXAMPLE_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/iu;

/**
 * Content that never appears in an exported file. Each rule names what it
 * protects. `allow` entries below are the reviewed exceptions.
 */
export const FORBIDDEN_CONTENT = Object.freeze([
  {id: 'private-repository-url', pattern: /github\.com[/:]The-CodingSloth\/sloth-tool[s]\b/gu,
    reason: 'links to the private monorepo'},
  {id: 'private-repository-name', pattern: /\bsloth-tool[s]\b/gu,
    reason: 'the private monorepo name'},
  {id: 'lookalike-domain', pattern: /\bslot[h]ub\.dev\b/giu,
    reason: 'single-h look-alike of slothhub.dev, owned by someone else'},
  {id: 'internal-package-scope', pattern: /@slot[h]ub\//gu,
    reason: 'the internal single-h package scope'},
  {id: 'internal-domain-directory', pattern: /\bslot[h]ub-domain\b/gu,
    reason: 'the internal domain package directory name'},
  {id: 'private-workspace', pattern: /\b(?:astro|studio)-sloth-hu[b]\b/gu,
    reason: 'private site and Studio workspaces'},
  // Code comments may cite an upstream receipt or issue when the export marks
  // it "upstream" (see rewriteUpstreamReferences in the export script).
  {id: 'internal-docs-reference', pattern: /(?<![\w./:-])(?<!upstream )docs\/(?!(?:runnable-commands|untrusted-catalog-content)\.md\b)(?:[\w./-]+\.md\b|(?:measurements|performance|qa|adr|agents|plans|security)\b[\w./-]*)/gu,
    reason: 'references to internal documentation, receipts and runbooks'},
  {id: 'private-issue-reference', pattern: /(?<![\w&#/])(?<!upstream (?:issues? |PR |pull request )?)#\d{2,5}\b(?![\w-])/giu,
    reason: 'private issue and pull request numbers'},
  {id: 'private-host', pattern: /\b[\w-]+\.(?:sanity\.studio|upstash\.io|resend\.app)\b|\b(?:[\w-]+\.)?api\.sanity\.io\b|\b(?:sloth[\w-]*|slot[h]?hub[\w-]*)\.vercel\.app\b/giu,
    reason: 'private infrastructure hostnames'},
  {id: 'email-address', pattern: /(?<![\w.%+:/-])[A-Za-z0-9._%+-]+@([A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/gu,
    reason: 'email addresses other than reserved example domains',
    accept: (match) => EXAMPLE_EMAIL_DOMAIN.test(match[1])},
  {id: 'secret-private-key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/gu, reason: 'private key material'},
  {id: 'secret-github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/gu, reason: 'GitHub token'},
  {id: 'secret-npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/gu, reason: 'npm token'},
  {id: 'secret-aws-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu, reason: 'AWS access key'},
  {id: 'secret-slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/gu, reason: 'Slack token'},
  {id: 'secret-stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bwhsec_[A-Za-z0-9]{16,}\b/gu, reason: 'Stripe key'},
  {id: 'secret-llm-key', pattern: /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{32,}\b/gu, reason: 'model provider API key'},
  {id: 'secret-service-key', pattern: /\b(?:dub_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}|ph[cx]_[A-Za-z0-9]{32,}|sk[A-Za-z0-9]{70,}|fc-[a-f0-9]{32})\b/gu,
    reason: 'Dub, Resend, PostHog, Sanity or Firecrawl key'},
  {id: 'secret-jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, reason: 'JSON web token'},
  {id: 'secret-assignment', pattern: /\b(?:api[_-]?key|secret|token|password|passwd|auth[_-]?token)\b\s*[:=]\s*['"][A-Za-z0-9+/=_-]{24,}['"]/giu,
    reason: 'hard-coded credential'},
]);

/**
 * Reviewed exceptions: exact file, rule and matched text. Anything not listed
 * fails. Keep each reason specific enough that a reviewer can re-check it.
 */
// Built from parts so this file never matches the rules it defines.
const SECURITY_REPORTING_DOMAIN = ['deleusolie', 'resend', 'app'].join('.');

export const CONTENT_ALLOWLIST = Object.freeze([
  {rule: 'email-address', path: 'SECURITY.md', match: `security@${SECURITY_REPORTING_DOMAIN}`,
    reason: 'the private vulnerability reporting address documented by the upstream security policy'},
  {rule: 'private-host', path: 'SECURITY.md', match: SECURITY_REPORTING_DOMAIN,
    reason: 'domain of the reporting address above'},
]);

const TEXT_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|patch|toml|html|css|svg|sh|d\.ts|map)$|(?:^|\/)(?:LICENSE|\.gitignore|\.gitattributes|\.node-version|\.nvmrc)$/u;

export const toPosix = (path) => path.split(sep).join('/');

/** List files under root, skipping dependency and build output directories. */
export const listTreeFiles = (root, {skip = ['node_modules', '.git']} = {}) => {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (!skip.includes(entry.name)) walk(join(directory, entry.name));
      } else {
        files.push(toPosix(relative(root, join(directory, entry.name))));
      }
    }
  };
  walk(root);
  return files.sort();
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Scan exported paths and contents. Returns {violations, allowed}; each entry
 * names the rule, the file and the line. The matched text is compared with
 * CONTENT_ALLOWLIST here and never returned.
 */
export const scanPublicTree = (root, paths = listTreeFiles(root)) => {
  const violations = [];
  const allowed = [];
  for (const path of paths) {
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.pattern.test(path)) violations.push({rule: rule.id, path, line: 0, reason: rule.reason});
    }
    if (!TEXT_EXTENSIONS.test(path)) {
      if (statSync(join(root, path)).size > 0 && !/\.(?:png|ico|tgz)$/u.test(path)) {
        violations.push({rule: 'unknown-file-type', path, line: 0,
          reason: 'only reviewed text formats are exported; add the extension to the scanner if it is intended'});
      }
      continue;
    }
    const text = readFileSync(join(root, path), 'utf8');
    for (const rule of FORBIDDEN_CONTENT) {
      for (const match of text.matchAll(rule.pattern)) {
        if (rule.accept?.(match)) continue;
        const finding = {rule: rule.id, path, line: lineOf(text, match.index), reason: rule.reason};
        const exception = CONTENT_ALLOWLIST.find((entry) =>
          entry.rule === rule.id && entry.path === path && match[0].includes(entry.match));
        if (exception) allowed.push({...finding, reason: exception.reason});
        else violations.push(finding);
      }
    }
  }
  return {violations, allowed};
};

/**
 * One line per finding: rule, path, line and why the rule exists. Never the
 * matched text: for a credential rule the match is the credential, and this
 * line lands in terminals and build logs. Open the file at the line to see it.
 */
export const formatFinding = ({rule, path, line, reason}) =>
  `${rule}: ${path}${line ? `:${line}` : ''} (${reason})`;

/**
 * Scan an extracted npm tarball. Every content rule applies to every file, with
 * no exceptions: nothing in CONTENT_ALLOWLIST ships in a package. Returns the
 * violations.
 */
export const scanPublishedFiles = (root) => {
  const violations = [];
  for (const path of listTreeFiles(root)) {
    const text = readFileSync(join(root, path), 'utf8');
    for (const rule of FORBIDDEN_CONTENT) {
      for (const match of text.matchAll(rule.pattern)) {
        if (rule.accept?.(match)) continue;
        violations.push({rule: rule.id, path, line: lineOf(text, match.index), reason: rule.reason});
      }
    }
  }
  return violations;
};

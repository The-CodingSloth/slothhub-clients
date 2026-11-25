#!/usr/bin/env node
// Fail when the public client tree contains a forbidden path or content.
// Usage: node scripts/release/check-public-tree.mjs [root]
// In a git checkout it scans tracked files, so it also catches a file that a
// manual commit added; otherwise it scans every file under root.

import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {formatFinding, listTreeFiles, scanPublicTree} from './public-clients-policy.mjs';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const paths = existsSync(resolve(root, '.git'))
  ? execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean).sort()
  : listTreeFiles(root);

const {violations, allowed} = scanPublicTree(root, paths);
for (const finding of allowed) console.log(`allowed ${formatFinding(finding)}`);
if (violations.length > 0) {
  for (const finding of violations) console.error(`forbidden ${formatFinding(finding)}`);
  console.error(
    `public_tree_forbidden_content: ${violations.length} finding(s) in ${paths.length} files. ` +
      'Remove the file or text, or fix it upstream and re-export. Add an exception to ' +
      'CONTENT_ALLOWLIST in scripts/release/public-clients-policy.mjs only after review.',
  );
  process.exit(1);
}
console.log(`public tree clean: ${paths.length} files, ${allowed.length} reviewed exception(s).`);

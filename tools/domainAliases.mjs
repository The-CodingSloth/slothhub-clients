import {fileURLToPath} from 'node:url';
import domainPackage from '../packages/domain/package.json' with {type: 'json'};

const packageDirectory = new URL('../packages/domain/', import.meta.url);

/** @typedef {typeof domainPackage.exports['.']} DomainModuleExport */

/** @param {'src' | 'dist'} directory */
export const domainAliases = (directory) => {
  /** @param {DomainModuleExport} entry */
  const modulePath = (entry) => fileURLToPath(new URL(
    directory === 'src'
      ? entry.default.replace('./dist/', './src/').replace(/\.js$/, '.ts')
      : entry.default,
    packageDirectory,
  ));
  const subpaths = Object.entries(domainPackage.exports)
    .filter(([subpath]) => subpath !== '.')
    .map(/** @returns {[string, string]} */ ([subpath, entry]) => [
      `@slothhub/domain${subpath.slice(1)}`, modulePath(entry),
    ]);

  // Vite and esbuild match package-name prefixes. Specific public subpaths
  // must precede the root alias, or they become paths under index.ts/index.js.
  // The public client repository ships a trimmed domain package without a
  // root export; only add the root alias when the package defines one.
  const aliases = Object.fromEntries(subpaths);
  const root = domainPackage.exports['.'];
  if (root) aliases['@slothhub/domain'] = modulePath(root);
  return aliases;
};

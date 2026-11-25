// Published CLI and MCP packages bundle @slothhub/domain into their JavaScript,
// and that package is not on npm. Their declarations must inline the domain
// types too, or a TypeScript consumer of the installed tarball sees
// "Cannot find module '@slothhub/domain/...'". Vite+ Pack (tsdown) writes one
// self-contained dist/index.d.ts after the type-checking tsc emit; the package
// `files` allowlist ships that file only. Packed imports are checked against
// declared dependencies by scripts/release/release-lib.mjs.

/**
 * @param {{neverBundle: Array<string | RegExp>}} options Runtime dependencies kept as imports.
 * @returns {import('vite-plus').UserConfig['pack']}
 */
export const publicDeclarationPack = ({neverBundle}) => ({
  entry: {index: 'src/index.ts'},
  outDir: 'dist',
  platform: 'node',
  tsconfig: 'tsconfig.build.json',
  // The JavaScript build and the tsc emit already wrote dist; keep it.
  clean: false,
  fixedExtension: false,
  dts: {emitDtsOnly: true, sourcemap: false, resolve: [/^@slothhub\/domain(\/|$)/]},
  deps: {neverBundle},
});

const USAGE_FILENAME = /(?:^|\/)(?:usage|example|demo)\.[a-z]+$/iu
// SPDX-style suffixes may contain dotted versions; implementation extensions are not notices.
const LICENSE_FILENAME = /(?:^|\/)(?:[^/]+\.)?(?:licen[cs]e(?:-[\w-]+(?:\.\d+)*(?:-[\w-]+)?)?|copying|notice)(?:\.(?:md|txt|rst))?$/iu

// Docs, declarations, repository control files, manifests, tests, stories and tool configuration
// describe or exercise a component; they are never its implementation or usage example.
const NON_SOURCE_FILENAME = new RegExp([
  String.raw`(?:^|/)\.`,
  String.raw`(?:^|/)(?:readme|changelog|contributing)(?:\.[a-z]+)?$`,
  String.raw`\.(?:md|mdx|txt)$`,
  String.raw`\.d\.(?:ts|mts|cts)$`,
  String.raw`(?:^|/)(?:package|package-lock|tsconfig(?:\.[\w-]+)?|components|jsconfig|biome|deno|turbo|nx)\.jsonc?$`,
  String.raw`(?:^|/)(?:pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$`,
  String.raw`\.(?:test|spec|stories|story)\.[a-z]+$`,
  String.raw`(?:^|/)(?:__tests__|__mocks__|__snapshots__)/`,
  String.raw`(?:^|/)[\w-]+\.config\.[a-z]+$`,
].join('|'), 'iu')

/**
 * Component files are created inside the reader's project, so their paths must stay relative and
 * normalized, without home or environment expansion at the root. Each segment must also be
 * creatable through the Windows shell as well as POSIX tools.
 * https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions
 */
export const isSafeComponentFilePath = (filename: string): boolean => {
  if (!filename || /^[~$%!/]/u.test(filename) || filename.includes('\\') || /^[a-z]:/iu.test(filename)) return false
  return filename.split('/').every((segment) => segment !== ''
    && !/[<>:"|?*\u0000-\u001f]/u.test(segment)
    && !/[. ]$/u.test(segment)
    && !/^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])(?:\.|$)/iu.test(segment))
}

/** Usage examples document the API, LICENSE is terms, and docs or manifests describe the project; the rest is source a reader copies. */
export const isComponentUsageFilename = (filename: string): boolean => USAGE_FILENAME.test(filename) && !NON_SOURCE_FILENAME.test(filename)
export const isComponentLicenseFilename = (filename: string): boolean => LICENSE_FILENAME.test(filename) && !/(?:^|\/)\./u.test(filename)
export const isComponentSourceFilename = (filename: string): boolean => !isComponentUsageFilename(filename) && !isComponentLicenseFilename(filename) && !NON_SOURCE_FILENAME.test(filename)

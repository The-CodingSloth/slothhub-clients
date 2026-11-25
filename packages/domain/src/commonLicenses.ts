/**
 * Common licenses readers recognise by name. Human surfaces use the short name: the Tool
 * page shows it as a header pill instead of the License section, and cards show it in
 * place of the SPDX identifier. Agent outputs (Markdown, JSON, CLI, MCP) always keep the
 * exact SPDX expression with its scope and evidence. Dependency-free so browser islands
 * can import it.
 */
const COMMON_LICENSE_LABELS = new Map([
  ['MIT', 'MIT'], ['MIT-0', 'MIT-0'], ['Apache-2.0', 'Apache 2.0'], ['BSD-2-Clause', 'BSD 2-Clause'], ['BSD-3-Clause', 'BSD 3-Clause'],
  ['ISC', 'ISC'], ['MPL-2.0', 'MPL 2.0'], ['EPL-2.0', 'EPL 2.0'], ['BSL-1.0', 'Boost 1.0'], ['Unlicense', 'Unlicense'], ['CC0-1.0', 'CC0'], ['Zlib', 'Zlib'],
  ['GPL-2.0', 'GPL 2.0'], ['GPL-2.0-only', 'GPL 2.0'], ['GPL-2.0-or-later', 'GPL 2.0+'],
  ['GPL-3.0', 'GPL 3.0'], ['GPL-3.0-only', 'GPL 3.0'], ['GPL-3.0-or-later', 'GPL 3.0+'],
  ['LGPL-2.1', 'LGPL 2.1'], ['LGPL-2.1-only', 'LGPL 2.1'], ['LGPL-2.1-or-later', 'LGPL 2.1+'],
  ['LGPL-3.0', 'LGPL 3.0'], ['LGPL-3.0-only', 'LGPL 3.0'], ['LGPL-3.0-or-later', 'LGPL 3.0+'],
  ['AGPL-3.0', 'AGPL 3.0'], ['AGPL-3.0-only', 'AGPL 3.0'], ['AGPL-3.0-or-later', 'AGPL 3.0+'],
])

/** Short display name for a common SPDX identifier, such as "Apache 2.0"; undefined otherwise. */
export const getCommonLicenseLabel = (spdxExpression: string): string | undefined => COMMON_LICENSE_LABELS.get(spdxExpression.trim())

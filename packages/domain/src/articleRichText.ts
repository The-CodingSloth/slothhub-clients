/**
 * Article rich-text code blocks. Sized from the fenced-block distribution in
 * docs/ (56 blocks, p99 = 875 B, max = 875 B — see
 * upstream docs/measurements/article-code-blocks-*.md); 8 KiB leaves ~9x headroom for
 * longer setup examples while still bounding serialized article bodies.
 */
export const ARTICLE_CODE_BLOCK_MAX_BYTES = 8192

/**
 * Languages Studio offers for Article code blocks. Kept small and Shiki-safe;
 * the renderer falls back to plain text for anything outside this list.
 */
export const ARTICLE_CODE_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'dockerfile',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsonc',
  'jsx',
  'just',
  'kotlin',
  'lua',
  'makefile',
  'markdown',
  'mdx',
  'nix',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'text',
  'toml',
  'tsx',
  'typescript',
  'yaml',
  'xml',
  'svg',
] as const

export type ArticleCodeLanguage = (typeof ARTICLE_CODE_LANGUAGES)[number]

export const isArticleCodeLanguage = (
  value: string | null | undefined,
): value is ArticleCodeLanguage =>
  typeof value === 'string' &&
  (ARTICLE_CODE_LANGUAGES as readonly string[]).includes(value)

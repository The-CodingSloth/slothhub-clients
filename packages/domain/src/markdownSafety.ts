const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const BIDI_FORMATTING_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const MARKDOWN_PUNCTUATION = /([\\`*_[\]{}()<>#+\-.!|])/g;

export const normalizeMarkdownText = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(BIDI_FORMATTING_CONTROLS, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const escapeMarkdownText = (value: string | null | undefined): string =>
  normalizeMarkdownText(value).replace(MARKDOWN_PUNCTUATION, '\\$1');

/**
 * Escapes Markdown punctuation inside an inline run without trimming or
 * collapsing whitespace. Portable Text spans carry meaningful edge spaces
 * ("Choose by " + link), so block-level trimming happens after spans join.
 */
export const escapeMarkdownInlineText = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(BIDI_FORMATTING_CONTROLS, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(MARKDOWN_PUNCTUATION, '\\$1');

export const encodeMarkdownUrl = (href: string): string =>
  href
    .replace(BIDI_FORMATTING_CONTROLS, '')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[!'()*\\\s]/gu, (character) => {
      const encoded = encodeURIComponent(character);
      return encoded === character
        ? `%${character.codePointAt(0)?.toString(16).toUpperCase()}`
        : encoded;
    });

export const buildSafeMarkdownLink = (label: string, href: string): string =>
  `[${escapeMarkdownText(label)}](${encodeMarkdownUrl(href)})`;

export const toMarkdownInlineCode = (value: string): string => {
  let longestFence = 0;
  let currentFence = 0;
  for (const character of value) {
    if (character === '`') {
      currentFence += 1;
      longestFence = Math.max(longestFence, currentFence);
    } else {
      currentFence = 0;
    }
  }
  const fence = '`'.repeat(longestFence + 1);
  const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
};

/** The caller supplies an allowlisted language; authored fences remain literal source. */
export const toMarkdownCodeBlock = (source: string, language: string): string => {
  let longestRun = 0;
  for (const match of source.matchAll(/`+/gu)) longestRun = Math.max(longestRun, match[0].length);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${source}\n${fence}`;
};

/**
 * How a Tool logo is drawn in square slots (cards, search, Tool page hero).
 *
 * - `swap`: an editor supplied dark-surface artwork; dark mode shows it.
 * - `flip`: a one-colour mark; dark mode inverts it to light ink.
 * - `bleed`: an opaque app icon that carries its own background.
 * - `chip`: anything else; it sits on a light chip (dimmed in dark mode).
 * - `favicon`: no logo, so the site's favicon is drawn at its own small size
 *   on a neutral tile and never stretched. Only the logo resolver assigns it;
 *   resolveToolLogoTreatment never returns it.
 *
 * Research behind the rules (2026-11-16): theme-matched artwork wins
 * (Raycast `icon@dark`, Logo.dev `theme=dark`); only one-colour marks are
 * inverted (Flint, Logo.dev); a light chip is the fallback, not the default.
 */
export const TOOL_LOGO_TREATMENTS = ['swap', 'flip', 'bleed', 'chip', 'favicon'] as const;
export type ToolLogoTreatment = (typeof TOOL_LOGO_TREATMENTS)[number];

/** Editor choices in Studio. `auto` lets the rules below decide. */
export const TOOL_LOGO_TREATMENT_OVERRIDES = ['auto', 'flip', 'bleed', 'chip'] as const;
export type ToolLogoTreatmentOverride = (typeof TOOL_LOGO_TREATMENT_OVERRIDES)[number];

export const TOOL_LOGO_TREATMENT_LABELS = {
  auto: 'Automatic',
  flip: 'One-colour mark: invert in dark mode',
  bleed: 'Full app icon: show edge to edge',
  chip: 'Multi-colour mark: show on a light chip in dark mode',
} as const satisfies Readonly<Record<ToolLogoTreatmentOverride, string>>;

export const TOOL_LOGO_TREATMENT_GUIDANCE =
  'Automatic uses the dark-mode logo when one is uploaded, shows opaque app icons edge to edge, inverts logos whose colours are all neutral, and puts everything else on a light chip in dark mode. Choose a treatment only when the automatic result looks wrong.';

export type ToolLogoTreatmentInput = {
  override?: string | null;
  hasDarkVariant?: boolean;
  isOpaque?: boolean | null;
  /** Hex colours from the image palette (Sanity `metadata.palette.*.background`). */
  paletteHexes?: ReadonlyArray<string | null | undefined> | null;
};

/** Saturation above this reads as a brand colour, so inverting would distort it. */
const MAX_NEUTRAL_SATURATION = 0.18;

const parseHex = (value: string): [number, number, number] | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

/** HSL saturation in 0–1. */
const saturation = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
};

/**
 * True when every palette swatch is neutral grey. Sanity counts transparent
 * pixels as near-black, so a transparent logo's dominant swatch is unreliable;
 * requiring every swatch to be neutral keeps colour marks (Figma) off the
 * flip path. An empty palette is not evidence of a one-colour mark.
 */
export const isNeutralPalette = (hexes: ReadonlyArray<string | null | undefined>): boolean => {
  const colors = hexes.flatMap((hex) => {
    const parsed = hex ? parseHex(hex) : undefined;
    return parsed ? [parsed] : [];
  });
  return colors.length > 0 && colors.every((color) => saturation(color) <= MAX_NEUTRAL_SATURATION);
};

const isOverride = (value: string): value is Exclude<ToolLogoTreatmentOverride, 'auto'> =>
  value !== 'auto' && TOOL_LOGO_TREATMENT_OVERRIDES.some((override) => override === value);

export const resolveToolLogoTreatment = (input: ToolLogoTreatmentInput): Exclude<ToolLogoTreatment, 'favicon'> => {
  if (input.hasDarkVariant) return 'swap';
  if (input.override && isOverride(input.override)) return input.override;
  if (input.isOpaque) return 'bleed';
  if (input.paletteHexes && isNeutralPalette(input.paletteHexes)) return 'flip';
  return 'chip';
};

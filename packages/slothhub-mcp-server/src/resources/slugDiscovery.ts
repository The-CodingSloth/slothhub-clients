import {BEST_HUB_RESOURCE_URI, COMPARISONS_HUB_RESOURCE_URI, STACKS_HUB_RESOURCE_URI} from '../constants.js';
import {
  ALTERNATIVES_RESOURCE_TEMPLATE_URI,
  BEST_RESOURCE_TEMPLATE_URI,
  COMPARISON_RESOURCE_TEMPLATE_URI,
  STACK_RESOURCE_TEMPLATE_URI,
  type CatalogResourceKind,
} from './catalogResourceUri.js';

/**
 * How a caller finds a valid slug for each catalog resource on the current
 * public surface. Recovery text names only registered tools and resources.
 */
export const SLUG_DISCOVERY = {
  tool: 'Find a Tool slug with search.',
  stack: `Find a stack slug in resources/list (${STACK_RESOURCE_TEMPLATE_URI} entries) or read ${STACKS_HUB_RESOURCE_URI}.`,
  best: `Find a list slug in resources/list (${BEST_RESOURCE_TEMPLATE_URI} entries) or read ${BEST_HUB_RESOURCE_URI}.`,
  compare: `Find a comparison slug in resources/list (${COMPARISON_RESOURCE_TEMPLATE_URI} entries) or read ${COMPARISONS_HUB_RESOURCE_URI}; compare Tools directly with slothhub_compare_tools when no published comparison matches.`,
  alternatives: `Alternatives use the source Tool slug (${ALTERNATIVES_RESOURCE_TEMPLATE_URI}). Check the slug with search; a Tool with no published alternatives set has none to return.`,
} as const satisfies Record<CatalogResourceKind, string>;

/** Recovery when the catalog does not advertise a Markdown collection hub. */
export const HUB_UNAVAILABLE_RECOVERY = {
  stacks: `List stacks with resources/list (${STACK_RESOURCE_TEMPLATE_URI} entries) or upgrade the catalog.`,
  best: `List best-of lists with resources/list (${BEST_RESOURCE_TEMPLATE_URI} entries) or upgrade the catalog.`,
  comparisons: `List comparisons with resources/list (${COMPARISON_RESOURCE_TEMPLATE_URI} entries), compare Tools directly with slothhub_compare_tools, or upgrade the catalog.`,
} as const;

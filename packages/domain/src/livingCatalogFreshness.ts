import {groqHasTrimmedText} from './groqText.js'
import type {LaunchReadinessRule} from './launchReadiness.js'

// Receipt: upstream docs/measurements/living-catalog-freshness-2026-09-22.md.
// Daily runs crawl ceil(catalog / 28) Tools, not the entire catalog.
export const LIVING_CATALOG_COVERAGE_DAYS = 28
export const LIVING_CATALOG_CHECK_MAX_AGE_SECONDS = (LIVING_CATALOG_COVERAGE_DAYS + 1) * 24 * 60 * 60
export const LIVING_CATALOG_ACTIVITY_MAX_AGE_SECONDS = 2 * 24 * 60 * 60

const PUBLIC_WEBSITE_TOOL_FILTER = `_type == "tool"
  && !(_id in path("drafts.**")) && ${groqHasTrimmedText('slug.current')}
  && seo.noIndex != true && !defined(successorTool)
  && ${groqHasTrimmedText('website')}`

/** Missing, malformed and future stamps cannot make an unchecked Tool look fresh. */
export const LIVING_CATALOG_OVERDUE_TOOL_FILTER = `${PUBLIC_WEBSITE_TOOL_FILTER} && (
  !defined(dateTime(lastCheckedAt))
  || dateTime(lastCheckedAt) > dateTime(now())
  || dateTime(lastCheckedAt) < dateTime(now()) - ${LIVING_CATALOG_CHECK_MAX_AGE_SECONDS}
)`

// Any persisted crawl attempt proves activity, including a failed crawl. Use the
// full sweep population: a daily batch need not contain a public website Tool.
const CRAWL_ACTIVITY_MISSING = `count(*[_type == "tool" && !(_id in path("drafts.**"))
    && dateTime(lastCrawlAttemptAt) <= dateTime(now())
    && dateTime(lastCrawlAttemptAt) >= dateTime(now()) - ${LIVING_CATALOG_ACTIVITY_MAX_AGE_SECONDS}
  ]) == 0`

export const LIVING_CATALOG_ACTIVITY_OVERDUE_TOOL_FILTER =
  `${PUBLIC_WEBSITE_TOOL_FILTER} && ${CRAWL_ACTIVITY_MISSING}`

export const LIVING_CATALOG_FRESHNESS_QUERY_FIELDS = `
  "toolsOverdueForWebsiteCheck": count(*[${LIVING_CATALOG_OVERDUE_TOOL_FILTER}]),
  "toolsAffectedByMissingCrawlActivity": select(
    ${CRAWL_ACTIVITY_MISSING} => count(*[${PUBLIC_WEBSITE_TOOL_FILTER}]),
    0
  )`

export const LIVING_CATALOG_READINESS_RULES = [
  {
    id: 'tools-overdue-for-website-check',
    countKey: 'toolsOverdueForWebsiteCheck',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'Website checks overdue or unknown',
    actionLabel: 'Review website checks',
    studioPath: '/inbox/editorialFreshness;websiteChecksOverdue',
    description:
      `Public website Tools need a valid Last checked stamp within ${LIVING_CATALOG_CHECK_MAX_AGE_SECONDS / (24 * 60 * 60)} days: the ${LIVING_CATALOG_COVERAGE_DAYS}-day crawl rotation plus one daily recovery run. Review failures and restore the sweep; human verification is separate.`,
  },
  {
    id: 'living-catalog-sweep-overdue',
    countKey: 'toolsAffectedByMissingCrawlActivity',
    severity: 'warning',
    target: {type: 'zero'},
    label: 'No recent Living Catalog crawl activity',
    actionLabel: 'Review website checks',
    studioPath: '/inbox/editorialFreshness;missingCrawlActivity',
    description:
      `Website Tools exist, but no crawl attempt was recorded within ${LIVING_CATALOG_ACTIVITY_MAX_AGE_SECONDS / (60 * 60)} hours. Check the Reverify Catalog schedule and write failures. An empty pending-change queue does not prove the sweep is healthy; a recent attempt does not prove a successful check.`,
  },
] as const satisfies readonly LaunchReadinessRule[]

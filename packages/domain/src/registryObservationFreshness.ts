import {prerelease, valid} from 'semver'

/** Existing registry sweep cadence; shared with operator freshness reporting. */
export const REGISTRY_OBSERVATION_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const REGISTRY_SWEEP_STATE_ID = 'drafts.system.agentInterfaceRegistrySweep'

export const REGISTRY_OBSERVATIONS_NEEDING_REVIEW_FILTER = `_type == "tool"
  && defined(slug.current) && seo.noIndex != true
  && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
  && (
    (resourceIdentity.kind in ["github_repository", "gitlab_repository"] &&
      (!defined(repositoryObservation) || repositoryObservation.status in ["stale", "never_fetched", "unavailable"]))
    || count(agentInterfaces[kind == "mcp_server" && status != "deprecated" && source == "mcp_registry"
      && (!defined(mcpRegistryObservation) || mcpRegistryObservation.status in ["deprecated", "deleted"])]) > 0
  )`

export const REGISTRY_SWEEP_ACTIVITY_OVERDUE_EXPRESSION = `select(count(*[
  _id == "${REGISTRY_SWEEP_STATE_ID}"
  && defined(lastSuccessfulAt)
  && dateTime(lastSuccessfulAt) >= dateTime(now()) - ${REGISTRY_OBSERVATION_RECHECK_INTERVAL_MS / 1000}
  && dateTime(lastSuccessfulAt) <= dateTime(now())
]) == 0 => 1, 0)`

/** Only explicit version pins; missing/unspecified ranges do not imply a prerelease. */
export function getPinnedPrereleaseVersions(versions: readonly string[]): string[] {
  return [...new Set(versions.filter((version) => valid(version) && prerelease(version)?.length))]
}

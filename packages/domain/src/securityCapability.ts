import {isRuntimeString} from './runtimeValidation.js'
import type {JsonValue} from './jsonValue.js'
export const SECURITY_CAPABILITY_VALUES = [
  'sso_saml',
  'scim',
  'rbac',
  'audit_logs',
  'encryption_at_rest',
  'encryption_in_transit',
  'api_key_scopes',
  'data_residency',
  'subprocessors',
  'dpa',
] as const;

export type SecurityCapability = (typeof SECURITY_CAPABILITY_VALUES)[number];

export const SECURITY_CAPABILITY_LABELS = {
  sso_saml: 'SSO/SAML',
  scim: 'SCIM',
  rbac: 'RBAC',
  audit_logs: 'Audit logs',
  encryption_at_rest: 'Encryption at rest',
  encryption_in_transit: 'Encryption in transit',
  api_key_scopes: 'API key scopes',
  data_residency: 'Data residency',
  subprocessors: 'Subprocessors',
  dpa: 'DPA',
} satisfies Record<SecurityCapability, string>;

const SECURITY_CAPABILITY_SET = new Set<SecurityCapability>(SECURITY_CAPABILITY_VALUES);

// SAFETY: The owner API or adjacent runtime guard establishes the asserted contract before this value is used.
export const isSecurityCapability = (value: JsonValue): value is SecurityCapability =>
  isRuntimeString(value) && SECURITY_CAPABILITY_SET.has(/* SAFETY: The adjacent guard or owner API establishes this asserted contract before use. */ value as SecurityCapability);

export const getSecurityCapabilityLabel = (value: SecurityCapability): string =>
  SECURITY_CAPABILITY_LABELS[value];

export const matchesSecurityCapability = (
  capabilities: readonly SecurityCapability[] | null | undefined,
  requestedCapability: JsonValue,
): boolean => {
  if (
    requestedCapability === undefined ||
    requestedCapability === null ||
    requestedCapability === ''
  ) {
    return true;
  }

  return (
    isSecurityCapability(requestedCapability) && (capabilities ?? []).includes(requestedCapability)
  );
};

export const SECURITY_CAPABILITY_FACET_MINIMUM_COVERAGE = 0.2;
export const SECURITY_CAPABILITY_FACET_MINIMUM_MATCHES = 3;

export interface SecurityCapabilityFacetTool {
  securityCapabilities?: readonly SecurityCapability[];
}

export interface SecurityCapabilityFacet {
  value: SecurityCapability;
  count: number;
}

export const getVisibleSecurityCapabilityFacets = (
  tools: readonly SecurityCapabilityFacetTool[],
): SecurityCapabilityFacet[] => {
  if (tools.length === 0) {
    return [];
  }

  const assessedToolCount = tools.filter((tool) => tool.securityCapabilities !== undefined).length;
  if (assessedToolCount / tools.length < SECURITY_CAPABILITY_FACET_MINIMUM_COVERAGE) {
    return [];
  }

  return SECURITY_CAPABILITY_VALUES.map((value) => ({
    value,
    count: tools.filter((tool) => matchesSecurityCapability(tool.securityCapabilities, value))
      .length,
  })).filter((facet) => facet.count >= SECURITY_CAPABILITY_FACET_MINIMUM_MATCHES);
};

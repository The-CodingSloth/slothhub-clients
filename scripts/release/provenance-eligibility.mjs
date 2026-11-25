import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {releaseRepository, releaseRunbook} from './release-lib.mjs';

const releaseEventSchema = z.object({
  repository: z.object({
    full_name: z.literal(releaseRepository),
    private: z.boolean(),
    visibility: z.enum(['public', 'private', 'internal']).optional(),
  }).refine((repository) => repository.visibility === undefined ||
    repository.private === (repository.visibility !== 'public')),
});

/** Read GitHub's event evidence; absent or invalid evidence never means public. */
export const readProvenanceEligibility = (eventPath) => {
  let sourceVisibility = 'unverified';
  if (eventPath) {
    try {
      const event = releaseEventSchema.safeParse(JSON.parse(readFileSync(eventPath, 'utf8')));
      if (event.success) {
        sourceVisibility = event.data.repository.visibility ??
          (event.data.repository.private ? 'private' : 'public');
      }
    } catch {
      // Local dry runs can continue; tagged releases reject unverified evidence.
      // Never include private file paths or raw event contents in diagnostics.
    }
  }
  return {
    sourceRepository: releaseRepository,
    sourceVisibility,
    eligibility: sourceVisibility === 'public' ? 'eligible_unverified'
      : sourceVisibility === 'unverified' ? 'unverified_source' : 'unsupported_private_source',
    registryVerification: 'not_performed',
  };
};

export const assertProvenanceEligible = (provenance) => {
  if (provenance.eligibility !== 'eligible_unverified') {
    throw new Error(
      `npm_provenance_unavailable: required_source_visibility=public observed_source_visibility=${provenance.sourceVisibility}. ` +
      `Keep the repository private and use --dry-run. An authorized maintainer must approve and verify an eligible source arrangement before tagged publication; see ${releaseRunbook}. ` +
      'Do not disable provenance or publish source to bypass this gate.',
    );
  }
};

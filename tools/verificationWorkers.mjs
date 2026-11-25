import {availableParallelism} from 'node:os';

// The root runner admits two package suites. Divide the measured eight-worker
// allowance between them and reserve capacity on smaller machines where possible.
// CLI --maxWorkers still overrides this default.
// Receipt: upstream docs/measurements/local-verification-third-pass-2026-10-28.md.
export const verificationWorkers = Math.min(4, Math.max(1, Math.floor((availableParallelism() - 1) / 2)));

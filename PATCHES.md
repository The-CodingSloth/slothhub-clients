# Patches

pnpm applies the patches listed under `patchedDependencies` in
`pnpm-workspace.yaml`. Each patch is pinned to an exact dependency version, so a
version bump fails installation until the patch is re-reviewed or removed.

## `vitest@5.1.0`

`patches/vitest@5.1.0.patch` changes one line in Vitest's VM pool setup: the
fresh per-file Node context is created with
[`vm.constants.DONT_CONTEXTIFY`](https://nodejs.org/api/vm.html#vmconstantsdont_contextify).
It makes the test suites faster. Vitest still creates and tears down a separate
context for each test file, so modules and mutable globals are not shared
between files.

Remove the patch when the pinned Vitest version creates its VM context this way
upstream, or when the test configuration stops using the VM pool.

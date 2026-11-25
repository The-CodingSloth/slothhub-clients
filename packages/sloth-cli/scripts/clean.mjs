import {rm} from 'node:fs/promises';

// Splitting emits hashed chunks; remove obsolete ones before packaging a release.
await rm(new URL('../dist/', import.meta.url), {recursive: true, force: true});

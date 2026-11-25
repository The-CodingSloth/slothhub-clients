import {rmSync} from 'node:fs';

// Declaration emit does not remove artifacts for deleted source files.
rmSync(new URL('../dist', import.meta.url), {recursive: true, force: true});

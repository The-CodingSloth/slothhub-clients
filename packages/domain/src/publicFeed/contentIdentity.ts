import { createHash } from 'node:crypto';
import { canonicalContentHashInput, canonicalIndexContentHashInput } from '../contentHash.js';

export const computeContentHash = <Input>(value: Input): string =>
  `sha256:${createHash('sha256').update(canonicalContentHashInput(value), 'utf8').digest('hex')}`;

export const computeIndexContentHash = <Input>(value: Input): string =>
  `sha256:${createHash('sha256')
    .update(canonicalIndexContentHashInput(value), 'utf8')
    .digest('hex')}`;

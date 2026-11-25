import {describe, expect, it} from 'vite-plus/test';
import {recommendationInput} from './agentWorkflows.js';

describe('recommendation input', () => {
  it.each(['', '   ', '\t\n', '!!!'])('rejects requirements without searchable text: %j', (requirements) => {
    expect(recommendationInput.safeParse({requirements}).success).toBe(false);
  });
  it('trims requirements and retains explicit valid limits', () => {
    expect(recommendationInput.parse({requirements: '  python  ', limit: 4})).toMatchObject({requirements: 'python', limit: 4});
  });
});

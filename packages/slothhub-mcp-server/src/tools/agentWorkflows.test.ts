import {describe, expect, it} from 'vite-plus/test';
import {getStackInputSchema} from '../schemas/inputs.js';
import {planInput} from '../schemas/agentWorkflows.js';

describe('implementation stack references', () => {
  it('accepts the same published stack slugs as the existing stack tool', () => {
    const stack = 'Design_Stack';
    expect(getStackInputSchema.parse({slug: stack}).slug).toBe(stack);
    expect(planInput.parse({slug: 'example-mcp', stack}).stack).toBe(stack);
  });
});

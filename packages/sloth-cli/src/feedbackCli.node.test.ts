import type {CatalogFeedbackResult} from '@slothhub/domain/catalog-feedback';
import {describe, expect, it, vi} from 'vite-plus/test';
import {runCli} from './cli.js';

const queued = vi.fn(async (_url: string, body: string): Promise<CatalogFeedbackResult> =>
  ({ok: true, receipt: {received: true, id: JSON.parse(body).requestId, status: 'queued', replayed: false}}));

describe('slothhub feedback', () => {
  it('sends a hyphenated kind, the message and only the given details to the site', async () => {
    const result = await runCli(['feedback', 'wrong-fact', 'Figma', 'Dev', 'seats', 'cost', '$12', 'annually.', '--tool', 'figma', '--field', 'pricing', '--evidence', 'https://www.figma.com/pricing/', '--json'], {postFeedback: queued});
    expect(result.exitCode).toBe(0);
    const [url, body] = queued.mock.calls.at(-1) ?? [];
    expect(url).toBe('https://slothhub.dev/api/feedback');
    expect(JSON.parse(body ?? '{}')).toMatchObject({
      kind: 'wrong_fact', surface: 'cli', reportedBy: 'human', message: 'Figma Dev seats cost $12 annually.',
      toolSlug: 'figma', field: 'pricing', evidenceUrl: 'https://www.figma.com/pricing/', client: {name: 'slothhub-cli'},
    });
    expect(JSON.parse(result.stdout)).toMatchObject({received: true, status: 'queued'});
  });

  it('rejects an unknown kind and invalid details before sending anything', async () => {
    const post = vi.fn();
    expect(JSON.parse((await runCli(['feedback', 'praise', 'Great site overall.', '--json'], {postFeedback: post})).stdout)).toMatchObject({code: 'invalid_input'});
    expect(JSON.parse((await runCli(['feedback', 'wrong-fact', 'The price is wrong here.', '--evidence', 'http://example.com', '--json'], {postFeedback: post})).stdout)).toMatchObject({code: 'invalid_input'});
    expect(post).not.toHaveBeenCalled();
  });

  it('shows rate limits with their retry time', async () => {
    const result = await runCli(['feedback', 'suggestion', 'Add more MCP servers please.', '--json'], {
      postFeedback: async () => ({ok: false, failure: {code: 'rate_limited', message: 'Too much feedback.', retryAfterSeconds: 90}}),
    });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({code: 'rate_limited', recovery: 'Retry after 90 seconds.'});
  });
});

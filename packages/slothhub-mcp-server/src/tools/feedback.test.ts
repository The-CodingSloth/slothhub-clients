import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import type {CatalogFeedbackRequest, CatalogFeedbackResult} from '@slothhub/domain/catalog-feedback';
import {describe, expect, it, vi} from 'vite-plus/test';

import {createSlothHubMcpServer} from '../server.js';
import {createHttpFeedbackSubmitter} from './feedback.js';

const connect = async (submitFeedback: (request: CatalogFeedbackRequest) => Promise<CatalogFeedbackResult>) => {
  const server = createSlothHubMcpServer({baseUrl: 'https://slothhub.dev', submitFeedback, fetchJson: vi.fn()});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({name: 'feedback-test-agent', version: '2.1.0'});
  await client.connect(clientTransport);
  return client;
};

describe('slothhub_submit_feedback', () => {
  it('queues an agent report with its client identity and only the fields it was given', async () => {
    const submit = vi.fn(async (request: CatalogFeedbackRequest): Promise<CatalogFeedbackResult> =>
      ({ok: true, receipt: {received: true, id: request.requestId, status: 'queued', replayed: false}}));
    const client = await connect(submit);
    const result = await client.callTool({name: 'slothhub_submit_feedback', arguments: {
      kind: 'setup_failed', message: 'The Cursor recipe points at a removed remote.', tool_slug: 'figma', host: 'cursor', response_format: 'json',
    }});
    expect(result.isError).toBeFalsy();
    const [request] = submit.mock.calls[0] ?? [];
    expect(request).toEqual({
      requestId: expect.any(String), kind: 'setup_failed', reportedBy: 'agent', surface: 'mcp',
      message: 'The Cursor recipe points at a removed remote.', toolSlug: 'figma', host: 'cursor',
      client: {name: 'feedback-test-agent', version: '2.1.0'},
    });
    expect(result.structuredContent).toMatchObject({received: true, status: 'queued', id: request?.requestId});
    await client.close();
  });

  it('passes validation and rate-limit failures back with their codes and recovery', async () => {
    const client = await connect(async () => ({ok: false, failure: {code: 'rate_limited', message: 'Too much feedback.', retryAfterSeconds: 120}}));
    const limited = await client.callTool({name: 'slothhub_submit_feedback', arguments: {kind: 'suggestion', message: 'Add more MCP servers please.', response_format: 'json'}});
    expect(limited.isError).toBe(true);
    expect(limited.structuredContent).toMatchObject({code: 'rate_limited', suggestion: 'Retry after 120 seconds.'});
    await client.close();
  });

  it('reports an unreachable site instead of claiming the feedback was sent', async () => {
    const submit = createHttpFeedbackSubmitter('https://slothhub.dev', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const client = await connect(submit);
    const result = await client.callTool({name: 'slothhub_submit_feedback', arguments: {kind: 'missing_tool', message: 'Searched for a Rust HTTP client.', query: 'rust http client', response_format: 'json'}});
    expect(result.structuredContent).toMatchObject({code: 'feedback_unavailable'});
    await client.close();
  });
});

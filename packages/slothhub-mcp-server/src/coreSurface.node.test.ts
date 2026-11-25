import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {expect, it} from 'vite-plus/test';
import {createSlothHubMcpServer} from './server.js';

it('offers one retrieval pair and a small discovery frame to connecting agents', async () => {
  const server = createSlothHubMcpServer();
  const client = new Client({name: 'core-surface', version: '1'});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const result = await client.listTools();
    expect(result.tools.map(({name}) => name).sort()).toEqual([
      'fetch', 'search', 'slothhub_check_status', 'slothhub_compare_tools',
      'slothhub_get_alternatives', 'slothhub_get_component',
      'slothhub_get_implementation_kit', 'slothhub_recommend_tools', 'slothhub_submit_feedback',
    ]);
    // Reuse the existing resource-page budget as the discovery tripwire.
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(128 * 1024);
    expect(result.tools.find(({name}) => name === 'fetch')?.inputSchema.properties).toHaveProperty('full_detail');
    // Agents choose valid filter values from the published enums rather than from prose.
    const searchProperties = result.tools.find(({name}) => name === 'search')?.inputSchema.properties;
    expect(searchProperties).toMatchObject({
      resource_kind: {enum: expect.arrayContaining(['mcp_server', 'ui_component'])},
      pricing: {enum: ['free', 'paid', 'freemium']},
      verified: {type: 'boolean'},
      limit: {type: 'integer', maximum: 50},
    });
  } finally {await client.close(); await server.close();}
});

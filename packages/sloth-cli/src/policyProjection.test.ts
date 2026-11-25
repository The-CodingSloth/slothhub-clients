import {expect, it} from 'vite-plus/test';
import {parseToolDetailFeed} from '@slothhub/domain/public-feed-schemas';
import {formatTool} from './catalogFormat.js';
import {toolDetailFeed} from './fixtures.js';

it('labels legacy policy summaries as unscoped and unreviewed', () => {
    const feed = parseToolDetailFeed({...toolDetailFeed, generatedAt: '2026-10-13T01:00:00.000Z', data: {...toolDetailFeed.data,

      securityPrivacyPosture: {dataRetentionSummary: 'Workspace retention depends on the selected plan.', privacyPolicyUrl: 'https://example.com/privacy'},
    }}, 'fixture');
    const output = formatTool(feed.data);

    expect(output).toContain('Data retention: Workspace retention depends on the selected plan.; source https://example.com/privacy; product/plan/region scope and summary review date not recorded');
    expect(output).toContain('Data training: Unknown; no source-backed summary recorded.');
  });

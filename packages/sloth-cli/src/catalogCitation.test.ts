import {describe, expect, it} from 'vite-plus/test';
import {isSafeCatalogCitationUrl} from './catalogCitation.js';

describe('catalog citations', () => {
  it('omits loopback citations from a remote feed', () => {
    expect(isSafeCatalogCitationUrl('http://localhost:4321/tool/context7', 'https://slothhub.dev')).toBe(false);
  });
  it.each(['http://localhost:4321/tool/context7', 'https://slothhub.dev/tool/context7'])(
    'accepts first-party Tool URL %s', (url) => expect(isSafeCatalogCitationUrl(url, 'http://localhost:4321')).toBe(true),
  );
  it.each([
    'http://example.com/tool', 'http://10.0.0.1/tool', 'http://localhost:9999/tool',
    undefined, '', 'javascript:alert(1)', 'data:text/plain,hello', 'ftp://example.com/tool',
    'https://user:secret@example.com/tool', 'http://user@localhost:4321/tool/context7',
    ...['http://localhost:4321', 'https://slothhub.dev'].flatMap((origin) => [`${origin}/go`, `${origin}/go/context7`]),
  ])('omits unsafe or tracked URL %s', (url) => expect(isSafeCatalogCitationUrl(url, 'http://localhost:4321')).toBe(false));
});

import {describe, expect, it} from 'vite-plus/test';
import {CHARACTER_LIMIT, ResponseFormat} from '../constants.js';
import {formatToolResult} from './format.js';

describe('tool response formatting', () => {
  it('renders deferred Markdown with the existing display bound and complete structured data', () => {
    const structured = {description: 'x'.repeat(CHARACTER_LIMIT + 1)};
    const result = formatToolResult(ResponseFormat.MARKDOWN, () => structured.description, structured,
      [{kind: 'tool', slug: 'figma', name: 'Figma'}]);
    expect(result.content[0].text).toBe('x'.repeat(CHARACTER_LIMIT) +
      `\n\n[Truncated. CHARACTER_LIMIT=${CHARACTER_LIMIT}, observed_characters=${CHARACTER_LIMIT + 1}. Read the complete structuredContent, or request response_format=json.]`);
    expect(result.structuredContent).toBe(structured);
    expect(result.content[1]).toEqual({type: 'resource_link', uri: 'slothhub://tool/figma', name: 'Figma', mimeType: 'application/json'});
  });

  it('returns complete safe JSON without evaluating the Markdown supplier', () => {
    const result = formatToolResult(ResponseFormat.JSON, () => {
      throw new Error('JSON must not render Markdown');
    }, {name: 'Figma', description: '\u202eexample'}, [{kind: 'tool', slug: 'figma', name: 'Figma'}]);
    expect(JSON.parse(result.content[0].text)).toEqual({name: 'Figma', description: '\u202eexample'});
    expect(result.content[0].text).not.toContain('\u202e');
    expect(result.content[1]).toEqual({type: 'resource_link', uri: 'slothhub://tool/figma', name: 'Figma', mimeType: 'application/json'});
  });
});

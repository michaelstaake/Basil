import { describe, expect, it } from 'vitest';
import { parseMarkdownSegments } from './markdown';

describe('parseMarkdownSegments', () => {
  it('returns a single text segment for prose', () => {
    expect(parseMarkdownSegments('just some words')).toEqual([
      { kind: 'text', content: 'just some words' },
    ]);
  });

  it('extracts a fenced code block with its language', () => {
    const input = 'Here you go:\n```ts\nconst a = 1;\n```\nDone.';
    expect(parseMarkdownSegments(input)).toEqual([
      { kind: 'text', content: 'Here you go:' },
      { kind: 'code', content: 'const a = 1;', language: 'ts' },
      { kind: 'text', content: 'Done.' },
    ]);
  });

  it('handles a fence with no language', () => {
    expect(parseMarkdownSegments('```\nplain\n```')).toEqual([
      { kind: 'code', content: 'plain', language: '' },
    ]);
  });

  it('keeps blank lines and indentation inside code', () => {
    const input = '```py\ndef f():\n\n    return 1\n```';
    const [segment] = parseMarkdownSegments(input);
    expect(segment).toEqual({
      kind: 'code',
      content: 'def f():\n\n    return 1',
      language: 'py',
    });
  });

  it('treats an unterminated fence as code, as happens mid-stream', () => {
    expect(parseMarkdownSegments('intro\n```js\nlet x =')).toEqual([
      { kind: 'text', content: 'intro' },
      { kind: 'code', content: 'let x =', language: 'js' },
    ]);
  });

  it('does not end a backtick fence on a tilde fence', () => {
    const segments = parseMarkdownSegments('```\na\n~~~\nb\n```');
    expect(segments).toEqual([{ kind: 'code', content: 'a\n~~~\nb', language: '' }]);
  });

  it('supports tilde fences', () => {
    expect(parseMarkdownSegments('~~~sh\nls -la\n~~~')).toEqual([
      { kind: 'code', content: 'ls -la', language: 'sh' },
    ]);
  });

  it('handles multiple code blocks', () => {
    const segments = parseMarkdownSegments('```\na\n```\nmid\n```\nb\n```');
    expect(segments.map((s) => s.kind)).toEqual(['code', 'text', 'code']);
  });

  it('drops whitespace-only prose between blocks', () => {
    const segments = parseMarkdownSegments('```\na\n```\n\n\n```\nb\n```');
    expect(segments.map((s) => s.kind)).toEqual(['code', 'code']);
  });

  it('returns nothing for empty input', () => {
    expect(parseMarkdownSegments('')).toEqual([]);
  });
});

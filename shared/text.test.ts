import { describe, expect, it } from 'vitest';
import {
  countLines,
  detectLineEnding,
  lineEndingFromEol,
  normalizeLineEndings,
} from './text';

describe('detectLineEnding', () => {
  it('defaults to LF for content without breaks', () => {
    expect(detectLineEnding('')).toBe('LF');
    expect(detectLineEnding('one line')).toBe('LF');
  });

  it('detects each style', () => {
    expect(detectLineEnding('a\nb\nc')).toBe('LF');
    expect(detectLineEnding('a\r\nb\r\nc')).toBe('CRLF');
    expect(detectLineEnding('a\rb\rc')).toBe('CR');
  });

  it('picks the dominant style in mixed content', () => {
    expect(detectLineEnding('a\r\nb\r\nc\nd')).toBe('CRLF');
    expect(detectLineEnding('a\nb\nc\nd\r\ne')).toBe('LF');
  });
});

describe('lineEndingFromEol', () => {
  it('maps monaco eol strings', () => {
    expect(lineEndingFromEol('\r\n')).toBe('CRLF');
    expect(lineEndingFromEol('\r')).toBe('CR');
    expect(lineEndingFromEol('\n')).toBe('LF');
    expect(lineEndingFromEol('')).toBe('LF');
  });
});

describe('countLines', () => {
  it('counts an empty document as one line', () => {
    expect(countLines('')).toBe(1);
  });

  it('counts trailing newlines as an extra line', () => {
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
  });

  it('treats CRLF as a single break', () => {
    expect(countLines('a\r\nb')).toBe(2);
    expect(countLines('a\r\nb\r\nc')).toBe(3);
  });

  it('counts bare CR breaks', () => {
    expect(countLines('a\rb')).toBe(2);
  });
});

describe('normalizeLineEndings', () => {
  it('rewrites every break style to the target', () => {
    expect(normalizeLineEndings('a\r\nb\nc\rd', 'LF')).toBe('a\nb\nc\nd');
    expect(normalizeLineEndings('a\nb', 'CRLF')).toBe('a\r\nb');
    expect(normalizeLineEndings('a\r\nb', 'CR')).toBe('a\rb');
  });

  it('is idempotent', () => {
    const once = normalizeLineEndings('a\r\nb\nc', 'CRLF');
    expect(normalizeLineEndings(once, 'CRLF')).toBe(once);
  });

  it('leaves break-free content alone', () => {
    expect(normalizeLineEndings('abc', 'CRLF')).toBe('abc');
  });
});

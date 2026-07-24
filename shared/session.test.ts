import { describe, expect, it } from 'vitest';
import { mergeSessions, normalizeSession } from './session';

describe('normalizeSession', () => {
  it('returns an empty session for junk', () => {
    expect(normalizeSession(null)).toEqual({ openPaths: [] });
    expect(normalizeSession('x')).toEqual({ openPaths: [] });
    expect(normalizeSession({})).toEqual({ openPaths: [], activePath: undefined });
  });

  it('drops non-string and empty paths', () => {
    expect(
      normalizeSession({ openPaths: ['a', '', 3, null, 'b'] }).openPaths,
    ).toEqual(['a', 'b']);
  });

  it('preserves an explicit null active path', () => {
    expect(normalizeSession({ openPaths: [], activePath: null }).activePath).toBeNull();
  });
});

describe('mergeSessions', () => {
  it('returns an empty session when there is nothing to merge', () => {
    expect(mergeSessions([])).toEqual({ openPaths: [], activePath: null });
  });

  it('unions paths across windows without duplicates, in order', () => {
    const merged = mergeSessions([
      { openPaths: ['a', 'b'], activePath: 'b' },
      { openPaths: ['b', 'c'], activePath: 'c' },
    ]);
    expect(merged.openPaths).toEqual(['a', 'b', 'c']);
  });

  it('prefers the focused window active path when it is still open', () => {
    const merged = mergeSessions(
      [{ openPaths: ['a', 'b'], activePath: 'a' }],
      'b',
    );
    expect(merged.activePath).toBe('b');
  });

  it('ignores a preferred active path that is not open', () => {
    const merged = mergeSessions([{ openPaths: ['a'], activePath: 'a' }], 'gone');
    expect(merged.activePath).toBe('a');
  });

  it('falls back to the first open path', () => {
    const merged = mergeSessions([{ openPaths: ['a', 'b'], activePath: null }]);
    expect(merged.activePath).toBe('a');
  });

  it('keeps the tabs of a window that already closed during a quit', () => {
    // The regression: closing windows one at a time must not erode the session
    // until the last one writes an empty file.
    const windowOne = { openPaths: ['C:\\one.txt'], activePath: 'C:\\one.txt' };
    const windowTwo = { openPaths: ['C:\\two.txt'], activePath: 'C:\\two.txt' };
    const merged = mergeSessions([windowOne, windowTwo]);
    expect(merged.openPaths).toEqual(['C:\\one.txt', 'C:\\two.txt']);
    expect(merged.activePath).toBe('C:\\one.txt');
  });
});

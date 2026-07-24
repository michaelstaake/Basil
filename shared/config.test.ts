import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI,
  DEFAULT_PREFERENCES,
  DEFAULT_TOOLBAR,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TOOLBAR_VERSION,
  isAiConfigured,
  normalizeAiConfig,
  normalizePreferences,
  resolveAiBaseUrl,
  resolveEditorFontFamily,
  type AiConfig,
} from './config';

describe('normalizePreferences', () => {
  it('returns defaults for an empty object', () => {
    expect(normalizePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it('rejects an invalid theme and falls back to the default', () => {
    expect(normalizePreferences({ theme: 'neon' as never }).theme).toBe('system');
  });

  it('clamps font size into the supported range', () => {
    expect(normalizePreferences({ fontSize: 2 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(normalizePreferences({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(normalizePreferences({ fontSize: 15.6 }).fontSize).toBe(16);
    expect(normalizePreferences({ fontSize: 'huge' as never }).fontSize).toBe(
      DEFAULT_PREFERENCES.fontSize,
    );
  });

  it('rejects an unknown font family', () => {
    expect(normalizePreferences({ fontFamily: 'comic' as never }).fontFamily).toBe(
      'default',
    );
  });

  it('drops the legacy aiSidebarVisible key', () => {
    const result = normalizePreferences({ aiSidebarVisible: true } as never);
    expect('aiSidebarVisible' in result).toBe(false);
  });

  it('strips unknown toolbar ids and keeps canonical order', () => {
    const result = normalizePreferences({
      toolbarActions: ['save', 'bogus', 'new'] as never,
    });
    expect(result.toolbarActions).not.toContain('bogus' as never);
    const order = result.toolbarActions.map((id) => DEFAULT_TOOLBAR.indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('preserves a toolbar with actions the user removed', () => {
    // A user who unchecks Diff and Replace must still have them off next launch.
    const saved = DEFAULT_TOOLBAR.filter((id) => id !== 'diff' && id !== 'replace');
    const result = normalizePreferences({
      toolbarActions: saved,
      toolbarVersion: TOOLBAR_VERSION,
    });
    expect(result.toolbarActions).toEqual(saved);
  });

  it('merges newly added actions into a pre-versioning file exactly once', () => {
    // An old file lists only the legacy ids; it should pick up the new ones...
    const legacy = ['new', 'open', 'save', 'saveAs', 'undo', 'redo', 'toggleAi'] as const;
    const upgraded = normalizePreferences({ toolbarActions: [...legacy] });
    expect(upgraded.toolbarActions).toContain('diff');
    expect(upgraded.toolbarVersion).toBe(TOOLBAR_VERSION);

    // ...and then removals must stick, because the file is now versioned.
    const trimmed = upgraded.toolbarActions.filter((id) => id !== 'diff');
    expect(
      normalizePreferences({ ...upgraded, toolbarActions: trimmed }).toolbarActions,
    ).toEqual(trimmed);
  });

  it('always stamps the current toolbar version', () => {
    expect(normalizePreferences({}).toolbarVersion).toBe(TOOLBAR_VERSION);
  });

  it('rejects non-numeric window bounds', () => {
    const result = normalizePreferences({
      windowBounds: { x: 0, y: 0, width: 'wide', height: null } as never,
    });
    expect(result.windowBounds).toBeUndefined();
  });

  it('keeps valid window bounds', () => {
    const bounds = { x: 10, y: 20, width: 900, height: 600 };
    expect(normalizePreferences({ windowBounds: bounds }).windowBounds).toEqual(bounds);
  });
});

describe('resolveAiBaseUrl', () => {
  it('uses the preset url for known presets', () => {
    expect(resolveAiBaseUrl({ ...DEFAULT_AI, preset: 'lmstudio' })).toBe(
      'http://localhost:1234/v1',
    );
    expect(resolveAiBaseUrl({ ...DEFAULT_AI, preset: 'xai' })).toBe(
      'https://api.x.ai/v1',
    );
  });

  it('uses the configured url for the custom preset', () => {
    expect(
      resolveAiBaseUrl({ ...DEFAULT_AI, preset: 'custom', baseUrl: 'https://x/v1' }),
    ).toBe('https://x/v1');
  });

  it('does not throw on an unknown preset from a hand-edited ai.json', () => {
    const config = { ...DEFAULT_AI, preset: 'bogus' } as unknown as AiConfig;
    expect(() => resolveAiBaseUrl(config)).not.toThrow();
    expect(resolveAiBaseUrl(config)).toBeTruthy();
  });
});

describe('isAiConfigured', () => {
  it('accepts a local endpoint without a key', () => {
    expect(isAiConfigured({ ...DEFAULT_AI, preset: 'lmstudio', apiKey: '' })).toBe(true);
  });

  it('requires a key for xai', () => {
    expect(isAiConfigured({ ...DEFAULT_AI, preset: 'xai', apiKey: '' })).toBe(false);
    expect(isAiConfigured({ ...DEFAULT_AI, preset: 'xai', apiKey: 'k' })).toBe(true);
  });

  it('requires a key for a remote custom endpoint but not a local one', () => {
    const custom = { ...DEFAULT_AI, preset: 'custom' as const, model: 'm' };
    expect(isAiConfigured({ ...custom, baseUrl: 'https://api.example.com/v1', apiKey: '' })).toBe(
      false,
    );
    expect(isAiConfigured({ ...custom, baseUrl: 'http://localhost:8080/v1', apiKey: '' })).toBe(
      true,
    );
    expect(isAiConfigured({ ...custom, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '' })).toBe(
      true,
    );
  });

  it('requires a model', () => {
    expect(isAiConfigured({ ...DEFAULT_AI, model: '  ' })).toBe(false);
  });

  it('does not throw on an unknown preset', () => {
    const config = { ...DEFAULT_AI, preset: 'bogus' } as unknown as AiConfig;
    expect(() => isAiConfigured(config)).not.toThrow();
  });
});

describe('normalizeAiConfig', () => {
  it('returns defaults for junk input', () => {
    expect(normalizeAiConfig(null)).toEqual(DEFAULT_AI);
    expect(normalizeAiConfig('nope')).toEqual(DEFAULT_AI);
    expect(normalizeAiConfig({})).toEqual(DEFAULT_AI);
  });

  it('replaces an unknown preset with the default', () => {
    expect(normalizeAiConfig({ preset: 'bogus' }).preset).toBe(DEFAULT_AI.preset);
  });

  it('keeps valid values', () => {
    const config = {
      preset: 'custom',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'my-model',
      systemPrompt: 'be terse',
    };
    expect(normalizeAiConfig(config)).toEqual(config);
  });

  it('coerces non-string fields to defaults', () => {
    const result = normalizeAiConfig({ preset: 'xai', model: 42, apiKey: null });
    expect(result.model).toBe(DEFAULT_AI.model);
    expect(result.apiKey).toBe(DEFAULT_AI.apiKey);
    expect(result.preset).toBe('xai');
  });

  it('produces a config that never throws downstream', () => {
    const result = normalizeAiConfig({ preset: 'bogus', baseUrl: 7 });
    expect(() => resolveAiBaseUrl(result)).not.toThrow();
    expect(() => isAiConfigured(result)).not.toThrow();
  });
});

describe('resolveEditorFontFamily', () => {
  it('falls back to the default stack for an unknown id', () => {
    expect(resolveEditorFontFamily('nope' as never)).toBe(
      resolveEditorFontFamily('default'),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  createFileTab,
  createSettingsTab,
  createUntitledTab,
  isSettingsTab,
  isUnusedBlankTab,
  languageFromPath,
  saveDialogDefaultPath,
} from './tabs';
import { sessionFromTabs } from '../../shared/session';

describe('languageFromPath', () => {
  it('maps known extensions', () => {
    expect(languageFromPath('a.ts')).toBe('typescript');
    expect(languageFromPath('a.tsx')).toBe('typescript');
    expect(languageFromPath('a.py')).toBe('python');
    expect(languageFromPath('a.YML')).toBe('yaml');
    expect(languageFromPath('C:\\dir\\file.md')).toBe('markdown');
  });

  it('falls back to plaintext', () => {
    expect(languageFromPath(undefined)).toBe('plaintext');
    expect(languageFromPath('README')).toBe('plaintext');
    expect(languageFromPath('a.unknownext')).toBe('plaintext');
  });
});

describe('tab factories', () => {
  it('mints unique ids', () => {
    const ids = new Set([
      createUntitledTab().id,
      createUntitledTab().id,
      createFileTab({ path: 'a.txt', name: 'a.txt', content: '' }).id,
    ]);
    expect(ids.size).toBe(3);
  });

  it('creates a clean file tab', () => {
    const tab = createFileTab({ path: 'C:\\x\\a.json', name: 'a.json', content: '{}' });
    expect(tab).toMatchObject({
      title: 'a.json',
      kind: 'editor',
      path: 'C:\\x\\a.json',
      content: '{}',
      originalContent: '{}',
      language: 'json',
      dirty: false,
      diffOpen: false,
    });
  });

  it('identifies the settings tab', () => {
    expect(isSettingsTab(createSettingsTab())).toBe(true);
    expect(isSettingsTab(createUntitledTab())).toBe(false);
    expect(isSettingsTab(null)).toBe(false);
  });
});

describe('isUnusedBlankTab', () => {
  it('is true only for a pristine untitled tab', () => {
    expect(isUnusedBlankTab(createUntitledTab())).toBe(true);
    expect(isUnusedBlankTab({ ...createUntitledTab(), content: 'x' })).toBe(false);
    expect(isUnusedBlankTab({ ...createUntitledTab(), dirty: true })).toBe(false);
    expect(isUnusedBlankTab(createFileTab({ path: 'a', name: 'a', content: '' }))).toBe(
      false,
    );
    expect(isUnusedBlankTab(createSettingsTab())).toBe(false);
  });
});

describe('saveDialogDefaultPath', () => {
  it('keeps the full path of an existing file so the dialog opens in its folder', () => {
    expect(saveDialogDefaultPath({ title: 'notes.md', path: 'C:\\docs\\notes.md' })).toBe(
      'C:\\docs\\notes.md',
    );
  });

  it('does not append .txt to a name that already has an extension', () => {
    expect(saveDialogDefaultPath({ title: 'notes.md' })).toBe('notes.md');
    expect(saveDialogDefaultPath({ title: 'data.json' })).toBe('data.json');
  });

  it('appends .txt to an extensionless untitled tab', () => {
    expect(saveDialogDefaultPath({ title: 'Untitled-1' })).toBe('Untitled-1.txt');
  });
});

describe('sessionFromTabs', () => {
  const fileA = createFileTab({ path: 'C:\\a.txt', name: 'a.txt', content: '' });
  const fileB = createFileTab({ path: 'C:\\b.txt', name: 'b.txt', content: '' });

  it('keeps only saved paths', () => {
    const session = sessionFromTabs([fileA, createUntitledTab(), fileB], fileB.id);
    expect(session.openPaths).toEqual(['C:\\a.txt', 'C:\\b.txt']);
    expect(session.activePath).toBe('C:\\b.txt');
  });

  it('falls back to the first path when the active tab has none', () => {
    const untitled = createUntitledTab();
    expect(sessionFromTabs([fileA, untitled], untitled.id).activePath).toBe('C:\\a.txt');
  });

  it('returns an empty session when nothing is saved', () => {
    const untitled = createUntitledTab();
    expect(sessionFromTabs([untitled], untitled.id)).toEqual({
      openPaths: [],
      activePath: null,
    });
  });
});

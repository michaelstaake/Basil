import { DEFAULT_ENCODING, type EncodingId } from '../../shared/encoding';
import type { LineEnding } from '../../shared/text';

export type EditorTabKind = 'editor' | 'settings';

export type EditorTab = {
  id: string;
  title: string;
  kind: EditorTabKind;
  path?: string;
  content: string;
  /** Snapshot of content when the file was opened or last saved. */
  originalContent: string;
  language: string;
  /** When false, editor renders as plaintext regardless of `language`. */
  syntaxHighlight: boolean;
  dirty: boolean;
  /** Whether the AI sidebar is open for this tab (per-file, not global). */
  aiSidebarOpen: boolean;
  /** Whether the side-by-side diff view is open for this tab. */
  diffOpen: boolean;
  /** Encoding the file was read with, and will be written back with. */
  encoding: EncodingId;
  /** Line ending style to write. */
  eol: LineEnding;
  /**
   * Bumped only when `content` is replaced from outside the editor (file
   * reopened from disk). Lets the editor tell an external replacement apart
   * from the user's own typing, which also updates `content`.
   */
  revision: number;
  /** Modification time Basil last saw on disk; 0 for a file never read. */
  mtimeMs: number;
};

export const SETTINGS_TAB_ID = 'settings';

export function languageFromPath(filePath: string | undefined): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    htm: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    java: 'java',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    xml: 'xml',
    sh: 'shell',
    bash: 'shell',
    ps1: 'powershell',
    sql: 'sql',
    txt: 'plaintext',
    log: 'plaintext',
    csv: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

let tabCounter = 1;

export function createUntitledTab(content = ''): EditorTab {
  const id = `tab-${Date.now()}-${tabCounter++}`;
  return {
    id,
    title: `Untitled-${tabCounter - 1}`,
    kind: 'editor',
    content,
    originalContent: content,
    language: 'plaintext',
    syntaxHighlight: true,
    dirty: false,
    aiSidebarOpen: false,
    diffOpen: false,
    encoding: DEFAULT_ENCODING,
    // New files follow the platform convention.
    eol: 'CRLF',
    revision: 0,
    mtimeMs: 0,
  };
}

export function createSettingsTab(): EditorTab {
  return {
    id: SETTINGS_TAB_ID,
    title: 'Settings',
    kind: 'settings',
    content: '',
    originalContent: '',
    language: 'plaintext',
    syntaxHighlight: false,
    dirty: false,
    aiSidebarOpen: false,
    diffOpen: false,
    encoding: DEFAULT_ENCODING,
    eol: 'LF',
    revision: 0,
    mtimeMs: 0,
  };
}

/** Structural, so it also accepts a TransferableTab arriving from another window. */
export function isSettingsTab(
  tab: { kind: EditorTabKind } | null | undefined,
): boolean {
  return tab?.kind === 'settings';
}

/**
 * What the Save As dialog should start on. An existing file keeps its full path
 * (so the dialog opens in its folder, with its own extension intact); an untitled
 * tab only gets ".txt" appended when it has no extension of its own.
 */
export function saveDialogDefaultPath(tab: { title: string; path?: string }): string {
  if (tab.path) return tab.path;
  return /\.[^.\\/]+$/.test(tab.title) ? tab.title : `${tab.title}.txt`;
}

/** True for a new untitled tab that has never been edited. */
export function isUnusedBlankTab(tab: EditorTab): boolean {
  return tab.kind === 'editor' && !tab.path && !tab.dirty && tab.content === '';
}

export function createFileTab(file: {
  path: string;
  name: string;
  content: string;
  encoding?: EncodingId;
  eol?: LineEnding;
  mtimeMs?: number;
}): EditorTab {
  return {
    id: `tab-${Date.now()}-${tabCounter++}`,
    title: file.name,
    kind: 'editor',
    path: file.path,
    content: file.content,
    originalContent: file.content,
    language: languageFromPath(file.path),
    syntaxHighlight: true,
    dirty: false,
    aiSidebarOpen: false,
    diffOpen: false,
    encoding: file.encoding ?? DEFAULT_ENCODING,
    eol: file.eol ?? 'LF',
    revision: 0,
    mtimeMs: file.mtimeMs ?? 0,
  };
}

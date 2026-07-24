import type { AiConfig, Preferences, ThemeEffective } from './config';
import type { EncodingId } from './encoding';
import type { LineEnding } from './text';

export type OpenedFile = {
  path: string;
  name: string;
  content: string;
  /** How the bytes on disk were decoded; used again when saving. */
  encoding: EncodingId;
  /** Line ending style found in the file. */
  eol: LineEnding;
  /** Modification time when read, to detect edits by other programs. */
  mtimeMs: number;
};

export type SavedFile = {
  path: string;
  name: string;
  encoding: EncodingId;
  eol: LineEnding;
  mtimeMs: number;
};

export type SavePayload = {
  path?: string;
  content: string;
  defaultName?: string;
  encoding: EncodingId;
  eol: LineEnding;
  /** Modification time when the file was opened or last saved by Basil. */
  expectedMtimeMs?: number;
  /** Save even though the file changed on disk since then. */
  force?: boolean;
};

/** A native message box driven from the renderer. */
export type ConfirmOptions = {
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
  type?: 'question' | 'warning';
};

/** A path that could not be opened, and why. */
export type FileError = {
  path: string;
  message: string;
};

/**
 * Opening is partial-success by design: a multi-select can contain one
 * unreadable file without losing the rest. Failures are reported, never swallowed.
 */
export type OpenFilesResult = {
  files: OpenedFile[];
  errors: FileError[];
};

/**
 * Saving distinguishes "user cancelled the dialog" from "the write failed", so
 * the renderer can stay silent for the first and report the second.
 */
export type SaveFileResult =
  | { status: 'saved'; file: SavedFile }
  | { status: 'cancelled' }
  /** The file changed on disk since Basil read it; saving would discard that. */
  | { status: 'conflict'; path: string }
  | { status: 'error'; error: string };

export type ChatPayload = {
  messages: Array<{ role: string; content: string }>;
  fileContext?: Array<{ name: string; path?: string; content: string }>;
};

export type AiCheckResult = {
  ok: boolean;
  error?: string;
};

export type AppCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'settings'
  | 'toggleAi';

/** Persisted open-file session (paths only; content is re-read from disk). */
export type SessionState = {
  openPaths: string[];
  activePath?: string | null;
};

export type RestoredSession = {
  files: OpenedFile[];
  activePath?: string | null;
};

/** Tab payload sent across windows (detach / transfer). */
export type TransferableTab = {
  id: string;
  title: string;
  kind: 'editor' | 'settings';
  path?: string;
  content: string;
  originalContent: string;
  language: string;
  syntaxHighlight: boolean;
  dirty: boolean;
  aiSidebarOpen: boolean;
  diffOpen: boolean;
  /** Carried across windows so a detached tab keeps writing the same bytes. */
  encoding: EncodingId;
  eol: LineEnding;
};

/** How a newly created BrowserWindow should hydrate its tabs. */
export type WindowBootstrap =
  | { mode: 'session' }
  | { mode: 'tabs'; tabs: TransferableTab[] }
  | { mode: 'blank' };

export type TabDragEndResult =
  | { action: 'moved' }
  | { action: 'detached' }
  | { action: 'cancelled' };

/** Custom MIME used when dragging tabs between Basil windows. */
export const BASIL_TAB_MIME = 'application/x-basil-tab';

export type BasilApi = {
  getPreferences: () => Promise<Preferences>;
  setPreferences: (prefs: Preferences) => Promise<Preferences>;
  getAiConfig: () => Promise<AiConfig>;
  setAiConfig: (config: AiConfig) => Promise<AiConfig>;
  checkAi: () => Promise<AiCheckResult>;
  getTheme: () => Promise<ThemeEffective>;
  onThemeUpdated: (cb: (theme: ThemeEffective) => void) => () => void;
  onAppCommand: (cb: (command: AppCommand) => void) => () => void;
  onCloseRequest: (cb: () => void) => () => void;
  /** Tell main the request was received, so it stops waiting on a timeout. */
  ackCloseRequest: () => Promise<void>;
  /** Allow or cancel a pending window close after unsaved-change confirmation. */
  respondCloseRequest: (allow: boolean) => Promise<void>;
  getSession: () => Promise<RestoredSession>;
  setSession: (session: SessionState) => Promise<void>;
  /** Files passed on the command line (e.g. "Open with Basil"). */
  getStartupFiles: () => Promise<OpenFilesResult>;
  /** Opened from a second instance / context menu while already running. */
  onOpenFiles: (cb: (result: OpenFilesResult) => void) => () => void;
  getWindowId: () => Promise<number | null>;
  /** Hydration mode for this window (session restore, detached tabs, or blank). */
  getBootstrap: () => Promise<WindowBootstrap>;
  /** Begin a tab drag; main tracks the payload until endTabDrag. */
  beginTabDrag: (tab: TransferableTab) => Promise<void>;
  /** Finish a tab drag: move to another window, detach, or cancel. */
  endTabDrag: (tab: TransferableTab) => Promise<TabDragEndResult>;
  /** Close this window without a dirty-tab prompt (e.g. after last tab moved). */
  closeWindow: () => Promise<void>;
  /** Open an empty Basil window. */
  newWindow: () => Promise<void>;
  /** Tab transferred into this window from another Basil window. */
  onReceiveTab: (cb: (tab: TransferableTab) => void) => () => void;
  showBrandMenu: () => Promise<void>;
  /** Native message box; resolves to the index of the button pressed. */
  confirm: (options: ConfirmOptions) => Promise<number>;
  /** Set this window's title bar / taskbar text. */
  setWindowTitle: (title: string) => Promise<void>;
  openFiles: () => Promise<OpenFilesResult>;
  /** Resolve a dropped File to an absolute filesystem path. */
  getPathForFile: (file: File) => string;
  /** Read paths from disk (e.g. after a window file drop). */
  openPaths: (paths: string[]) => Promise<OpenFilesResult>;
  saveFile: (payload: SavePayload) => Promise<SaveFileResult>;
  basename: (filePath: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  chat: (
    payload: ChatPayload,
    onChunk: (chunk: string) => void,
  ) => Promise<{ content: string; aborted?: boolean }>;
  stopChat: () => Promise<void>;
};

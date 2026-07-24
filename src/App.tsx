import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { Toolbar } from './components/Toolbar';
import { TabBar } from './components/TabBar';
import { EditorPane } from './components/EditorPane';
import { DiffPane } from './components/DiffPane';
import { AiSidebar, forgetChatForTab } from './components/AiSidebar';
import { SettingsPane } from './components/SettingsPane';
import { Toast, type ToastState } from './components/Toast';
import {
  StatusBar,
  countLines,
  detectLineEnding,
  type EditorStatus,
} from './components/StatusBar';
import {
  DEFAULT_AI,
  DEFAULT_PREFERENCES,
  type AiConfig,
  type Preferences,
  type ToolbarActionId,
} from '../shared/config';
import type { FileError, OpenFilesResult, OpenedFile, TransferableTab } from '../shared/api';
import { normalizeEncoding, type EncodingId } from '../shared/encoding';
import { disposeModelFor } from './lib/monaco';
import type { LineEnding } from '../shared/text';
import { BASIL_TAB_MIME } from '../shared/api';
import { sessionFromTabs } from '../shared/session';
import {
  createFileTab,
  createSettingsTab,
  createUntitledTab,
  isSettingsTab,
  isUnusedBlankTab,
  languageFromPath,
  saveDialogDefaultPath,
  SETTINGS_TAB_ID,
  type EditorTab,
} from './lib/tabs';

const DEFAULT_EDITOR_STATUS: EditorStatus = {
  line: 1,
  column: 1,
  eol: 'LF',
  overwrite: false,
};

function toTransferableTab(tab: EditorTab): TransferableTab {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    path: tab.path,
    content: tab.content,
    originalContent: tab.originalContent,
    language: tab.language,
    syntaxHighlight: tab.syntaxHighlight,
    dirty: tab.dirty,
    aiSidebarOpen: tab.aiSidebarOpen,
    diffOpen: tab.diffOpen,
    encoding: tab.encoding,
    eol: tab.eol,
  };
}

function fromTransferableTab(tab: TransferableTab): EditorTab {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    path: tab.path,
    content: tab.content,
    originalContent: tab.originalContent,
    language: tab.language,
    syntaxHighlight: tab.syntaxHighlight,
    dirty: tab.dirty,
    aiSidebarOpen: tab.aiSidebarOpen,
    diffOpen: tab.diffOpen,
    encoding: normalizeEncoding(tab.encoding),
    eol: tab.eol === 'CRLF' || tab.eol === 'CR' ? tab.eol : 'LF',
    revision: 0,
    // Re-checked on the next save in the receiving window.
    mtimeMs: 0,
  };
}

type UnsavedChoice = 'save' | 'discard' | 'cancel';

/**
 * Ask about unsaved work with a real three-way choice. The old `window.confirm`
 * only offered OK/Cancel, so the only way to keep your changes was to cancel and
 * remember to save by hand.
 */
async function confirmUnsaved(dirty: EditorTab[]): Promise<UnsavedChoice> {
  const names = dirty.map((t) => t.title).join(', ');
  const message =
    dirty.length === 1
      ? `Save changes to ${dirty[0].title}?`
      : `Save changes to ${dirty.length} files?`;

  if (!window.basil?.confirm) {
    // Browser fallback (no Electron bridge): keep the old two-way behaviour.
    return window.confirm(`${message}\n\nOK discards your changes.`)
      ? 'discard'
      : 'cancel';
  }

  const choice = await window.basil.confirm({
    type: 'warning',
    message,
    detail:
      dirty.length === 1
        ? 'Your changes will be lost if you do not save them.'
        : `Unsaved: ${names}. Your changes will be lost if you do not save them.`,
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });

  if (choice === 0) return 'save';
  if (choice === 1) return 'discard';
  return 'cancel';
}

export default function App() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI);
  const [aiReady, setAiReady] = useState(false);
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  const [tabs, setTabs] = useState<EditorTab[]>(() => [createUntitledTab()]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(DEFAULT_EDITOR_STATUS);
  /** False while the diff view or Settings tab has replaced the code editor. */
  const [editorReady, setEditorReady] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const prefsRef = useRef(prefs);
  const aiReadyRef = useRef(aiReady);
  /** The close-request listener registers once, so it reaches saveTab by ref. */
  const saveTabRef = useRef<(tab: EditorTab, saveAs?: boolean) => Promise<boolean>>(
    async () => false,
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => {
    aiReadyRef.current = aiReady;
  }, [aiReady]);

  useEffect(() => {
    if (!activeId && tabs.length > 0) {
      setActiveId(tabs[0].id);
    }
  }, [activeId, tabs]);

  const applyThemeToDom = useCallback((shouldUseDark: boolean) => {
    setDark(shouldUseDark);
    document.documentElement.dataset.theme = shouldUseDark ? 'dark' : 'light';
  }, []);

  const refreshAiReady = useCallback(async (enabled: boolean) => {
    if (!enabled || !window.basil?.checkAi) {
      setAiReady(false);
      return false;
    }
    try {
      const result = await window.basil.checkAi();
      setAiReady(result.ok);
      return result.ok;
    } catch {
      setAiReady(false);
      return false;
    }
  }, []);

  const persistSession = useCallback(async () => {
    if (!window.basil?.setSession) return;
    await window.basil.setSession(
      sessionFromTabs(tabsRef.current, activeIdRef.current),
    );
  }, []);

  const showError = useCallback((message: string) => {
    setToast({ id: Date.now(), message, tone: 'error' });
  }, []);

  /** Report whatever could not be opened; one toast, however many failed. */
  const reportFileErrors = useCallback(
    (errors: FileError[]) => {
      if (!errors.length) return;
      const message =
        errors.length === 1
          ? errors[0].message
          : `${errors.length} files could not be opened: ${errors
              .map((e) => e.message)
              .join(' ')}`;
      showError(message);
    },
    [showError],
  );

  const openOpenedFiles = useCallback((files: OpenedFile[]) => {
    if (!files.length) return;

    // Build the next tab list outside setTabs so createFileTab runs once
    // (Strict Mode can double-invoke updaters and would mint a different id).
    const prev = tabsRef.current;
    const active = prev.find((t) => t.id === activeIdRef.current);
    let merged = prev.map((t) => ({ ...t }));
    let focusId: string | null = null;

    for (const file of files) {
      const existingIdx = merged.findIndex((t) => t.path && t.path === file.path);
      if (existingIdx >= 0) {
        merged[existingIdx] = {
          ...merged[existingIdx],
          content: file.content,
          originalContent: file.content,
          dirty: false,
          diffOpen: false,
          title: file.name,
          encoding: file.encoding,
          eol: file.eol,
          mtimeMs: file.mtimeMs,
          // Content came from disk, not the editor: make the editor adopt it.
          revision: merged[existingIdx].revision + 1,
        };
        focusId ??= merged[existingIdx].id;
      } else {
        const tab = createFileTab(file);
        merged.push(tab);
        focusId ??= tab.id;
      }
    }

    // Replace an unused blank tab so Open doesn't leave behind an empty Untitled.
    if (active && isUnusedBlankTab(active)) {
      merged = merged.filter((t) => t.id !== active.id);
    }

    setTabs(merged);
    if (focusId) setActiveId(focusId);
  }, []);

  /** Open whatever succeeded and surface whatever did not. */
  const applyOpenResult = useCallback(
    (result: OpenFilesResult) => {
      openOpenedFiles(result.files);
      reportFileErrors(result.errors);
    },
    [openOpenedFiles, reportFileErrors],
  );

  const receiveTransferredTab = useCallback((incoming: TransferableTab) => {
    if (isSettingsTab(incoming)) return;
    const tab = fromTransferableTab(incoming);
    const prev = tabsRef.current;
    let merged = prev.map((t) => ({ ...t }));

    if (tab.path) {
      const existingIdx = merged.findIndex((t) => t.path && t.path === tab.path);
      if (existingIdx >= 0) {
        merged[existingIdx] = {
          ...tab,
          id: merged[existingIdx].id,
          revision: merged[existingIdx].revision + 1,
        };
        setTabs(merged);
        setActiveId(merged[existingIdx].id);
        return;
      }
    }

    if (merged.some((t) => t.id === tab.id)) {
      setActiveId(tab.id);
      return;
    }

    const active = merged.find((t) => t.id === activeIdRef.current);
    if (active && isUnusedBlankTab(active)) {
      merged = merged.filter((t) => t.id !== active.id);
    }
    merged.push(tab);
    setTabs(merged);
    setActiveId(tab.id);
  }, []);

  const removeTabAfterTransfer = useCallback((id: string) => {
    const prev = tabsRef.current;
    const idx = prev.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = prev[idx];
    const next = prev.filter((t) => t.id !== id);
    // The tab now lives in another window, so this window's model can go.
    if (!isSettingsTab(tab)) disposeModelFor(tab.path ?? tab.id);
    if (next.length === 0) {
      setTabs([]);
      setActiveId(null);
      void window.basil.closeWindow();
      return;
    }
    if (activeIdRef.current === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? next[0];
      setActiveId(fallback.id);
    }
    setTabs(next);
  }, []);

  const handleTabDragStart = useCallback((tab: EditorTab) => {
    if (!window.basil?.beginTabDrag || isSettingsTab(tab)) return;
    void window.basil.beginTabDrag(toTransferableTab(tab));
  }, []);

  const handleTabDragEnd = useCallback(
    (tab: EditorTab) => {
      if (!window.basil?.endTabDrag || isSettingsTab(tab)) return;
      void window.basil.endTabDrag(toTransferableTab(tab)).then((result) => {
        if (result.action === 'moved' || result.action === 'detached') {
          removeTabAfterTransfer(tab.id);
        }
      });
    },
    [removeTabAfterTransfer],
  );

  useEffect(() => {
    let unsubTheme: (() => void) | undefined;
    let unsubOpenFiles: (() => void) | undefined;
    let unsubReceiveTab: (() => void) | undefined;
    let startupErrors: FileError[] = [];
    void (async () => {
      if (!window.basil) {
        setSessionReady(true);
        return;
      }
      const [loadedPrefs, loadedAi, theme, bootstrap] = await Promise.all([
        window.basil.getPreferences(),
        window.basil.getAiConfig(),
        window.basil.getTheme(),
        window.basil.getBootstrap(),
      ]);
      setPrefs(loadedPrefs);
      setAiConfig(loadedAi);
      applyThemeToDom(theme.shouldUseDarkColors);
      unsubTheme = window.basil.onThemeUpdated((t) =>
        applyThemeToDom(t.shouldUseDarkColors),
      );
      // Deliberately not awaited: this is a network probe with a 5s timeout, and
      // blocking on it left the window empty that whole time when the endpoint
      // was unreachable. The AI controls simply appear once it answers.
      void refreshAiReady(loadedPrefs.aiEnabled);

      if (bootstrap.mode === 'tabs' && bootstrap.tabs.length > 0) {
        const restored = bootstrap.tabs
          .filter((t) => !isSettingsTab(t))
          .map((t) => fromTransferableTab(t));
        if (restored.length > 0) {
          setTabs(restored);
          setActiveId(restored[0].id);
        }
      } else if (bootstrap.mode === 'session') {
        const [session, startup] = await Promise.all([
          window.basil.getSession(),
          window.basil.getStartupFiles(),
        ]);
        const startupFiles = startup.files;
        startupErrors = startup.errors;
        const byPath = new Map<string, OpenedFile>();
        for (const file of session.files) byPath.set(file.path, file);
        // CLI / "Open with Basil" paths win over a stale session snapshot.
        for (const file of startupFiles) byPath.set(file.path, file);
        const combined = [...byPath.values()];

        if (combined.length > 0) {
          const restored = combined.map((file) => createFileTab(file));
          const preferStartup = startupFiles[startupFiles.length - 1]?.path;
          const focus =
            restored.find((t) => t.path === preferStartup) ??
            restored.find((t) => t.path === session.activePath) ??
            restored[0];
          setTabs(restored);
          setActiveId(focus.id);
        }
      } else if (bootstrap.mode === 'blank') {
        const blank = createUntitledTab();
        setTabs([blank]);
        setActiveId(blank.id);
      }

      setSessionReady(true);
      reportFileErrors(startupErrors);

      unsubOpenFiles = window.basil.onOpenFiles((result) => {
        applyOpenResult(result);
      });
      unsubReceiveTab = window.basil.onReceiveTab((tab) => {
        receiveTransferredTab(tab);
      });
    })();
    return () => {
      unsubTheme?.();
      unsubOpenFiles?.();
      unsubReceiveTab?.();
    };
  }, [
    applyThemeToDom,
    refreshAiReady,
    applyOpenResult,
    reportFileErrors,
    receiveTransferredTab,
  ]);

  // An endpoint started after Basil (the usual case with LM Studio) should not
  // require a trip through Settings to be noticed.
  useEffect(() => {
    const onFocus = () => {
      if (prefsRef.current.aiEnabled && !aiReadyRef.current) {
        void refreshAiReady(true);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAiReady]);

  // Only the set of open paths is persisted, so keying on `tabs` (which changes
  // on every keystroke) meant rewriting session.json after every typing pause.
  const sessionKey = useMemo(
    // JSON rather than a joined string: no separator can collide with a path.
    () => JSON.stringify(tabs.map((t) => t.path ?? '')),
    [tabs],
  );

  useEffect(() => {
    if (!sessionReady || !window.basil?.setSession) return;
    const handle = window.setTimeout(() => {
      void persistSession();
    }, 200);
    return () => window.clearTimeout(handle);
  }, [sessionKey, activeId, sessionReady, persistSession]);


  useEffect(() => {
    if (!window.basil?.onCloseRequest) return;
    return window.basil.onCloseRequest(() => {
      void (async () => {
        // Answer immediately so the force-close timer stands down: the prompt
        // below is modal and the user may take a while over it.
        void window.basil.ackCloseRequest?.();
        try {
          const dirty = tabsRef.current.filter((t) => t.dirty);
          if (dirty.length > 0) {
            const choice = await confirmUnsaved(dirty);
            if (choice === 'cancel') {
              await window.basil.respondCloseRequest(false);
              return;
            }
            if (choice === 'save') {
              for (const tab of dirty) {
                // Any save that fails or is cancelled aborts the close, so work
                // the user asked to keep is never lost.
                if (!(await saveTabRef.current(tab, !tab.path))) {
                  await window.basil.respondCloseRequest(false);
                  return;
                }
              }
            }
          }
          await persistSession();
          await window.basil.respondCloseRequest(true);
        } catch (err) {
          console.error('[basil] close request failed:', err);
          // Do not trap the user in an unclosable window.
          await window.basil.respondCloseRequest(true);
        }
      })();
    });
  }, [persistSession]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId],
  );

  // Title bar and taskbar show the active file and whether it has unsaved edits.
  useEffect(() => {
    if (!window.basil?.setWindowTitle) return;
    void window.basil.setWindowTitle(
      activeTab ? `${activeTab.dirty ? '• ' : ''}${activeTab.title} — Basil` : 'Basil',
    );
  }, [activeTab]);

  const fileStats = useMemo(() => {
    const content = activeTab?.content ?? '';
    return {
      length: content.length,
      lines: countLines(content),
      eol: detectLineEnding(content),
    };
  }, [activeTab?.content]);

  useEffect(() => {
    setEditorStatus((prev) => ({
      ...DEFAULT_EDITOR_STATUS,
      eol: detectLineEnding(activeTab?.content ?? ''),
      // Keep overwrite mode across tab switches; reset cursor until Monaco reports.
      overwrite: prev.overwrite,
    }));
    // Deliberately keyed on tab identity only: re-running on every content change
    // would reset the cursor position on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

  const updateActiveContent = useCallback((content: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeIdRef.current || isSettingsTab(t)) return t;
        const dirty = content !== t.originalContent;
        return {
          ...t,
          content,
          dirty,
          // Leave diff view once the buffer matches the opened snapshot again.
          diffOpen: dirty ? t.diffOpen : false,
        };
      }),
    );
  }, []);

  const openSettings = useCallback(() => {
    setTabs((prev) => {
      const rest = prev.filter((t) => !isSettingsTab(t));
      return [createSettingsTab(), ...rest];
    });
    setActiveId(SETTINGS_TAB_ID);
  }, []);

  const newFile = useCallback(() => {
    const tab = createUntitledTab();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, []);

  const openFiles = useCallback(async () => {
    try {
      applyOpenResult(await window.basil.openFiles());
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not open files.');
    }
  }, [applyOpenResult, showError]);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      const isFiles = types.includes('Files');
      const isBasilTab = types.includes(BASIL_TAB_MIME);
      if (!isFiles && !isBasilTab) return;
      e.preventDefault();
      if (!e.dataTransfer) return;
      if (isBasilTab) {
        const el =
          e.target instanceof Element
            ? e.target
            : ((e.target as Node | null)?.parentElement ?? null);
        const overTabBar = el?.closest('.tabbar');
        // Only the tab strip accepts tabs; toolbar/editor show not-allowed.
        // Empty-desktop "move" cursor is handled by the main-process overlay.
        e.dataTransfer.dropEffect = overTabBar ? 'move' : 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      // Tab moves are finalized by the source window via endTabDrag.
      if (types?.includes(BASIL_TAB_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const dropped = e.dataTransfer?.files;
      if (!dropped?.length) return;
      e.preventDefault();
      e.stopPropagation();

      if (!window.basil?.getPathForFile || !window.basil?.openPaths) return;

      const paths: string[] = [];
      for (const file of Array.from(dropped)) {
        try {
          const filePath = window.basil.getPathForFile(file);
          if (filePath) paths.push(filePath);
        } catch {
          // Skip files without a resolvable path
        }
      }
      if (!paths.length) return;

      void window.basil
        .openPaths(paths)
        .then(applyOpenResult)
        .catch((err: unknown) => {
          showError(err instanceof Error ? err.message : 'Could not open dropped files.');
        });
    };

    // Capture phase so Monaco cannot treat a tab drag as text insert.
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [applyOpenResult, showError]);

  const saveTab = useCallback(
    async (tab: EditorTab, saveAs = false): Promise<boolean> => {
      if (isSettingsTab(tab)) return false;

      const attempt = (force: boolean) =>
        window.basil.saveFile({
          path: saveAs ? undefined : tab.path,
          content: tab.content,
          defaultName: saveDialogDefaultPath(tab),
          encoding: tab.encoding,
          eol: tab.eol,
          expectedMtimeMs: saveAs ? undefined : tab.mtimeMs,
          force,
        });

      let result;
      try {
        result = await attempt(false);

        if (result.status === 'conflict') {
          // Something else wrote this file after Basil read it.
          const choice = await window.basil.confirm({
            type: 'warning',
            message: `${tab.title} has changed on disk since you opened it.`,
            detail:
              'Saving now replaces the version on disk with yours, discarding the ' +
              'other changes.',
            buttons: ['Overwrite', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
          });
          if (choice !== 0) return false;
          result = await attempt(true);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : `Could not save ${tab.title}.`);
        return false;
      }

      if (result.status === 'cancelled' || result.status === 'conflict') return false;
      if (result.status === 'error') {
        // The write failed: leave the tab dirty so the edit is not presumed safe.
        showError(`Could not save ${tab.title}. ${result.error}`);
        return false;
      }

      const saved = result.file;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                path: saved.path,
                title: saved.name,
                originalContent: t.content,
                dirty: false,
                diffOpen: false,
                language: languageFromPath(saved.path),
                encoding: saved.encoding,
                eol: saved.eol,
                mtimeMs: saved.mtimeMs,
              }
            : t,
        ),
      );
      return true;
    },
    [showError],
  );

  useEffect(() => {
    saveTabRef.current = saveTab;
  }, [saveTab]);

  const saveActive = useCallback(
    async (saveAs = false): Promise<boolean> => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!tab || isSettingsTab(tab)) return false;
      return saveTab(tab, saveAs || !tab.path);
    },
    [saveTab],
  );

  const closeTab = useCallback(
    async (id: string) => {
      const prev = tabsRef.current;
      const idx = prev.findIndex((t) => t.id === id);
      const tab = prev[idx];
      if (!tab) return;
      if (tab.dirty) {
        const choice = await confirmUnsaved([tab]);
        if (choice === 'cancel') return;
        if (choice === 'save') {
          // A failed or cancelled save must not close the tab.
          const saved = await saveTab(tab, !tab.path);
          if (!saved) return;
        }
      }

      // Computed outside the updater: Strict Mode double-invokes updaters, which
      // would mint two different blank tabs and call setActiveId twice.
      const remaining = tabsRef.current.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const blank = createUntitledTab();
        setTabs([blank]);
        setActiveId(blank.id);
      } else {
        setTabs(remaining);
        if (activeIdRef.current === id) {
          const fallback = remaining[idx] ?? remaining[idx - 1] ?? remaining[0];
          setActiveId(fallback.id);
        }
      }

      // Free the Monaco model (and its undo stack) that this tab was using.
      if (!isSettingsTab(tab)) disposeModelFor(tab.path ?? tab.id);
      forgetChatForTab(tab.id);
    },
    [saveTab],
  );

  /**
   * Changing encoding or line endings changes the bytes that will be written,
   * so it marks the tab dirty even though the visible text is unchanged.
   */
  const setActiveEncoding = useCallback((encoding: EncodingId) => {
    const id = activeIdRef.current;
    if (!id) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id && !isSettingsTab(t) && t.encoding !== encoding
          ? { ...t, encoding, dirty: true }
          : t,
      ),
    );
  }, []);

  const setActiveEol = useCallback((eol: LineEnding) => {
    const id = activeIdRef.current;
    if (!id) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id && !isSettingsTab(t) && t.eol !== eol
          ? { ...t, eol, dirty: true }
          : t,
      ),
    );
  }, []);

  const toggleAiSidebar = useCallback(() => {
    if (!aiReadyRef.current) return;
    const id = activeIdRef.current;
    if (!id) return;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (isSettingsTab(tab)) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, aiSidebarOpen: !t.aiSidebarOpen } : t)),
    );
  }, []);

  const togglePref = useCallback(async (key: 'wordWrap' | 'indentGuides') => {
    const updated = await window.basil.setPreferences({
      ...prefsRef.current,
      [key]: !prefsRef.current[key],
    });
    setPrefs(updated);
  }, []);

  const toggleSyntax = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (isSettingsTab(tab)) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, syntaxHighlight: !t.syntaxHighlight } : t,
      ),
    );
  }, []);

  const toggleDiff = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (isSettingsTab(tab)) return;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const canDiff = t.content !== t.originalContent;
        if (!canDiff && !t.diffOpen) return t;
        return { ...t, diffOpen: !t.diffOpen };
      }),
    );
  }, []);

  const runEditorCommand = useCallback((cmd: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    ed.trigger('basil', cmd, null);
  }, []);

  const handleToolbar = useCallback(
    (id: ToolbarActionId) => {
      switch (id) {
        case 'new':
          newFile();
          break;
        case 'open':
          void openFiles();
          break;
        case 'save':
          void saveActive(false);
          break;
        case 'saveAs':
          void saveActive(true);
          break;
        case 'undo':
          runEditorCommand('undo');
          break;
        case 'redo':
          runEditorCommand('redo');
          break;
        case 'find':
          runEditorCommand('actions.find');
          break;
        case 'replace':
          runEditorCommand('editor.action.startFindReplaceAction');
          break;
        case 'wordWrap':
          void togglePref('wordWrap');
          break;
        case 'indentGuides':
          void togglePref('indentGuides');
          break;
        case 'toggleSyntax':
          toggleSyntax();
          break;
        case 'diff':
          toggleDiff();
          break;
        case 'toggleAi':
          toggleAiSidebar();
          break;
      }
    },
    [newFile, openFiles, saveActive, runEditorCommand, toggleAiSidebar, toggleDiff, togglePref, toggleSyntax],
  );

  useEffect(() => {
    if (!window.basil?.onAppCommand) return;
    return window.basil.onAppCommand((command) => {
      switch (command) {
        case 'new':
          newFile();
          break;
        case 'open':
          void openFiles();
          break;
        case 'save':
          void saveActive(false);
          break;
        case 'saveAs':
          void saveActive(true);
          break;
        case 'settings':
          openSettings();
          break;
        case 'toggleAi':
          toggleAiSidebar();
          break;
      }
    });
  }, [newFile, openFiles, openSettings, saveActive, toggleAiSidebar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'n' && e.shiftKey) {
        e.preventDefault();
        void window.basil.newWindow();
      } else if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        newFile();
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        void openFiles();
      } else if (key === 's') {
        e.preventDefault();
        void saveActive(e.shiftKey);
      } else if (key === ',' && !e.shiftKey) {
        e.preventDefault();
        openSettings();
      } else if (key === 'b' && e.shiftKey) {
        e.preventDefault();
        toggleAiSidebar();
      } else if (key === 'w') {
        e.preventDefault();
        if (activeIdRef.current) void closeTab(activeIdRef.current);
      } else if (key === 'tab') {
        e.preventDefault();
        const list = tabsRef.current;
        if (list.length < 2) return;
        const idx = list.findIndex((t) => t.id === activeIdRef.current);
        const next = e.shiftKey
          ? list[(idx - 1 + list.length) % list.length]
          : list[(idx + 1) % list.length];
        setActiveId(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeTab, newFile, openFiles, openSettings, saveActive, toggleAiSidebar]);

  async function saveSettings(nextPrefs: Preferences, nextAi: AiConfig) {
    const [p, a] = await Promise.all([
      window.basil.setPreferences(nextPrefs),
      window.basil.setAiConfig(nextAi),
    ]);
    setPrefs(p);
    setAiConfig(a);
    const theme = await window.basil.getTheme();
    applyThemeToDom(theme.shouldUseDarkColors);
    const ready = await refreshAiReady(p.aiEnabled);
    if (!ready) {
      setTabs((prev) => prev.map((t) => (t.aiSidebarOpen ? { ...t, aiSidebarOpen: false } : t)));
    }
    setToast({ id: Date.now(), message: 'Settings saved' });
  }

  const toolbarActions = useMemo(
    () =>
      aiReady
        ? prefs.toolbarActions
        : prefs.toolbarActions.filter((id) => id !== 'toggleAi'),
    [aiReady, prefs.toolbarActions],
  );

  return (
    <div
      className={`app${prefs.statusBarVisible && !isSettingsTab(activeTab) ? ' status-bar-visible' : ''}`}
    >
      <Toolbar
        actions={toolbarActions}
        aiSidebarVisible={activeTab?.aiSidebarOpen ?? false}
        wordWrap={prefs.wordWrap}
        indentGuides={prefs.indentGuides}
        syntaxHighlight={activeTab?.syntaxHighlight ?? true}
        diffOpen={activeTab?.diffOpen ?? false}
        canDiff={
          !!activeTab && activeTab.content !== activeTab.originalContent
        }
        canEdit={editorReady}
        onAction={handleToolbar}
        onOpenSettings={openSettings}
      />
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={(id) => void closeTab(id)}
        onTabDragStart={handleTabDragStart}
        onTabDragEnd={handleTabDragEnd}
      />
      <div className="main-row">
        {isSettingsTab(activeTab) ? (
          <SettingsPane
            preferences={prefs}
            aiConfig={aiConfig}
            onSave={saveSettings}
          />
        ) : activeTab?.diffOpen ? (
          <DiffPane
            tab={activeTab}
            dark={dark}
            wordWrap={prefs.wordWrap}
            fontSize={prefs.fontSize}
            fontFamily={prefs.fontFamily}
          />
        ) : (
          <EditorPane
            tab={activeTab}
            dark={dark}
            wordWrap={prefs.wordWrap}
            indentGuides={prefs.indentGuides}
            highlightCurrentLine={prefs.highlightCurrentLine}
            stickyScroll={prefs.stickyScroll}
            fontSize={prefs.fontSize}
            fontFamily={prefs.fontFamily}
            trackStatus={prefs.statusBarVisible}
            onChange={updateActiveContent}
            onStatusChange={setEditorStatus}
            onEditorMount={(ed) => {
              editorRef.current = ed;
              setEditorReady(!!ed);
            }}
          />
        )}
        {!isSettingsTab(activeTab) && activeTab?.aiSidebarOpen && aiReady ? (
          <AiSidebar enabled={prefs.aiEnabled} tabs={tabs} activeTab={activeTab} />
        ) : null}
      </div>
      {prefs.statusBarVisible && !isSettingsTab(activeTab) && activeTab ? (
        <StatusBar
          length={fileStats.length}
          lines={fileStats.lines}
          line={editorStatus.line}
          column={editorStatus.column}
          eol={activeTab.eol}
          encoding={activeTab.encoding}
          overwrite={editorStatus.overwrite}
          onEolChange={setActiveEol}
          onEncodingChange={setActiveEncoding}
        />
      ) : null}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_AI,
  DEFAULT_PREFERENCES,
  isAiConfigured,
  normalizeAiConfig,
  normalizePreferences,
  type AiConfig,
  type Preferences,
  type ThemePreference,
  resolveAiBaseUrl,
} from '../shared/config';
import type {
  AiCheckResult,
  AppCommand,
  ConfirmOptions,
  FileError,
  OpenFilesResult,
  OpenedFile,
  RestoredSession,
  SaveFileResult,
  SavePayload,
  SessionState,
  TabDragEndResult,
  TransferableTab,
  WindowBootstrap,
} from '../shared/api';
import {
  describeFsError,
  quarantineFile,
  sweepStaleTempFiles,
  writeFileAtomic,
} from './fs-safe';
import { mergeSessions, normalizeSession } from '../shared/session';
import { decode, detectEncoding, normalizeEncoding } from '../shared/encoding';
import { capChatHistory } from '../shared/ai';
import type { LineEnding } from '../shared/text';
import { getMtimeMs, readTextFile, writeTextFile } from './file-io';
import { initLogger, installGlobalErrorHandlers } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const windows = new Map<number, BrowserWindow>();
/** Windows allowed to close without asking the renderer. */
const allowCloseIds = new Set<number>();
/** Per-window session snapshots; merged when persisting. */
const windowSessions = new Map<number, SessionState>();
/** Tabs waiting for a newly created window to call getBootstrap. */
const pendingBootstrap = new Map<number, TransferableTab[]>();
/** Cached bootstrap so React Strict Mode remounts don't re-claim session/tabs. */
const bootstrapCache = new Map<number, WindowBootstrap>();
/** First non-detached window claims session restore. */
let sessionClaimed = false;

type ActiveTabDrag = {
  sourceWindowId: number;
  tab: TransferableTab;
};

let activeTabDrag: ActiveTabDrag | null = null;
/** Fullscreen overlay that owns dragover while a tab is dragged (cursor feedback). */
let tabDragOverlay: BrowserWindow | null = null;

/** Must match --toolbar-height / --tabbar-height in app.css (content coords). */
const TOOLBAR_HEIGHT = 44;
const TABBAR_HEIGHT = 36;

let tray: Tray | null = null;
let basilDir = '';
let preferences: Preferences = { ...DEFAULT_PREFERENCES };
let aiConfig: AiConfig = { ...DEFAULT_AI };
/** True while quitting from the tray menu (skip hide-to-tray). */
let isQuitting = false;
/** Window ids still awaiting close confirmation during quit. */
const quitPendingIds = new Set<number>();
/** Launch hidden to the tray (boot / login item). */
const startHidden = process.argv.includes('--hidden');
/** File paths from argv / second-instance, awaiting renderer consume. */
let pendingOpenPaths: string[] = [];

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function listWindows(): BrowserWindow[] {
  return [...windows.values()].filter((win) => !win.isDestroyed());
}

function getPrimaryWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused.id) && !focused.isDestroyed()) {
    return focused;
  }
  const visible = listWindows().find((win) => win.isVisible());
  if (visible) return visible;
  return listWindows()[0] ?? null;
}

function pointInBounds(
  x: number,
  y: number,
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    x >= bounds.x &&
    x < bounds.x + bounds.width &&
    y >= bounds.y &&
    y < bounds.y + bounds.height
  );
}

function findWindowAtPoint(
  x: number,
  y: number,
  excludeId?: number,
): BrowserWindow | null {
  for (const win of listWindows()) {
    if (excludeId != null && win.id === excludeId) continue;
    if (!win.isVisible() || win.isMinimized()) continue;
    if (pointInBounds(x, y, win.getBounds())) return win;
  }
  return null;
}

function pointInTabBar(win: BrowserWindow, x: number, y: number): boolean {
  const content = win.getContentBounds();
  if (!pointInBounds(x, y, content)) return false;
  const relY = y - content.y;
  return relY >= TOOLBAR_HEIGHT && relY < TOOLBAR_HEIGHT + TABBAR_HEIGHT;
}

function getVirtualScreenBounds(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Cursor feedback while dragging a tab: tab strip or empty desktop = move. */
function getTabDragDropEffect(): 'move' | 'none' {
  const point = screen.getCursorScreenPoint();
  for (const win of listWindows()) {
    if (!win.isVisible() || win.isMinimized()) continue;
    if (!pointInBounds(point.x, point.y, win.getBounds())) continue;
    return pointInTabBar(win, point.x, point.y) ? 'move' : 'none';
  }
  return 'move';
}

function destroyTabDragOverlay(): void {
  if (!tabDragOverlay || tabDragOverlay.isDestroyed()) {
    tabDragOverlay = null;
    return;
  }
  tabDragOverlay.hide();
}

let tabDragOverlayLoaded = false;

const TAB_DRAG_OVERLAY_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
    </style>
  </head>
  <body>
    <script>
      const MIME = 'application/x-basil-tab';
      function isBasilTab(dt) {
        if (!dt || !dt.types) return false;
        return Array.from(dt.types).includes(MIME);
      }
      function effect() {
        try {
          return window.basilTabDrag && window.basilTabDrag.getDropEffect
            ? window.basilTabDrag.getDropEffect()
            : 'move';
        } catch (_) {
          return 'move';
        }
      }
      document.addEventListener('dragover', (e) => {
        if (!isBasilTab(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = effect();
      });
      document.addEventListener('drop', (e) => {
        if (!isBasilTab(e.dataTransfer)) return;
        e.preventDefault();
      });
    </script>
  </body>
</html>
`;

function ensureTabDragOverlay(): BrowserWindow {
  if (tabDragOverlay && !tabDragOverlay.isDestroyed()) {
    return tabDragOverlay;
  }

  tabDragOverlayLoaded = false;
  const bounds = getVirtualScreenBounds();
  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  tabDragOverlay = overlay;
  overlay.setIgnoreMouseEvents(false);
  overlay.setAlwaysOnTop(true, 'screen-saver');

  overlay.webContents.once('did-finish-load', () => {
    tabDragOverlayLoaded = true;
  });
  // Loaded straight from memory: __dirname lives inside the read-only app.asar in
  // a packaged build, so writing an .html file next to main.js always failed there.
  void overlay.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(TAB_DRAG_OVERLAY_HTML)}`,
  );
  overlay.on('closed', () => {
    if (tabDragOverlay === overlay) {
      tabDragOverlay = null;
      tabDragOverlayLoaded = false;
    }
  });
  return overlay;
}

function showTabDragOverlay(): void {
  const overlay = ensureTabDragOverlay();
  const bounds = getVirtualScreenBounds();
  overlay.setBounds(bounds);
  overlay.setAlwaysOnTop(true, 'screen-saver');

  const reveal = () => {
    if (!activeTabDrag || overlay.isDestroyed()) return;
    if (!overlay.isVisible()) overlay.showInactive();
  };

  if (tabDragOverlayLoaded) {
    reveal();
  } else {
    overlay.webContents.once('did-finish-load', reveal);
  }
}

function isTransferableTab(value: unknown): value is TransferableTab {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.id === 'string' &&
    typeof tab.title === 'string' &&
    (tab.kind === 'editor' || tab.kind === 'settings') &&
    typeof tab.content === 'string' &&
    typeof tab.originalContent === 'string' &&
    typeof tab.language === 'string' &&
    typeof tab.syntaxHighlight === 'boolean' &&
    typeof tab.dirty === 'boolean' &&
    typeof tab.aiSidebarOpen === 'boolean' &&
    typeof tab.diffOpen === 'boolean' &&
    typeof tab.encoding === 'string' &&
    typeof tab.eol === 'string'
  );
}

/** Close-to-tray when either option needs the app to keep running. */
function shouldKeepInTray(): boolean {
  return preferences.stayInTray || preferences.startWithBoot;
}

/** Canonical HKCU Run value; must match build/installer.nsh. */
const LOGIN_ITEM_NAME = 'basil';
/** Older / default Electron Run names that leave duplicate or bare-electron startups. */
const LEGACY_LOGIN_ITEM_NAMES = [
  'Basil',
  'com.basil.editor',
  'electron.app.Basil',
  'electron.app.Electron',
];

function clearLoginItem(name: string): void {
  app.setLoginItemSettings({
    openAtLogin: false,
    path: process.execPath,
    args: [],
    name,
  });
}

function applyLoginItemSettings(): void {
  // Drop legacy duplicates so boot never launches Basil twice (second instance
  // would focus the main window) and so stale electron.exe Run entries die.
  for (const name of LEGACY_LOGIN_ITEM_NAMES) {
    clearLoginItem(name);
  }

  // Never register node_modules/electron.exe — that opens Electron's default_app
  // help window ("To run a local app, execute the following...").
  if (!app.isPackaged) {
    clearLoginItem(LOGIN_ITEM_NAME);
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: preferences.startWithBoot,
    path: process.execPath,
    args: preferences.startWithBoot ? ['--hidden'] : [],
    name: LOGIN_ITEM_NAME,
  });
}

async function ensureTray(): Promise<void> {
  if (tray) return;

  let icon = nativeImage.createEmpty();
  try {
    icon = await app.getFileIcon(process.execPath, { size: 'small' });
  } catch {
    const candidates = [
      path.join(__dirname, '../build/icon.ico'),
      path.join(__dirname, '../build/icon.png'),
      path.join(process.resourcesPath, 'icon.ico'),
    ];
    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) {
        icon = nativeImage.createFromPath(candidate);
        if (!icon.isEmpty()) break;
      }
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('Basil');
  tray.on('click', () => focusPrimaryWindow());
  tray.on('double-click', () => focusPrimaryWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Basil',
        click: () => focusPrimaryWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => requestQuit(),
      },
    ]),
  );
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function syncTrayPresence(): void {
  if (shouldKeepInTray()) {
    void ensureTray();
  } else {
    destroyTray();
  }
}

function requestQuit(): void {
  isQuitting = true;
  const open = listWindows();
  if (open.length === 0) {
    destroyTray();
    app.quit();
    return;
  }
  quitPendingIds.clear();
  for (const win of open) {
    quitPendingIds.add(win.id);
    if (win.isMinimized()) win.restore();
    win.show();
    win.webContents.send('app:close-request');
  }
}

function collectFileArgs(argv: string[]): string[] {
  // Packaged: [exe, ...args]. Dev (electron .): [electron, script, ...args].
  const start = app.isPackaged ? 1 : 2;
  const out: string[] = [];
  for (const arg of argv.slice(start)) {
    if (!arg || arg.startsWith('-')) continue;
    try {
      const resolved = path.resolve(arg);
      if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isFile()) {
        out.push(resolved);
      }
    } catch {
      // ignore invalid paths
    }
  }
  return out;
}

async function readOpenedFiles(paths: string[]): Promise<OpenFilesResult> {
  const files: OpenedFile[] = [];
  const errors: FileError[] = [];
  for (const filePath of paths) {
    try {
      files.push(await readTextFile(filePath));
    } catch (err) {
      errors.push({ path: filePath, message: describeFsError(err, filePath) });
    }
  }
  return { files, errors };
}

function focusPrimaryWindow(): void {
  let win = getPrimaryWindow();
  if (!win) {
    createWindow();
    win = getPrimaryWindow();
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function deliverOpenFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const result = await readOpenedFiles(paths);
  if (!result.files.length && !result.errors.length) return;
  const win = getPrimaryWindow();
  if (!win || win.isDestroyed()) {
    pendingOpenPaths.push(...paths);
    focusPrimaryWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('files:open', result);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const files = collectFileArgs(argv);
    void deliverOpenFiles(files);
    // A duplicate boot launch (--hidden, no files) must stay tray-only.
    if (files.length || !argv.includes('--hidden')) {
      focusPrimaryWindow();
    }
  });
}

pendingOpenPaths = collectFileArgs(process.argv);

function getBasilDir(): string {
  return path.join(app.getPath('home'), '.basil');
}

async function hideBasilDir(dir: string): Promise<void> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('attrib', ['+h', dir]);
  } catch {
    // Non-fatal if attrib fails
  }
}

/**
 * Cached result of the registry probe below. `execSync` spawns a process and
 * blocks the main process, and this is consulted on every theme read, every
 * window creation and every broadcast — so it is refreshed only when Windows
 * actually reports a theme change.
 */
let cachedAppsPreferDark: boolean | null | undefined;

/** Electron's shouldUseDarkColors can lag; read AppsUseLightTheme directly. */
function windowsAppsPreferDark(): boolean | null {
  if (cachedAppsPreferDark !== undefined) return cachedAppsPreferDark;
  if (process.platform !== 'win32') {
    cachedAppsPreferDark = null;
    return null;
  }
  try {
    const output = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme',
      { encoding: 'utf8', windowsHide: true, timeout: 2000 },
    );
    const match = output.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    cachedAppsPreferDark = match ? parseInt(match[1], 16) === 0 : null;
  } catch {
    cachedAppsPreferDark = null;
  }
  return cachedAppsPreferDark;
}

function effectiveShouldUseDark(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  const winDark = windowsAppsPreferDark();
  if (winDark !== null) return winDark;
  return nativeTheme.shouldUseDarkColors;
}

function themePayload() {
  return {
    preference: preferences.theme,
    shouldUseDarkColors: effectiveShouldUseDark(preferences.theme),
  };
}

function broadcastTheme(): void {
  const payload = themePayload();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('theme:updated', payload);
  }
}

function applyTheme(theme: ThemePreference): void {
  if (theme === 'system') {
    nativeTheme.themeSource = 'system';
  } else {
    nativeTheme.themeSource = theme;
  }
  broadcastTheme();
}

function sendCommand(command: AppCommand): void {
  getPrimaryWindow()?.webContents.send('app:command', command);
}

function buildAppMenu(): void {
  // File/Edit/View live on the Basil brand menu in the toolbar.
  Menu.setApplicationMenu(null);
}

/** Config files that could not be parsed and were moved aside, for a startup notice. */
const quarantinedConfigs: string[] = [];

/**
 * Read and parse a JSON config. A corrupt file (hand-edited, or truncated by a
 * crash before writes were atomic) is moved aside rather than thrown, so a bad
 * byte in preferences.json can never stop the app from starting.
 */
async function readJsonConfig(filePath: string): Promise<unknown | null> {
  if (!fsSync.existsSync(filePath)) return null;
  try {
    // Decode rather than assume UTF-8: Notepad, PowerShell's Set-Content and
    // most Windows tools write JSON with a BOM, which JSON.parse rejects. That
    // is a normal file, not a corrupt one — losing settings over it would be a
    // bug, so the BOM is stripped here (and UTF-16 configs are handled too).
    const buffer = await fs.readFile(filePath);
    return JSON.parse(decode(buffer, detectEncoding(buffer)));
  } catch (err) {
    const moved = await quarantineFile(filePath);
    quarantinedConfigs.push(path.basename(filePath));
    console.error(
      `[basil] ${path.basename(filePath)} was unreadable (${describeFsError(err)}); ` +
        (moved ? `moved to ${path.basename(moved)}` : 'could not be moved') +
        '. Falling back to defaults.',
    );
    return null;
  }
}

async function ensureBasilConfig(): Promise<void> {
  basilDir = getBasilDir();
  const prefsPath = path.join(basilDir, 'preferences.json');
  const aiPath = path.join(basilDir, 'ai.json');
  const setupOptionsPath = path.join(basilDir, 'setup-options.json');

  if (!fsSync.existsSync(basilDir)) {
    await fs.mkdir(basilDir, { recursive: true });
    await hideBasilDir(basilDir);
  }

  initLogger(basilDir);

  const swept = await sweepStaleTempFiles(basilDir);
  if (swept > 0) {
    console.warn(`[basil] cleaned up ${swept} temp file(s) from a previous crash`);
  }

  const rawPrefs = await readJsonConfig(prefsPath);
  preferences = normalizePreferences((rawPrefs ?? {}) as Record<string, unknown>);
  // Persist defaults / migration (e.g. removed toolbar actions, toolbar version).
  await writeFileAtomic(prefsPath, JSON.stringify(preferences, null, 2));

  // Apply one-shot options written by the NSIS installer setup page.
  if (fsSync.existsSync(setupOptionsPath)) {
    const raw = (await readJsonConfig(setupOptionsPath)) as Record<string, unknown> | null;
    if (raw) {
      const next = { ...preferences };
      if (typeof raw.stayInTray === 'boolean') next.stayInTray = raw.stayInTray;
      if (typeof raw.startWithBoot === 'boolean') next.startWithBoot = raw.startWithBoot;
      preferences = normalizePreferences(next);
      await writeFileAtomic(prefsPath, JSON.stringify(preferences, null, 2));
    }
    try {
      await fs.unlink(setupOptionsPath);
    } catch {
      // Non-fatal
    }
  }

  const rawAi = await readJsonConfig(aiPath);
  aiConfig = normalizeAiConfig(decryptApiKey(rawAi ?? DEFAULT_AI));
  // Rewrite when the file is new, or still holds a plaintext key to migrate.
  if (rawAi === null || (aiConfig.apiKey && !hasEncryptedKey(rawAi))) {
    await writeAiConfigFile(aiPath, aiConfig);
  }

  applyTheme(preferences.theme);
  applyLoginItemSettings();
}

async function savePreferences(next: Preferences): Promise<void> {
  preferences = normalizePreferences(next);
  try {
    await writeFileAtomic(
      path.join(basilDir, 'preferences.json'),
      JSON.stringify(preferences, null, 2),
    );
  } catch (err) {
    // Keep the in-memory preference change; losing the file is not worth a crash.
    console.error('[basil] could not save preferences:', describeFsError(err));
  }
  applyTheme(preferences.theme);
  applyLoginItemSettings();
  syncTrayPresence();
}

/**
 * The API key is a real credential, so it is encrypted at rest with the OS
 * keystore (DPAPI on Windows) rather than sitting in plaintext in ai.json.
 * Files written by older versions still hold `apiKey` and are migrated on load.
 */
function hasEncryptedKey(raw: unknown): boolean {
  return (
    !!raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).apiKeyEnc === 'string'
  );
}

function decryptApiKey(raw: unknown): unknown {
  if (!hasEncryptedKey(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const encrypted = obj.apiKeyEnc as string;
  delete obj.apiKeyEnc;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      obj.apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
  } catch (err) {
    console.error('[basil] could not decrypt the stored API key:', err);
  }
  return obj;
}

async function writeAiConfigFile(filePath: string, config: AiConfig): Promise<void> {
  const { apiKey, ...rest } = config;
  const payload: Record<string, unknown> = { ...rest };
  if (apiKey) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        payload.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64');
      } else {
        // No OS keystore (rare): keep working rather than losing the key.
        payload.apiKey = apiKey;
      }
    } catch (err) {
      console.error('[basil] could not encrypt the API key:', err);
      payload.apiKey = apiKey;
    }
  }
  await writeFileAtomic(filePath, JSON.stringify(payload, null, 2));
}

async function saveAiConfig(next: AiConfig): Promise<void> {
  aiConfig = normalizeAiConfig(next);
  try {
    await writeAiConfigFile(path.join(basilDir, 'ai.json'), aiConfig);
  } catch (err) {
    console.error('[basil] could not save AI config:', describeFsError(err));
  }
}

function sessionPath(): string {
  return path.join(basilDir, 'session.json');
}

/**
 * The in-flight session write. Quit awaits this so the process cannot exit
 * between "write the session" and the bytes actually reaching disk.
 */
let pendingSessionWrite: Promise<void> = Promise.resolve();

async function saveSession(session: SessionState): Promise<void> {
  try {
    await writeFileAtomic(
      sessionPath(),
      JSON.stringify(normalizeSession(session), null, 2),
    );
  } catch (err) {
    console.error('[basil] could not save session:', describeFsError(err));
  }
}

/**
 * Persist the union of the sessions we should remember.
 *
 * `includeAll` keeps entries belonging to windows that have already closed,
 * which is what a quit needs: otherwise each closing window trims the file
 * until the last one writes an empty session over everything.
 */
function mergeAndPersistSessions(includeAll = false): Promise<void> {
  const sessions: SessionState[] = [];
  for (const [id, session] of windowSessions) {
    if (!includeAll && !windows.has(id)) continue;
    sessions.push(session);
  }
  const primary = getPrimaryWindow();
  const preferredActive = primary ? windowSessions.get(primary.id)?.activePath : null;
  pendingSessionWrite = saveSession(mergeSessions(sessions, preferredActive));
  return pendingSessionWrite;
}

async function loadRestoredSession(): Promise<RestoredSession> {
  const session = normalizeSession(await readJsonConfig(sessionPath()));
  const files: OpenedFile[] = [];
  for (const filePath of session.openPaths) {
    try {
      files.push(await readTextFile(filePath));
    } catch (err) {
      // A file deleted, moved, or grown too large since last launch is skipped
      // silently — restoring a session should never open with an error banner.
      console.warn(`[basil] skipping restored file: ${describeFsError(err, filePath)}`);
    }
  }
  const activePath =
    session.activePath && files.some((f) => f.path === session.activePath)
      ? session.activePath
      : (files[0]?.path ?? null);
  return { files, activePath };
}

function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  void savePreferences({
    ...preferences,
    windowBounds: { x, y, width, height },
  });
}

function clampWindowBounds(
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;
  const width = Math.min(Math.max(bounds.width, 800), area.width);
  const height = Math.min(Math.max(bounds.height, 500), area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/**
 * The app window must only ever show Basil. Dropping a URL onto the window or a
 * stray link would otherwise navigate the shell away from the editor with no way
 * back, and popups would open uncontrolled BrowserWindows.
 */
function applyNavigationGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url === current) return;
    // Vite's dev server drives real navigations during HMR; allow only those.
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    console.warn(`[basil] blocked navigation to ${url}`);
  });
}

/** Abort a chat that has produced nothing for this long. */
const AI_IDLE_TIMEOUT_MS = 120_000;

/** How long to wait for a renderer to answer app:close-request before forcing. */
const CLOSE_REQUEST_TIMEOUT_MS = 3000;

const closeTimeouts = new Map<number, NodeJS.Timeout>();

function clearCloseTimeout(id: number): void {
  const handle = closeTimeouts.get(id);
  if (handle) {
    clearTimeout(handle);
    closeTimeouts.delete(id);
  }
}

/** Close a window without waiting for (or asking) the renderer. */
function forceClose(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  clearCloseTimeout(win.id);
  allowCloseIds.add(win.id);
  win.destroy();
}

function armCloseTimeout(win: BrowserWindow): void {
  clearCloseTimeout(win.id);
  closeTimeouts.set(
    win.id,
    setTimeout(() => {
      closeTimeouts.delete(win.id);
      if (win.isDestroyed()) return;
      console.warn(
        `[basil] window ${win.id} did not answer the close request; closing it anyway`,
      );
      forceClose(win);
    }, CLOSE_REQUEST_TIMEOUT_MS),
  );
}

function openNewWindow(from?: BrowserWindow | null): void {
  const source = from && !from.isDestroyed() ? from : getPrimaryWindow();
  const bounds = source?.getBounds();
  createWindow({
    bounds: bounds
      ? {
          x: bounds.x + 32,
          y: bounds.y + 32,
          width: bounds.width,
          height: bounds.height,
        }
      : undefined,
  });
}

function createWindow(opts?: {
  bounds?: { x?: number; y?: number; width?: number; height?: number };
  tabs?: TransferableTab[];
  show?: boolean;
}): BrowserWindow {
  const prefBounds = preferences.windowBounds;
  const width = opts?.bounds?.width ?? prefBounds?.width ?? 1280;
  const height = opts?.bounds?.height ?? prefBounds?.height ?? 800;
  const rawBounds = {
    x: opts?.bounds?.x ?? prefBounds?.x ?? screen.getPrimaryDisplay().workArea.x + 40,
    y: opts?.bounds?.y ?? prefBounds?.y ?? screen.getPrimaryDisplay().workArea.y + 40,
    width,
    height,
  };
  const bounds = clampWindowBounds(rawBounds);
  const dark = effectiveShouldUseDark(preferences.theme);
  const shouldShow = opts?.show !== false;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 500,
    title: 'Basil',
    show: false,
    backgroundColor: dark ? '#1e1e1e' : '#f5f7f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  windows.set(win.id, win);
  applyNavigationGuards(win);
  if (opts?.tabs?.length) {
    pendingBootstrap.set(win.id, opts.tabs);
  }

  win.once('ready-to-show', () => {
    broadcastTheme();
    if (!shouldShow) {
      if (shouldKeepInTray()) void ensureTray();
      return;
    }
    if (startHidden && shouldKeepInTray() && listWindows().length === 1 && !opts?.tabs) {
      void ensureTray();
      return;
    }
    win.show();
    if (shouldKeepInTray()) {
      void ensureTray();
    }
  });

  win.on('close', (event) => {
    persistWindowBounds(win);
    if (allowCloseIds.has(win.id)) {
      allowCloseIds.delete(win.id);
      clearCloseTimeout(win.id);
      return;
    }
    const isLast = listWindows().length <= 1;
    if (!isQuitting && shouldKeepInTray() && isLast) {
      event.preventDefault();
      win.hide();
      void ensureTray();
      return;
    }
    event.preventDefault();
    win.webContents.send('app:close-request');
    // A renderer that is wedged (or already gone) must not make the window
    // impossible to close: fall back to a forced close if it never answers.
    armCloseTimeout(win);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[basil] renderer gone (${details.reason})`);
    // Nothing left to ask about unsaved changes, so let the window close.
    forceClose(win);
  });

  win.on('unresponsive', () => {
    console.warn(`[basil] window ${win.id} is unresponsive`);
  });

  win.on('closed', () => {
    windows.delete(win.id);
    allowCloseIds.delete(win.id);
    clearCloseTimeout(win.id);
    pendingBootstrap.delete(win.id);
    bootstrapCache.delete(win.id);
    quitPendingIds.delete(win.id);
    if (activeTabDrag?.sourceWindowId === win.id) {
      activeTabDrag = null;
      destroyTabDragOverlay();
    }
    if (windows.size === 0) {
      sessionClaimed = false;
    }

    // The last window out defines what "restore my session" means next launch, so
    // its tabs (and those of windows that closed earlier in this quit) must be kept.
    // Pruning first is what previously persisted an empty session on every quit.
    const isLastWindow = listWindows().length === 0;
    if (isLastWindow) {
      void mergeAndPersistSessions(true);
    } else {
      windowSessions.delete(win.id);
      void mergeAndPersistSessions();
    }

    if (isQuitting && quitPendingIds.size === 0 && isLastWindow) {
      destroyTray();
      // Let the session write land before the process goes away.
      void pendingSessionWrite.finally(() => app.quit());
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Warm the tab-drag overlay so the first drag does not wait on loadURL.
  // Best-effort: a failure here must never prevent the editor window from opening.
  try {
    ensureTabDragOverlay();
  } catch (err) {
    console.error('[basil] tab drag overlay unavailable:', err);
  }

  return win;
}

function detachTabToNewWindow(tab: TransferableTab, point: { x: number; y: number }): void {
  const pref = preferences.windowBounds;
  const width = pref?.width ?? 1280;
  const height = pref?.height ?? 800;
  createWindow({
    bounds: {
      x: point.x - 80,
      y: point.y - 16,
      width,
      height,
    },
    tabs: [tab],
  });
}

function registerIpc(): void {
  ipcMain.handle('prefs:get', () => preferences);
  ipcMain.handle('prefs:set', async (_e, next: Preferences) => {
    await savePreferences(next);
    return preferences;
  });

  ipcMain.handle('session:get', () => loadRestoredSession());
  ipcMain.handle('session:set', (event, session: SessionState) => {
    const win = windowFromEvent(event);
    if (win) {
      windowSessions.set(win.id, normalizeSession(session));
    }
    mergeAndPersistSessions();
  });

  ipcMain.handle('window:getId', (event) => windowFromEvent(event)?.id ?? null);

  ipcMain.handle('window:getBootstrap', (event): WindowBootstrap => {
    const win = windowFromEvent(event);
    if (!win) return { mode: 'blank' };
    const cached = bootstrapCache.get(win.id);
    if (cached) return cached;

    const pending = pendingBootstrap.get(win.id);
    let result: WindowBootstrap;
    if (pending) {
      pendingBootstrap.delete(win.id);
      result = { mode: 'tabs', tabs: pending };
    } else if (!sessionClaimed) {
      sessionClaimed = true;
      result = { mode: 'session' };
    } else {
      result = { mode: 'blank' };
    }
    bootstrapCache.set(win.id, result);
    return result;
  });

  ipcMain.handle('window:close', (event) => {
    const win = windowFromEvent(event);
    if (!win || win.isDestroyed()) return;
    allowCloseIds.add(win.id);
    win.close();
  });

  ipcMain.handle('tabs:begin-drag', (event, tab: unknown) => {
    const win = windowFromEvent(event);
    if (!win || !isTransferableTab(tab) || tab.kind === 'settings') {
      activeTabDrag = null;
      destroyTabDragOverlay();
      return;
    }
    activeTabDrag = { sourceWindowId: win.id, tab };
    // The overlay only supplies cursor feedback; dragging still works without it.
    try {
      showTabDragOverlay();
    } catch (err) {
      console.error('[basil] tab drag overlay unavailable:', err);
    }
  });

  ipcMain.handle('tabs:end-drag', (event, tab: unknown): TabDragEndResult => {
    const win = windowFromEvent(event);
    const dragTab =
      (activeTabDrag && activeTabDrag.sourceWindowId === win?.id
        ? activeTabDrag.tab
        : null) ?? (isTransferableTab(tab) ? tab : null);
    activeTabDrag = null;
    destroyTabDragOverlay();
    if (!win || !dragTab || dragTab.kind === 'settings') {
      return { action: 'cancelled' };
    }

    const point = screen.getCursorScreenPoint();
    const target = findWindowAtPoint(point.x, point.y, win.id);
    if (target) {
      // Cross-window moves only land when dropped on the tab strip.
      if (!pointInTabBar(target, point.x, point.y)) {
        return { action: 'cancelled' };
      }
      target.focus();
      target.webContents.send('tabs:receive', dragTab);
      return { action: 'moved' };
    }

    // Dropped on the source window (any region) cancels; outside all windows detaches.
    const sourceBounds = win.getBounds();
    if (!pointInBounds(point.x, point.y, sourceBounds)) {
      detachTabToNewWindow(dragTab, point);
      return { action: 'detached' };
    }

    return { action: 'cancelled' };
  });

  ipcMain.on('tabs:drag-drop-effect', (event) => {
    event.returnValue = activeTabDrag ? getTabDragDropEffect() : 'none';
  });

  ipcMain.handle('files:getStartup', async () => {
    const paths = pendingOpenPaths;
    pendingOpenPaths = [];
    return readOpenedFiles(paths);
  });

  ipcMain.handle(
    'files:openPaths',
    async (_e, paths: unknown): Promise<OpenFilesResult> => {
      if (!Array.isArray(paths)) return { files: [], errors: [] };
      const filePaths: string[] = [];
      const errors: FileError[] = [];
      for (const entry of paths) {
        if (typeof entry !== 'string' || !entry) continue;
        try {
          const resolved = path.resolve(entry);
          const stat = fsSync.statSync(resolved);
          if (stat.isFile()) {
            filePaths.push(resolved);
          } else if (stat.isDirectory()) {
            errors.push({
              path: resolved,
              message: `${path.basename(resolved)} is a folder.`,
            });
          }
        } catch (err) {
          errors.push({ path: entry, message: describeFsError(err, entry) });
        }
      }
      const result = await readOpenedFiles(filePaths);
      return { files: result.files, errors: [...errors, ...result.errors] };
    },
  );

  ipcMain.handle('app:ack-close', (event) => {
    // The renderer is alive and is handling the request (it may now be showing a
    // modal about unsaved changes). Stand down the force-close timer, which
    // exists only for a renderer that never responds at all.
    const win = windowFromEvent(event);
    if (win) clearCloseTimeout(win.id);
  });

  ipcMain.handle('app:respond-close', (event, allow: boolean) => {
    const win = windowFromEvent(event);
    // The renderer answered, so the forced-close fallback is no longer needed.
    if (win) clearCloseTimeout(win.id);
    if (!allow) {
      // Any decline aborts a multi-window quit in progress.
      isQuitting = false;
      quitPendingIds.clear();
      for (const id of [...closeTimeouts.keys()]) clearCloseTimeout(id);
      return;
    }
    if (!win || win.isDestroyed()) return;
    allowCloseIds.add(win.id);
    win.close();
    if (isQuitting) {
      // Remaining windows are closed via their own close-requests; app quits on last closed.
      return;
    }
    if (!shouldKeepInTray() && listWindows().filter((w) => w.id !== win.id).length === 0) {
      destroyTray();
      void pendingSessionWrite.finally(() => app.quit());
    }
  });

  ipcMain.handle('ai:getConfig', () => ({
    ...aiConfig,
  }));
  ipcMain.handle('ai:setConfig', async (_e, next: AiConfig) => {
    await saveAiConfig(next);
    return aiConfig;
  });
  ipcMain.handle('ai:check', async (): Promise<AiCheckResult> => {
    if (!isAiConfigured(aiConfig)) {
      return { ok: false, error: 'AI is not configured' };
    }

    const baseUrl = resolveAiBaseUrl(aiConfig).replace(/\/$/, '');
    const url = `${baseUrl}/models`;
    const headers: Record<string, string> = {};
    if (aiConfig.apiKey) {
      headers.Authorization = `Bearer ${aiConfig.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          ok: false,
          error: `AI check failed (${response.status}): ${errText || response.statusText}`,
        };
      }
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'AI check timed out'
            : err.message
          : 'AI check failed';
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle('theme:getEffective', () => themePayload());

  ipcMain.handle('menu:brand', (event) => {
    // Non-redundant items from the old File/Edit/View menus.
    // New/Open/Save/Save As, Undo/Redo, and Toggle AI are already on the toolbar.
    const win = windowFromEvent(event);
    const menu = Menu.buildFromTemplate([
      {
        label: 'New Window',
        accelerator: 'Ctrl+Shift+N',
        click: () => openNewWindow(win),
      },
      {
        label: 'Settings…',
        accelerator: 'Ctrl+,',
        click: () => sendCommand('settings'),
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'quit' },
    ]);
    menu.popup({ window: win ?? undefined });
  });

  ipcMain.handle('window:new', (event) => {
    openNewWindow(windowFromEvent(event));
  });

  ipcMain.handle('window:setTitle', (event, title: unknown) => {
    const win = windowFromEvent(event);
    if (!win || win.isDestroyed() || typeof title !== 'string') return;
    win.setTitle(title);
  });

  ipcMain.handle('dialog:openFiles', async (event): Promise<OpenFilesResult> => {
    const win = windowFromEvent(event);
    if (!win) return { files: [], errors: [] };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled) return { files: [], errors: [] };
    return readOpenedFiles(result.filePaths);
  });

  ipcMain.handle(
    'dialog:saveFile',
    async (event, payload: SavePayload): Promise<SaveFileResult> => {
      const win = windowFromEvent(event);
      if (!win) return { status: 'cancelled' };

      let target = payload.path;
      if (!target) {
        const result = await dialog.showSaveDialog(win, {
          defaultPath: payload.defaultName ?? 'untitled.txt',
          filters: [
            { name: 'Text Files', extensions: ['txt', 'md', 'json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) return { status: 'cancelled' };
        target = result.filePath;
      }

      const encoding = normalizeEncoding(payload.encoding);
      const eol: LineEnding =
        payload.eol === 'CRLF' || payload.eol === 'CR' || payload.eol === 'LF'
          ? payload.eol
          : 'LF';

      // Another program may have written this file since Basil read it; saving
      // now would silently discard those changes.
      if (!payload.force && payload.expectedMtimeMs) {
        const current = await getMtimeMs(target);
        if (current !== 0 && Math.abs(current - payload.expectedMtimeMs) > 1) {
          return { status: 'conflict', path: target };
        }
      }

      try {
        await writeTextFile(target, payload.content, encoding, eol);
      } catch (err) {
        // Never report a failed write as a save: the tab must stay dirty.
        return { status: 'error', error: describeFsError(err, target) };
      }
      return {
        status: 'saved',
        file: {
          path: target,
          name: path.basename(target),
          encoding,
          eol,
          mtimeMs: await getMtimeMs(target),
        },
      };
    },
  );

  ipcMain.handle(
    'dialog:confirm',
    async (event, options: ConfirmOptions): Promise<number> => {
      const win = windowFromEvent(event);
      const config = {
        type: (options.type ?? 'question') as 'question' | 'warning',
        message: options.message,
        detail: options.detail,
        buttons: options.buttons,
        defaultId: options.defaultId ?? 0,
        cancelId: options.cancelId ?? options.buttons.length - 1,
        noLink: true,
      };
      // Sheet-style on the owning window so it cannot be lost behind it.
      const result = win
        ? await dialog.showMessageBox(win, config)
        : await dialog.showMessageBox(config);
      return result.response;
    },
  );

  ipcMain.handle('shell:openExternal', async (_e, url: unknown) => {
    // Only ever hand the OS a web link: file:// or a local path here would let
    // page content launch arbitrary programs through the shell.
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn(`[basil] refused to open external url with scheme ${parsed.protocol}`);
      return;
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle('path:basename', (_e, filePath: string) => path.basename(filePath));

  /**
   * One controller per renderer, not one per app: a chat started in a second
   * window used to abort the first window's stream, and switching tabs (which
   * calls stopChat) killed every window's response.
   */
  const chatControllers = new Map<number, AbortController>();

  ipcMain.handle('ai:chat-abort', (event) => {
    chatControllers.get(event.sender.id)?.abort();
  });

  ipcMain.handle(
    'ai:chat',
    async (
      event,
      payload: {
        messages: Array<{ role: string; content: string }>;
        fileContext?: Array<{ name: string; path?: string; content: string }>;
      },
    ) => {
      const sender = event.sender;
      // Only this window's previous request is superseded.
      chatControllers.get(sender.id)?.abort();
      const controller = new AbortController();
      chatControllers.set(sender.id, controller);

      // An endpoint that accepts the connection and then goes quiet would
      // otherwise leave the sidebar saying "Thinking…" forever.
      let idleTimer: NodeJS.Timeout | null = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), AI_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();

      const baseUrl = resolveAiBaseUrl(aiConfig).replace(/\/$/, '');
      const url = `${baseUrl}/chat/completions`;

      // Only trust a single current-file context from the renderer.
      const singleFile =
        payload.fileContext && payload.fileContext.length > 0
          ? [payload.fileContext[0]]
          : [];

      const contextBlock =
        singleFile.length > 0
          ? [
              {
                role: 'system',
                content:
                  'The user has shared the following file contents for read-only reference. You may discuss and analyze them, but you cannot edit or write files. Do not claim to have modified any files. Only this one file is in scope.\n\n' +
                  singleFile
                    .map(
                      (f) =>
                        `--- FILE: ${f.name}${f.path ? ` (${f.path})` : ''} ---\n${f.content}\n--- END FILE ---`,
                    )
                    .join('\n\n'),
              },
            ]
          : [];

      const systemMessages = [
        {
          role: 'system',
          content:
            aiConfig.systemPrompt ||
            'You are Basil AI, a helpful assistant embedded in the Basil text editor. You can read the current file contents the user shares, but you cannot edit or write files.',
        },
        ...contextBlock,
      ];

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (aiConfig.apiKey) {
        headers.Authorization = `Bearer ${aiConfig.apiKey}`;
      }

      let fullText = '';

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: aiConfig.model,
            messages: [...systemMessages, ...capChatHistory(payload.messages ?? [])],
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(
            `AI request failed (${response.status}): ${errText || response.statusText}`,
          );
        }

        if (!response.body) {
          throw new Error('AI response had no body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const chunk = json.choices?.[0]?.delta?.content ?? '';
              if (chunk) {
                fullText += chunk;
                if (!sender.isDestroyed()) {
                  sender.send('ai:chat-chunk', chunk);
                }
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        return { content: fullText };
      } catch (err) {
        if (controller.signal.aborted) {
          return { content: fullText, aborted: true };
        }
        throw err;
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (chatControllers.get(sender.id) === controller) {
          chatControllers.delete(sender.id);
        }
      }
    },
  );

  nativeTheme.on('updated', () => {
    // The OS just changed theme, so the cached registry read is now stale.
    cachedAppsPreferDark = undefined;
    if (preferences.theme === 'system') {
      broadcastTheme();
    }
  });
}

installGlobalErrorHandlers();

app
  .whenReady()
  .then(async () => {
    if (!gotSingleInstanceLock) return;
    await ensureBasilConfig();
    buildAppMenu();
    registerIpc();
    createWindow({ show: !(startHidden && shouldKeepInTray()) });

    if (quarantinedConfigs.length > 0) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Basil settings reset',
        message: `Could not read ${quarantinedConfigs.join(' and ')}.`,
        detail:
          'The unreadable file was renamed with a ".corrupt" suffix in your .basil ' +
          'folder and Basil started with default settings.',
        buttons: ['OK'],
      });
    }
  })
  .catch((err) => {
    // Without this the process would sit alive with no window and no message.
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error('[basil] startup failed:', message);
    dialog.showErrorBox('Basil could not start', message);
    app.exit(1);
  });

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (shouldKeepInTray() && !isQuitting) return;
  void pendingSessionWrite.finally(() => app.quit());
});

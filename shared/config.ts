export type ThemePreference = 'system' | 'light' | 'dark';

/** Editor typeface preference. */
export type EditorFontId =
  | 'default'
  | 'google-sans'
  | 'jetbrains-mono'
  | 'nunito'
  | 'ubuntu';

export type ToolbarActionId =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'find'
  | 'replace'
  | 'wordWrap'
  | 'indentGuides'
  | 'toggleSyntax'
  | 'diff'
  | 'toggleAi';

export type Preferences = {
  theme: ThemePreference;
  aiEnabled: boolean;
  wordWrap: boolean;
  indentGuides: boolean;
  highlightCurrentLine: boolean;
  stickyScroll: boolean;
  /** Editor font size in pixels. */
  fontSize: number;
  /** Editor typeface. */
  fontFamily: EditorFontId;
  /** Show the bottom status bar with file and cursor stats. */
  statusBarVisible: boolean;
  /** Keep running in the tray when the window is closed (faster reopen). */
  stayInTray: boolean;
  /** Launch silently to the tray when the user signs in. */
  startWithBoot: boolean;
  toolbarActions: ToolbarActionId[];
  /**
   * Which generation of the default toolbar this file was last written against.
   * Newly introduced actions are merged in once, when an older file is upgraded —
   * after that the user's choices are respected verbatim.
   */
  toolbarVersion?: number;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type AiPreset = 'lmstudio' | 'xai' | 'custom';

export type AiConfig = {
  preset: AiPreset;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
};

export type ThemeEffective = {
  preference: ThemePreference;
  shouldUseDarkColors: boolean;
};

export const DEFAULT_TOOLBAR: ToolbarActionId[] = [
  'new',
  'open',
  'save',
  'saveAs',
  'undo',
  'redo',
  'find',
  'replace',
  'wordWrap',
  'indentGuides',
  'toggleSyntax',
  'diff',
  'toggleAi',
];

/** Current generation of DEFAULT_TOOLBAR; bump when new default actions are added. */
export const TOOLBAR_VERSION = 1;

/** Ids that existed before newer view/edit toolbar actions were added. */
const LEGACY_TOOLBAR_IDS = new Set([
  'new',
  'open',
  'save',
  'saveAs',
  'undo',
  'redo',
  'toggleAi',
  'theme',
  'settings',
]);

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

/** Default first; remaining fonts alphabetical by label. */
export const EDITOR_FONTS: { id: EditorFontId; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'google-sans', label: 'Google Sans' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono' },
  { id: 'nunito', label: 'Nunito' },
  { id: 'ubuntu', label: 'Ubuntu' },
];

const EDITOR_FONT_STACKS: Record<EditorFontId, string> = {
  default: "Cascadia Code, Consolas, 'Courier New', monospace",
  'google-sans': "'Google Sans', sans-serif",
  'jetbrains-mono': "'JetBrains Mono', monospace",
  nunito: "Nunito, sans-serif",
  ubuntu: "Ubuntu, sans-serif",
};

export function resolveEditorFontFamily(id: EditorFontId): string {
  return EDITOR_FONT_STACKS[id] ?? EDITOR_FONT_STACKS.default;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  aiEnabled: true,
  wordWrap: true,
  indentGuides: true,
  highlightCurrentLine: true,
  stickyScroll: true,
  fontSize: 14,
  fontFamily: 'default',
  // On by default now that it carries the encoding and line-ending pickers.
  statusBarVisible: true,
  stayInTray: false,
  startWithBoot: false,
  toolbarActions: [...DEFAULT_TOOLBAR],
  toolbarVersion: TOOLBAR_VERSION,
};

export const AI_PRESETS: Record<
  Exclude<AiPreset, 'custom'>,
  { baseUrl: string; model: string; label: string }
> = {
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
  },
  xai: {
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3',
  },
};

export const DEFAULT_AI: AiConfig = {
  preset: 'lmstudio',
  baseUrl: AI_PRESETS.lmstudio.baseUrl,
  apiKey: '',
  model: AI_PRESETS.lmstudio.model,
  systemPrompt:
    'You are Basil AI, a helpful assistant in the Basil text editor. You can read the current file contents but cannot edit or write files.',
};

const VALID_TOOLBAR = new Set<string>(DEFAULT_TOOLBAR);

/** Strip removed toolbar ids and keep canonical order. */
export function normalizePreferences(raw: Partial<Preferences> & Record<string, unknown>): Preferences {
  // Drop legacy global sidebar visibility — open state is now per tab.
  const { aiSidebarVisible: _legacySidebar, ...rest } = raw;

  const merged: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...rest,
    theme: normalizeTheme(rest.theme) ?? DEFAULT_PREFERENCES.theme,
    wordWrap: typeof rest.wordWrap === 'boolean' ? rest.wordWrap : DEFAULT_PREFERENCES.wordWrap,
    indentGuides:
      typeof rest.indentGuides === 'boolean'
        ? rest.indentGuides
        : DEFAULT_PREFERENCES.indentGuides,
    highlightCurrentLine:
      typeof rest.highlightCurrentLine === 'boolean'
        ? rest.highlightCurrentLine
        : DEFAULT_PREFERENCES.highlightCurrentLine,
    stickyScroll:
      typeof rest.stickyScroll === 'boolean'
        ? rest.stickyScroll
        : DEFAULT_PREFERENCES.stickyScroll,
    fontSize: normalizeFontSize(rest.fontSize),
    fontFamily: normalizeFontFamily(rest.fontFamily),
    statusBarVisible:
      typeof rest.statusBarVisible === 'boolean'
        ? rest.statusBarVisible
        : DEFAULT_PREFERENCES.statusBarVisible,
    stayInTray:
      typeof rest.stayInTray === 'boolean' ? rest.stayInTray : DEFAULT_PREFERENCES.stayInTray,
    startWithBoot:
      typeof rest.startWithBoot === 'boolean'
        ? rest.startWithBoot
        : DEFAULT_PREFERENCES.startWithBoot,
    toolbarActions: DEFAULT_PREFERENCES.toolbarActions,
    toolbarVersion: TOOLBAR_VERSION,
  };

  const fromFile = Array.isArray(rest.toolbarActions)
    ? (rest.toolbarActions as unknown[])
    : [];
  const cleaned = fromFile.filter(
    (id): id is ToolbarActionId => typeof id === 'string' && VALID_TOOLBAR.has(id),
  );

  if (cleaned.length > 0) {
    // Only a file predating toolbarVersion gets newly introduced actions merged in.
    // Doing this on every load would silently undo the user unchecking an action.
    if (rest.toolbarVersion !== TOOLBAR_VERSION) {
      for (const id of DEFAULT_TOOLBAR) {
        if (!LEGACY_TOOLBAR_IDS.has(id) && !cleaned.includes(id)) {
          cleaned.push(id);
        }
      }
    }
    cleaned.sort((a, b) => DEFAULT_TOOLBAR.indexOf(a) - DEFAULT_TOOLBAR.indexOf(b));
    merged.toolbarActions = cleaned;
  }

  const bounds = normalizeWindowBounds(rest.windowBounds);
  if (bounds) {
    merged.windowBounds = bounds;
  } else {
    delete merged.windowBounds;
  }

  return merged;
}

/** Reject non-finite or nonsensical saved bounds; a NaN here reaches BrowserWindow. */
function normalizeWindowBounds(value: unknown): Preferences['windowBounds'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const parts = (['x', 'y', 'width', 'height'] as const).map((key) => raw[key]);
  if (!parts.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) {
    return undefined;
  }
  const [x, y, width, height] = parts as number[];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function normalizeTheme(value: unknown): ThemePreference | undefined {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  return undefined;
}

function normalizeFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PREFERENCES.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));
}

const VALID_EDITOR_FONTS = new Set<string>(EDITOR_FONTS.map((f) => f.id));

function normalizeFontFamily(value: unknown): EditorFontId {
  if (typeof value === 'string' && VALID_EDITOR_FONTS.has(value)) {
    return value as EditorFontId;
  }
  return DEFAULT_PREFERENCES.fontFamily;
}

const VALID_PRESETS = new Set<string>(['lmstudio', 'xai', 'custom']);

/**
 * Validate an ai.json that may have been hand-edited. Without this an unknown
 * preset makes AI_PRESETS[preset] undefined and every chat and health check
 * throws deep inside resolveAiBaseUrl.
 */
export function normalizeAiConfig(raw: unknown): AiConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;
  return {
    preset: VALID_PRESETS.has(obj.preset as string)
      ? (obj.preset as AiPreset)
      : DEFAULT_AI.preset,
    baseUrl: str(obj.baseUrl, DEFAULT_AI.baseUrl),
    apiKey: str(obj.apiKey, DEFAULT_AI.apiKey),
    model: str(obj.model, DEFAULT_AI.model),
    systemPrompt: str(obj.systemPrompt, DEFAULT_AI.systemPrompt),
  };
}

/** Total over any input: never throws, always yields a usable URL. */
export function resolveAiBaseUrl(config: AiConfig): string {
  const fallback = AI_PRESETS.lmstudio.baseUrl;
  if (config?.preset === 'custom') {
    return config.baseUrl?.trim() || fallback;
  }
  const preset = AI_PRESETS[config?.preset as Exclude<AiPreset, 'custom'>];
  return preset?.baseUrl ?? config?.baseUrl?.trim() ?? fallback;
}

/** True when AI settings look complete enough to attempt a connection. */
export function isAiConfigured(config: AiConfig): boolean {
  const baseUrl = resolveAiBaseUrl(config).trim();
  if (!baseUrl || !config?.model?.trim()) return false;
  const apiKey = config.apiKey?.trim() ?? '';
  if (config.preset === 'xai' && !apiKey) return false;
  if (config.preset === 'custom') {
    const local = /localhost|127\.0\.0\.1/i.test(baseUrl);
    if (!local && !apiKey) return false;
  }
  return true;
}

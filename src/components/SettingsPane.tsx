import { useEffect, useState } from 'react';
import {
  AI_PRESETS,
  DEFAULT_TOOLBAR,
  EDITOR_FONTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  resolveEditorFontFamily,
  type AiConfig,
  type AiPreset,
  type Preferences,
  type ThemePreference,
  type ToolbarActionId,
} from '../../shared/config';
import type { AiCheckResult } from '../../shared/api';
import { version } from '../../package.json';

type Props = {
  preferences: Preferences;
  aiConfig: AiConfig;
  onSave: (prefs: Preferences, ai: AiConfig) => Promise<void>;
};

const TOOLBAR_LABELS: Record<ToolbarActionId, string> = {
  new: 'New',
  open: 'Open',
  save: 'Save',
  saveAs: 'Save As',
  undo: 'Undo',
  redo: 'Redo',
  find: 'Find',
  replace: 'Find and Replace',
  wordWrap: 'Word Wrap',
  indentGuides: 'Indent Guides',
  toggleSyntax: 'Syntax Highlighting',
  diff: 'Diff',
  toggleAi: 'Toggle AI',
};

export function SettingsPane({ preferences, aiConfig, onSave }: Props) {
  const [prefs, setPrefs] = useState(preferences);
  const [ai, setAi] = useState(aiConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiCheckResult | null>(null);

  useEffect(() => {
    setPrefs(preferences);
    setAi(aiConfig);
  }, [preferences, aiConfig]);

  /** Save any pending edits first, then probe the endpoint they describe. */
  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      await onSave(prefs, ai);
      setTestResult(await window.basil.checkAi());
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  }

  function persist(nextPrefs: Preferences, nextAi: AiConfig) {
    setPrefs(nextPrefs);
    setAi(nextAi);
    void onSave(nextPrefs, nextAi);
  }

  function applyPreset(preset: AiPreset) {
    if (preset === 'custom') {
      persist(prefs, { ...ai, preset });
      return;
    }
    const p = AI_PRESETS[preset];
    persist(prefs, {
      ...ai,
      preset,
      baseUrl: p.baseUrl,
      model: ai.preset === preset ? ai.model : p.model,
    });
  }

  function toggleToolbar(id: ToolbarActionId) {
    const has = prefs.toolbarActions.includes(id);
    if (has && prefs.toolbarActions.length <= 1) return;
    const toolbarActions = has
      ? prefs.toolbarActions.filter((a) => a !== id)
      : [...prefs.toolbarActions, id];
    const order = DEFAULT_TOOLBAR;
    toolbarActions.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    persist({ ...prefs, toolbarActions }, ai);
  }

  function saveAiOnBlur() {
    if (
      ai.baseUrl === aiConfig.baseUrl &&
      ai.apiKey === aiConfig.apiKey &&
      ai.model === aiConfig.model &&
      ai.systemPrompt === aiConfig.systemPrompt &&
      ai.preset === aiConfig.preset
    ) {
      return;
    }
    void onSave(prefs, ai);
  }

  return (
    <div className="settings-pane">
      <header className="settings-header">
        <h2>Settings</h2>
        <span className="settings-version">v{version}</span>
      </header>

      <div className="settings-sections">
        <section className="settings-section">
          <h3 className="settings-section-heading">Appearance</h3>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="theme">Theme</label>
              <select
                id="theme"
                value={prefs.theme}
                onChange={(e) =>
                  persist({ ...prefs, theme: e.target.value as ThemePreference }, ai)
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="fontSize">Font size</label>
              <select
                id="fontSize"
                value={prefs.fontSize}
                onChange={(e) =>
                  persist({ ...prefs, fontSize: Number(e.target.value) }, ai)
                }
              >
                {Array.from(
                  { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
                  (_, i) => FONT_SIZE_MIN + i,
                ).map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label id="fontFamily-label">Font</label>
              <div
                className="font-picker"
                role="listbox"
                aria-labelledby="fontFamily-label"
              >
                {EDITOR_FONTS.map((font) => {
                  const selected = prefs.fontFamily === font.id;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected ? 'font-picker-option is-selected' : 'font-picker-option'
                      }
                      style={{ fontFamily: resolveEditorFontFamily(font.id) }}
                      onClick={() =>
                        persist({ ...prefs, fontFamily: font.id }, ai)
                      }
                    >
                      {font.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="settings-toggle">
              <span className="settings-toggle-title">Highlight current line</span>
              <input
                type="checkbox"
                checked={prefs.highlightCurrentLine}
                onChange={(e) =>
                  persist({ ...prefs, highlightCurrentLine: e.target.checked }, ai)
                }
              />
            </label>

            <label className="settings-toggle">
              <span className="settings-toggle-title">Sticky scroll</span>
              <input
                type="checkbox"
                checked={prefs.stickyScroll}
                onChange={(e) =>
                  persist({ ...prefs, stickyScroll: e.target.checked }, ai)
                }
              />
            </label>

            <label className="settings-toggle">
              <span className="settings-toggle-title">Status bar</span>
              <input
                type="checkbox"
                checked={prefs.statusBarVisible}
                onChange={(e) =>
                  persist({ ...prefs, statusBarVisible: e.target.checked }, ai)
                }
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-heading">Toolbar</h3>

          <div className="toolbar-customize">
            {DEFAULT_TOOLBAR.map((id) => (
              <label key={id} className="settings-check">
                <input
                  type="checkbox"
                  checked={prefs.toolbarActions.includes(id)}
                  onChange={() => toggleToolbar(id)}
                />
                <span>{TOOLBAR_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-heading">Startup</h3>

          <div className="form-grid">
            <label className="settings-toggle">
              <span className="settings-toggle-title">Stay in system tray</span>
              <input
                type="checkbox"
                checked={prefs.stayInTray}
                onChange={(e) => {
                  const stayInTray = e.target.checked;
                  persist(
                    {
                      ...prefs,
                      stayInTray,
                      // Boot-to-tray needs tray behavior; turn boot off if tray is disabled.
                      startWithBoot: stayInTray ? prefs.startWithBoot : false,
                    },
                    ai,
                  );
                }}
              />
            </label>

            <label className="settings-toggle">
              <span className="settings-toggle-title">Start with boot</span>
              <input
                type="checkbox"
                checked={prefs.startWithBoot}
                onChange={(e) => {
                  const startWithBoot = e.target.checked;
                  persist(
                    {
                      ...prefs,
                      startWithBoot,
                      // Enabling boot also enables stay-in-tray.
                      stayInTray: startWithBoot ? true : prefs.stayInTray,
                    },
                    ai,
                  );
                }}
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-heading">AI</h3>

          <div className="form-grid">
            <label className="settings-toggle">
              <span className="settings-toggle-title">Enable AI integration</span>
              <input
                type="checkbox"
                checked={prefs.aiEnabled}
                onChange={(e) => persist({ ...prefs, aiEnabled: e.target.checked }, ai)}
              />
            </label>

            <div className="ai-config-fields">
              <div className="form-field">
                <label htmlFor="preset">Preset</label>
                <select
                  id="preset"
                  value={ai.preset}
                  disabled={!prefs.aiEnabled}
                  onChange={(e) => applyPreset(e.target.value as AiPreset)}
                >
                  <option value="lmstudio">LM Studio</option>
                  <option value="xai">xAI</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="baseUrl">Base URL</label>
                <input
                  id="baseUrl"
                  value={ai.baseUrl}
                  disabled={!prefs.aiEnabled || ai.preset !== 'custom'}
                  onChange={(e) => setAi((a) => ({ ...a, baseUrl: e.target.value }))}
                  onBlur={saveAiOnBlur}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="form-field">
                <label htmlFor="apiKey">API key</label>
                <input
                  id="apiKey"
                  type="password"
                  value={ai.apiKey}
                  disabled={!prefs.aiEnabled}
                  onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
                  onBlur={saveAiOnBlur}
                  placeholder={ai.preset === 'lmstudio' ? 'Optional for local' : 'Required'}
                />
              </div>

              <div className="form-field">
                <label htmlFor="model">Model</label>
                <input
                  id="model"
                  value={ai.model}
                  disabled={!prefs.aiEnabled}
                  onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
                  onBlur={saveAiOnBlur}
                />
              </div>

              <div className="form-field">
                <label htmlFor="systemPrompt">System prompt</label>
                <textarea
                  id="systemPrompt"
                  rows={3}
                  value={ai.systemPrompt}
                  disabled={!prefs.aiEnabled}
                  onChange={(e) => setAi((a) => ({ ...a, systemPrompt: e.target.value }))}
                  onBlur={saveAiOnBlur}
                />
              </div>

              <div className="form-field">
                <div className="ai-test-row">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!prefs.aiEnabled || testing}
                    onClick={() => void testConnection()}
                  >
                    {testing ? 'Testing…' : 'Test connection'}
                  </button>
                  {testResult ? (
                    <span
                      className={`ai-test-result${testResult.ok ? ' ok' : ' error'}`}
                      role="status"
                    >
                      {testResult.ok ? 'Connected' : testResult.error}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

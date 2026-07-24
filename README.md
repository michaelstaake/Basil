# Basil

**Basil** is an intuitive text editor for Windows with optional AI assistance. Open source and free!

[github.com/michaelstaake/Basil](https://github.com/michaelstaake/Basil)

Versioning is year, month, then build.

## Get Started

Grab the latest `Basil-<version>-setup.exe` (installer) or
`Basil-<version>-portable.exe` (no installation) from the
[releases page](https://github.com/michaelstaake/Basil/releases).

At this time, the executables are not signed, so you may receive Windows SmartScreen warnings. Choose run anyway, or build from source using the steps below (refer to Build section of this document).

## Features
- Built on Monaco editor, which powers popular applications like VS Code.
- Powerful yet easy handling of multiple files with tabs.
- Fully customizable toolbar - make it just the way you want it.
- Dark mode and light mode -the default is to detect the correct theme based on your system preferences.
- Automatically detects correct encoding and line endings.
- Compare your current file state to the original file state with git-style diff feature.
- Optional AI features - compatible with any OpenAI API-compatible provider or service, including LM Studio, LmPanel, OpenRouter, xAI, etc.
- If enabled, each file gets its own AI context that can assist you. AI features are specifically designed to be read-only so you always remain in complete control.
- Basil comes packaged with a portable version, or install it for convenient features like "Open with Basil" context menu, system tray persistence, etc. Alternately, you may build it from source.

Hint: Click the Basil logo in the toolbar to access settings and more features.

## Requirements

- Windows 10/11
- Node.js 22+ (if building from source - otherwise you can just run the included portable or setup executables)


## Development

```bash
npm install
```

```bash
npm run dev
```

Other scripts:

| Script | Purpose |
|--------|---------|
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run icons` | Regenerate `build/icon.png` and `build/icon.ico` from `build/icon.svg` |

## Build

```bash
npm run build
```

Writes `release/Basil-<version>-portable.exe` and `release/Basil-<version>-setup.exe`.
Use `npm run build:dir` for an unpacked build without installers.

Everything the app needs at runtime is bundled into `dist/` by Vite, so
`package.json` has **no production dependencies**. Adding one would ship it a
second time inside `app.asar` — keep new libraries in `devDependencies` unless
they genuinely need to be loaded from disk at runtime.

## Configuration

On first launch Basil creates a hidden folder in your home directory:

`%USERPROFILE%\.basil\`

| File | Purpose |
|------|---------|
| `preferences.json` | Theme, toolbar, editor options, window bounds |
| `ai.json` | API preset, base URL, encrypted API key, model |
| `session.json` | Files to reopen on next launch |
| `logs\main.log` | Main-process log, including crashes |

The API key is encrypted with the Windows credential store (DPAPI) and stored as
`apiKeyEnc`. A file that cannot be parsed is renamed with a `.corrupt-<timestamp>`
suffix and Basil starts with defaults rather than failing to launch.

### AI presets

| Preset | Default base URL |
|--------|------------------|
| LM Studio | `http://localhost:1234/v1` |
| xAI | `https://api.x.ai/v1` |
| Custom | whatever you set |

Use **Test connection** in Settings to check an endpoint. If you start your model
server after Basil, the AI controls appear when the window regains focus.

## Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+Shift+N | New window |
| Ctrl+O | Open |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+F | Find |
| Ctrl+H | Find and replace |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+Shift+B | Toggle AI sidebar |
| Ctrl+, | Settings |
| Middle-click a tab | Close it |

## Credits

- Project Developer and Maintainer: Michael Staake
- Editor: [Monaco Editor](https://microsoft.github.io/monaco-editor/) (MIT)
- Icons: [Lucide](https://lucide.dev/) (ISC)
- Shell: [Electron](https://www.electronjs.org/) (MIT)

## Contributing and Support

Questions or suggestions? Please use GitHub Issues:
[github.com/michaelstaake/Basil](https://github.com/michaelstaake/Basil).

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).

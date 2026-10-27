# Basil

**Basil** is an intuitive text editor for Windows, with a `.deb` package for Ubuntu 26.04 and newer, and optional AI assistance. Open source and free!

[github.com/michaelstaake/Basil](https://github.com/michaelstaake/Basil)

Versioning is year, month, then build. The current release is 26.10.1.

## Get Started

Grab the latest `Basil-<version>-setup.exe` (installer) or
`Basil-<version>-portable.exe` (no installation) from the
[releases page](https://github.com/michaelstaake/Basil/releases).

At this time, the executables are not signed, so you may receive Windows SmartScreen warnings. Choose run anyway, or build from source using the steps below (refer to Build section of this document).

On Ubuntu 26.04 or newer (x64), install the `.deb` the same way:

```bash
sudo apt install ./Basil-<version>-amd64.deb
```

`apt` pulls in GTK and the other libraries the package depends on. Basil then shows up in the applications menu, and under **Open With** for common text files. The current default text editor stays as it is.

## Features
- Built on Monaco editor, which powers popular applications like VS Code.
- Powerful yet easy handling of multiple files with tabs.
- Fully customizable toolbar - make it just the way you want it.
- Dark mode and light mode -the default is to detect the correct theme based on your system preferences.
- Automatically detects correct encoding and line endings.
- Compare your current file state to the original file state with git-style diff feature.
- Optional AI features, off until you turn them on in Settings. Compatible with any OpenAI API-compatible provider or service, including LM Studio, Napa AI Gateway, xAI/SpaceXSI, and custom endpoints such as LmPanel or OpenRouter.
- If enabled, each file gets its own AI context that can assist you. AI features are specifically designed to be read-only so you always remain in complete control.
- Basil comes packaged with a portable version, or install it for convenient features like "Open with Basil" context menu, system tray persistence, etc. The Ubuntu `.deb` adds an applications-menu entry and Open With for common text files. Alternately, you may build it from source.

Hint: Click the Basil logo in the toolbar to access settings and more features.

## Requirements

- Windows 10/11, or Ubuntu 26.04+ (x64) for the `.deb`
- Node.js 22+ (if building from source - otherwise you can just run the included portable or setup executables, or install the `.deb`)


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
| `npm run build:deb` | Linux `.deb` for x64 (`release/Basil-<version>-amd64.deb`) |
| `npm run icons` | Regenerate `build/icon.png`, `build/icon.ico`, and `build/icons/` from `build/icon.svg` |

## Build

```bash
npm run build
```

Writes `release/Basil-<version>-portable.exe` and `release/Basil-<version>-setup.exe`.
Use `npm run build:dir` for an unpacked build without installers.

The Linux package is a separate command. `npm run build` still writes the Windows executables above.

```bash
npm run build:deb
```

Writes `release/Basil-<version>-amd64.deb` (Debian package name `basil`, executable `/usr/bin/basil`). Run it on Linux. electron-builder shells out to `dpkg` and `fakeroot` to assemble the package. The `.deb` depends on the Ubuntu 26.04 library names (`libgtk-3-0t64` and the other `t64` packages), with the older names as alternatives where those still exist. It also depends on glibc 2.25 or newer, which Ubuntu 26.04 (glibc 2.43) satisfies, and on `libudev1`, which the Electron binary links directly. The only Linux target is this `.deb`.

Everything the app needs at runtime is bundled into `dist/` by Vite, so
`package.json` has **no production dependencies**. Adding one would ship it a
second time inside `app.asar` — keep new libraries in `devDependencies` unless
they genuinely need to be loaded from disk at runtime.

## Configuration

On first launch Basil creates a folder in your home directory:

`%USERPROFILE%\.basil\` on Windows, `~/.basil/` on Linux.

On Windows that folder is marked hidden. On Linux the leading dot is what hides it.

| File | Purpose |
|------|---------|
| `preferences.json` | Theme, toolbar, editor options, window bounds |
| `ai.json` | API preset, base URL, encrypted API key, model |
| `session.json` | Files to reopen on next launch |
| `logs\main.log` | Main-process log, including crashes |

The API key is encrypted with the OS keystore (Windows DPAPI, or the Secret Service on Linux) and stored as
`apiKeyEnc`. A file that cannot be parsed is renamed with a `.corrupt-<timestamp>`
suffix and Basil starts with defaults rather than failing to launch. When a Linux Secret Service is available, the key is encrypted with it. Otherwise Basil stores the key in the file so the setting is kept.

### Linux startup

"Start with boot" on Linux writes `~/.config/autostart/com.basil.editor.desktop` (or `$XDG_CONFIG_HOME/autostart/` when that variable is set). Electron's login-item API does not run on Linux, so this is a normal XDG autostart file. It launches `/opt/Basil/basil --hidden`, the same hidden start the Windows Run key uses. Desktops that honor that directory (GNOME, KDE, XFCE, and other freedesktop sessions) will start Basil in the tray.

A few limits:

- A session that ignores `autostart` will not launch Basil at login.
- The tray icon is a PNG. It needs a StatusNotifier host. Ubuntu's desktop includes one (`libayatana-appindicator3-1` is a recommended package). A minimal session with no tray still starts Basil hidden, with no window to click. Turn the setting off, or delete the autostart file, and open Basil from the menu.
- The package install leaves that file alone, and removing the `.deb` leaves it in place. `TryExec` points at the binary, so a removed install is skipped on later logins.
- `npm run dev` removes this file so a dev Electron binary stays off the login list. The Windows NSIS login item is unchanged.

System light and dark mode on Linux follows Electron's `nativeTheme` (the GTK / portal setting).

### AI presets

| Preset | Default base URL |
|--------|------------------|
| LM Studio | `http://localhost:1234/v1` |
| Napa AI Gateway | `https://gateway-api.napa-ai.com/v1` |
| xAI/SpaceXSI | `https://api.x.ai/v1` |
| Custom | whatever you set |

AI is off on a fresh install. Turn on **Enable AI integration** in Settings to use a preset. A saved choice in `preferences.json` is kept.

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

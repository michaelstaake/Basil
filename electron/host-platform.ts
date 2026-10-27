import path from 'node:path';

/**
 * Installed desktop id. electron-builder writes
 * `/usr/share/applications/com.basil.editor.desktop` when `desktopName` is set
 * and `linux.syncDesktopName` is true. Electron uses the same id for WM_CLASS.
 */
export const LINUX_DESKTOP_NAME = 'com.basil.editor';

/** Windows marks `~\.basil` hidden with `attrib +h`. Other platforms use the leading dot. */
export function shouldHideBasilDir(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

export interface TrayIconLocations {
  devIco: string;
  devPng: string;
  resourceIco: string;
  resourcePng: string;
}

/**
 * Linux status icons want a PNG. The packaged file is preferred so a dev tree
 * is not required after install; Windows keeps the `.ico` search it already had.
 */
export function trayIconCandidates(
  platform: NodeJS.Platform,
  locations: TrayIconLocations,
): string[] {
  if (platform === 'linux') {
    return [
      locations.resourcePng,
      locations.devPng,
      locations.resourceIco,
      locations.devIco,
    ];
  }
  return [locations.devIco, locations.devPng, locations.resourceIco];
}

/** Characters that must be quoted in a freedesktop `Exec` value. */
const DESKTOP_EXEC_RESERVED = /[\s"'`\\<>~|&;$*?#()%]/;

/**
 * Quote one `Exec` argument. Field codes (`%f`, `%U`, …) stay bare so the
 * launcher expands them. `%` inside a real argument is escaped as `%%`.
 */
export function quoteDesktopExecArg(arg: string): string {
  if (/^%[a-zA-Z]$/.test(arg)) return arg;
  const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
  if (DESKTOP_EXEC_RESERVED.test(arg)) return `"${escaped}"`;
  return escaped;
}

export function linuxAutostartDesktopPath(home: string, xdgConfigHome: string | undefined): string {
  const configHome = xdgConfigHome?.trim() || path.join(home, '.config');
  return path.join(configHome, 'autostart', `${LINUX_DESKTOP_NAME}.desktop`);
}

/**
 * Per-user XDG autostart entry. Electron's `setLoginItemSettings` is
 * macOS/Windows only, so Linux login startup is this file.
 * `--hidden` matches the Windows Run key (`basil` → `"exe" --hidden`).
 */
export function renderLinuxAutostartDesktop(options: {
  execPath: string;
  hidden: boolean;
}): string {
  const exec = [
    quoteDesktopExecArg(options.execPath),
    ...(options.hidden ? ['--hidden'] : []),
  ].join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Basil',
    'Comment=Basil Text Editor',
    `Exec=${exec}`,
    `TryExec=${quoteDesktopExecArg(options.execPath)}`,
    'Terminal=false',
    'Icon=basil',
    'X-GNOME-Autostart-enabled=true',
    'StartupNotify=false',
    '',
  ].join('\n');
}

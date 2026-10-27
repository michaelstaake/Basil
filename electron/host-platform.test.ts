import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LINUX_DESKTOP_NAME,
  linuxAutostartDesktopPath,
  quoteDesktopExecArg,
  renderLinuxAutostartDesktop,
  shouldHideBasilDir,
  trayIconCandidates,
} from './host-platform';

const trayLocations = {
  devIco: 'dev.ico',
  devPng: 'dev.png',
  resourceIco: 'res.ico',
  resourcePng: 'res.png',
};

describe('shouldHideBasilDir', () => {
  it('uses attrib only on Windows', () => {
    expect(shouldHideBasilDir('win32')).toBe(true);
    expect(shouldHideBasilDir('linux')).toBe(false);
    expect(shouldHideBasilDir('darwin')).toBe(false);
  });
});

describe('trayIconCandidates', () => {
  it('searches PNG before ICO on Linux', () => {
    expect(trayIconCandidates('linux', trayLocations)).toEqual([
      'res.png',
      'dev.png',
      'res.ico',
      'dev.ico',
    ]);
  });

  it('keeps the Windows ico, png, resource-ico order', () => {
    expect(trayIconCandidates('win32', trayLocations)).toEqual([
      'dev.ico',
      'dev.png',
      'res.ico',
    ]);
  });
});

describe('linux autostart desktop file', () => {
  it('places the file under XDG_CONFIG_HOME when that is set', () => {
    expect(linuxAutostartDesktopPath('/home/me', '/tmp/cfg')).toBe(
      path.join('/tmp/cfg', 'autostart', `${LINUX_DESKTOP_NAME}.desktop`),
    );
  });

  it('falls back to ~/.config/autostart', () => {
    expect(linuxAutostartDesktopPath('/home/me', '   ')).toBe(
      path.join('/home/me', '.config', 'autostart', `${LINUX_DESKTOP_NAME}.desktop`),
    );
  });

  it('launches the packaged binary hidden, matching the Windows Run key', () => {
    const text = renderLinuxAutostartDesktop({
      execPath: '/opt/Basil/basil',
      hidden: true,
    });
    expect(text.startsWith('[Desktop Entry]\n')).toBe(true);
    expect(text).toContain('Exec=/opt/Basil/basil --hidden\n');
    expect(text).toContain('TryExec=/opt/Basil/basil\n');
    expect(text).toContain('X-GNOME-Autostart-enabled=true\n');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('quotes an executable path that contains spaces', () => {
    expect(quoteDesktopExecArg('/opt/My Apps/basil')).toBe('"/opt/My Apps/basil"');
    const text = renderLinuxAutostartDesktop({
      execPath: '/opt/My Apps/basil',
      hidden: true,
    });
    expect(text).toContain('Exec="/opt/My Apps/basil" --hidden\n');
  });

  it('escapes percent signs so the launcher does not treat them as field codes', () => {
    expect(quoteDesktopExecArg('/opt/100%/basil')).toBe('"/opt/100%%/basil"');
  });

  it('leaves freedesktop field codes unquoted', () => {
    expect(quoteDesktopExecArg('%U')).toBe('%U');
    expect(quoteDesktopExecArg('%f')).toBe('%f');
  });
});

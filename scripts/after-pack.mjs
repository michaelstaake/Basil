import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Basil's UI is English-only, but Electron ships ~55 locale packs (~47 MB).
 * Chromium falls back to en-US.pak for any locale it cannot find, so keeping
 * only that one costs nothing and takes a large bite out of the installer.
 */
const KEEP_LOCALES = new Set(['en-US.pak']);

export default async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  let entries;
  try {
    entries = await fs.readdir(localesDir);
  } catch {
    return; // No locales directory on this platform.
  }

  let removed = 0;
  let freed = 0;
  for (const entry of entries) {
    if (KEEP_LOCALES.has(entry)) continue;
    const target = path.join(localesDir, entry);
    try {
      freed += (await fs.stat(target)).size;
      await fs.rm(target, { force: true });
      removed++;
    } catch {
      // Leaving a locale behind is harmless; never fail the build over it.
    }
  }

  if (removed > 0) {
    console.log(
      `  • pruned ${removed} unused locale packs  freed=${(freed / 1024 / 1024).toFixed(1)}MB`,
    );
  }
}

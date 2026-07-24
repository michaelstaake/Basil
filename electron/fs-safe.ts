import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Files larger than this are refused rather than loaded: the whole file becomes a
 * JS string in the renderer and is handed to Monaco, so a multi-GB file would
 * freeze (or kill) the window.
 */
export const MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor(
    readonly filePath: string,
    readonly size: number,
    readonly limit: number,
  ) {
    super(
      `${path.basename(filePath)} is ${formatBytes(size)}, larger than the ${formatBytes(
        limit,
      )} limit.`,
    );
    this.name = 'FileTooLargeError';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Human-readable reason for a failed fs operation. */
export function describeFsError(err: unknown, filePath?: string): string {
  if (err instanceof FileTooLargeError) return err.message;
  const name = filePath ? path.basename(filePath) : 'The file';
  // Errors we raised ourselves already read as a sentence.
  if (err instanceof Error && err.name === 'BinaryFileError') return err.message;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return `${name} no longer exists.`;
    case 'EACCES':
    case 'EPERM':
      return `${name} is read-only or you do not have permission to write it.`;
    case 'EBUSY':
      return `${name} is open in another program.`;
    case 'EISDIR':
      return `${name} is a folder, not a file.`;
    case 'ENOSPC':
      return 'The disk is full.';
    case 'EROFS':
      return `${name} is on a read-only drive.`;
    default:
      return err instanceof Error ? err.message : `Could not access ${name}.`;
  }
}

/**
 * Write via a sibling temp file + rename so an interrupted write can never leave
 * the destination truncated: either the old bytes or the new bytes survive.
 * `fsync` before the rename so the data is on disk, not just in the page cache.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    // Windows MoveFileEx replaces an existing destination; a read-only or locked
    // destination fails here and is reported instead of silently losing the edit.
    await fs.rename(tmp, filePath);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Read a file as bytes, refusing anything over `limit`. */
export async function readFileCapped(
  filePath: string,
  limit = MAX_TEXT_FILE_BYTES,
): Promise<Buffer> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    const err: NodeJS.ErrnoException = new Error(`${filePath} is not a file`);
    err.code = stat.isDirectory() ? 'EISDIR' : 'EINVAL';
    throw err;
  }
  if (stat.size > limit) {
    throw new FileTooLargeError(filePath, stat.size, limit);
  }
  return fs.readFile(filePath);
}

/**
 * Delete temp files left behind when the process died between the write and the
 * rename. The data is safe either way — the destination still holds the previous
 * bytes — but without this the config folder accumulates litter after crashes.
 */
export async function sweepStaleTempFiles(dir: string): Promise<number> {
  let removed = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
      try {
        await fs.unlink(path.join(dir, name));
        removed++;
      } catch {
        // Someone else's temp file, or in use; leave it.
      }
    }
  } catch {
    // Directory unreadable; nothing to sweep.
  }
  return removed;
}

/**
 * Move a file that failed to parse aside so the app can fall back to defaults
 * without destroying whatever the user (or a crash) left behind.
 * Returns the quarantine path, or null if it could not be moved.
 */
export async function quarantineFile(filePath: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${filePath}.corrupt-${stamp}`;
  try {
    await fs.rename(filePath, target);
    return target;
  } catch {
    return null;
  }
}

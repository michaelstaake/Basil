import fsSync from 'node:fs';
import path from 'node:path';

/**
 * A packaged Electron app has no console attached, so without a log file a crash
 * leaves nothing to diagnose. This writes a single rotating file and mirrors
 * console output into it.
 */

const MAX_LOG_BYTES = 1024 * 1024;

let logPath: string | null = null;
let stream: fsSync.WriteStream | null = null;

function rotateIfNeeded(file: string): void {
  try {
    const stat = fsSync.statSync(file);
    if (stat.size < MAX_LOG_BYTES) return;
    fsSync.renameSync(file, `${file}.1`);
  } catch {
    // No existing log, or it cannot be rotated; either way just keep going.
  }
}

function write(level: string, args: unknown[]): void {
  if (!stream) return;
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  try {
    stream.write(`${new Date().toISOString()} [${level}] ${text}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

/**
 * Start file logging in `dir` and route console output through it.
 * Safe to call once; later calls are ignored.
 */
export function initLogger(dir: string): string | null {
  if (stream) return logPath;
  try {
    const logDir = path.join(dir, 'logs');
    fsSync.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'main.log');
    rotateIfNeeded(file);
    stream = fsSync.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
    logPath = file;
  } catch {
    return null;
  }

  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level.toUpperCase(), args);
    };
  }

  write('INFO', [`--- Basil started (pid ${process.pid}) ---`]);
  return logPath;
}

export function getLogPath(): string | null {
  return logPath;
}

/**
 * Log what would otherwise be an invisible crash. Deliberately does not exit:
 * an unhandled rejection in one IPC handler should not close the user's editor
 * with unsaved work in it.
 */
export function installGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    console.error('[basil] uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[basil] unhandled rejection:', reason);
  });
}

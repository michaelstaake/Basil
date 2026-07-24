import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// Resolve the local CLI so this works when invoked via `node` (CI) as well as
// `npm run` (which puts node_modules/.bin on PATH).
const electronBuilderCli = require.resolve('electron-builder/cli.js');

/**
 * electron-builder extracts Electron into release/win-unpacked.tmp and renames it
 * onto release/win-unpacked. On Windows that rename intermittently fails with
 * EPERM: a virus scanner still has handles open on the ~300MB of freshly written
 * binaries. electron-builder does not retry, so the whole build fails.
 *
 * The lock clears within seconds, so clean the directories and retry the build
 * rather than leaving the developer to run it again by hand.
 */
function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until);
}

function removeStaleDirs() {
  for (const stale of ['win-unpacked.tmp', 'win-unpacked']) {
    const dir = path.join(root, 'release', stale);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (err) {
      console.warn(`Could not remove release/${stale}: ${err.message}`);
    }
    if (existsSync(dir)) console.warn(`release/${stale} still exists after cleanup.`);
  }
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join('');

// File Version (PE Details) = appVersion.buildDatetime, e.g. 1.0.2.20260722165342
// Product / app version stays package.json "version" (e.g. 1.0.2).
const buildVersion = `${pkg.version}.${stamp}`;
console.log(`File version: ${buildVersion}`);

const MAX_ATTEMPTS = 3;
let status = 1;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  removeStaleDirs();

  const result = spawnSync(
    process.execPath,
    [electronBuilderCli, ...process.argv.slice(2), `-c.buildVersion=${buildVersion}`],
    { stdio: 'inherit', cwd: root },
  );

  status = result.status ?? 1;
  if (status === 0) break;

  // Only the file-lock failure is worth retrying, and it always leaves the
  // half-extracted win-unpacked.tmp behind. Anything else (a config error, a
  // missing binary) would just fail again more slowly.
  const lockFailure = existsSync(path.join(root, 'release', 'win-unpacked.tmp'));
  if (!lockFailure) break;

  if (attempt < MAX_ATTEMPTS) {
    // Progressive backoff: a scanner working through ~300MB, or handles from a
    // Basil instance that was just closed, can take a while to clear.
    const waitMs = attempt * 15000;
    console.warn(
      `\nBuild attempt ${attempt} failed. This is usually a transient file lock on ` +
        `release/win-unpacked (a running Basil.exe, or a virus scanner reading the ` +
        `freshly extracted runtime). Retrying in ${waitMs / 1000}s…\n`,
    );
    sleepSync(waitMs);
  }
}

process.exit(status);

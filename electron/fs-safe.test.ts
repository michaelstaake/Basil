import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FileTooLargeError,
  describeFsError,
  formatBytes,
  quarantineFile,
  readFileCapped,
  sweepStaleTempFiles,
  writeFileAtomic,
} from './fs-safe';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'basil-fs-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('creates a new file', async () => {
    const target = path.join(dir, 'new.txt');
    await writeFileAtomic(target, 'hello');
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
  });

  it('replaces existing content', async () => {
    const target = path.join(dir, 'x.txt');
    await fs.writeFile(target, 'old content that is longer');
    await writeFileAtomic(target, 'new');
    expect(await fs.readFile(target, 'utf8')).toBe('new');
  });

  it('leaves no temp files behind on success', async () => {
    const target = path.join(dir, 'x.txt');
    await writeFileAtomic(target, 'a');
    await writeFileAtomic(target, 'b');
    expect(await fs.readdir(dir)).toEqual(['x.txt']);
  });

  it('preserves the original file and cleans up when the write fails', async () => {
    const target = path.join(dir, 'x.txt');
    await fs.writeFile(target, 'original');
    // A directory in place of the temp file's parent makes open() fail.
    const bad = path.join(dir, 'missing-dir', 'x.txt');
    await expect(writeFileAtomic(bad, 'nope')).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect(await fs.readdir(dir)).toEqual(['x.txt']);
  });

  it('writes binary data unchanged', async () => {
    const target = path.join(dir, 'bin');
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
    await writeFileAtomic(target, bytes);
    expect(new Uint8Array(await fs.readFile(target))).toEqual(bytes);
  });
});

describe('readFileCapped', () => {
  it('reads a small file', async () => {
    const target = path.join(dir, 'x.txt');
    await fs.writeFile(target, 'hi');
    expect((await readFileCapped(target)).toString('utf8')).toBe('hi');
  });

  it('refuses a file over the limit', async () => {
    const target = path.join(dir, 'big.txt');
    await fs.writeFile(target, 'x'.repeat(2048));
    await expect(readFileCapped(target, 1024)).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('refuses a directory', async () => {
    await expect(readFileCapped(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

describe('quarantineFile', () => {
  it('renames the file out of the way and returns the new path', async () => {
    const target = path.join(dir, 'preferences.json');
    await fs.writeFile(target, '{ broken');
    const moved = await quarantineFile(target);
    expect(moved).toBeTruthy();
    expect(await fs.readFile(moved!, 'utf8')).toBe('{ broken');
    await expect(fs.access(target)).rejects.toThrow();
  });

  it('returns null when the file cannot be moved', async () => {
    expect(await quarantineFile(path.join(dir, 'does-not-exist.json'))).toBeNull();
  });
});

describe('sweepStaleTempFiles', () => {
  it('removes leftover temp files from an interrupted write', async () => {
    await fs.writeFile(path.join(dir, '.preferences.json.123.456.tmp'), 'x');
    await fs.writeFile(path.join(dir, '.session.json.9.9.tmp'), 'x');
    await fs.writeFile(path.join(dir, 'preferences.json'), '{}');

    expect(await sweepStaleTempFiles(dir)).toBe(2);
    expect(await fs.readdir(dir)).toEqual(['preferences.json']);
  });

  it('leaves real config files alone', async () => {
    await fs.writeFile(path.join(dir, 'ai.json'), '{}');
    await fs.writeFile(path.join(dir, 'notes.tmp'), 'not ours');
    expect(await sweepStaleTempFiles(dir)).toBe(0);
    expect((await fs.readdir(dir)).sort()).toEqual(['ai.json', 'notes.tmp']);
  });

  it('does not throw on a missing directory', async () => {
    expect(await sweepStaleTempFiles(path.join(dir, 'nope'))).toBe(0);
  });
});

describe('describeFsError', () => {
  it('explains common error codes in terms of the file', () => {
    const err: NodeJS.ErrnoException = new Error('x');
    err.code = 'EACCES';
    expect(describeFsError(err, 'C:\\a\\notes.txt')).toContain('notes.txt');
    expect(describeFsError(err, 'C:\\a\\notes.txt')).toMatch(/read-only|permission/);
  });

  it('passes through a size error', () => {
    const err = new FileTooLargeError('C:\\a\\big.log', 100, 50);
    expect(describeFsError(err)).toBe(err.message);
  });

  it('falls back to the raw message', () => {
    expect(describeFsError(new Error('weird'), 'a.txt')).toBe('weird');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});

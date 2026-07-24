import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BinaryFileError, readTextFile, writeTextFile } from './file-io';
import { encode, type EncodingId } from '../shared/encoding';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'basil-io-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeRaw(name: string, bytes: Uint8Array): Promise<string> {
  const target = path.join(dir, name);
  await fs.writeFile(target, bytes);
  return target;
}

describe('readTextFile', () => {
  it('reports the encoding and line endings it found', async () => {
    const target = await writeRaw('crlf.txt', encode('a\r\nb\r\nc', 'utf-8'));
    const file = await readTextFile(target);
    expect(file).toMatchObject({
      name: 'crlf.txt',
      content: 'a\r\nb\r\nc',
      encoding: 'utf-8',
      eol: 'CRLF',
    });
  });

  it('decodes UTF-16 without mangling it', async () => {
    const target = await writeRaw('utf16.txt', encode('héllo wörld', 'utf-16le'));
    const file = await readTextFile(target);
    expect(file.content).toBe('héllo wörld');
    expect(file.encoding).toBe('utf-16le');
  });

  it('decodes Latin-1 bytes that are not valid UTF-8', async () => {
    // "café" in Latin-1: the trailing 0xE9 is invalid as UTF-8.
    const target = await writeRaw('latin.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    const file = await readTextFile(target);
    expect(file.content).toBe('café');
    expect(file.encoding).toBe('latin-1');
  });

  it('refuses a binary file instead of loading mojibake', async () => {
    const target = await writeRaw('app.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]));
    await expect(readTextFile(target)).rejects.toBeInstanceOf(BinaryFileError);
  });
});

describe('open then save with no edits reproduces the file byte for byte', () => {
  const cases: { name: string; text: string; encoding: EncodingId }[] = [
    { name: 'utf8-lf.txt', text: 'plain\nlines\n', encoding: 'utf-8' },
    { name: 'utf8-crlf.txt', text: 'plain\r\nlines\r\n', encoding: 'utf-8' },
    { name: 'utf8bom.txt', text: 'café\r\nsecond', encoding: 'utf-8-bom' },
    { name: 'utf16le.txt', text: 'héllo\r\nwörld', encoding: 'utf-16le' },
    { name: 'utf16be.txt', text: 'héllo\nwörld', encoding: 'utf-16be' },
    { name: 'latin1.txt', text: 'café ±\r\nsecond', encoding: 'latin-1' },
  ];

  for (const { name, text, encoding } of cases) {
    it(name, async () => {
      const original = encode(text, encoding);
      const target = await writeRaw(name, original);

      const opened = await readTextFile(target);
      await writeTextFile(target, opened.content, opened.encoding, opened.eol);

      const after = await fs.readFile(target);
      expect(new Uint8Array(after)).toEqual(new Uint8Array(original));
    });
  }
});

describe('JSON config decoding', () => {
  // main.ts reads config files with detectEncoding + decode for exactly this
  // reason: Windows tools routinely write JSON with a BOM, and JSON.parse
  // rejects it. Treating that as corruption would throw away user settings.
  it('parses JSON written with a UTF-8 BOM', async () => {
    const target = await writeRaw('prefs.json', encode('{"theme":"dark"}', 'utf-8-bom'));
    const opened = await readTextFile(target);
    expect(() => JSON.parse(opened.content)).not.toThrow();
    expect(JSON.parse(opened.content)).toEqual({ theme: 'dark' });
  });

  it('parses JSON written as UTF-16', async () => {
    const target = await writeRaw('prefs16.json', encode('{"a":1}', 'utf-16le'));
    const opened = await readTextFile(target);
    expect(JSON.parse(opened.content)).toEqual({ a: 1 });
  });
});

describe('writeTextFile', () => {
  it('applies the requested line ending regardless of the buffer style', async () => {
    const target = path.join(dir, 'out.txt');
    // Monaco hands back one style; the file's own style must win.
    await writeTextFile(target, 'a\nb\nc', 'utf-8', 'CRLF');
    expect((await fs.readFile(target)).toString('utf8')).toBe('a\r\nb\r\nc');

    await writeTextFile(target, 'a\r\nb\r\nc', 'utf-8', 'LF');
    expect((await fs.readFile(target)).toString('utf8')).toBe('a\nb\nc');
  });

  it('converts between encodings when the user picks a new one', async () => {
    const target = path.join(dir, 'converted.txt');
    await writeTextFile(target, 'café', 'utf-16le', 'LF');

    const reopened = await readTextFile(target);
    expect(reopened.encoding).toBe('utf-16le');
    expect(reopened.content).toBe('café');
  });

  it('writes atomically, leaving no temp files', async () => {
    const target = path.join(dir, 'atomic.txt');
    await writeTextFile(target, 'hello', 'utf-8', 'LF');
    expect(await fs.readdir(dir)).toEqual(['atomic.txt']);
  });

  it('round trips an edit without changing encoding or line endings', async () => {
    const target = await writeRaw('edit.txt', encode('one\r\ntwo', 'utf-16le'));
    const opened = await readTextFile(target);

    const edited = `${opened.content}\r\nthree`;
    await writeTextFile(target, edited, opened.encoding, opened.eol);

    const reopened = await readTextFile(target);
    expect(reopened.content).toBe('one\r\ntwo\r\nthree');
    expect(reopened.encoding).toBe('utf-16le');
    expect(reopened.eol).toBe('CRLF');
  });
});

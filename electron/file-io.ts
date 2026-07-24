import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpenedFile } from '../shared/api';
import {
  decode,
  detectEncoding,
  encode,
  looksBinary,
  normalizeEncoding,
  type EncodingId,
} from '../shared/encoding';
import { detectLineEnding, normalizeLineEndings, type LineEnding } from '../shared/text';
import { readFileCapped, writeFileAtomic } from './fs-safe';

/** A file whose bytes are not text; opening it would corrupt it on save. */
export class BinaryFileError extends Error {
  constructor(readonly filePath: string) {
    super(
      `${path.basename(filePath)} looks like a binary file, so Basil did not open it.`,
    );
    this.name = 'BinaryFileError';
  }
}

/**
 * Read a text file, detecting its encoding and line endings so that saving it
 * again reproduces the same bytes.
 */
export async function readTextFile(filePath: string): Promise<OpenedFile> {
  const buffer = await readFileCapped(filePath);
  if (looksBinary(buffer)) {
    throw new BinaryFileError(filePath);
  }
  const encoding = detectEncoding(buffer);
  const content = decode(buffer, encoding);
  return {
    path: filePath,
    content,
    name: path.basename(filePath),
    encoding,
    eol: detectLineEnding(content),
    mtimeMs: await getMtimeMs(filePath),
  };
}

/** Modification time, or 0 when the file does not exist yet. */
export async function getMtimeMs(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Write text back in a specific encoding and line-ending style. Monaco keeps one
 * line-ending style in its buffer, so the file's own style is re-applied here.
 */
export async function writeTextFile(
  filePath: string,
  content: string,
  encoding: EncodingId,
  eol: LineEnding,
): Promise<void> {
  const text = normalizeLineEndings(content, eol);
  await writeFileAtomic(filePath, encode(text, normalizeEncoding(encoding)));
}

/**
 * Text encoding detection and conversion.
 *
 * Everything here works on Buffer/Uint8Array so a file survives an open/save
 * round trip byte for byte. Reading everything as UTF-8 (the previous behaviour)
 * silently destroyed UTF-16 and Latin-1 files the moment they were saved back.
 *
 * No dependency: Node's Buffer covers utf8, utf16le and latin1 natively, and
 * UTF-16BE is handled by swapping byte pairs.
 */

export type EncodingId = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'latin-1';

export const ENCODINGS: { id: EncodingId; label: string }[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'latin-1', label: 'Latin-1' },
];

export const DEFAULT_ENCODING: EncodingId = 'utf-8';

const VALID_ENCODINGS = new Set<string>(ENCODINGS.map((e) => e.id));

export function isEncodingId(value: unknown): value is EncodingId {
  return typeof value === 'string' && VALID_ENCODINGS.has(value);
}

export function normalizeEncoding(value: unknown): EncodingId {
  return isEncodingId(value) ? value : DEFAULT_ENCODING;
}

export function encodingLabel(id: EncodingId): string {
  return ENCODINGS.find((e) => e.id === id)?.label ?? id;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * A NUL byte in the first 8KB means this is not text. Opening such a file would
 * fill the editor with replacement characters, and saving would then write those
 * replacements over the original — unrecoverable corruption.
 *
 * UTF-16 is full of NULs for ASCII text, so a BOM is checked first.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (
    startsWith(bytes, UTF16LE_BOM) ||
    startsWith(bytes, UTF16BE_BOM) ||
    startsWith(bytes, UTF8_BOM)
  ) {
    return false;
  }
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/** True when the bytes are a well-formed UTF-8 sequence. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte <= 0x7f) {
      i += 1;
      continue;
    }
    let extra: number;
    let min: number;
    let code: number;
    if (byte >= 0xc2 && byte <= 0xdf) {
      extra = 1;
      min = 0x80;
      code = byte & 0x1f;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      extra = 2;
      min = 0x800;
      code = byte & 0x0f;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      extra = 3;
      min = 0x10000;
      code = byte & 0x07;
    } else {
      return false;
    }
    // Truncated multi-byte sequence at the end of the buffer.
    if (i + extra >= bytes.length) return false;
    for (let k = 1; k <= extra; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) return false;
      code = (code << 6) | (cont & 0x3f);
    }
    // Reject overlong encodings, surrogates and out-of-range code points.
    if (code < min || code > 0x10ffff) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;
    i += extra + 1;
  }
  return true;
}

/** Best guess at how these bytes are encoded, BOM first then UTF-8 validity. */
export function detectEncoding(bytes: Uint8Array): EncodingId {
  if (startsWith(bytes, UTF8_BOM)) return 'utf-8-bom';
  if (startsWith(bytes, UTF16LE_BOM)) return 'utf-16le';
  if (startsWith(bytes, UTF16BE_BOM)) return 'utf-16be';
  if (isValidUtf8(bytes)) return 'utf-8';
  // Not valid UTF-8 and no BOM: treat as single-byte so no byte is lost.
  return 'latin-1';
}

/** Swap every byte pair, converting between UTF-16 BE and LE. */
function swap16(bytes: Uint8Array): Buffer {
  const out = Buffer.from(bytes);
  const end = out.length - (out.length % 2);
  for (let i = 0; i < end; i += 2) {
    const tmp = out[i];
    out[i] = out[i + 1];
    out[i + 1] = tmp;
  }
  return out;
}

export function decode(bytes: Uint8Array, encoding: EncodingId): string {
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.from(bytes.subarray(UTF8_BOM.length)).toString('utf8');
    case 'utf-16le':
      return Buffer.from(bytes.subarray(UTF16LE_BOM.length)).toString('utf16le');
    case 'utf-16be':
      return swap16(bytes.subarray(UTF16BE_BOM.length)).toString('utf16le');
    case 'latin-1':
      return Buffer.from(bytes).toString('latin1');
    case 'utf-8':
    default:
      return Buffer.from(bytes).toString('utf8');
  }
}

export function encode(text: string, encoding: EncodingId): Buffer {
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from(UTF8_BOM), Buffer.from(text, 'utf8')]);
    case 'utf-16le':
      return Buffer.concat([Buffer.from(UTF16LE_BOM), Buffer.from(text, 'utf16le')]);
    case 'utf-16be':
      return Buffer.concat([Buffer.from(UTF16BE_BOM), swap16(Buffer.from(text, 'utf16le'))]);
    case 'latin-1':
      return Buffer.from(text, 'latin1');
    case 'utf-8':
    default:
      return Buffer.from(text, 'utf8');
  }
}

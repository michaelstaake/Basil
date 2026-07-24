import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENCODING,
  decode,
  detectEncoding,
  encode,
  encodingLabel,
  isValidUtf8,
  looksBinary,
  normalizeEncoding,
  type EncodingId,
} from './encoding';

const SAMPLES = [
  'plain ascii',
  'accented: café naïve résumé',
  'symbols: € £ ¥ © ±',
  'multi-line\nwith breaks\r\nand more',
  '',
];

describe('detectEncoding', () => {
  it('detects a UTF-8 BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')]);
    expect(detectEncoding(bytes)).toBe('utf-8-bom');
  });

  it('detects UTF-16 BOMs', () => {
    expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe('utf-16le');
    expect(detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x41]))).toBe('utf-16be');
  });

  it('detects plain UTF-8 without a BOM', () => {
    expect(detectEncoding(Buffer.from('café', 'utf8'))).toBe('utf-8');
    expect(detectEncoding(Buffer.from('', 'utf8'))).toBe('utf-8');
  });

  it('falls back to latin-1 for bytes that are not valid UTF-8', () => {
    // 0xE9 alone is "é" in Latin-1 but an invalid UTF-8 lead byte.
    expect(detectEncoding(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('latin-1');
  });
});

describe('isValidUtf8', () => {
  it('accepts valid sequences', () => {
    expect(isValidUtf8(Buffer.from('a € 😀 ü', 'utf8'))).toBe(true);
    expect(isValidUtf8(Buffer.from([]))).toBe(true);
  });

  it('rejects a truncated multi-byte sequence', () => {
    expect(isValidUtf8(Buffer.from([0xe2, 0x82]))).toBe(false);
  });

  it('rejects a bare continuation byte', () => {
    expect(isValidUtf8(Buffer.from([0x80]))).toBe(false);
  });

  it('rejects overlong encodings and surrogates', () => {
    expect(isValidUtf8(Buffer.from([0xc0, 0xaf]))).toBe(false);
    expect(isValidUtf8(Buffer.from([0xed, 0xa0, 0x80]))).toBe(false);
  });
});

describe('looksBinary', () => {
  it('flags content with NUL bytes', () => {
    expect(looksBinary(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBe(true);
  });

  it('does not flag plain text', () => {
    expect(looksBinary(Buffer.from('hello world', 'utf8'))).toBe(false);
    expect(looksBinary(Buffer.from([]))).toBe(false);
  });

  it('does not flag UTF-16 text, which is full of NULs', () => {
    const utf16 = encode('hello', 'utf-16le');
    expect(looksBinary(utf16)).toBe(false);
    expect(looksBinary(encode('hello', 'utf-16be'))).toBe(false);
  });

  it('only inspects the first 8KB', () => {
    const late = Buffer.concat([Buffer.alloc(9000, 0x41), Buffer.from([0x00])]);
    expect(looksBinary(late)).toBe(false);
  });
});

describe('encode/decode round trip', () => {
  const encodings: EncodingId[] = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'];

  for (const encoding of encodings) {
    for (const sample of SAMPLES) {
      it(`preserves ${JSON.stringify(sample.slice(0, 20))} as ${encoding}`, () => {
        expect(decode(encode(sample, encoding), encoding)).toBe(sample);
      });
    }
  }

  it('round trips latin-1 for characters in its range', () => {
    const sample = 'café ± °';
    expect(decode(encode(sample, 'latin-1'), 'latin-1')).toBe(sample);
  });

  it('writes the expected BOM bytes', () => {
    expect([...encode('a', 'utf-8-bom').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...encode('a', 'utf-16le').subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect([...encode('a', 'utf-16be').subarray(0, 2)]).toEqual([0xfe, 0xff]);
  });

  it('writes plain utf-8 with no BOM', () => {
    expect([...encode('a', 'utf-8')]).toEqual([0x61]);
  });

  it('encodes utf-16be as big endian on the wire', () => {
    // "A" is 0x0041: big endian puts the zero byte first.
    expect([...encode('A', 'utf-16be')]).toEqual([0xfe, 0xff, 0x00, 0x41]);
    expect([...encode('A', 'utf-16le')]).toEqual([0xff, 0xfe, 0x41, 0x00]);
  });
});

describe('detect then decode reproduces the original file', () => {
  it('handles every supported encoding without knowing it in advance', () => {
    for (const encoding of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'] as const) {
      const original = 'héllo wörld\nsecond line';
      const bytes = encode(original, encoding);
      expect(decode(bytes, detectEncoding(bytes))).toBe(original);
    }
  });
});

describe('normalizeEncoding', () => {
  it('rejects unknown ids', () => {
    expect(normalizeEncoding('koi8-r')).toBe(DEFAULT_ENCODING);
    expect(normalizeEncoding(undefined)).toBe(DEFAULT_ENCODING);
    expect(normalizeEncoding('utf-16be')).toBe('utf-16be');
  });
});

describe('encodingLabel', () => {
  it('gives a human label', () => {
    expect(encodingLabel('utf-8-bom')).toBe('UTF-8 with BOM');
  });
});

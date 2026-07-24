export type LineEnding = 'LF' | 'CRLF' | 'CR';

export const EOL_STRINGS: Record<LineEnding, string> = {
  LF: '\n',
  CRLF: '\r\n',
  CR: '\r',
};

/** Detect dominant line ending from file contents. */
export function detectLineEnding(content: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r') {
      if (content[i + 1] === '\n') {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (content[i] === '\n') {
      lf++;
    }
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return 'CRLF';
  if (cr > lf && cr > 0) return 'CR';
  return 'LF';
}

export function lineEndingFromEol(eol: string): LineEnding {
  if (eol === '\r\n') return 'CRLF';
  if (eol === '\r') return 'CR';
  return 'LF';
}

export function countLines(content: string): number {
  if (content.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r') {
      lines++;
      if (content[i + 1] === '\n') i++;
    } else if (content[i] === '\n') {
      lines++;
    }
  }
  return lines;
}

/** Rewrite every line break in `content` to `eol`. */
export function normalizeLineEndings(content: string, eol: LineEnding): string {
  return content.replace(/\r\n|\r|\n/g, EOL_STRINGS[eol]);
}

/**
 * Minimal markdown segmentation for AI replies.
 *
 * Deliberately produces plain data, not HTML: the sidebar renders these segments
 * as React elements, so model output can never inject markup into the page and
 * the app keeps its strict CSP with no HTML sanitiser dependency.
 */

export type MarkdownSegment =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)$/;

/** Split text into prose and fenced code blocks. */
export function parseMarkdownSegments(input: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const lines = input.split('\n');

  let text: string[] = [];
  let code: string[] | null = null;
  let fence = '';
  let language = '';

  const flushText = () => {
    if (!text.length) return;
    const content = text.join('\n');
    if (content.trim()) segments.push({ kind: 'text', content: trimBlankEdges(content) });
    text = [];
  };

  for (const line of lines) {
    const match = FENCE.exec(line);

    if (code === null) {
      if (match) {
        flushText();
        code = [];
        fence = match[1][0];
        language = match[2].trim();
        continue;
      }
      text.push(line);
      continue;
    }

    // Inside a fence: only a matching fence character closes it.
    if (match && match[1][0] === fence) {
      segments.push({ kind: 'code', content: code.join('\n'), language });
      code = null;
      language = '';
      continue;
    }
    code.push(line);
  }

  if (code !== null) {
    // Unterminated fence: still show it as code, which is what it is mid-stream.
    segments.push({ kind: 'code', content: code.join('\n'), language });
  }
  flushText();

  return segments;
}

function trimBlankEdges(value: string): string {
  return value.replace(/^\n+/, '').replace(/\n+$/, '');
}

export type ChatMessageLike = { role: string; content: string };

/** Keep at most this many turns of history in a request. */
export const AI_MAX_HISTORY_MESSAGES = 20;
/** And at most this many characters across them. */
export const AI_MAX_HISTORY_CHARS = 60_000;

/**
 * Trim conversation history from the oldest end.
 *
 * The whole thread plus the whole file used to be resent on every turn, so a
 * long conversation eventually exceeded the model's context window (and, on a
 * paid endpoint, cost accordingly). The newest messages are the ones that
 * matter, and the most recent message is always kept even if it alone is over
 * budget — dropping the user's actual question would be worse than a long one.
 */
export function capChatHistory(
  messages: ReadonlyArray<ChatMessageLike>,
  maxMessages = AI_MAX_HISTORY_MESSAGES,
  maxChars = AI_MAX_HISTORY_CHARS,
): ChatMessageLike[] {
  const recent = messages.slice(-maxMessages);
  const out: ChatMessageLike[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i];
    total += message.content?.length ?? 0;
    if (total > maxChars && out.length > 0) break;
    out.unshift(message);
  }
  return out;
}

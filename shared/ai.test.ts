import { describe, expect, it } from 'vitest';
import { capChatHistory } from './ai';

const msg = (content: string, role = 'user') => ({ role, content });

describe('capChatHistory', () => {
  it('leaves a short history untouched', () => {
    const history = [msg('one'), msg('two', 'assistant'), msg('three')];
    expect(capChatHistory(history)).toEqual(history);
  });

  it('keeps the newest messages when over the message limit', () => {
    const history = Array.from({ length: 30 }, (_, i) => msg(`m${i}`));
    const capped = capChatHistory(history, 5);
    expect(capped).toHaveLength(5);
    expect(capped[0].content).toBe('m25');
    expect(capped[4].content).toBe('m29');
  });

  it('drops old messages when over the character budget', () => {
    const history = [msg('a'.repeat(100)), msg('b'.repeat(100)), msg('c'.repeat(10))];
    const capped = capChatHistory(history, 20, 150);
    expect(capped.map((m) => m.content[0])).toEqual(['b', 'c']);
  });

  it('always keeps the most recent message, even if it alone is over budget', () => {
    const history = [msg('old'), msg('x'.repeat(1000))];
    const capped = capChatHistory(history, 20, 10);
    expect(capped).toHaveLength(1);
    expect(capped[0].content).toHaveLength(1000);
  });

  it('handles an empty history', () => {
    expect(capChatHistory([])).toEqual([]);
  });

  it('preserves roles and order', () => {
    const history = [msg('q1'), msg('a1', 'assistant'), msg('q2')];
    expect(capChatHistory(history, 3)).toEqual(history);
  });
});

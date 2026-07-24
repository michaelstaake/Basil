import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { EditorTab } from '../lib/tabs';
import { parseMarkdownSegments } from '../lib/markdown';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
};

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: "Hey there, I'm Basil AI. How can I help you?",
};

function welcomeMessages(): ChatMessage[] {
  return [{ ...WELCOME_MESSAGE }];
}

/** Ephemeral per-tab chats survive sidebar remounts when switching files. */
const chatsByTab = new Map<string, ChatMessage[]>();

/**
 * Drop the chat for a closed tab. Called from App on close, because the
 * sidebar's own cleanup only runs while it is mounted — chats for tabs closed
 * with the sidebar hidden used to stay in memory for the life of the window.
 */
export function forgetChatForTab(tabId: string): void {
  chatsByTab.delete(tabId);
}

type Props = {
  enabled: boolean;
  tabs: EditorTab[];
  activeTab: EditorTab | null;
};

/** One fenced code block, with a copy button. */
function CodeBlock({ content, language }: { content: string; language: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(handle);
  }, [copied]);

  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="ai-code-lang">{language || 'code'}</span>
        <button
          type="button"
          className="ai-code-copy"
          onClick={() => {
            void navigator.clipboard.writeText(content).then(() => setCopied(true));
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

/**
 * Renders an assistant reply as prose plus code blocks. Segments are turned into
 * React elements rather than HTML, so model output is never interpreted as markup.
 */
function MessageBody({ content }: { content: string }) {
  const segments = useMemo(() => parseMarkdownSegments(content), [content]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'code' ? (
          <CodeBlock key={i} content={segment.content} language={segment.language} />
        ) : (
          <p key={i} className="ai-text">
            {segment.content}
          </p>
        ),
      )}
    </>
  );
}

export function AiSidebar({ enabled, tabs, activeTab }: Props) {
  const [activeChatId, setActiveChatId] = useState<string | null>(activeTab?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!activeTab) return [];
    return chatsByTab.get(activeTab.id) ?? welcomeMessages();
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  const activeChatIdRef = useRef(activeChatId);
  const pendingAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // Seed welcome on first open for this tab, and persist current thread.
  useEffect(() => {
    const nextId = activeTab?.id ?? null;
    const prevId = activeChatIdRef.current;
    if (nextId === prevId) {
      if (nextId && !chatsByTab.has(nextId)) {
        const welcome = welcomeMessages();
        chatsByTab.set(nextId, welcome);
        setMessages(welcome);
      }
      return;
    }

    if (prevId) {
      chatsByTab.set(prevId, messagesRef.current);
    }
    setActiveChatId(nextId);
    if (!nextId) {
      setMessages([]);
    } else {
      const existing = chatsByTab.get(nextId);
      if (existing) {
        setMessages(existing);
      } else {
        const welcome = welcomeMessages();
        chatsByTab.set(nextId, welcome);
        setMessages(welcome);
      }
    }
    setInput('');
    setBusy(false);
    void window.basil.stopChat();
  }, [activeTab?.id]);

  // Drop chats for closed tabs.
  useEffect(() => {
    const open = new Set(tabs.map((t) => t.id));
    for (const id of [...chatsByTab.keys()]) {
      if (!open.has(id)) chatsByTab.delete(id);
    }
  }, [tabs]);

  // Persist on unmount so switching to a file without the sidebar open keeps history.
  useEffect(() => {
    return () => {
      const id = activeChatIdRef.current;
      if (id) chatsByTab.set(id, messagesRef.current);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !activeTab) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const assistantId = `a-${Date.now()}`;
    const nextMessages = [
      ...messages,
      userMsg,
      { id: assistantId, role: 'assistant' as const, content: '' },
    ];
    setMessages(nextMessages);
    chatsByTab.set(activeTab.id, nextMessages);
    setInput('');
    setBusy(true);
    pendingAssistantIdRef.current = assistantId;

    // Only the active file is shared as context — never other tabs.
    const fileContext = [
      {
        name: activeTab.title,
        path: activeTab.path,
        content: activeTab.content,
      },
    ];

    const history = [...messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const removeEmptyAssistant = (id: string) => {
      setMessages((prev) => {
        const assistant = prev.find((m) => m.id === id);
        if (!assistant || assistant.content) return prev;
        const updated = prev.filter((m) => m.id !== id);
        chatsByTab.set(activeTab.id, updated);
        return updated;
      });
    };

    try {
      const result = await window.basil.chat(
        {
          messages: history,
          fileContext,
        },
        (chunk) => {
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            );
            chatsByTab.set(activeTab.id, updated);
            return updated;
          });
        },
      );
      if (result.aborted) {
        removeEmptyAssistant(assistantId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantId ? { ...m, role: 'error' as const, content: message } : m,
        );
        chatsByTab.set(activeTab.id, updated);
        return updated;
      });
    } finally {
      pendingAssistantIdRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    void window.basil.stopChat();
    const id = pendingAssistantIdRef.current;
    if (!id || !activeTab) return;
    // Clear the waiting spinner immediately if nothing has streamed yet.
    setMessages((prev) => {
      const assistant = prev.find((m) => m.id === id);
      if (!assistant || assistant.content) return prev;
      const updated = prev.filter((m) => m.id !== id);
      chatsByTab.set(activeTab.id, updated);
      return updated;
    });
  }

  function clearChat() {
    const next = welcomeMessages();
    setMessages(next);
    if (activeTab?.id) chatsByTab.set(activeTab.id, next);
  }

  if (!enabled) {
    return (
      <aside className="ai-sidebar">
        <div className="ai-disabled">
          AI is disabled. Enable it in Settings to chat with an OpenAI-compatible API
          (LM Studio, xAI, or custom).
        </div>
      </aside>
    );
  }

  return (
    <aside className="ai-sidebar">
      <div className="ai-messages">
        {messages.map((m) => (
          <div key={m.id} className={`ai-msg ${m.role}`}>
            {m.content ? (
              m.role === 'assistant' ? (
                <MessageBody content={m.content} />
              ) : (
                m.content
              )
            ) : m.role === 'assistant' ? (
              <LoaderCircle
                className="ai-loading-spinner"
                size={18}
                aria-label="Waiting for response"
              />
            ) : (
              ''
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="ai-composer">
        <textarea
          value={input}
          placeholder={
            activeTab ? `Ask about ${activeTab.title}` : 'Open a file to chat…'
          }
          disabled={!activeTab}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-composer-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={clearChat}>
            Clear
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!busy && (!input.trim() || !activeTab)}
            onClick={() => {
              if (busy) {
                stop();
                return;
              }
              void send();
            }}
          >
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </aside>
  );
}

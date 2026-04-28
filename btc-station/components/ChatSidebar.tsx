"use client";

/**
 * ChatSidebar — BYOK AI coding assistant.
 * - API key stored in localStorage only, never sent to our backend DB.
 * - Streams responses from /py-api/api/ai/chat via SSE fetch.
 * - Supports injecting editor code as context via the `codeContext` prop.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

// react-markdown is a large ESM package — load client-side only
const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

const LS_KEY = "btcstation_openai_key";
const BASE = "/py-api/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Props {
  /** Current code in Monaco editor, injected as context on demand */
  codeContext?: string;
}

// ── Auth header helper ────────────────────────────────────────────────────────

async function authHeader(): Promise<string> {
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const { data } = await sb.auth.getSession();
  return `Bearer ${data.session?.access_token ?? ""}`;
}

// ── Key Setup Screen ──────────────────────────────────────────────────────────

function KeySetup({ onSave }: { onSave: (key: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>设置 OpenAI API Key</div>
      <p style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.6, margin: 0 }}>
        Key 仅存储在您浏览器的 localStorage 中，不会上传到我们的服务器。
        支持 OpenAI 兼容接口（如 DeepSeek、Claude via proxy）。
      </p>
      <input
        type="password"
        placeholder="sk-..."
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && input.trim()) onSave(input.trim()); }}
        style={{
          padding: "8px 10px", borderRadius: 6, fontSize: 12,
          border: "1px solid var(--border)", background: "var(--bg)",
          color: "var(--text)", outline: "none",
        }}
      />
      <button
        disabled={!input.trim()}
        onClick={() => onSave(input.trim())}
        style={{
          padding: "7px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: "var(--primary)", color: "#fff", border: "none",
          cursor: input.trim() ? "pointer" : "not-allowed", opacity: input.trim() ? 1 : 0.5,
        }}
      >
        保存并开始
      </button>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 2,
    }}>
      <div style={{
        maxWidth: "90%",
        padding: "8px 11px",
        borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
        fontSize: 12,
        lineHeight: 1.65,
        background: isUser ? "var(--primary)" : "var(--bg)",
        color: isUser ? "#fff" : "var(--text)",
        border: isUser ? "none" : "1px solid var(--border)",
        wordBreak: "break-word",
      }}>
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
        ) : (
          <div className="ai-markdown">
            <ReactMarkdown>{msg.content + (msg.streaming ? "▌" : "")}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ChatSidebar({ codeContext }: Props) {
  const [apiKey, setApiKey]     = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError]       = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Load key from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) setApiKey(stored);
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function saveKey(key: string) {
    localStorage.setItem(LS_KEY, key);
    setApiKey(key);
  }

  function clearKey() {
    localStorage.removeItem(LS_KEY);
    setApiKey(null);
    setMessages([]);
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !apiKey || streaming) return;
    setError("");

    // Build messages with optional code context injected into first user message
    const userContent = codeContext
      ? `【当前策略代码】\n\`\`\`python\n${codeContext.slice(0, 3000)}\n\`\`\`\n\n${text}`
      : text;

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Placeholder for streaming assistant message
    setMessages(prev => [...prev, { role: "assistant", content: "", streaming: true }]);

    const apiMessages = newMessages.map((m, i) =>
      i === newMessages.length - 1 && codeContext
        ? { role: m.role, content: userContent }
        : { role: m.role, content: m.content }
    );

    try {
      const auth = await authHeader();
      abortRef.current = new AbortController();
      const res = await fetch(`${BASE}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ api_key: apiKey, messages: apiMessages }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`请求失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(parsed.error);
              break;
            }
            if (parsed.delta) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.delta };
                }
                return updated;
              });
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message ?? "连接失败");
        // Remove empty assistant placeholder on error
        setMessages(prev => {
          const last = prev[prev.length - 1];
          return last?.role === "assistant" && !last.content ? prev.slice(0, -1) : prev;
        });
      }
    } finally {
      // Mark streaming done
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.streaming) updated[updated.length - 1] = { ...last, streaming: false };
        return updated;
      });
      setStreaming(false);
      abortRef.current = null;
    }
  }, [apiKey, messages, codeContext, streaming]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function stopStream() {
    abortRef.current?.abort();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!apiKey) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-elev)" }}>
        <SidebarHeader title="AI 助手" onClearKey={undefined} />
        <KeySetup onSave={saveKey} />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-elev)" }}>
      <SidebarHeader
        title="AI 助手"
        onClearKey={clearKey}
        onClear={() => setMessages([])}
      />

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "var(--text-mute)", fontSize: 11, textAlign: "center", marginTop: 24, lineHeight: 1.8 }}>
            你好！我是你的策略开发助手。<br />
            可以问我：<br />
            · 帮我写一个 RSI 超买超卖策略<br />
            · 这段代码为什么没有交易信号？<br />
            · 解释 populate_entry_trend 的写法<br />
            <br />
            发送消息时会自动带上当前代码作为上下文。
          </div>
        )}
        {messages.map((msg, i) => (
          <Bubble key={i} msg={msg} />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ margin: "0 10px 6px", padding: "6px 10px", borderRadius: 6, background: "rgba(255,77,79,0.1)", border: "1px solid rgba(255,77,79,0.3)", color: "#ff4d4f", fontSize: 11 }}>
          {error}
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: "8px 10px 10px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问 AI 助手… (Enter 发送, Shift+Enter 换行)"
          disabled={streaming}
          rows={3}
          style={{
            resize: "none",
            padding: "7px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 12,
            lineHeight: 1.5,
            outline: "none",
            fontFamily: "inherit",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: "var(--primary)", color: "#fff", border: "none",
              cursor: (!input.trim() || streaming) ? "not-allowed" : "pointer",
              opacity: (!input.trim() || streaming) ? 0.5 : 1,
            }}
          >
            {streaming ? "生成中…" : "发送"}
          </button>
          {streaming && (
            <button
              onClick={stopStream}
              style={{
                padding: "6px 10px", borderRadius: 6, fontSize: 12,
                background: "rgba(255,77,79,0.15)", border: "1px solid rgba(255,77,79,0.4)",
                color: "#ff4d4f", cursor: "pointer",
              }}
            >
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function SidebarHeader({
  title,
  onClearKey,
  onClear,
}: {
  title: string;
  onClearKey?: () => void;
  onClear?: () => void;
}) {
  return (
    <div style={{
      padding: "10px 12px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", flex: 1 }}>🤖 {title}</span>
      {onClear && (
        <button
          onClick={onClear}
          title="清空对话"
          style={{ background: "none", border: "none", color: "var(--text-mute)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
        >
          清空
        </button>
      )}
      {onClearKey && (
        <button
          onClick={onClearKey}
          title="更换 API Key"
          style={{ background: "none", border: "none", color: "var(--text-mute)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
        >
          换 Key
        </button>
      )}
    </div>
  );
}

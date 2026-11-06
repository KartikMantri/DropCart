"use client";

import type { ChatStatus } from "ai";
import { useEffect, useRef, useState } from "react";
import type { AgentUIMessage } from "./ChatWorkspace";

const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  "tool-search_products": ["Searching Channel3…", "Searched Channel3"],
  "tool-get_product": ["Checking the live price…", "Checked the live price"],
  "tool-list_variants": ["Looking up variants…", "Looked up variants"],
  "tool-draft_mandate": ["Filling the mandate form…", "Filled the mandate form"],
};

/** Renders **bold** as <strong>; everything else as plain text (no HTML injection). */
function InlineText({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {pieces.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** User bubbles white, agent bubbles blue, tool actions as bordered system lines. */
export function ChatPanel({
  messages,
  status,
  error,
  disabled,
  suggestions,
  onSend,
  onStop,
}: {
  messages: AgentUIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  disabled: string | null;
  suggestions: string[];
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    onSend(t);
    setInput("");
  };

  return (
    <section className="nb-card flex min-h-[32rem] flex-col" aria-label="Agent chat">
      <div className="border-b-[3px] border-ink bg-blue px-5 py-3">
        <h2 className="text-xl font-bold uppercase">Agent</h2>
        <p className="text-sm font-medium">Tell it your price, variant and how long to watch.</p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="max-w-[85%] self-start border-[3px] border-ink bg-blue px-3 py-2">
              Hi! I can watch this for you and buy it if it drops to your price. What&apos;s the
              most you&apos;d pay?
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="border-[3px] border-ink bg-card px-3 py-1 text-left text-sm font-bold hover:bg-yellow"
                  onClick={() => send(s)}
                  disabled={Boolean(disabled)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.parts.map((part, i) => {
            const key = `${m.id}-${i}`;
            if (part.type === "text") {
              if (!part.text.trim()) return null;
              return (
                <p
                  key={key}
                  className={`max-w-[85%] whitespace-pre-wrap border-[3px] border-ink px-3 py-2 ${
                    m.role === "user" ? "self-end bg-card" : "self-start bg-blue"
                  }`}
                >
                  <InlineText text={part.text} />
                </p>
              );
            }
            const labels = TOOL_LABELS[part.type];
            if (labels && "state" in part) {
              const failed = part.state === "output-error";
              const done = part.state === "output-available";
              return (
                <p
                  key={key}
                  className={`self-start border-2 border-ink px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                    failed ? "bg-red" : "bg-bg"
                  }`}
                >
                  {failed ? `✕ ${labels[1]} failed` : done ? `✓ ${labels[1]}` : `… ${labels[0]}`}
                </p>
              );
            }
            return null;
          }),
        )}

        {status === "submitted" && (
          <p className="self-start border-2 border-ink bg-bg px-2 py-0.5 font-mono text-xs font-bold uppercase">
            … Agent is thinking
          </p>
        )}
        {error && (
          <p role="alert" className="self-stretch border-[3px] border-ink bg-red px-3 py-2 font-bold">
            {error.message || "The agent couldn't reply."} Try again.
          </p>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-3 border-t-[3px] border-ink p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="nb-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ?? "e.g. Get it under $280, black, for 30 days"}
          disabled={Boolean(disabled)}
          aria-label="Message the agent"
          maxLength={500}
        />
        {busy ? (
          <button type="button" className="nb-btn nb-btn-white" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="nb-btn" disabled={Boolean(disabled) || !input.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}

/**
 * A reply fork's pane: beside the conversation when the session is wide,
 * over it when narrow. It shows the question being written about collected
 * pieces, or a fork's conversation with its helper, with Send back and Close.
 */
import { useState, type CSSProperties } from "react";
import { ArrowLeft, CornerUpLeft, LoaderCircle, Send, X } from "lucide-react";
import { agentClientId } from "../agentIdentity";
import { PermissionCard } from "../PermissionCard";
import { Timeline } from "../Session";
import { useAgentSession } from "../useAgentSession";
import type { ForkRow } from "./api";
import type { Quote } from "./types";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Quotes({
  quotes,
  onRemove,
}: {
  quotes: Quote[];
  onRemove?: (i: number) => void;
}) {
  return (
    <ul className="fork-quotes">
      {quotes.map((q, i) => (
        <li key={`${q.replyKey}:${q.start}:${i}`}>
          <span>{q.text}</span>
          {onRemove && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove “${q.text.slice(0, 30)}”`}
              onClick={() => onRemove(i)}
            >
              <X size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Question({
  busy,
  onAsk,
}: {
  busy: boolean;
  onAsk: (question: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await onAsk(text.trim())) setText("");
  };
  return (
    <form
      className="fork-question"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Question for the fork"
        placeholder="Ask about these pieces…"
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" disabled={busy || !text.trim()}>
        {busy ? <LoaderCircle size={13} className="spinning" /> : null}
        Ask
      </button>
    </form>
  );
}

/** The fork's conversation with its helper agent. */
function Conversation({
  fork,
  host,
  sending,
  onNotice,
  onSendBack,
  onClose,
}: {
  fork: ForkRow;
  host?: string;
  sending: boolean;
  onNotice: (message: string) => void;
  onSendBack: () => void;
  onClose: () => void;
}) {
  const s = useAgentSession(
    { id: agentClientId(fork.helperId, host), host },
    { onNotice },
  );
  const [reply, setReply] = useState("");
  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    if (await s.send({ text, images: [], attachments: [] })) setReply("");
  };
  return (
    <>
      <Timeline
        entries={s.entries}
        loading={s.source === null && !s.error}
        imageHost={host}
        running={s.running}
        pending={s.pending}
        unavailable={s.unavailable}
        error={s.error}
        earlier={s.earlier}
        onEarlier={s.loadOlder}
      />
      <footer className="fork-footer">
        {s.detail?.PendingPermissions.map((p, i) => (
          <PermissionCard
            imageHost={host}
            key={p.id || i}
            permission={p}
            busy={!!s.busy}
            onRespond={(decision) => void s.respond(p, decision)}
          />
        ))}
        <form
          className="fork-reply"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="Reply in fork"
            placeholder="Reply in fork…"
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="submit"
            className="icon-btn"
            aria-label="Send reply"
            disabled={!reply.trim() || !!s.busy}
          >
            <Send size={14} />
          </button>
        </form>
        <div className="fork-actions">
          <button
            type="button"
            disabled={sending || s.running}
            title={s.running ? "The fork is still answering." : undefined}
            onClick={onSendBack}
          >
            {sending ? (
              <LoaderCircle size={13} className="spinning" />
            ) : (
              <CornerUpLeft size={13} />
            )}
            Send back
          </button>
          {fork.sentBackAt && (
            <small className="fork-sent">Sent back {clock(fork.sentBackAt)}</small>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            <X size={13} />
            Close fork
          </button>
        </div>
      </footer>
    </>
  );
}

export function ForkPane({
  layout,
  host,
  forks,
  shown,
  collected,
  draftColour,
  busy,
  onShow,
  onBack,
  onAsk,
  onRemove,
  onClose,
  onSendBack,
  onNotice,
}: {
  layout: "side" | "over";
  host?: string;
  forks: ForkRow[];
  shown: string;
  collected: Quote[];
  draftColour: number;
  busy: string | null;
  onShow: (id: string) => void;
  onBack: () => void;
  onAsk: (question: string) => Promise<boolean>;
  onRemove: (i: number) => void;
  onClose: (id: string) => void;
  onSendBack: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const open = forks.filter((f) => !f.closedAt);
  const fork = shown === "draft" ? null : forks.find((f) => f.id === shown);
  const colour = fork ? fork.colour : draftColour;
  return (
    <section
      className="fork-pane"
      role="region"
      aria-label="Fork"
      data-layout={layout}
      style={{ "--fork": `var(--fork-${colour})` } as CSSProperties}
    >
      <header className="fork-head">
        <button type="button" className="ghost-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          Back to main
        </button>
        {(open.length > 1 || (open.length && shown === "draft")) && (
          <div className="fork-tabs" role="tablist" aria-label="Open forks">
            {open.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={f.id === shown}
                style={{ "--fork": `var(--fork-${f.colour})` } as CSSProperties}
                onClick={() => onShow(f.id)}
              >
                {f.question.slice(0, 24)}
              </button>
            ))}
            {shown === "draft" && (
              <button type="button" role="tab" aria-selected>
                New question
              </button>
            )}
          </div>
        )}
      </header>
      {fork ? (
        <>
          <p className="fork-asked">{fork.question}</p>
          <Quotes quotes={fork.quotes} />
          <Conversation
            key={fork.id}
            fork={fork}
            host={host}
            sending={busy === `send:${fork.id}`}
            onNotice={onNotice}
            onSendBack={() => onSendBack(fork.id)}
            onClose={() => onClose(fork.id)}
          />
        </>
      ) : (
        <>
          <Quotes quotes={collected} onRemove={onRemove} />
          {collected.length ? (
            <Question busy={busy === "ask"} onAsk={onAsk} />
          ) : (
            <p className="timeline-note">
              Highlight text in a reply, then Ask or Add.
            </p>
          )}
        </>
      )}
    </section>
  );
}

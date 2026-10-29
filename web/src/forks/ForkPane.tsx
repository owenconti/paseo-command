/**
 * A reply fork's pane: beside the conversation when the session is wide,
 * over it when narrow. It asks about the collected pieces, then holds the
 * fork's conversation with its helper, in the standard chat input, with
 * Send back and Close in its header.
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, CornerUpLeft, LoaderCircle, TextQuote, X } from "lucide-react";
import { agentClientId } from "../agentIdentity";
import { Composer, type Outgoing } from "../Composer";
import { PermissionCard } from "../PermissionCard";
import { Timeline } from "../Session";
import { useAgentSession } from "../useAgentSession";
import type { Agent } from "../types";
import type { ForkRow } from "./api";
import { FIRST_PROMPT_LEAD, type Quote } from "./types";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const forkColour = (colour: number) =>
  ({ "--fork": `var(--fork-${colour})` }) as CSSProperties;

/** Highlighted pieces, drawn as queued messages are above the chat input. */
export function ForkPieces({
  quotes,
  label,
  colour,
  onRemove,
  action,
}: {
  quotes: Quote[];
  label: string;
  colour?: number;
  onRemove?: (i: number) => void;
  action?: ReactNode;
}) {
  return (
    <section
      className="fork-pieces"
      role="region"
      aria-label={label}
      style={colour === undefined ? undefined : forkColour(colour)}
    >
      <ul className="queue">
        {quotes.map((q, i) => (
          <li key={`${q.replyKey}:${q.start}:${i}`}>
            <TextQuote size={13} aria-hidden="true" />
            <span className="queue-text" title={q.text}>
              {q.text}
            </span>
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove “${q.text.slice(0, 30)}”`}
                data-tip="Remove this piece"
                onClick={() => onRemove(i)}
              >
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {action}
    </section>
  );
}

/** The chat input's settings for a fork: no archive or fresh draft. */
const forkComposer = (onNotice: (m: string) => void) => ({
  dropFiles: null,
  onArchive: () => onNotice("Close the fork instead."),
  onFreshDraft: () => onNotice("Close the fork instead."),
  inputId: "fork-composer",
});

/** The question about the collected pieces: its first message starts it. */
function Question({
  agentId,
  collected,
  onRemove,
  onAsk,
  onNotice,
}: {
  agentId: string;
  collected: Quote[];
  onRemove: (i: number) => void;
  onAsk: (question: string) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const send = async (message: Outgoing) => {
    if (message.images.length || message.attachments.length) {
      onNotice("Attach files in a reply, once the fork has started.");
      return false;
    }
    return onAsk(message.text);
  };
  return (
    <>
      <div className="fork-start">
        <p className="timeline-note">
          {collected.length
            ? `Ask about ${collected.length === 1 ? "this piece" : "these pieces"}. The fork knows the conversation up to here.`
            : "Highlight text in a reply, then Ask or Add."}
        </p>
      </div>
      <footer className="fork-footer">
        <Composer
          {...forkComposer(onNotice)}
          activity={
            collected.length ? (
              <ForkPieces
                quotes={collected}
                label="Pieces to ask about"
                onRemove={onRemove}
              />
            ) : undefined
          }
          draft={{ controls: null }}
          draftOwner={`fork:${agentId}`}
          label="Question for the fork"
          placeholder="Ask about these pieces…"
          running={false}
          disabled={!collected.length}
          disabledReason="Highlight text in a reply first."
          started={false}
          modes={[]}
          onSetMode={() => {}}
          onSend={send}
          onCancel={async () => {}}
          onNotice={onNotice}
          promptHistory={[]}
        />
      </footer>
    </>
  );
}

/** The fork's conversation with its helper agent. */
function Conversation({
  fork,
  host,
  onNotice,
}: {
  fork: ForkRow;
  host?: string;
  onNotice: (message: string) => void;
}) {
  const id = agentClientId(fork.helperId, host);
  const s = useAgentSession({ id, host }, { onNotice });
  const helper = useMemo<Agent>(
    () => ({
      id,
      daemonId: fork.helperId,
      shortId: fork.helperId.slice(0, 7),
      name: fork.question,
      provider: s.detail?.Provider || "claude",
      status: s.running ? "running" : s.detail?.Status || "idle",
      cwd: s.detail?.Cwd || "",
      created: fork.createdAt,
      host,
    }),
    [id, fork, host, s.detail?.Provider, s.detail?.Status, s.detail?.Cwd, s.running],
  );
  // The prompt that started it: its question and pieces head the pane.
  const entries = useMemo(
    () =>
      s.entries.filter(
        (e, i) =>
          !(i === s.entries.findIndex((x) => x.kind === "user") &&
            e.kind === "user" &&
            e.text.startsWith(FIRST_PROMPT_LEAD)),
      ),
    [s.entries],
  );
  return (
    <>
      <Timeline
        entries={entries}
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
        <Composer
          {...forkComposer(onNotice)}
          agent={helper}
          label="Reply in fork"
          placeholder="Reply in fork…"
          running={s.running}
          disabled={s.archived}
          disabledReason="This fork's agent is archived."
          started
          modes={s.detail?.AvailableModes ?? []}
          mode={s.detail?.Mode}
          onSetMode={(mode) => void s.command("mode", { mode }, "")}
          onSend={s.send}
          onCancel={async () => {
            await s.command("cancel", {}, "Fork interrupted");
          }}
          onNotice={onNotice}
          promptHistory={s.promptHistory}
        />
      </footer>
    </>
  );
}

export function ForkPane({
  layout,
  agentId,
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
  /** The main agent's id. */
  agentId: string;
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
  const sending = !!fork && busy === `send:${fork.id}`;
  return (
    <section
      className="fork-pane"
      role="region"
      aria-label="Fork"
      data-layout={layout}
      style={forkColour(fork ? fork.colour : draftColour)}
    >
      <header className="fork-head">
        <button type="button" className="ghost-btn" onClick={onBack}>
          <ArrowLeft size={15} />
          Back to main
        </button>
        {fork && (
          <span className="fork-tools">
            {fork.sentBackAt && (
              <small className="fork-sent">Sent back {clock(fork.sentBackAt)}</small>
            )}
            <button
              type="button"
              className="ghost-btn"
              aria-label="Send back"
              data-tip="Send this fork's conclusion to the main agent"
              disabled={sending}
              onClick={() => onSendBack(fork.id)}
            >
              {sending ? (
                <LoaderCircle size={14} className="spinning" />
              ) : (
                <CornerUpLeft size={14} />
              )}
              Send back
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close fork"
              data-tip="Close this fork (it stays under its reply)"
              onClick={() => onClose(fork.id)}
            >
              <X size={15} />
            </button>
          </span>
        )}
      </header>
      {(open.length > 1 || (open.length > 0 && shown === "draft")) && (
        <div className="fork-tabs" role="tablist" aria-label="Open forks">
          {open.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={f.id === shown}
              style={forkColour(f.colour)}
              onClick={() => onShow(f.id)}
            >
              {f.question}
            </button>
          ))}
          {shown === "draft" && (
            <button type="button" role="tab" aria-selected style={forkColour(draftColour)}>
              New question
            </button>
          )}
        </div>
      )}
      {fork ? (
        <>
          <div className="fork-context">
            <h3>{fork.question}</h3>
            <ForkPieces quotes={fork.quotes} label="Asked about" colour={fork.colour} />
          </div>
          <Conversation key={fork.id} fork={fork} host={host} onNotice={onNotice} />
        </>
      ) : (
        <Question
          agentId={agentId}
          collected={collected}
          onRemove={onRemove}
          onAsk={onAsk}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

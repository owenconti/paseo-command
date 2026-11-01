import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LoaderCircle, Search as SearchIcon, X } from "lucide-react";
import { plainText } from "../ui";
import { Avatar, ConversationIcon, fullTime, tsDate } from "./bits";
import { MessageText } from "./rich";
import { conversationTitle, searchSlack, useSlack } from "./store";
import type { SlackSearch, SlackSearchHit } from "./types";

/** One hit: where, who and when, and its words. */
function Hit({ hit, onOpen }: { hit: SlackSearchHit; onOpen: () => void }) {
  const conversation = useSlack((d) => d.conversations.get(hit.conversationId));
  const where = useSlack((d) => (conversation ? conversationTitle(d, conversation) : "A conversation"));
  const user = useSlack((d) => {
    const id = hit.userId ?? hit.botId;
    return id ? d.users.get(id) : undefined;
  });
  const date = tsDate(hit.ts);
  return (
    <li>
      <button type="button" className="slack-hit" onClick={onOpen}>
        <span className="slack-hit-where">
          <ConversationIcon conversation={conversation} size={12} />
          {where}
          {hit.threadTs && hit.threadTs !== hit.ts && <span className="slack-hit-thread">in a thread</span>}
        </span>
        <span className="slack-hit-main">
          <Avatar user={user} name={hit.botName ?? user?.name} size={28} botIcon={hit.botIconUrl} />
          <span className="slack-hit-body">
            <span className="slack-head">
              <b className="slack-name">{hit.botName ?? user?.name ?? "Someone"}</b>
              <time className="slack-time" dateTime={date.toISOString()} data-tip={fullTime(hit.ts)}>
                {date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })}
              </time>
            </span>
            <MessageText message={hit} />
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Search every message in the workspace (Slack's `search.messages`), asked
 * 300 ms after typing pauses, from two characters. A hit opens its
 * conversation at it, or its thread.
 */
export function Search({
  query,
  onQuery,
  onOpen,
  onClose,
  focusRef,
  revision,
  sidebarHidden,
}: {
  query: string;
  onQuery: (q: string) => void;
  onOpen: (hit: SlackSearchHit) => void;
  onClose: () => void;
  focusRef: MutableRefObject<(() => void) | null>;
  /** Refresh asks again. */
  revision: number;
  sidebarHidden: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState<{ term: string; result?: SlackSearch; error?: string }>();
  const term = query.trim();
  const searchable = term.length >= 2;
  useEffect(() => {
    focusRef.current = () => {
      input.current?.focus();
      input.current?.select();
    };
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);
  const asked = useRef(revision);
  useEffect(() => {
    if (!searchable) return;
    let gone = false;
    const fresh = asked.current !== revision;
    asked.current = revision;
    const timer = setTimeout(() => {
      void searchSlack(term, fresh).then((a) => {
        if (!gone) setAnswer({ term, ...a });
      });
    }, 300);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [term, searchable, revision]);
  const current = answer?.term === term ? answer : undefined;
  const hits = current?.result?.messages ?? [];

  return (
    <section className={`slack-search${sidebarHidden ? " sidebar-hidden" : ""}`} aria-label="Search Slack">
      <header className="slack-conv-head">
        <label className="search-wrap slack-search-field">
          <SearchIcon size={14} aria-hidden="true" />
          <input
            {...plainText}
            ref={input}
            type="search"
            autoFocus
            aria-label="Search all messages in Slack"
            placeholder="Search all messages"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                (e.currentTarget.closest("section")?.querySelector(".slack-hit") as HTMLElement | null)?.focus();
              }
            }}
          />
        </label>
        <button type="button" className="icon-btn" aria-label="Close the search" data-tip="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div
        className="slack-hits"
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>(".slack-hit")];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (at < 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "ArrowUp" && at === 0) input.current?.focus();
          else items[Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
        }}
      >
        {!searchable ? (
          <p className="slack-note">Type two or more characters to search every message in Slack.</p>
        ) : !current ? (
          <p className="slack-note" aria-busy="true">
            <LoaderCircle size={13} className="spinning" aria-hidden="true" /> Searching…
          </p>
        ) : current.error ? (
          <p className="slack-note">{current.error}</p>
        ) : hits.length === 0 ? (
          <p className="slack-note">No messages match.</p>
        ) : (
          <>
            <p className="slack-note slack-hit-count">
              {current.result!.total > hits.length ? `${hits.length} of ${current.result!.total} results, most relevant first` : `${hits.length} ${hits.length === 1 ? "result" : "results"}`}
            </p>
            <ul className="slack-hit-list">
              {hits.map((hit) => (
                <Hit key={`${hit.conversationId}:${hit.ts}`} hit={hit} onOpen={() => onOpen(hit)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

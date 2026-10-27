/**
 * An agent's subagents, as the Paseo app's subagent dropdown shows them: a
 * compact "N subagents · M working" control in the agent's header opens
 * "Archive finished subagents" and the list (running first, then finished),
 * and picking one opens its conversation here, read-only, with a way back to
 * the agent that dispatched it.
 *
 * Conversations are read as the Paseo app reads them: a provider subagent's
 * from its parent's provider-subagent timeline
 * (`agents/:id/subagents/:subagent/timeline`), a hidden daemon subagent's
 * like any agent's (it has its own ID and timeline). Neither can be
 * prompted from here.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowLeft,
  Bot,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { api, errorMessage, retainSnapshot } from "./api";
import { agentClientId } from "./agentIdentity";
import { watchSession } from "./sessionPoll";
import { liveConnection } from "./live";
import type { HistoryItem, HistoryPage } from "./history";
import { placePopover } from "./popover";
import { soundEvent } from "./soundCues";
import { fromTimeline, type TimelineItem } from "./transcript";
import { Timeline, type Earlier } from "./Session";
import { Badge, ProviderIcon } from "./ui";
import type { Agent, Subagent } from "./types";
import { hostQuery } from "./types";

/** Running (or starting): as the server counts a working subagent. */
export const subagentWorking = (s: Pick<Subagent, "status">) =>
  /running|starting|initializing/.test(s.status);
/** What "Archive finished subagents" takes (the Paseo app's `isFinishedSubagent`). */
export const subagentFinished = (s: Pick<Subagent, "status" | "source">) =>
  s.source === "agent"
    ? /^(idle|error)$/.test(s.status)
    : /^(completed|failed|canceled)$/.test(s.status);
/** Its status in words, as a badge shows it. */
export function subagentStatus(s: Pick<Subagent, "status">) {
  if (subagentWorking(s)) return "running";
  if (/fail|error/.test(s.status)) return "failed";
  if (/cancel/.test(s.status)) return "canceled";
  if (s.status === "completed") return "done";
  return s.status || "done";
}
/** Running ones first (oldest first), then finished ones (newest first). */
export function subagentOrder(list: Subagent[]) {
  const at = (s: Subagent) => Date.parse(s.startedAt ?? "") || 0;
  const running = list.filter(subagentWorking);
  const done = list.filter((s) => !subagentWorking(s));
  return [
    ...running.sort((a, b) => at(a) - at(b)),
    ...done.sort((a, b) => at(b) - at(a)),
  ];
}
/** "5 subagents · 2 working". */
export function subagentSummary(list: Subagent[]) {
  const working = list.filter(subagentWorking).length;
  const count = `${list.length} subagent${list.length === 1 ? "" : "s"}`;
  return working ? `${count} · ${working} working` : count;
}
/** Its kind and facts for the line under its name. */
export const subagentFacts = (s: Subagent) => s.detail || s.kind || "";

/** The header control and its dropdown. Hidden when there are none. */
export function SubagentsControl({
  agent,
  current,
  onOpen,
  onNotice,
}: {
  agent: Agent;
  /** The subagent whose conversation is open, if any. */
  current?: string;
  onOpen: (subagentId: string) => void;
  onNotice: (message: string) => void;
}) {
  const list = agent.subagents ?? [];
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    menu.current
      ?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, close]);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    return placePopover(el);
  }, []);
  if (!list.length) return null;
  const finished = list.filter(subagentFinished).length;
  const working = list.filter(subagentWorking).length;
  const summary = subagentSummary(list);
  const archive = async () => {
    if (!finished || archiving) return;
    setArchiving(true);
    try {
      const r = await api<{
        archived?: unknown[];
        dismissed?: unknown[];
        failed?: { name: string; error: string }[];
      }>(`agents/${agent.id}/subagents/archive`, {
        confirm: true,
        ...(agent.host ? { host: agent.host } : {}),
      });
      const n = (r.archived?.length ?? 0) + (r.dismissed?.length ?? 0);
      if (r.failed?.length) {
        soundEvent("actionFailed");
        onNotice(
          `Archived ${n}; ${r.failed.length} couldn't be archived: ${r.failed[0].error}`,
        );
      } else
        onNotice(
          n
            ? `Archived ${n} finished subagent${n === 1 ? "" : "s"}`
            : "No finished subagents to archive",
        );
    } catch (e) {
      soundEvent("actionFailed");
      onNotice(errorMessage(e));
    } finally {
      setArchiving(false);
    }
  };
  return (
    <span
      ref={anchor}
      className="menu-anchor subagents-anchor"
      onBlur={(e) => {
        if (
          open &&
          e.relatedTarget &&
          !anchor.current?.contains(e.relatedTarget as Node)
        )
          close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`subagents-trigger${working ? " working" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Subagents: ${summary}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Bot size={12} aria-hidden="true" />
        <span>{summary}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={placeMenu}
          id={id}
          role="menu"
          aria-label="Subagents"
          className="popover-menu right subagents-menu"
          onKeyDown={(e) => {
            if (e.key === "Tab" || e.key === "Escape") return;
            // Keys pressed in the menu are the menu's (not J/K/N/D shortcuts).
            e.stopPropagation();
            const all = [
              ...(menu.current?.querySelectorAll<HTMLElement>(
                "[role=menuitem]",
              ) || []),
            ];
            const i = all.indexOf(document.activeElement as HTMLElement);
            const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[
              e.key as "Home"
            ];
            if (to === undefined || !all.length) return;
            e.preventDefault();
            all[(to + all.length) % all.length].focus();
          }}
        >
          <button
            role="menuitem"
            tabIndex={-1}
            className="subagents-archive"
            aria-disabled={!finished || archiving}
            aria-busy={archiving}
            aria-description={
              finished
                ? `Archive the ${finished} finished subagent${finished === 1 ? "" : "s"}; running ones are left alone`
                : "No finished subagents to archive"
            }
            onClick={() => void archive()}
          >
            {archiving ? (
              <LoaderCircle size={14} className="spinning" aria-hidden="true" />
            ) : (
              <Archive size={14} aria-hidden="true" />
            )}
            <span className="subagent-text">
              <b>Archive finished subagents</b>
            </span>
            {finished > 0 && (
              <small className="subagents-count">{finished}</small>
            )}
          </button>
          <hr />
          <div className="subagents-list">
            {subagentOrder(list).map((s) => {
              const facts = subagentFacts(s);
              const state = subagentStatus(s);
              return (
                <button
                  key={s.id}
                  role="menuitem"
                  tabIndex={-1}
                  data-subagent={s.id}
                  className={`subagent-row ${subagentWorking(s) ? "running" : "finished"}${s.id === current ? " current" : ""}`}
                  aria-current={s.id === current ? "true" : undefined}
                  aria-description={`${state}${facts ? ` · ${facts}` : ""}. Open its conversation`}
                  onClick={() => {
                    close(false);
                    onOpen(s.id);
                  }}
                >
                  <ProviderIcon
                    provider={
                      s.source === "agent" && s.kind ? s.kind : agent.provider
                    }
                  />
                  <span className="subagent-text">
                    <b>{s.name}</b>
                    {facts && <small>{facts}</small>}
                  </span>
                  <em className={`subagent-state ${state}`}>
                    <span className="dot" aria-hidden="true" />
                    {state}
                  </em>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

type Conversation = {
  items: TimelineItem[];
  unavailable: string;
  error: string;
  loaded: boolean;
  earlier: Earlier;
};
const emptyConversation: Conversation = {
  items: [],
  unavailable: "",
  error: "",
  loaded: false,
  earlier: { more: false, loading: false, error: "" },
};

/**
 * A subagent's conversation. A hidden daemon subagent is watched like any
 * agent (pushed over the live connection, polled when it drops); a provider
 * subagent's is read from its parent and polled (every 2 s while it runs).
 */
function useConversation(agent: Agent, subagent: Subagent) {
  const [c, setC] = useState<Conversation>(emptyConversation);
  const older = useRef<(() => Promise<void>) | null>(null);
  const running = subagentWorking(subagent);
  const runningRef = useRef(running);
  runningRef.current = running;
  const host = agent.host;
  useEffect(() => {
    setC(emptyConversation);
    const controller = new AbortController();
    const show = (items: TimelineItem[], hasOlder?: boolean, note = "") =>
      setC((prev) => ({
        ...prev,
        items: retainSnapshot(prev.items, items),
        unavailable: note,
        error: "",
        loaded: true,
        earlier:
          prev.earlier.more === Boolean(hasOlder)
            ? prev.earlier
            : { ...prev.earlier, more: Boolean(hasOlder) },
      }));
    const fail = (message: string) =>
      setC((prev) => ({ ...prev, error: message, loaded: true }));
    if (subagent.source === "agent") {
      const id = agentClientId(subagent.id, host);
      const session = watchSession(
        {
          detail: {
            fetch: (signal) =>
              api<unknown>(`agents/${id}${hostQuery(host)}`, undefined, signal),
            apply: () => {},
            error: () => {},
          },
          conversation: {
            fetch: (signal) =>
              api<HistoryPage>(
                `agents/${id}/timeline${hostQuery(host)}${host ? "&" : "?"}limit=300`,
                undefined,
                signal,
              ),
            error: fail,
          },
        },
        {
          subscribe: (h) => liveConnection().watch(id, host, h),
          timeline: (items, unavailable, hasOlder) =>
            show(items as TimelineItem[], hasOlder, unavailable),
          older: ({ epoch, before, after, until }) =>
            api<HistoryPage>(
              `agents/${id}/timeline${hostQuery(host)}${host ? "&" : "?"}limit=300&epoch=${encodeURIComponent(epoch)}&${after !== undefined ? `after=${after}&until=${until}` : `before=${before}`}`,
              undefined,
              controller.signal,
            ),
          hidden: () => document.hidden,
          interval: () =>
            document.hidden ? 30000 : runningRef.current ? 5000 : 15000,
          signal: controller.signal,
        },
      );
      older.current = () => session.loadOlder();
    } else {
      // Held by id; older pages join it, newer reads replace the tail.
      const held = new Map<string, HistoryItem>();
      let epoch = "";
      let hasOlder = false;
      const base = `agents/${agent.id}/subagents/${encodeURIComponent(subagent.id)}/timeline${hostQuery(host)}${host ? "&" : "?"}limit=300${subagent.owner ? `&owner=${encodeURIComponent(subagent.owner)}` : ""}`;
      const sorted = () =>
        [...held.values()].sort(
          (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
        ) as unknown as TimelineItem[];
      const absorb = (page: HistoryPage, tail: boolean) => {
        if (page.epoch && page.epoch !== epoch) {
          held.clear();
          epoch = page.epoch;
          hasOlder = Boolean(page.hasOlder);
        } else if (!tail) hasOlder = Boolean(page.hasOlder);
        else if (!held.size) hasOlder = Boolean(page.hasOlder);
        for (const item of page.items ?? []) held.set(item.id, item);
        show(sorted(), hasOlder);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        try {
          absorb(
            await api<HistoryPage>(base, undefined, controller.signal),
            true,
          );
        } catch (e) {
          if (controller.signal.aborted) return;
          fail(errorMessage(e) || "Couldn't read the conversation.");
        }
        if (controller.signal.aborted) return;
        timer = setTimeout(
          poll,
          document.hidden ? 30000 : runningRef.current ? 2000 : 15000,
        );
      };
      void poll();
      controller.signal.addEventListener("abort", () => clearTimeout(timer));
      older.current = async () => {
        const first = sorted()[0] as unknown as HistoryItem | undefined;
        if (!first?.seq || !epoch) return;
        absorb(
          await api<HistoryPage>(
            `${base}&before=${first.seq}&epoch=${encodeURIComponent(epoch)}`,
            undefined,
            controller.signal,
          ),
          false,
        );
      };
    }
    return () => {
      controller.abort();
      older.current = null;
    };
    // A different subagent (or agent) starts over; a status change doesn't
    // (the poll reads it through a ref).
  }, [agent.id, host, subagent.id, subagent.source, subagent.owner]);
  const loadOlder = useCallback(() => {
    const load = older.current;
    if (!load) return;
    setC((prev) => ({
      ...prev,
      earlier: { ...prev.earlier, loading: true, error: "" },
    }));
    void load().then(
      () =>
        setC((prev) => ({
          ...prev,
          earlier: { ...prev.earlier, loading: false },
        })),
      (e: unknown) =>
        setC((prev) => ({
          ...prev,
          earlier: {
            ...prev.earlier,
            loading: false,
            error: errorMessage(e) || "Couldn't load earlier messages.",
          },
        })),
    );
  }, []);
  return { ...c, loadOlder };
}

/** A subagent's conversation in the panel's chat view, read-only. */
export function SubagentSession({
  agent,
  subagent,
  parentName,
  onParent,
  onOpen,
  onNotice,
}: {
  /** The listed agent it belongs to. */
  agent: Agent;
  subagent: Subagent;
  parentName: string;
  /** Back to the agent's own conversation. */
  onParent: () => void;
  /** Open another of the agent's subagents. */
  onOpen: (subagentId: string) => void;
  onNotice: (message: string) => void;
}) {
  const conversation = useConversation(agent, subagent);
  const entries = useMemo(
    () => fromTimeline(conversation.items),
    [conversation.items],
  );
  const running = subagentWorking(subagent);
  const dispatcher = subagent.parent
    ? agent.subagents?.find((s) => s.id === subagent.parent)
    : undefined;
  const facts = subagentFacts(subagent);
  return (
    <div className="session subagent-session" data-subagent={subagent.id}>
      <header className="session-header">
        <div className="session-nav">
          <button
            className="ghost-btn subagent-back"
            onClick={onParent}
            aria-description={`Back to ${parentName}'s conversation`}
          >
            <ArrowLeft size={15} />
            <span>{parentName}</span>
          </button>
        </div>
        <div className="session-title">
          <div>
            <p className="subagent-of">
              Subagent of{" "}
              <button type="button" className="link-btn" onClick={onParent}>
                {parentName}
              </button>
              {dispatcher && (
                <>
                  {" "}
                  · dispatched by{" "}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onOpen(dispatcher.id)}
                  >
                    {dispatcher.name}
                  </button>
                </>
              )}
            </p>
            <h2>{subagent.name}</h2>
          </div>
        </div>
        <div className="session-meta">
          <ProviderIcon
            provider={
              subagent.source === "agent" && subagent.kind
                ? subagent.kind
                : agent.provider
            }
          />
          <Badge status={subagentStatus(subagent)} />
          {facts && <span className="usage-chip">{facts}</span>}
          <SubagentsControl
            agent={agent}
            current={subagent.id}
            onOpen={onOpen}
            onNotice={onNotice}
          />
        </div>
      </header>
      <Timeline
        key={`${agent.id}:${subagent.id}`}
        entries={entries}
        loading={!conversation.loaded}
        imageHost={agent.host}
        running={running}
        pending={[]}
        unavailable={conversation.unavailable}
        error={conversation.error}
        earlier={conversation.earlier}
        onEarlier={conversation.loadOlder}
      />
      <footer className="session-footer subagent-footer">
        <p>
          A subagent's conversation is read-only.{" "}
          <button type="button" className="link-btn" onClick={onParent}>
            Back to {parentName}
          </button>
        </p>
      </footer>
    </div>
  );
}

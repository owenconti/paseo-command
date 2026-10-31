import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Archive, AlarmClock, AlarmClockOff, Bell, Box, CheckCheck, Mail, MailOpen, X } from "lucide-react";
import { ago, errorMessage } from "../api";
import { onAppCommand } from "../appCommands";
import { Person, ScreenHead } from "./bits";
import { inboxEntity, inboxGroups, inboxText, snoozeTimes, type InboxGroup } from "./inboxRows";
import type { IssueListNav } from "./IssueList";
import { placeBelow } from "./Picker";
import { linearStore, loadNotifications, useLinear } from "./store";

/** How long an archive's Undo stays offered. */
const UNDO_MS = 10_000;

const now = () => Date.now();

/** Marks a row's notifications read (or unread again), at once and in Linear. */
export function markRead(group: InboxGroup, read: boolean): Promise<boolean> {
  const ids = group.notifications.map((n) => n.id);
  const at = new Date().toISOString();
  return read
    ? linearStore.writeNotifications("notificationMarkReadAll", { ...inboxEntity(group), readAt: at }, ids, { readAt: at })
    : linearStore.writeNotifications("notificationMarkUnreadAll", inboxEntity(group), ids, { readAt: undefined });
}

/** A row's snooze choices (an hour, tomorrow, next week), at its button or where H was pressed. */
function SnoozeMenu({ onPick, onClose }: { onPick: (at: Date) => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement | null>(null);
  const place = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!menu.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);
  return (
    <div
      ref={place}
      role="menu"
      aria-label="Snooze until"
      className="popover-menu right linear-row-menu linear-snooze-menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Tab") return;
        e.stopPropagation();
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const to = { ArrowDown: i + 1, ArrowUp: i - 1 }[e.key as "ArrowDown"];
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (to !== undefined) {
          e.preventDefault();
          items[(to + items.length) % items.length]?.focus();
        }
      }}
    >
      {snoozeTimes(new Date()).map((choice) => (
        <button key={choice.label} role="menuitem" tabIndex={-1} onClick={() => onPick(choice.at)}>
          <span>
            {choice.label}
            <small>
              {choice.at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Your Inbox, as Linear's: your notifications, an issue's (or project's) in
 * one row, newest first; unread rows marked. A row opens its issue (beside, or
 * in its place) or project, and is read from then. Each row marks read or
 * unread (U), snoozes until later (H), or archives (⌫, with Undo); Snoozed
 * lists what's snoozed, each to wake now. Mark all read takes every unread row.
 * Everything shows from the store, kept current by sync; `nav` takes J/K and Enter.
 */
export function Inbox({
  openKey,
  onOpen,
  onProject,
  revision,
  nav,
}: {
  openKey?: string;
  onOpen: (issueKey: string) => void;
  onProject: (projectId: string) => void;
  /** Changes when the view refreshes: the Inbox is asked for again. */
  revision: number;
  nav?: MutableRefObject<IssueListNav | null>;
}) {
  const notifications = useLinear((d) => d.notifications);
  const loaded = useLinear((d) => d.notificationsLoaded);
  const users = useLinear((d) => d.workspace?.users);
  const issues = useLinear((d) => d.issues);
  const byKey = useLinear((d) => d.byKey);
  const [snoozedTab, setSnoozedTab] = useState(false);
  const [error, setError] = useState<string>();
  // Snoozes run out as time passes: a minute's tick brings them back.
  const [tick, setTick] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setTick(now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setError(undefined);
    loadNotifications(revision > 0).catch((e) => setError(errorMessage(e)));
  }, [revision]);
  const all = useMemo(() => [...notifications.values()], [notifications]);
  const rows = useMemo(() => inboxGroups(all, tick, snoozedTab), [all, tick, snoozedTab]);
  const snoozedCount = useMemo(() => inboxGroups(all, tick, true).length, [all, tick]);
  const unread = rows.filter((g) => g.unread);
  const readAll = useRef(() => {});
  readAll.current = () => unread.forEach((g) => void markRead(g, true));
  useEffect(() => onAppCommand("linear-inbox-read-all", () => readAll.current()), []);

  const listRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string>();
  const current =
    rows.find((g) => g.key === focusKey)?.key ?? rows.find((g) => g.issueKey && g.issueKey === openKey)?.key ?? rows[0]?.key;
  const [snoozing, setSnoozing] = useState<string>();
  const [undo, setUndo] = useState<{ ids: string[]; label: string }>();
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo((u) => (u === undo ? undefined : u)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const label = (g: InboxGroup) => g.issueKey ?? inboxText(g).title;
  const open = (g: InboxGroup) => {
    setFocusKey(g.key);
    if (g.unread) void markRead(g, true);
    if (g.issueKey) onOpen(g.issueKey);
    else if (g.projectId) onProject(g.projectId);
  };
  const focusRow = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  /** After a row leaves (archived, snoozed): the keyboard goes to the next one. */
  const leave = (g: InboxGroup) => {
    const at = rows.findIndex((r) => r.key === g.key);
    const next = rows[at + 1] ?? rows[at - 1];
    setFocusKey(next?.key);
    if (next) setTimeout(() => focusRow(next.key), 0);
  };
  const archive = async (g: InboxGroup) => {
    const ids = g.notifications.map((n) => n.id);
    leave(g);
    const done = await linearStore.writeNotifications("notificationArchiveAll", inboxEntity(g), ids, {
      archivedAt: new Date().toISOString(),
    });
    if (done) setUndo({ ids, label: label(g) });
  };
  const unarchive = async () => {
    if (!undo) return;
    setUndo(undefined);
    for (const id of undo.ids)
      await linearStore.writeNotifications("notificationUnarchive", { id }, [id], { archivedAt: undefined });
  };
  const snooze = (g: InboxGroup, at: Date) => {
    setSnoozing(undefined);
    leave(g);
    const until = at.toISOString();
    void linearStore.writeNotifications(
      "notificationSnoozeAll",
      { ...inboxEntity(g), snoozedUntilAt: until },
      g.notifications.map((n) => n.id),
      { snoozedUntilAt: until },
    );
  };
  const wake = (g: InboxGroup) => {
    leave(g);
    void linearStore.writeNotifications(
      "notificationUnsnoozeAll",
      { ...inboxEntity(g), unsnoozedAt: new Date().toISOString() },
      g.notifications.map((n) => n.id),
      { snoozedUntilAt: undefined },
    );
  };
  const step = (by: number) => {
    const at = rows.findIndex((g) => g.key === current);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
    if (!next) return;
    setFocusKey(next.key);
    focusRow(next.key);
  };
  const focusedRow = () => {
    const el = document.activeElement as HTMLElement | null;
    return el && listRef.current?.contains(el) && el.matches(".linear-inbox-row") ? el.dataset.key : undefined;
  };
  useEffect(
    () => () => {
      if (nav) nav.current = null;
    },
    [nav],
  );
  if (nav)
    nav.current = {
      move: (by) => step(focusedRow() ? by : 0),
      open: () => {
        const g = rows.find((r) => r.key === (focusedRow() ?? current));
        if (g) open(g);
      },
      filter: () => {},
      filterBy: () => {},
      display: () => {},
      setLayout: () => {},
      clearFilters: () => {},
    };

  return (
    <div className="linear-list linear-inbox">
      <ScreenHead title={snoozedTab ? "Snoozed" : "Inbox"} count={loaded ? rows.length : undefined}>
        <span className="linear-tools">
          {!snoozedTab && unread.length > 0 && (
            <button className="linear-tool" onClick={() => readAll.current()}>
              <CheckCheck size={13} aria-hidden="true" />
              Mark all read
            </button>
          )}
          <button className="linear-tool" aria-pressed={snoozedTab} onClick={() => setSnoozedTab(!snoozedTab)}>
            {snoozedTab ? <Bell size={13} aria-hidden="true" /> : <AlarmClock size={13} aria-hidden="true" />}
            {snoozedTab ? "Inbox" : `Snoozed${snoozedCount ? ` ${snoozedCount}` : ""}`}
          </button>
        </span>
      </ScreenHead>
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      <div className="linear-groups">
        {!loaded && !error && <p className="linear-note">Loading your inbox…</p>}
        {loaded && !rows.length && (
          <p className="linear-note">{snoozedTab ? "Nothing snoozed." : "You're all caught up."}</p>
        )}
        <div
          ref={listRef}
          role="listbox"
          aria-label={snoozedTab ? "Snoozed notifications" : "Notifications"}
          onKeyDown={(e) => {
            const key = (e.target as HTMLElement).closest<HTMLElement>(".linear-inbox-row")?.dataset.key;
            const g = rows.find((r) => r.key === key);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              step(e.key === "ArrowDown" ? 1 : -1);
            }
            if (!g || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement) !== listRef.current?.querySelector(`[data-key="${CSS.escape(g.key)}"]`))
              return;
            if (e.key === "Enter") {
              e.preventDefault();
              open(g);
            } else if (e.key.toLowerCase() === "u") {
              e.preventDefault();
              void markRead(g, g.unread);
            } else if (e.key === "Backspace" || e.key === "Delete") {
              e.preventDefault();
              void archive(g);
            } else if (e.key.toLowerCase() === "h" && !snoozedTab) {
              e.preventDefault();
              setSnoozing(g.key);
            }
          }}
        >
          {rows.map((g) => {
            const issue = g.issueId ? issues.get(g.issueId) : g.issueKey ? issues.get(byKey.get(g.issueKey) ?? "") : undefined;
            const text = inboxText(g, issue?.title);
            const actor = users?.find((u) => u.id === g.latest.actorId);
            const selected = !!g.issueKey && g.issueKey === openKey;
            return (
              <div
                key={g.key}
                data-key={g.key}
                role="option"
                aria-selected={selected}
                tabIndex={g.key === current ? 0 : -1}
                className={`linear-inbox-row${g.unread ? " unread" : ""}${selected ? " selected" : ""}`}
                onClick={() => open(g)}
              >
                <span className="linear-inbox-dot" aria-label={g.unread ? "Unread" : undefined} />
                {actor ? <Person user={actor} /> : <span className="linear-person linear-person-none" aria-hidden="true" />}
                <span className="linear-inbox-text">
                  <span className="linear-inbox-title">
                    {text.key ? <span className="linear-key">{text.key}</span> : g.projectId ? <Box size={12} aria-hidden="true" /> : null}
                    <span className="linear-title">{text.title}</span>
                    {g.notifications.length > 1 && <span className="linear-count">{g.notifications.length}</span>}
                  </span>
                  <span className="linear-inbox-what">{text.what}</span>
                </span>
                <span className="linear-inbox-time">
                  {snoozedTab && g.latest.snoozedUntilAt
                    ? `until ${new Date(g.latest.snoozedUntilAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                    : ago(g.latest.createdAt)}
                </span>
                <span className="linear-inbox-actions menu-anchor" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    aria-label={g.unread ? `Mark ${label(g)} read` : `Mark ${label(g)} unread`}
                    data-tip={g.unread ? "Mark read (U)" : "Mark unread (U)"}
                    tabIndex={-1}
                    onClick={() => void markRead(g, g.unread)}
                  >
                    {g.unread ? <MailOpen size={13} aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
                  </button>
                  {snoozedTab ? (
                    <button
                      className="icon-btn"
                      aria-label={`Unsnooze ${label(g)}`}
                      data-tip="Unsnooze"
                      tabIndex={-1}
                      onClick={() => wake(g)}
                    >
                      <AlarmClockOff size={13} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      className="icon-btn"
                      aria-label={`Snooze ${label(g)}`}
                      aria-haspopup="menu"
                      aria-expanded={snoozing === g.key}
                      data-tip="Snooze (H)"
                      tabIndex={-1}
                      onClick={() => setSnoozing(snoozing === g.key ? undefined : g.key)}
                    >
                      <AlarmClock size={13} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label={`Archive ${label(g)}`}
                    data-tip="Archive (⌫)"
                    tabIndex={-1}
                    onClick={() => void archive(g)}
                  >
                    <Archive size={13} aria-hidden="true" />
                  </button>
                  {snoozing === g.key && (
                    <SnoozeMenu
                      onPick={(at) => snooze(g, at)}
                      onClose={() => {
                        setSnoozing(undefined);
                        focusRow(g.key);
                      }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {undo && (
        <div className="linear-undo" role="status">
          <Archive size={13} aria-hidden="true" />
          <span>{undo.label} archived</span>
          <button type="button" className="link-btn" onClick={() => void unarchive()}>
            Undo
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" data-tip="Dismiss" onClick={() => setUndo(undefined)}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

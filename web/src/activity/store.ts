/**
 * The page's Activity feed: asked for every 30 s while the Activity view shows
 * and the page isn't hidden, else once a minute (the mode bar's unread count
 * needs it), and not at all while no source is enabled. Read, unread and done
 * show at once and are put back, with a notice, if the server says they failed.
 * A key saved in Settings or an integration switched asks again at once.
 */
import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "../api";
import { useIntegrations } from "../integrationSettings";
import { activityEnabled, type Integrations } from "../integrations";
import { readActivity, writeActivity } from "./api";
import { SOURCE_LABEL } from "./rows";
import type { ActivityFeed, ActivityItem, ActivityWriteName } from "./types";

export const ACTIVITY_POLL = { shownMs: 30_000, hiddenMs: 60_000, tickMs: 5_000 };

export type ActivityState = {
  /** The feed as shown: the server's last answer with writes still going applied. Undefined until the first answer. */
  feed?: ActivityFeed;
  /** Why the last ask failed (the feed stays as it was). */
  error?: string;
  loading: boolean;
  enabled: boolean;
};

let state: ActivityState = { loading: false, enabled: false };
let server: ActivityFeed | undefined;
const pending = new Map<number, { name: ActivityWriteName; keys: Set<string> }>();
let serial = 0;
let asks = 0;
/** Bumped as each write settles: an answer asked for before then may predate it, and is dropped. */
let writesSettled = 0;
let lastAsked = 0;
let inflight: Promise<void> | undefined;
let notice: (message: string) => void = () => {};
const listeners = new Set<() => void>();

const emit = (next: Partial<ActivityState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

/** Whether an item can go back to unread (GitHub can't). */
export const canUnread = (item: Pick<ActivityItem, "source">) => item.source !== "github";

/** The server's feed with these writes applied: read, unread (where it can be) and done (gone). */
export function applyWrites(
  feed: ActivityFeed,
  writes: Iterable<{ name: ActivityWriteName; keys: Set<string> }>,
): ActivityFeed {
  let items = feed.items;
  for (const w of writes) {
    if (w.name === "done") items = items.filter((i) => !w.keys.has(i.key));
    else
      items = items.map((i) =>
        w.keys.has(i.key) && (w.name === "read" || canUnread(i)) ? { ...i, unread: w.name === "unread" } : i,
      );
  }
  if (items === feed.items) return feed;
  return {
    ...feed,
    items,
    sources: feed.sources.map((s) =>
      s.enabled && s.ok ? { ...s, unread: items.filter((i) => i.source === s.source && i.unread).length } : s,
    ),
  };
}

const show = () => emit({ feed: server && applyWrites(server, pending.values()) });

/** Asks for the feed now (`fresh` past the server's caches); one ask at a time. */
export function loadActivity(fresh = false): Promise<void> {
  if (!state.enabled) return Promise.resolve();
  if (inflight && !fresh) return inflight;
  const settled = writesSettled;
  const mine = ++asks;
  lastAsked = Date.now();
  emit({ loading: true });
  const ask: Promise<void> = readActivity(fresh)
    .then(
      (feed) => {
        // Only the latest ask's answer, and none from before a write settled.
        if (!state.enabled || mine !== asks) return;
        if (settled === writesSettled) server = feed;
        emit({ error: undefined });
        show();
      },
      (e) => {
        if (mine === asks) emit({ error: errorMessage(e) || "Activity didn't answer." });
      },
    )
    .finally(() => {
      if (inflight !== ask) return;
      inflight = undefined;
      emit({ loading: false });
    });
  inflight = ask;
  return inflight;
}

/** Marks these items read, unread or done: at once here, then on the server; false when any failed. */
export async function writeItems(name: ActivityWriteName, keys: string[]): Promise<boolean> {
  const items = (state.feed?.items ?? []).filter((i) => keys.includes(i.key));
  const wanted = items.filter((i) =>
    name === "read" ? i.unread : name === "unread" ? !i.unread && canUnread(i) : true,
  );
  if (!wanted.length) return true;
  const id = ++serial;
  pending.set(id, { name, keys: new Set(wanted.map((i) => i.key)) });
  show();
  const verb = name === "done" ? "mark as done" : `mark ${name}`;
  try {
    const result = await writeActivity(name, wanted.map((i) => i.key));
    pending.delete(id);
    writesSettled++;
    if (result?.feed) server = result.feed;
    show();
    if (result?.failed?.length) {
      const first = wanted.find((i) => i.key === result.failed![0]!.key);
      const what = result.failed.length === 1 ? `“${first?.title ?? "it"}”` : `${result.failed.length} items`;
      notice(`Couldn’t ${verb} ${what}: ${result.failed[0]!.error}`);
      return false;
    }
    return true;
  } catch (e) {
    pending.delete(id);
    writesSettled++;
    show();
    const sources = [...new Set(wanted.map((i) => SOURCE_LABEL[i.source]))].join(", ");
    notice(`Couldn’t ${verb} in ${sources}: ${errorMessage(e) || "the app server didn't answer."}`);
    return false;
  }
}

/** Where a refused write says why (the app's notice). */
export function setActivityNotice(next: ((message: string) => void) | null): void {
  notice = next ?? (() => {});
}

let integrationsKey = "";
/** Which sources are on: off forgets the feed; a change asks again at once. */
export function setActivityIntegrations(integrations: Pick<Integrations, "github" | "linear" | "slack">): void {
  const key = JSON.stringify([integrations.github, integrations.linear, integrations.slack]);
  if (key === integrationsKey) return;
  integrationsKey = key;
  const enabled = activityEnabled(integrations as Integrations);
  if (!enabled) {
    server = undefined;
    pending.clear();
    emit({ enabled, feed: undefined, error: undefined });
    return;
  }
  emit({ enabled });
  void loadActivity(true);
}

let shown = 0;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const hidden = () => typeof document !== "undefined" && document.hidden;

/** Whether a poll is due now: every 30 s while the view shows and the page isn't hidden, else a minute. */
export function pollDue(now: number, viewShown: boolean, pageHidden: boolean, asked: number): boolean {
  return now - asked >= (viewShown && !pageHidden ? ACTIVITY_POLL.shownMs : ACTIVITY_POLL.hiddenMs);
}
function tick() {
  if (state.enabled && !inflight && pollDue(Date.now(), shown > 0, hidden(), lastAsked)) void loadActivity();
}
const onVisible = () => {
  if (!hidden() && shown > 0) void loadActivity();
};
const onSecrets = () => void loadActivity(true);

/** Keeps the feed polled while anything uses it; `viewShown` while the Activity view is mounted. */
export function useActivityPoll(viewShown: boolean): void {
  const { integrations, loaded } = useIntegrations();
  useEffect(() => {
    if (loaded) setActivityIntegrations(integrations);
  }, [loaded, integrations]);
  useEffect(() => {
    if (users++ === 0) {
      timer = setInterval(tick, ACTIVITY_POLL.tickMs);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("paseo:secrets", onSecrets);
    }
    return () => {
      if (--users === 0) {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("paseo:secrets", onSecrets);
      }
    };
  }, []);
  useEffect(() => {
    if (!viewShown) return;
    // Shown: ask now if the last answer is older than the view's 30 s.
    if (shown++ === 0 && pollDue(Date.now(), true, hidden(), lastAsked)) void loadActivity();
    return () => void shown--;
  }, [viewShown]);
}

export function useActivity<T>(select: (s: ActivityState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const activityStore = { getState: () => state };

/** The feed's unread items from sources that answered; undefined before the first answer or while Activity is off. */
export function unreadOf(s: ActivityState): number | undefined {
  if (!s.enabled || !s.feed) return undefined;
  return s.feed.items.filter((i) => i.unread).length;
}

/** The unread count for the mode bar's Activity tab, kept by the background poll even while the view isn't mounted. */
export function useActivityUnread(): number | undefined {
  useActivityPoll(false);
  return useActivity(unreadOf);
}

/** Forgets everything (tests). */
export function resetActivityStore(): void {
  state = { loading: false, enabled: false };
  server = undefined;
  pending.clear();
  inflight = undefined;
  lastAsked = 0;
  writesSettled = 0;
  integrationsKey = "";
  notice = () => {};
}

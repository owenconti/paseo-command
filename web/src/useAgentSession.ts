/**
 * One agent's session as the panel shows it: its detail and conversation
 * (pushed, polled when the stream drops), earlier history on demand, sent
 * messages shown until the timeline reports them, and its commands. Used by
 * `Session` and by a reply fork's pane (its helper agent).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsPresent } from "framer-motion";
import type { Outgoing } from "./Composer";
import type { PermissionDecision } from "./PermissionCard";
import { sendBody } from "./sent";
import { api, errorMessage, retainSnapshot, writeStore } from "./api";
import { watchSession } from "./sessionPoll";
import { liveConnection } from "./live";
import type { HistoryPage } from "./history";
import { newMessageId, onQueueSent } from "./queue";
import {
  fromTimeline,
  parseTranscript,
  type Entry,
  type TimelineItem,
} from "./transcript";
import type { Detail, Permission } from "./types";
import { hostQuery, isArchived, isRunning, providerName } from "./types";
import { soundEvent } from "./soundCues";
import {
  agentExcluded,
  agentIdentity,
  archiveAgent,
  onAgentArchived,
} from "./activeAgents";

export type Earlier = { more: boolean; loading: boolean; error: string };
/** `seen`: how many matching prompts the timeline already had when this one was sent.
 *  `messageId`: the ID it was sent with; the timeline's prompt carries it. */
export type Pending = {
  text: string;
  images: string[];
  at: number;
  seen: number;
  messageId?: string;
};
export type Source =
  | { source: "timeline"; items: TimelineItem[] }
  | { source: "logs"; lines: string[]; assistant?: string[] };
const sameMessage = (logged: string, sent: string) => {
  const a = logged.trim().slice(0, 60),
    b = sent.trim().slice(0, 60);
  return Boolean(a) && (a.startsWith(b) || b.startsWith(a));
};

export type SessionTarget = {
  id: string;
  host?: string;
  provider?: string;
  /** The fleet's status; without it, the detail's. */
  status?: string;
  archived?: boolean;
  archivedAt?: string | null;
};

export function useAgentSession(
  agent: SessionTarget,
  {
    onNotice,
    onChanged,
    onCommand,
  }: {
    onNotice: (message: string) => void;
    onChanged?: () => Promise<void> | void;
    /** After any command succeeds. */
    onCommand?: () => void;
  },
) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const present = useIsPresent();
  const [source, setSource] = useState<Source | null>(null);
  const [unavailable, setUnavailable] = useState("");
  // Earlier history: paged in on demand (the session sends only its newest
  // rows within a byte budget).
  const [earlier, setEarlier] = useState<Earlier>({
    more: false,
    loading: false,
    error: "",
  });
  const loadOlder = useRef<(() => Promise<void>) | null>(null);
  // Each stream keeps its own error, so one's success can't hide the other's.
  const [detailError, setDetailError] = useState("");
  const [conversationError, setConversationError] = useState("");
  const error = conversationError || detailError;
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const host = agent.host;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const status = agent.status ?? detail?.Status ?? "";
  const running = isRunning(status);
  const archived =
    Boolean(detail?.Archived) || isArchived({ ...agent, status });

  useEffect(() => {
    setDetail(null);
    setSource(null);
    setUnavailable("");
    setDetailError("");
    setConversationError("");
    setPending([]);
  }, [agent.id]);

  // Read when a fallback poll is scheduled, so a status change doesn't
  // reopen the stream.
  const runningRef = useRef(running);
  runningRef.current = running;
  useLayoutEffect(() => {
    if (!present || agentExcluded({ ...agent, status })) {
      loadOlder.current = null;
      return;
    }
    const controller = new AbortController();
    const stopArchived = onAgentArchived((id, archivedHost) => {
      if (agentIdentity(id, archivedHost) !== agentIdentity(agent.id, host))
        return;
      controller.abort();
      loadOlder.current = null;
    });
    const showTimeline = (t: {
      items: TimelineItem[];
      unavailable?: string;
      hasOlder?: boolean;
    }) => {
      setEarlier((e) =>
        e.more === Boolean(t.hasOlder)
          ? e
          : { ...e, more: Boolean(t.hasOlder) },
      );
      setSource((previous) =>
        retainSnapshot(previous, {
          source: "timeline",
          items: t.items,
        } as Source),
      );
      setUnavailable(t.unavailable || "");
    };
    // The header and the conversation are pushed; if the stream drops they
    // poll independently: a slow or failing one never delays the other, and
    // neither clears the other's error.
    setEarlier({ more: false, loading: false, error: "" });
    const session = watchSession(
      {
        detail: {
          fetch: (signal) =>
            api<Detail>(
              `agents/${agent.id}${hostQuery(host)}`,
              undefined,
              signal,
            ),
          apply: (d: Detail) => {
            if (d.Archived) {
              archiveAgent(agent.id, host);
              return;
            }
            setDetail((previous) => retainSnapshot(previous, d));
            if (d.AvailableModes?.length)
              writeStore(
                `modes:${providerName(agent.provider ?? "")}`,
                d.AvailableModes,
              );
          },
          error: setDetailError,
        },
        conversation: {
          fetch: (signal) =>
            api<{ items: TimelineItem[]; unavailable?: string }>(
              `agents/${agent.id}/timeline${hostQuery(host)}${host ? "&" : "?"}limit=300`,
              undefined,
              signal,
            ),
          apply: showTimeline,
          error: setConversationError,
        },
      },
      {
        subscribe: (h) => liveConnection().watch(agent.id, host, h),
        // The daemon's timeline rows, held as they arrived.
        timeline: (items, unavailable, hasOlder) =>
          showTimeline({
            items: items as TimelineItem[],
            unavailable,
            hasOlder,
          }),
        // An older page, or the changes after a sequence (repair).
        older: ({ epoch, before, after, until }) =>
          api<HistoryPage>(
            `agents/${agent.id}/timeline${hostQuery(host)}${host ? "&" : "?"}limit=300&epoch=${encodeURIComponent(epoch)}&${after !== undefined ? `after=${after}&until=${until}` : `before=${before}`}`,
            undefined,
            controller.signal,
          ),
        hidden: () => document.hidden,
        interval: () =>
          document.hidden ? 30000 : runningRef.current ? 5000 : 15000,
        signal: controller.signal,
      },
    );
    loadOlder.current = () => {
      setEarlier((e) => ({ ...e, loading: true, error: "" }));
      return session.loadOlder().then(
        () => setEarlier((e) => ({ ...e, loading: false })),
        (err: unknown) => {
          if (controller.signal.aborted) return;
          setEarlier((e) => ({
            ...e,
            loading: false,
            error: errorMessage(err) || "Couldn't load earlier messages.",
          }));
        },
      );
    };
    return () => {
      stopArchived();
      controller.abort();
      loadOlder.current = null;
    };
    // Reload for a different agent, not for each poll of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, host, reload, agent.provider, present]);

  const entries = useMemo(
    () =>
      !source
        ? []
        : source.source === "timeline"
          ? fromTimeline(source.items)
          : parseTranscript(source.lines, source.assistant),
    [source],
  );
  // Optimistic follow-ups disappear once the timeline reports them: by the
  // message ID they were sent with, or else by their text (an image-only
  // prompt has none, and a queued one can be logged before it is tracked).
  const userEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<Entry, { kind: "user" }> => e.kind === "user",
      ),
    [entries],
  );
  const userTexts = useMemo(() => userEntries.map((e) => e.text), [userEntries]);
  const userTextsRef = useRef(userTexts);
  userTextsRef.current = userTexts;
  const loggedIdsRef = useRef(new Set<string>());
  loggedIdsRef.current = useMemo(
    () => new Set(userEntries.flatMap((e) => (e.messageId ? [e.messageId] : []))),
    [userEntries],
  );
  useEffect(() => {
    if (!pending.length) return;
    const prune = () =>
      setPending((current) => {
        const next = current.filter(
          (p) =>
            Date.now() - p.at < 90000 &&
            !(p.messageId && loggedIdsRef.current.has(p.messageId)) &&
            userTextsRef.current.filter((u) => sameMessage(u, p.text)).length <=
              p.seen,
        );
        return next.length === current.length ? current : next;
      });
    prune();
    const timer = setInterval(prune, 5000);
    return () => clearInterval(timer);
  }, [pending.length, userTexts]);

  const command = useCallback(
    async (action: string, body: Record<string, unknown>, success: string) => {
      setBusy(action);
      try {
        await api(
          `agents/${agent.id}/${action}`,
          host ? { ...body, host } : body,
        );
        if (action === "archive") archiveAgent(agent.id, host);
        if (action === "send") soundEvent("sent");
        if (success) onNotice(success);
        onCommandRef.current?.();
        await onChanged?.();
        setReload((n) => n + 1);
        return true;
      } catch (e) {
        soundEvent("actionFailed");
        onNotice(errorMessage(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agent.id, host, onChanged, onNotice],
  );

  /** Shows a sent message until the timeline reports it. */
  const track = useCallback((message: Outgoing) => {
    const seen = userTextsRef.current.filter((u) =>
      sameMessage(u, message.text),
    ).length;
    const at = Date.now();
    setPending((p) => [
      ...p,
      {
        text: message.text,
        images: message.images.map((i) => i.dataUrl),
        at,
        seen,
        messageId: message.messageId,
      },
    ]);
    return at;
  }, []);
  // Queued messages are sent by the app-wide runner.
  useEffect(
    () =>
      onQueueSent((id, message) => {
        if (id !== agent.id) return;
        track(message);
        setReload((n) => n + 1);
      }),
    [agent.id, track],
  );
  const send = async (outgoing: Outgoing) => {
    // Sent with an ID, so the timeline's copy is recognised by it.
    const message = { ...outgoing, messageId: outgoing.messageId ?? newMessageId() };
    const at = track(message);
    const ok = await command("send", await sendBody(message), "");
    if (!ok) setPending((p) => p.filter((x) => x.at !== at));
    return ok;
  };
  const respond = async (p: Permission, decision: PermissionDecision) => {
    const label = decision.answers
      ? "Answer sent"
      : decision.behavior === "allow"
        ? "Approved"
        : "Denied";
    let ok = await command("respond", { requestId: p.id, ...decision }, label);
    // Plain decisions can still go through the CLI if the daemon socket is unavailable.
    if (!ok && !decision.answers && !decision.actionId)
      ok = await command(
        decision.behavior === "allow" ? "allow" : "deny",
        { requestId: p.id },
        label,
      );
    if (ok)
      setDetail((d) =>
        d
          ? {
              ...d,
              PendingPermissions: d.PendingPermissions.filter(
                (x) => x.id !== p.id,
              ),
            }
          : d,
      );
  };
  const promptHistory = useMemo(
    () => userTexts.filter((t) => t.trim()).slice(-50),
    [userTexts],
  );
  return {
    detail,
    source,
    entries,
    unavailable,
    earlier,
    loadOlder: () => void loadOlder.current?.(),
    error,
    pending,
    busy,
    running,
    archived,
    command,
    send,
    respond,
    promptHistory,
  };
}

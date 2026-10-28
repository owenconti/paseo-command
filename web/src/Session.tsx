import type { WorkSummary } from "./useWorkingOn";
import { soundEvent } from "./soundCues";
import { daemonAgentId } from "./agentIdentity";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, useIsPresent } from "framer-motion";
import { PresenceDiv } from "./PresenceSurface";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  Plug,
  Plus,
  Server,
  Terminal,
  Wrench,
} from "lucide-react";
import { Composer, type Outgoing } from "./Composer";
import { PermissionCard, type PermissionDecision } from "./PermissionCard";
import { loadSent, sendBody, type SentAttachments } from "./sent";
import {
  api,
  errorMessage,
  readStore,
  retainSnapshot,
  writeStore,
} from "./api";
import { Markdown } from "./Markdown";
import { watchSession } from "./sessionPoll";
import { liveConnection } from "./live";
import type { HistoryPage } from "./history";
import { MarkdownImage } from "./Images";
import { extractImages } from "./imageSource";
import { onQueueSent } from "./queue";
import {
  eventBody,
  fromTimeline,
  parseTranscript,
  toBlocks,
  toolSummary,
  type Block,
  type Entry,
  type TimelineItem,
} from "./transcript";
import type { Agent, Detail, Mode, Permission, Workspace } from "./types";
import {
  hostQuery,
  isArchived,
  shownStatus,
  isRunning,
  providerName,
} from "./types";
import { Badge, CopyButton, ProviderIcon } from "./ui";
import { InlineName } from "./InlineName";
import { agentRenameTarget, rename } from "./renames";
import { agentName, hostText, pathText, placeText } from "./names";
import {
  agentExcluded,
  agentIdentity,
  archiveAgent,
  onAgentArchived,
} from "./activeAgents";
import { SubagentsControl } from "./Subagents";
import { HeaderLinks } from "./HeaderLinks";

/** `seen`: how many matching prompts the timeline already had when this one was sent. */
type Pending = { text: string; images: string[]; at: number; seen: number };
type Source =
  | { source: "timeline"; items: TimelineItem[] }
  | { source: "logs"; lines: string[]; assistant?: string[] };
const sameMessage = (logged: string, sent: string) => {
  const a = logged.trim().slice(0, 60),
    b = sent.trim().slice(0, 60);
  return Boolean(a) && (a.startsWith(b) || b.startsWith(a));
};
type Confirm = "archive" | "fresh" | null;

export function Session({
  workingOn,
  agent,
  workspace,
  waiting,
  online,
  onBack,
  onSelectWorkspace,
  onNotice,
  onChanged,
  onFreshDraft,
  onNewAgent,
  onOpenSubagent,
  position,
}: {
  workingOn?: WorkSummary;
  agent: Agent;
  workspace?: Workspace;
  waiting: boolean;
  online: boolean;
  onBack: () => void;
  onSelectWorkspace: (id: string) => void;
  onNotice: (message: string) => void;
  onChanged: () => Promise<void> | void;
  /** Open a new draft in this agent's workspace (after archiving it). */
  onFreshDraft: (agent: Agent) => void;
  /** Dispatch another agent into this agent's workspace (D). */
  onNewAgent: () => void;
  /** Open one of its subagents' conversations. */
  onOpenSubagent: (subagentId: string) => void;
  position: {
    index: number;
    total: number;
    prev: () => void;
    next: () => void;
  };
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const present = useIsPresent();
  const [source, setSource] = useState<Source | null>(null);
  const [drop, setDrop] = useState<{ files: File[]; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
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
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reload, setReload] = useState(0);
  const host = agent.host;
  const status = detail?.PendingPermissions.length
    ? "awaiting approval"
    : waiting
      ? "awaiting approval"
      : detail?.Archived
        ? "archived"
        : shownStatus(agent) || detail?.Status || "";
  const running = isRunning(agent.status);
  const archived = Boolean(detail?.Archived) || isArchived(agent);

  useEffect(() => {
    setDetail(null);
    setSource(null);
    setUnavailable("");
    setDetailError("");
    setConversationError("");
    setPending([]);
    setConfirm(null);
  }, [agent.id]);

  // Read when a fallback poll is scheduled, so a status change doesn't
  // reopen the stream.
  const runningRef = useRef(running);
  runningRef.current = running;
  useLayoutEffect(() => {
    if (!present || agentExcluded(agent)) {
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
                `modes:${providerName(agent.provider)}`,
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
  // Optimistic follow-ups disappear once the timeline reports them.
  const userTexts = useMemo(
    () =>
      entries
        .filter((e): e is Extract<Entry, { kind: "user" }> => e.kind === "user")
        .map((e) => e.text),
    [entries],
  );
  const userTextsRef = useRef(userTexts);
  userTextsRef.current = userTexts;
  useEffect(() => {
    if (!pending.length) return;
    const prune = () =>
      setPending((current) => {
        const next = current.filter(
          (p) =>
            Date.now() - p.at < 90000 &&
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
        setConfirm(null);
        await onChanged();
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
  const send = async (message: Outgoing) => {
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
  const archiveNow = async (fresh: boolean) => {
    const ok = await command(
      "archive",
      { confirm: true },
      `Archived “${agentName(agent, workspace?.branch)}”`,
    );
    if (ok && fresh) onFreshDraft(agent);
  };

  // Its settings are offered only while it has no turn. Until the timeline
  // is known, it is taken as started (nearly every agent is).
  const started =
    source === null ||
    entries.length > 0 ||
    pending.length > 0 ||
    earlier.more ||
    Boolean(agent.lastUserMessageAt || detail?.LastUserMessageAt);
  const modes: Mode[] =
    detail?.AvailableModes ||
    readStore<Mode[]>(`modes:${providerName(agent.provider)}`, []);
  const usage = detail?.LastUsage;
  // The title renames what it shows: the agent's own title, or its
  // workspace's when the agent is named by it.
  const renameTarget = agentRenameTarget(agent);

  const hasFiles = (e: React.DragEvent) =>
    [...e.dataTransfer.types].includes("Files");
  return (
    <div
      className="session"
      onDragEnter={(e) => {
        if (!hasFiles(e) || archived) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        // Always claim file drags, or the browser navigates to the dropped file.
        e.preventDefault();
        e.dataTransfer.dropEffect = archived ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (archived) return;
        dragDepth.current = 0;
        setDragging(false);
        setDrop({ files: [...e.dataTransfer.files], at: Date.now() });
      }}
    >
      {dragging && (
        <div className="drop-overlay">
          <span>
            <ImagePlus size={26} />
            Drop images or files here
          </span>
        </div>
      )}
      <header className="session-header">
        <div className="session-nav">
          <button
            className="ghost-btn"
            onClick={onBack}
            aria-description="Back to fleet (Esc)"
          >
            <ArrowLeft size={15} />
            Fleet
          </button>
          <span className="session-position">
            {position.index >= 0 && (
              <>
                <button
                  className="icon-btn"
                  onClick={position.prev}
                  data-tip="Previous agent (K)"
                  aria-label="Previous agent"
                >
                  <ChevronRight
                    size={15}
                    style={{ transform: "rotate(180deg)" }}
                  />
                </button>
                {position.index + 1} / {position.total}
                <button
                  className="icon-btn"
                  onClick={position.next}
                  data-tip="Next agent (J)"
                  aria-label="Next agent"
                >
                  <ChevronRight size={15} />
                </button>
              </>
            )}
          </span>
          <span className="session-tools">
            <button
              className="icon-btn"
              data-tip="New agent in this workspace (D)"
              aria-label="New agent in this workspace"
              aria-keyshortcuts="D"
              disabled={!online}
              onClick={onNewAgent}
            >
              <Plus size={14} />
            </button>
            <CopyButton value={daemonAgentId(agent)} label="Copy agent ID" />
            <button
              className="icon-btn"
              data-tip="Open in Paseo"
              aria-label="Open in Paseo"
              disabled={!!busy}
              onClick={() => void command("open", {}, "Opened in Paseo")}
            >
              <ExternalLink size={14} />
            </button>
            {!archived && (
              <button
                className="icon-btn"
                data-tip={
                  running
                    ? "Stop the agent before archiving it"
                    : "Archive agent"
                }
                aria-label="Archive agent"
                disabled={!!busy || !online || running}
                onClick={() => setConfirm("archive")}
              >
                <Archive size={14} />
              </button>
            )}
          </span>
        </div>
        <div className="session-title">
          <div>
            <InlineName
              kind={renameTarget.kind}
              renameKey={renameTarget.key}
              shown={agentName(agent, workspace?.branch)}
              value={renameTarget.value || agentName(agent, workspace?.branch)}
              disabled={archived || !online}
              onSave={(name) => void rename(renameTarget, name, onNotice)}
            />
            {/* The issue key is the Linear chip's (HeaderLinks); the ID is behind "Copy agent ID". */}
            {agent.hostLabel && (
              <p>
                <span className="host-chip">
                  <Server size={10} />
                  {hostText(agent)}
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="session-meta">
          <ProviderIcon provider={agent.provider} />
          <Badge status={status} />
          {usage && (usage.CostUsd || usage.OutputTokens) ? (
            <span
              className="usage-chip"
              aria-description={`${usage.InputTokens || 0} in · ${usage.OutputTokens || 0} out · ${usage.CachedTokens || 0} cached (last turn)`}
            >
              ${(usage.CostUsd || 0).toFixed(2)} ·{" "}
              {((usage.OutputTokens || 0) / 1000).toFixed(1)}k out
            </span>
          ) : null}
          <SubagentsControl
            agent={agent}
            onOpen={onOpenSubagent}
            onNotice={onNotice}
          />
        </div>
        <div className="session-links">
          <button
            className="branch-chip"
            disabled={!workspace}
            onClick={() =>
              workspace && onSelectWorkspace(workspace.workspaceId)
            }
            aria-description={pathText(detail?.Cwd || agent.cwd, [
              agent.id,
              agent.shortId,
              workspace?.workspaceId,
            ])}
          >
            <GitBranch size={11} />
            {placeText(
              workspace?.name ||
                workspace?.branch ||
                agent.cwd.split("/").pop(),
              "workspace",
            )}
          </button>
          <HeaderLinks agent={agent} workspace={workspace} />
        </div>
        <AnimatePresence>
          {confirm && (
            <PresenceDiv
              className="inline-confirm"
              role="alertdialog"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // Close the confirmation, not the whole session.
                e.nativeEvent.stopPropagation();
                setConfirm(null);
              }}
              aria-label="Confirm archive"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.12 } }}
            >
              <p>
                {confirm === "fresh"
                  ? "Archive this agent and start a fresh draft in the same workspace?"
                  : "Archive this agent? It leaves the active fleet; its workspace and files are untouched."}
              </p>
              <div>
                <button
                  aria-description="Keep the agent (Esc)"
                  className="secondary"
                  autoFocus
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  aria-description={
                    confirm === "fresh"
                      ? "Archive this agent, then start a new draft in its workspace"
                      : "Archive this agent; its workspace and files are kept"
                  }
                  className="danger"
                  disabled={!!busy}
                  onClick={() => void archiveNow(confirm === "fresh")}
                >
                  {busy ? (
                    <LoaderCircle size={13} className="spinning" />
                  ) : (
                    <Archive size={13} />
                  )}
                  {confirm === "fresh"
                    ? "Archive and start fresh"
                    : "Archive agent"}
                </button>
              </div>
            </PresenceDiv>
          )}
        </AnimatePresence>
      </header>
      <Timeline
        key={agent.id}
        entries={entries}
        loading={source === null && !error}
        imageHost={agent.host}
        running={running}
        pending={pending}
        unavailable={unavailable}
        error={error}
        earlier={earlier}
        onEarlier={() => loadOlder.current?.()}
      />
      <footer className="session-footer">
        {detail?.PendingPermissions.map((p, i) => (
          <PermissionCard
            imageHost={agent.host}
            key={p.id || i}
            permission={p}
            busy={!!busy}
            onRespond={(decision) => void respond(p, decision)}
          />
        ))}
        <Composer
          activity={
            running && online && !waiting && !archived && agent.workspaceId ? (
              <p
                className="session-working-on"
                title={workingOn?.error || "AI-generated from recent activity"}
              >
                {workingOn?.sentence ||
                  (workingOn?.error
                    ? "Current work summary unavailable."
                    : "Summarizing current work…")}
              </p>
            ) : undefined
          }
          key={agent.id}
          agent={agent}
          running={running}
          disabled={!online || archived}
          disabledReason={
            archived ? "This agent is archived." : "Paseo is offline."
          }
          started={started}
          modes={modes}
          mode={detail?.Mode}
          onSetMode={(mode) =>
            void command(
              "mode",
              { mode },
              `Mode set to ${modes.find((m) => m.id === mode)?.label || mode}`,
            )
          }
          onSend={send}
          onCancel={async () => {
            await command("cancel", {}, "Agent interrupted");
          }}
          onNotice={onNotice}
          onArchive={() =>
            running
              ? onNotice("Stop the agent before archiving it.")
              : setConfirm("archive")
          }
          onFreshDraft={() =>
            running
              ? onNotice("Stop the agent before archiving it.")
              : setConfirm("fresh")
          }
          promptHistory={promptHistory}
          dropFiles={drop}
        />
      </footer>
    </div>
  );
}

export type Earlier = { more: boolean; loading: boolean; error: string };
/** A row's distance from the top of the scrolling view. */
const offsetIn = (view: Element, node: Element) =>
  node.getBoundingClientRect().top - view.getBoundingClientRect().top;

export const Timeline = memo(function Timeline({
  entries,
  loading,
  imageHost,
  running,
  pending,
  unavailable,
  error,
  earlier,
  onEarlier,
}: {
  entries: Entry[];
  loading: boolean;
  imageHost?: string;
  running: boolean;
  pending: Pending[];
  unavailable: string;
  error: string;
  earlier: Earlier;
  onEarlier: () => Promise<void> | void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // When the reader last scrolled (wheel, touch, keys, scrollbar, focus).
  const userScroll = useRef(-Infinity);
  const intend = useCallback(() => {
    userScroll.current = performance.now();
  }, []);
  /**
   * While earlier rows load: the row the reader is looking at and its
   * distance from the top of the view. Whatever changes around it (rows
   * added above, a live reply growing below, an image decoding), it stays
   * where it was.
   */
  const anchor = useRef<{ node: Element; offset: number } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const blocks = useMemo(() => toBlocks(entries), [entries]);
  /** Hold the anchored row in place, or keep a pinned view at the bottom. */
  const settle = useCallback((el: HTMLDivElement) => {
    const held = anchor.current;
    if (held) {
      if (held.node.isConnected)
        el.scrollTop += offsetIn(el, held.node) - held.offset;
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    settle(el);
    if (!earlier.loading) anchor.current = null;
  }, [blocks, pending.length, earlier.loading, settle]);
  // Content also grows without new entries (images loading, details opening):
  // a view pinned to the latest stays there, an anchored one stays put.
  useEffect(() => {
    const el = scroller.current;
    const content = body.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => settle(el));
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settle]);
  const loadEarlier = () => {
    const el = scroller.current;
    if (!earlier.more || earlier.loading) return;
    if (el) {
      // The first row the reader can see.
      const top = el.getBoundingClientRect().top;
      const node = [...(body.current?.children ?? [])].find(
        (c) => c.getBoundingClientRect().bottom > top + 1,
      );
      anchor.current = node ? { node, offset: offsetIn(el, node) } : null;
    }
    void onEarlier();
  };
  // The reader scrolling themselves takes over from the anchor.
  const takeOver = () => {
    intend();
    anchor.current = null;
  };
  return (
    <div
      className="timeline"
      ref={scroller}
      // While pinned, the browser's scroll anchoring would move the view when
      // content grows; the effects above keep the bottom instead. Unpinned,
      // anchoring keeps the reader's place.
      style={{ overflowAnchor: showJump ? "auto" : "none" }}
      onWheel={takeOver}
      onTouchMove={takeOver}
      onPointerDown={intend}
      onKeyDown={intend}
      onFocusCapture={intend}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 60)
          pinned.current = true;
        // Only the reader unpins: layout (a placeholder giving way to an image
        // that is still decoding) also moves scrollTop.
        else if (performance.now() - userScroll.current < 500)
          pinned.current = false;
        else if (pinned.current && !anchor.current)
          el.scrollTop = el.scrollHeight;
        setShowJump(!pinned.current);
        // Reaching the top reads the page before it.
        if (el.scrollTop < 40 && !pinned.current && !earlier.error)
          loadEarlier();
      }}
    >
      {earlier.more && !loading && (
        <div className="load-earlier-row">
          <button
            type="button"
            className="load-earlier"
            onClick={loadEarlier}
            // Not \`disabled\`: that would take keyboard focus away mid-load.
            aria-disabled={earlier.loading}
            aria-busy={earlier.loading}
            aria-description={
              earlier.error && !earlier.loading
                ? "Try loading earlier messages again"
                : undefined
            }
            aria-label={
              earlier.loading
                ? "Loading earlier messages"
                : earlier.error
                  ? "Retry loading earlier messages"
                  : "Load earlier messages"
            }
          >
            {earlier.loading ? (
              <LoaderCircle size={13} className="spinning" />
            ) : (
              <ArrowUp size={13} />
            )}
            {earlier.loading
              ? "Loading earlier…"
              : earlier.error
                ? "Retry earlier messages"
                : "Load earlier messages"}
          </button>
          {earlier.error && (
            <p className="load-earlier-error" role="alert">
              {earlier.error}
            </p>
          )}
        </div>
      )}
      <div className="timeline-body" ref={body}>
        {error && <p className="error-inline">{error}</p>}
        {unavailable && <p className="timeline-note">{unavailable}</p>}
        {loading ? (
          <p className="loading">
            <LoaderCircle size={14} />
            Reading timeline…
          </p>
        ) : (
          !blocks.length &&
          !unavailable &&
          !pending.length && (
            <p className="timeline-note">No activity reported yet.</p>
          )
        )}
        {blocks.map((block, i) => (
          <TimelineBlock
            key={block.key}
            block={block}
            imageHost={imageHost}
            live={running && i === blocks.length - 1}
          />
        ))}
        {pending.map((p) => (
          <div className="msg user pending" key={p.at}>
            {p.images.length > 0 && (
              <div className="msg-images">
                {p.images.map((src, i) => (
                  <button
                    key={i}
                    data-tip="Open the attached image in a new tab"
                    onClick={() => window.open(src, "_blank")}
                  >
                    <img src={src} alt="Attached" />
                  </button>
                ))}
              </div>
            )}
            <UserText text={p.text} />
            <small>Sending…</small>
          </div>
        ))}
        {running && (
          <div className="working-row">
            <span className="activity-bars">
              <i />
              <i />
              <i />
            </span>
            Working…
          </div>
        )}
      </div>
      {showJump && (
        <button
          aria-description="Jump to the latest message"
          className="jump-latest"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={13} />
          Latest
        </button>
      )}
    </div>
  );
});

function SentExtras({ sent }: { sent: SentAttachments }) {
  return (
    <>
      {sent.images.length > 0 && (
        <div className="msg-images">
          {sent.images.map((src, i) => (
            <button
              key={i}
              data-tip="Open the attached image in a new tab"
              onClick={() => window.open(src, "_blank")}
            >
              <img src={src} alt="Attached" />
            </button>
          ))}
        </div>
      )}
      {(sent.files.length > 0 || sent.github.length > 0) && (
        <div className="msg-attachments">
          {sent.files.map((f, i) => (
            <span key={`f${i}`} className="chip">
              <FileText size={12} />
              <span>{f.name}</span>
            </span>
          ))}
          {sent.github.map((g) => (
            <a
              key={g.url}
              className="chip"
              href={g.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <GitBranch size={12} />
              <span>
                #{g.number} {g.title}
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function UserText({
  text,
  imageHost,
  messageId,
}: {
  text: string;
  imageHost?: string;
  messageId?: string;
}) {
  const [open, setOpen] = useState(false);
  const sent = useMemo(() => loadSent(messageId), [messageId]);
  // Images the daemon stored for this prompt appear as Markdown links to local files.
  const { images, text: rest } = useMemo(() => extractImages(text), [text]);
  const clean = rest.replace(/\n{3,}/g, "\n\n").trim();
  const long = clean.length > 700 || clean.split("\n").length > 12;
  return (
    <>
      {sent && <SentExtras sent={sent} />}
      {images.length > 0 && (
        <div className="msg-images">
          {images.map((image, i) => (
            <MarkdownImage
              key={i}
              src={image.src}
              alt={image.alt}
              host={imageHost}
            />
          ))}
        </div>
      )}
      {clean && (
        <div className={`user-text ${long && !open ? "clamped" : ""}`}>
          {clean}
        </div>
      )}
      {long && (
        <button
          aria-description={
            open ? "Show less of this message" : "Show all of this message"
          }
          className="link-btn"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

const TimelineBlock = memo(function TimelineBlock({
  block,
  live,
  imageHost,
}: {
  block: Block;
  live: boolean;
  imageHost?: string;
}) {
  if (block.kind === "user")
    return (
      <div className="msg user">
        {block.from && <small className="msg-from">From {block.from}</small>}
        <UserText
          text={block.text}
          imageHost={imageHost}
          messageId={block.messageId}
        />
      </div>
    );
  if (block.kind === "todo")
    return (
      <div className="todo-card">
        <b>Tasks</b>
        <ul>
          {block.items.map((t, i) => (
            <li key={i} className={t.done ? "done" : ""}>
              {t.done ? <Check size={13} /> : <span>○</span>}
              {t.text}
            </li>
          ))}
        </ul>
      </div>
    );
  if (block.kind === "assistant")
    return (
      <div className="msg assistant">
        <Markdown text={block.text} imageHost={imageHost} streaming={live} />
      </div>
    );
  if (block.kind === "event") {
    const { head, body } = eventBody(block.text);
    return (
      <details className="msg event">
        <summary
          aria-description={`Show or hide this ${block.label.toLowerCase()} in full`}
        >
          <span className="event-label">{block.label}</span>
          {head}
        </summary>
        {body && <Markdown text={body} imageHost={imageHost} />}
      </details>
    );
  }
  return block.kind === "activity" ? (
    <Activity steps={block.steps} live={live} />
  ) : null;
});

function stepIcon(entry: Entry) {
  if (entry.kind === "thought") return <Brain size={12} />;
  if (entry.kind !== "tool") return <Wrench size={12} />;
  if (entry.tool === "Shell" || entry.tool === "Bash")
    return <Terminal size={12} />;
  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit)$/.test(entry.tool))
    return <FileText size={12} />;
  if (entry.tool.startsWith("mcp__")) return <Plug size={12} />;
  return <Wrench size={12} />;
}

function Activity({ steps, live }: { steps: Entry[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const visible = open ? steps : steps.slice(live ? -4 : -2);
  const hidden = steps.length - visible.length;
  const counts = new Map<string, number>();
  for (const s of steps) {
    const name =
      s.kind === "tool" ? toolSummary(s.tool, s.text).name : "Thought";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return (
    <div className={`activity ${live ? "live" : ""}`}>
      {hidden > 0 && (
        <button
          aria-description={`Show the ${hidden} earlier ${hidden === 1 ? "step" : "steps"}`}
          className="activity-summary"
          onClick={() => setOpen(true)}
        >
          <ChevronRight size={12} />
          {hidden} earlier {hidden === 1 ? "step" : "steps"}
          <span>
            {[...counts]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([n, c]) => `${n} ×${c}`)
              .join(" · ")}
          </span>
        </button>
      )}
      {open && steps.length > 2 && (
        <button
          aria-description="Collapse these steps"
          className="activity-summary"
          onClick={() => setOpen(false)}
        >
          <ChevronRight size={12} style={{ transform: "rotate(90deg)" }} />
          Collapse {steps.length} steps
        </button>
      )}
      {visible.map((step, i) => (
        // Absolute index: an expanded step stays expanded as new steps arrive.
        <Step key={hidden + i} step={step} />
      ))}
    </div>
  );
}

function Step({ step }: { step: Entry }) {
  const [open, setOpen] = useState(false);
  if (step.kind === "thought")
    return (
      <button
        aria-description={
          open ? "Collapse this thought" : "Show this thought in full"
        }
        className={`step thought ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {stepIcon(step)}
        <span>{step.text}</span>
      </button>
    );
  if (step.kind !== "tool") return null;
  const { name, source } = toolSummary(step.tool, step.text);
  return (
    <>
      <button
        className={`step tool ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        // A short, stable hint (the row and its detail hold the full text).
        aria-description={
          step.detail
            ? `${open ? "Hide" : "Show"} what ${name} was given and returned`
            : `${name}${step.status && step.status !== "completed" ? ` · ${step.status}` : ""}${step.text ? `: ${step.text}` : ""}`
        }
      >
        {stepIcon(step)}
        <b>{name}</b>
        {source && <small>{source}</small>}
        <code>{step.text}</code>
        {step.status && step.status !== "completed" && (
          <span className={`tool-status ${step.status}`}>{step.status}</span>
        )}
      </button>
      {open && step.detail && <pre className="step-detail">{step.detail}</pre>}
    </>
  );
}

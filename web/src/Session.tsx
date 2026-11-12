import { PublishedPage } from "./visual/PublishedPage";
import type { WorkSummary } from "./useWorkingOn";
import { soundEvent } from "./soundCues";
import { daemonAgentId } from "./agentIdentity";
import { onOwnedAppCommand } from "./appCommands";
import { macApp, postAppMenu, postAppReveal } from "./worldBridge";
import { openChatLink } from "./chatLinks";
import { openFilesFile } from "./files/open";
import { usePeers } from "./peers";
import { robotColour, useRobotPortrait } from "./robotPortrait";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
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
  GitFork,
  ImagePlus,
  LoaderCircle,
  Plug,
  Plus,
  Server,
  Terminal,
  Wrench,
} from "lucide-react";
import { Composer } from "./Composer";
import { PendingComments } from "./composer/PendingComments";
import {
  useAgentSession,
  type AgentSession,
  type Earlier,
  type Pending,
} from "./useAgentSession";
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
import { urlRuns } from "./urlRuns";
import { autolinkRuns, canAutolink, fileTitle, type AutolinkContext, type AutolinkRun } from "./autolink";
import { Autolinks, useAutolinkContext, useAutolinks } from "./autolinkStore";
import { enqueue, newMessageId, onQueueSent, toOutgoing } from "./queue";
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
import type { DraftSettings } from "./Dispatch";
import { SPLIT_MIN } from "./panelGeometry";
import { ForkPill } from "./forks/ForkPill";
import { ForkPane, ForkPieces } from "./forks/ForkPane";
import { useReplyForks } from "./forks/useReplyForks";
import type { ForkRow } from "./forks/api";
import type { Asks } from "./asks/types";

type Confirm = "archive" | "fresh" | null;

/** A chat file link: a workspace file opens in Files at its line; another local
 * path reveals in Finder. Remote paths and plain browsers explain the limitation. */
export function openFileLink(e: React.MouseEvent, workspace: Workspace | undefined, onNotice: (message: string) => void): boolean {
  const link = (e.target as Element).closest?.("a[data-file-path]");
  if (!(link instanceof HTMLAnchorElement)) return false;
  e.preventDefault();
  if (e.button !== 0) return true;
  const path = link.dataset.filePath;
  if (!path) return true;
  if (link.dataset.fileReveal) {
    if (workspace?.host || link.dataset.fileHost) onNotice("This path is on the agent’s remote host; Finder can only show local files.");
    else if (!macApp()) onNotice("Showing files in Finder is available in the macOS app.");
    else postAppReveal(path);
    return true;
  }
  if (!macApp()) {
    onNotice("The Files tab, where files open, is in the macOS app.");
    return true;
  }
  if (!workspace) return true;
  const line = Number(link.dataset.fileLine) || undefined;
  const endLine = Number(link.dataset.fileEnd) || undefined;
  openFilesFile({
    workspace: workspace.workspaceId,
    ...(workspace.host ? { host: workspace.host } : {}),
    path,
    ...(line ? { line } : {}),
    ...(endLine ? { endLine } : {}),
  });
  postAppMenu("files");
  return true;
}

/** In the macOS app, web links clicked in the chat open as a Conquer tab, in the
 * map's place, rather than in the default browser; on the Dungeon Board, in the robot's
 * browser while it shows (`chatLinks.ts`). */
export function openInAppBrowser(e: React.MouseEvent) {
  if (!macApp() || e.button !== 0 || e.altKey) return;
  const link = (e.target as Element).closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement) || !/^https?:$/.test(link.protocol)) return;
  if (link.origin === window.location.origin) return;
  e.preventDefault();
  openChatLink(link.href, link);
}

export type SessionProps = {
  workingOn?: WorkSummary;
  /** What its last reply asks of you, once judged. */
  asks?: Asks;
  agent: Agent;
  workspace?: Workspace;
  waiting: boolean;
  online: boolean;
  /** Back to the fleet; absent where no list lies behind the conversation (the Dungeon Board's overlay). */
  onBack?: () => void;
  onSelectWorkspace: (id: string) => void;
  onNotice: (message: string) => void;
  onChanged: () => Promise<void> | void;
  /** Open a new draft in this agent's workspace (after archiving it). */
  onFreshDraft: (agent: Agent, settings?: DraftSettings) => void;
  /** Dispatch another agent into this agent's workspace (D). */
  onNewAgent: () => void;
  /** Open one of its subagents' conversations. */
  onOpenSubagent: (subagentId: string) => void;
  /** Its place among the listed agents; absent where the surface steps through them itself. */
  position?: {
    index: number;
    total: number;
    prev: () => void;
    next: () => void;
  };
};

/** What differs where the conversation shows somewhere other than the side panel (the Dungeon Board's
 * overlay, `worldChat/WorldChat.tsx`): the same component and features, in that surface's styling. */
export type SessionSurface = {
  className?: string;
  /** The composer's input, draft, label and hint (`Composer`'s own props). */
  inputId?: string;
  draftScope?: string;
  label?: string;
  placeholder?: string;
  /** A message went to the agent: sent, or queued while it works. */
  onSent?: () => void;
  /** Asks before archiving in the surface's own way, in place of the header's confirmation. */
  onConfirm?: (kind: "archive" | "fresh") => void;
  /** Filled with what Escape closes inside the conversation (an open fork), answering whether it closed one. */
  escape?: MutableRefObject<(() => boolean) | null>;
};

/** An agent's conversation in the side panel. */
export function Session(props: SessionProps) {
  const session = useAgentSession(props.agent, {
    onNotice: props.onNotice,
    onChanged: props.onChanged,
  });
  return <SessionView {...props} session={session} />;
}

/** The conversation itself, over a session its surface already follows (the board's dialogue box reads the
 * same one): header, timeline, reply forks, requests and the composer with everything above it. */
export function SessionView({
  workingOn,
  asks,
  agent,
  workspace,
  waiting,
  online,
  onBack,
  onSelectWorkspace,
  onNotice,
  onFreshDraft,
  onNewAgent,
  onOpenSubagent,
  position,
  session,
  surface,
}: SessionProps & { session: AgentSession; surface?: SessionSurface }) {
  const [drop, setDrop] = useState<{ files: File[]; at: number } | null>(null);
  const [answerQuote, setAnswerQuote] = useState<{ text: string; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const {
    detail,
    source,
    entries,
    unavailable,
    earlier,
    loadOlder,
    error,
    pending,
    busy,
    commands,
    running,
    archived,
    command,
    send,
    respond,
    promptHistory,
  } = session;
  // Any command that succeeds settles an open confirmation.
  useEffect(() => {
    setConfirm(null);
  }, [commands]);
  /** Ask before archiving: in the header, or as the surface asks. */
  const askConfirm = (kind: "archive" | "fresh") =>
    surface?.onConfirm ? surface.onConfirm(kind) : setConfirm(kind);
  const status = detail?.PendingPermissions.length
    ? "awaiting approval"
    : waiting
      ? "awaiting approval"
      : detail?.Archived
        ? "archived"
        : shownStatus(agent) || detail?.Status || "";

  useEffect(() => {
    setConfirm(null);
  }, [agent.id]);
  // The command palette's Interrupt, Open in Paseo and Archive for this agent.
  // Shown twice (the panel and the board's overlay), the copy mounted last answers.
  const palette = useRef({ command, running, archived, busy, online, askConfirm });
  palette.current = { command, running, archived, busy, online, askConfirm };
  useEffect(() => {
    const offs = [
      onOwnedAppCommand("agent-interrupt", () => {
        const { command, running } = palette.current;
        if (running) void command("cancel", {}, "Agent interrupted");
      }),
      onOwnedAppCommand("agent-open-paseo", () => {
        const { command, busy } = palette.current;
        if (!busy) void command("open", {}, "Opened in Paseo");
      }),
      onOwnedAppCommand("agent-archive", () => {
        const { running, archived, busy, online, askConfirm } = palette.current;
        if (running) onNotice("Stop the agent before archiving it.");
        else if (!archived && !busy && online) askConfirm("archive");
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [onNotice]);

  // Reply forks: their pane sits beside the conversation when there's room.
  const root = useRef<HTMLDivElement>(null);
  // Linear keys, PR numbers and the workspace's file paths in the conversation link themselves.
  const autolinks = useAutolinks(workspace);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= SPLIT_MIN);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const forks = useReplyForks(agent, { root, onNotice, repaint: entries });
  const { open: openFork } = forks;
  // Escape, where the surface owns it: an open fork goes back to the conversation first.
  const escape = surface?.escape;
  const openForks = useRef(forks);
  openForks.current = forks;
  useEffect(() => {
    if (!escape) return;
    escape.current = () => {
      if (!openForks.current.shown) return false;
      openForks.current.back();
      return true;
    };
    return () => {
      escape.current = null;
    };
  }, [escape]);
  const forkMarkers = useCallback(
    (block: Block) => {
      const here = forks.forks.filter((f) => forkUnder(f, block));
      return here.length ? (
        <div className="fork-markers">
          {here.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`fork-marker${f.closedAt ? " closed" : ""}`}
              style={{ "--fork": `var(--fork-${f.colour})` } as CSSProperties}
              aria-label={`Fork: ${f.question.slice(0, 40)}${f.waiting ? " · waiting" : ""}`}
              onClick={() => void openFork(f.id)}
            >
              {f.question.slice(0, 40)}
              {f.waiting && <span className="waiting">waiting</span>}
            </button>
          ))}
        </div>
      ) : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forks.forks],
  );
  const forkLayout = wide ? "side" : "over";

  /** "clear" is "fresh" keeping the agent's settings, without asking. */
  const archiveNow = async (next: Confirm | "clear") => {
    // Read before archiving: the detail may change once it is archived.
    const settings: DraftSettings = {
      provider: detail?.Provider || agent.provider,
      model: detail?.Model || undefined,
      thinking: detail?.Thinking ?? agent.thinking,
      mode: detail?.Mode || undefined,
    };
    const ok = await command(
      "archive",
      { confirm: true },
      `Archived “${agentName(agent, workspace?.branch)}”`,
    );
    if (ok && next === "fresh") onFreshDraft(agent);
    if (ok && next === "clear") onFreshDraft(agent, settings);
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
      ref={root}
      className={`session${surface?.className ? ` ${surface.className}` : ""}${forks.shown ? ` fork-${forkLayout}` : ""}`}
      onClickCapture={(e) => {
        if (!openFileLink(e, workspace, onNotice)) openInAppBrowser(e);
      }}
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
          {onBack && (
            <button
              className="ghost-btn"
              onClick={onBack}
              aria-description="Back to fleet (Esc)"
            >
              <ArrowLeft size={15} />
              Fleet
            </button>
          )}
          <span className="session-position">
            {position && position.index >= 0 && (
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
                onClick={() => askConfirm("archive")}
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
                  onClick={() => void archiveNow(confirm)}
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
        onEarlier={loadOlder}
        replyExtra={forkMarkers}
        links={autolinks}
      />
      <ForkPill
        root={root}
        supported={forks.supported}
        onAsk={forks.askAbout}
        onAdd={forks.add}
        onAnswer={(q) => setAnswerQuote({ text: q.text, at: Date.now() })}
      />
      {forks.shown && (
        <ForkPane
          layout={forkLayout}
          agentId={agent.id}
          host={agent.host}
          forks={forks.forks}
          shown={forks.shown}
          collected={forks.collected}
          draftColour={forks.draftColour}
          busy={forks.busy}
          onShow={forks.show}
          onBack={forks.back}
          onAsk={forks.ask}
          onRemove={forks.removeCollected}
          onClose={(id) => void forks.close(id)}
          onSendBack={(id) => void forks.sendBack(id, { running })}
          onNotice={onNotice}
        />
      )}
      <footer className="session-footer">
        {detail?.PendingPermissions.map((p, i) => (
          <PermissionCard
            imageHost={agent.host}
            key={p.id || i}
            permission={p}
            busy={!!busy}
            paletteToggle={i === 0}
            onRespond={(decision) => void respond(p, decision)}
          />
        ))}
        <Composer
          activity={
            <>
              {forks.collected.length > 0 && forks.shown !== "draft" && (
                <ForkPieces
                  quotes={forks.collected}
                  label="Collected pieces"
                  onRemove={forks.removeCollected}
                  action={
                    <button
                      type="button"
                      className="ghost-btn fork-ask"
                      onClick={() => forks.show("draft")}
                    >
                      <GitFork size={14} aria-hidden="true" />
                      Ask about these
                    </button>
                  }
                />
              )}
              {agent.workspaceId && (
                <PendingComments
                  host={agent.host}
                  workspace={agent.workspaceId}
                  agentId={agent.id}
                  disabled={!online || archived}
                  onSend={async (text) => {
                    if (!running) return send(toOutgoing(text, []));
                    try {
                      await enqueue(agent.id, text, []);
                      return true;
                    } catch (e) {
                      onNotice(errorMessage(e) || "Couldn't queue the comments.");
                      return false;
                    }
                  }}
                  onNotice={onNotice}
                />
              )}
              {running && online && !waiting && !archived && agent.workspaceId && (
                <p
                  className="session-working-on"
                  title={workingOn?.error || "AI-generated from recent activity"}
                >
                  {workingOn?.sentence ||
                    (workingOn?.error
                      ? "Current work summary unavailable."
                      : "Summarizing current work…")}
                </p>
              )}
            </>
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
          onSend={async (message) => {
            const ok = await send(message);
            if (ok) surface?.onSent?.();
            return ok;
          }}
          onQueued={surface?.onSent}
          onCancel={async () => {
            await command("cancel", {}, "Agent interrupted");
          }}
          onNotice={onNotice}
          onArchive={() =>
            running
              ? onNotice("Stop the agent before archiving it.")
              : askConfirm("archive")
          }
          onFreshDraft={(keepSettings) =>
            running
              ? onNotice("Stop the agent before archiving it.")
              : keepSettings
                ? void archiveNow("clear")
                : askConfirm("fresh")
          }
          promptHistory={promptHistory}
          dropFiles={drop}
          answerQuote={answerQuote}
          replyAsks={running || waiting ? undefined : asks}
          inputId={surface?.inputId}
          draftScope={surface?.draftScope}
          label={surface?.label}
          placeholder={surface?.placeholder}
        />
      </footer>
    </div>
  );
}

export type { Earlier };
/** Whether a fork's marker stands under this reply: the reply it was cut
 *  after (else its last quoted one). */
const forkUnder = (f: ForkRow, block: Block) =>
  block.kind === "assistant" &&
  (f.boundary.messageId
    ? block.messageId === f.boundary.messageId
    : f.quotes[f.quotes.length - 1]?.replyKey === block.key);
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
  replyExtra,
  links,
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
  /** Shown under a reply (its forks' markers). */
  replyExtra?: (block: Block) => ReactNode;
  /** What its Linear keys and PR numbers link to (src/autolink.ts). */
  links?: AutolinkContext;
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
<Autolinks.Provider value={links}>
          {blocks.map((block, i) => (
            <TimelineBlock
              key={block.key}
              block={block}
              imageHost={imageHost}
              live={running && i === blocks.length - 1}
              extra={replyExtra?.(block)}
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
        </Autolinks.Provider>
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
  const links = useAutolinkContext();
  const runs = useMemo(
    () =>
      urlRuns(clean).flatMap((run): AutolinkRun[] =>
        run.href || !canAutolink(links) ? [run] : autolinkRuns(run.text, links),
      ),
    [clean, links],
  );
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
          {runs.map((run, i) =>
            run.file ? (
              <a
                key={i}
                href={run.href}
                className="file-link"
                title={fileTitle(run.file)}
                data-file-path={run.file.path}
                {...(run.file.reveal ? { "data-file-reveal": "true" } : {})}
                {...(imageHost ? { "data-file-host": imageHost } : {})}
                {...(run.file.line ? { "data-file-line": String(run.file.line) } : {})}
                {...(run.file.endLine ? { "data-file-end": String(run.file.endLine) } : {})}
              >
                {run.text}
              </a>
            ) : run.href ? (
              <a
                key={i}
                href={run.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {run.text}
              </a>
            ) : (
              run.text
            ),
          )}
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
  extra,
}: {
  block: Block;
  live: boolean;
  imageHost?: string;
  extra?: ReactNode;
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
      <>
        <div
          className="msg assistant"
          data-reply-key={block.key}
          data-message-id={block.messageId}
          data-seq={block.seq}
          data-live={live ? "true" : undefined}
        >
          <Markdown text={block.text} imageHost={imageHost} streaming={live} />
        </div>
        {extra}
      </>
    );
  if (block.kind === "agent")
    return <AgentReportCard block={block} imageHost={imageHost} />;
  if (block.kind === "visual")
    return (
      <div className="msg visual-reply">
        <div className="md">
          <PublishedPage page={block.page} title={block.title} host={imageHost} />
        </div>
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

/** Another agent's report: its Atlas robot, and what it said in a quote. */
function AgentReportCard({
  block,
  imageHost,
}: {
  block: Extract<Block, { kind: "agent" }>;
  imageHost?: string;
}) {
  const peers = usePeers();
  const peer = peers?.find(block.agentId);
  const robot = useRobotPortrait(peer?.provider);
  const name = peer?.title || block.title || peer?.name || block.agentId.slice(0, 8);
  return (
    <figure
      className="agent-report"
      style={peer ? ({ "--robot": robotColour(peer.provider) } as CSSProperties) : undefined}
    >
      <span className="agent-report-robot" aria-hidden="true">
        {robot && <img src={robot} alt="" />}
      </span>
      <div className="agent-report-card">
        <figcaption>
          {peer && peers ? (
            <button
              type="button"
              className="agent-report-name"
              aria-description="Open this agent's conversation"
              onClick={() => peers.open(peer)}
            >
              {name}
            </button>
          ) : (
            <b className="agent-report-name">{name}</b>
          )}
          <span>{block.verb}</span>
        </figcaption>
        <blockquote>
          <Markdown text={block.text} imageHost={imageHost} />
        </blockquote>
      </div>
    </figure>
  );
}

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

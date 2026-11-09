import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AtlasData } from "../../../rendering/src/world";
import {
  useWorkQueues,
  queueText,
  githubQueueUrl,
  type WorkQueue,
} from "./queues";
import { writeItems } from "../activity/store";
import type { WorldSnapshot } from "../worldBridge";
import type { WorkSummaries } from "../useWorkingOn";
import { openAppLink } from "../appLinks";
import { openSettings } from "../settingsStore";
import { onAppCommand } from "../appCommands";
import { ROBOTS_URL, ROBOTS_SHEET, robotFrames } from "../worldChat/art";
import { loadHudArt, type HudArt } from "./art";
import {
  DUNGEON_TRAYS,
  BELT_SLOTS,
  hudAgents,
  type DungeonTray,
  type AgentTray,
} from "./model";
import "./hud.css";
import { X } from "lucide-react";
import { AgentPreview } from "./AgentPreview";
import type { Agent } from "../types";

type Props = {
  data: AtlasData;
  dashboard: AtlasData["dashboard"];
  agents: Agent[];
  snapshot: WorldSnapshot;
  summaries?: WorkSummaries;
  blocked: boolean;
  talking: boolean;
  onPick: (key: string) => void;
  onNotice: (message: string) => void;
  onDispatch: () => void;
  onBrowse: () => void;
  onHeight: (height: number) => void;
  onTray: (tray: DungeonTray | null) => void;
};
function Portrait({ model }: { model: string }) {
  const f = robotFrames(model, false)[0]!;
  const k = 36 / f.h;
  return (
    <span
      className="dh-portrait"
      aria-hidden="true"
      style={{
        width: f.w * k,
        height: 36,
        backgroundImage: `url(${ROBOTS_URL})`,
        backgroundSize: `${ROBOTS_SHEET.width * k}px ${ROBOTS_SHEET.height * k}px`,
        backgroundPosition: `${-f.x * k}px ${-f.y * k}px`,
      }}
    />
  );
}
export function DungeonHud(props: Props) {
  const [art, setArt] = useState<Partial<Record<HudArt, string>>>({});
  const [artError, setArtError] = useState("");
  const [tray, setTray] = useState<DungeonTray | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const activeTray = useRef(tray);
  activeTray.current = tray;
  const latest = useRef(props);
  latest.current = props;
  const close = (focus = true) => {
    setTray(null);
    if (focus) requestAnimationFrame(() => trigger.current?.focus());
  };
  const toggle = (id: DungeonTray, button?: HTMLButtonElement) => {
    if (latest.current.blocked) return;
    if (button) trigger.current = button;
    latest.current.onBrowse();
    setTray((old) => (old === id ? null : id));
  };
  useEffect(() => {
    let live = true;
    loadHudArt().then(
      (a) => live && setArt(a),
      (e: Error) => live && setArtError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const resized = () =>
      latest.current.onHeight(Math.ceil(node.getBoundingClientRect().height));
    resized();
    const observer = new ResizeObserver(resized);
    observer.observe(node);
    return () => {
      observer.disconnect();
      latest.current.onHeight(0);
    };
  }, []);
  useEffect(() => {
    props.onTray(tray);
    return () => props.onTray(null);
  }, [tray, props.onTray]);
  useEffect(() => {
    if (props.talking || props.blocked) close(false);
  }, [props.talking, props.blocked]);
  useEffect(
    () =>
      onAppCommand("dungeon-tray", (id) => {
        if (DUNGEON_TRAYS.some((t) => t.id === id)) toggle(id as DungeonTray);
      }),
    [],
  );
  useEffect(() => onAppCommand("dungeon-tray-close", () => close()), []);
  useEffect(
    () =>
      onAppCommand("dungeon-tray-settings", () => {
        const id = activeTray.current;
        if (
          !["review", "assigned", "issues", "inbox", "problems"].includes(
            id ?? "",
          )
        )
          return;
        close(false);
        openSettings(
          id === "review" || id === "assigned" ? "github" : "linear",
        );
      }),
    [],
  );
  useEffect(() => {
    if (!tray) return;
    requestAnimationFrame(() =>
      panel.current
        ?.querySelector<HTMLButtonElement>(".dh-entry, .dh-close")
        ?.focus(),
    );
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        latest.current.blocked ||
        [
          ...document.querySelectorAll<HTMLElement>(
            '[aria-modal="true"], .popover-menu, .autocomplete, .lightbox',
          ),
        ].some(
          (node) =>
            !node.closest('[inert], [aria-hidden="true"]') &&
            node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility !== "hidden",
        )
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [tray]);
  const queues = useWorkQueues(props.dashboard);
  const failed = hudAgents(props.data, "failures");
  const count = (id: DungeonTray): string => {
    if (id === "problems") {
      if (queues.blocked.known)
        return `${failed.length + queues.blocked.total}${queues.blocked.lowerBound ? "+" : ""}`;
      return queues.linearEnabled
        ? failed.length
          ? `${failed.length}+`
          : "—"
        : String(failed.length);
    }
    if (
      id === "review" ||
      id === "assigned" ||
      id === "issues" ||
      id === "inbox"
    )
      return queueText(queues[id]);
    return String(hudAgents(props.data, id).length);
  };
  const style = Object.fromEntries(
    Object.entries(art).map(([key, value]) => [`--dh-${key}`, `url(${value})`]),
  ) as CSSProperties;
  const activate = (key: string) => {
    close(false);
    props.onPick(key);
  };
  const selected = DUNGEON_TRAYS.find((t) => t.id === tray);
  const agentEntries = (kind: AgentTray) => {
    const agents = hudAgents(props.data, kind);
    return agents.length ? (
      agents.map((a) => {
        const row = props.snapshot.agents.find((s) => s.key === a.key);
        const workspace = props.snapshot.workspaces.find(
          (w) => w.key === a.workspace,
        );
        const project = props.snapshot.projects.find(
          (p) => p.key === a.project,
        );
        const host = props.snapshot.hosts.find((h) => h.id === a.host);
        const source = props.agents.find(
          (s) => s.id === (row?.clientId ?? row?.id),
        );
        return (
          <button
            type="button"
            key={a.key}
            className="dh-entry"
            onClick={() => activate(a.key)}
          >
            <Portrait model={a.model} />
            <span className="dh-entry-text">
              <strong>{a.name}</strong>
              <span className="dh-context">
                {[project?.name, workspace?.name, host?.name]
                  .filter(Boolean)
                  .join(" · ") || "Agent"}
              </span>
              <AgentPreview
                id={row?.clientId ?? row?.id ?? a.key}
                host={row?.hostId === "local" ? undefined : row?.hostId}
                version={
                  source?.attentionTimestamp ??
                  source?.updatedAt ??
                  source?.lastUserMessageAt ??
                  ""
                }
                tray={kind}
                fallback={
                  kind === "replies"
                    ? "New reply · open conversation"
                    : kind === "failures"
                      ? "Open the conversation to inspect the error"
                      : kind === "waiting"
                        ? "Waiting for your approval or answer"
                        : props.summaries?.[source?.id ?? ""]?.sentence ||
                          "Working · open conversation"
                }
              />
            </span>
            <span className="dh-entry-arrow" aria-hidden="true">
              →
            </span>
          </button>
        );
      })
    ) : (
      <p className="dh-empty">
        No {kind === "failures" ? "failed agents" : "agents here"}.
      </p>
    );
  };
  const externalEntries = (q: WorkQueue, icon: string) => (
    <>
      {!q.known ? (
        <div className="dh-empty" role="status">
          <p>{q.why}</p>
          <button
            type="button"
            className="dh-settings"
            onClick={() => {
              close(false);
              openSettings(q.integration);
            }}
          >
            Integration settings
          </button>
        </div>
      ) : q.items.length ? (
        q.items.map((item) => (
          <button
            type="button"
            className="dh-entry"
            key={item.key}
            disabled={!item.url}
            onClick={() => {
              if (item.activity?.unread)
                void writeItems("read", [item.activity.key]).then((ok) => {
                  if (!ok)
                    props.onNotice(
                      "Couldn’t mark this notification read; it remains in your Inbox.",
                    );
                });
              close(false);
              if (item.url) openAppLink(item.url);
            }}
          >
            <span
              className={`dh-item-icon dh-icon-${icon}`}
              aria-hidden="true"
            />
            <span className="dh-entry-text">
              <strong>{item.title}</strong>
              <span className="dh-context">{item.detail}</span>
              {item.status && <span className="dh-preview">{item.status}</span>}
            </span>
            <span className="dh-entry-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ))
      ) : (
        <p className="dh-empty">
          {q.lowerBound
            ? "No matching items in the loaded page."
            : q.total
              ? "Item details aren’t available right now."
              : "Nothing here right now."}
        </p>
      )}
      {q.known && (q.total > q.items.length || q.lowerBound) && (
        <p className="dh-more">
          Showing {q.items.length} of {queueText(q)}
          {q.lowerBound ? " · more source pages may contain work" : ""}
        </p>
      )}
    </>
  );
  const agentButton = (id: "waiting" | "running") => (
    <button
      type="button"
      className={`dh-orb dh-${id}${tray === id ? " selected" : ""}`}
      aria-label={`${DUNGEON_TRAYS.find((t) => t.id === id)!.title}: ${count(id)}`}
      aria-expanded={tray === id}
      aria-controls={tray === id ? "dungeon-tray" : undefined}
      disabled={props.blocked}
      onClick={(e) => toggle(id, e.currentTarget)}
    >
      <span className="dh-orb-number" aria-hidden="true">
        {count(id)}
      </span>
      <span className="dh-orb-label" aria-hidden="true">
        {id}
      </span>
    </button>
  );
  return (
    <div
      ref={root}
      className="dungeon-hud"
      style={style}
      aria-label="Dungeon command belt"
    >
      {selected && (
        <section
          className={`dh-tray dh-tray-${tray}`}
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="dh-tray-title"
          id="dungeon-tray"
        >
          <header>
            <h2 id="dh-tray-title">
              {selected.title} <span>{count(selected.id)}</span>
            </h2>
            <button
              type="button"
              className="dh-close"
              aria-label="Close the command belt tray"
              onClick={() => close()}
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </header>
          <div className="dh-entries">
            {tray === "problems" ? (
              <>
                <h3 className="dh-section-title">
                  Failed agents <span>{failed.length}</span>
                </h3>
                {agentEntries("failures")}
                <h3 className="dh-section-title">
                  Blocked issues <span>{queueText(queues.blocked)}</span>
                </h3>
                {externalEntries(queues.blocked, "issues")}
              </>
            ) : tray === "review" ||
              tray === "assigned" ||
              tray === "issues" ||
              tray === "inbox" ? (
              externalEntries(queues[tray], tray)
            ) : tray ? (
              agentEntries(tray as AgentTray)
            ) : null}
          </div>
          <footer>
            <span>
              {tray === "review" || tray === "assigned" ? (
                <button
                  type="button"
                  className="dh-source-link"
                  onClick={() => openAppLink(githubQueueUrl(tray))}
                >
                  All on GitHub ↗
                </button>
              ) : tray === "inbox" ? (
                "Opening an item marks its notification read"
              ) : (
                "Choose an item to open it"
              )}
            </span>
            <span>Esc · Close</span>
          </footer>
        </section>
      )}
      <div className="dh-console" aria-hidden="true" />
      <div className="dh-controls">
        {agentButton("waiting")}
        <div className="dh-belt">
          <span
            className="dh-service-group dh-service-github"
            aria-hidden="true"
          >
            GitHub
          </span>
          <span
            className="dh-service-group dh-service-linear"
            aria-hidden="true"
          >
            Linear
          </span>
          {BELT_SLOTS.map((id) => (
            <button
              type="button"
              key={id}
              className={`dh-slot${tray === id ? " selected" : ""}`}
              aria-label={`${DUNGEON_TRAYS.find((t) => t.id === id)!.title}: ${count(id)}`}
              aria-expanded={tray === id}
              aria-controls={tray === id ? "dungeon-tray" : undefined}
              disabled={props.blocked}
              onClick={(e) => toggle(id, e.currentTarget)}
            >
              <span
                className={`dh-item-icon dh-icon-${id}`}
                aria-hidden="true"
              />
              <span className="dh-badge" aria-hidden="true">
                {count(id)}
              </span>
              <span className="dh-slot-label" aria-hidden="true">
                {DUNGEON_TRAYS.find((t) => t.id === id)!.label}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="dh-slot dh-dispatch"
            aria-label="New agent"
            disabled={props.blocked}
            onClick={() => {
              close(false);
              props.onDispatch();
            }}
          >
            <span
              className="dh-item-icon dh-icon-dispatch"
              aria-hidden="true"
            />
            <span className="dh-slot-label">Dispatch</span>
          </button>
        </div>
        {agentButton("running")}
      </div>
      {artError && (
        <span className="dh-art-error" role="status">
          {artError}
        </span>
      )}
    </div>
  );
}

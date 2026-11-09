import { MAP_STYLES, mapStyle, setMapStyle, useMapStyle } from "./mapStyle";
import type { WorkSummaries } from "./useWorkingOn";
/** Atlas world adapter. The inherited React work surface owns all daemon actions;
 * the world only draws the host-qualified snapshot and reports what was picked. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from "react";
import {
  mountAtlas,
  STATE_NAMES,
  type AtlasData,
  type AtlasWorld,
  type Entity,
  type ScreenPoint,
} from "../../rendering/src/atlas";
import {
  worldSnapshot,
  targetSelection,
  type WorldSnapshot,
} from "./worldBridge";
import { projectKey, workspaceKey } from "./workspaces";
import { isFitWorldKey, isTyping } from "./worldShortcut";
import { modalOpen } from "./focus";
import { onAppCommand } from "./appCommands";
import { soundEvent } from "./soundCues";
import { setUnityWorldTheme } from "./theme";
import type { Agent, Host, Project, Selection, Workspace } from "./types";
import { WorldLegend } from "./WorldLegend";
import { flagTip, workspacePrLines } from "./flagTip";
import type { MapFlag } from "../../rendering/src/prStatus";
import type { ProbeVerdict } from "../../rendering/src/probe";
import { useProbe } from "./useProbe";
import { useHostStats } from "./useHostStats";
import { useDashboardCounts } from "./dashboardCounts";
import { openAppLink } from "./appLinks";
import { liveConnection } from "./live";
import { CARD_MARGIN, placeCard } from "./cardPlace";
import type { HostStats } from "../../rendering/src/world";
import "./atlas-world.css";
import { useGameTooltipFrame } from "./worldChat/frame";
import "./worldChat/game-tooltip.css";
import { DungeonHud } from "./dungeon/DungeonHud";
import type { DungeonTray } from "./dungeon/model";
type Props = {
  workingOn?: WorkSummaries;
  hosts: Host[];
  projects: Project[];
  workspaces: Workspace[];
  agents: Agent[];
  permissions: Set<string>;
  /** Agents whose pending request is a question rather than an approval. */
  questions: Set<string>;
  /** Idle agents whose last reply waits on you. */
  asking: Set<string>;
  unread: Set<string>;
  selection: Selection;
  focusRevision: number;
  select: (value: Selection) => void;
  /** The host the app has focused ("" for local), drawn selected when nothing else is. */
  host: string | null;
  chooseHost: (id: string) => void;
  hover: (id: string | null) => void;
  onNotice: (message: string) => void;
  blocked: boolean;
  /** The fleet's first state has arrived (the macOS app's splash lifts once it is drawn). */
  loaded: boolean;
  /** The Dungeon Board's dialogue box speaks for the selected agent: the board frames its robot above the box. */
  talking?: boolean;
  /** How much of the map's foot the box covers (CSS px). */
  talkInset?: number;
  hudVisible?: boolean;
  onDispatch: () => void;
  onBrowseHud: () => void;
  onHudTray: (tray: DungeonTray | null) => void;
};
/** Hosts are keyed by their bridge id ("local" or a server id), as rows reference them. */
export function atlasData(
  snapshot: WorldSnapshot,
  questions: Set<string>,
  asking: Set<string> = new Set(),
  /** Probe's verdicts, keyed `<host>:<workspaceId>` (useProbe). */
  probe: Record<string, ProbeVerdict> = {},
  /** Each host machine's load, keyed by host id (useHostStats). */
  stats: Record<string, HostStats> = {},
): AtlasData {
  return {
    hosts: snapshot.hosts.map((h) => ({
      key: h.id,
      name: h.name,
      online: !/offline|stale/.test(h.state),
      local: h.local,
      ...(stats[h.id] ? { stats: stats[h.id] } : {}),
    })),
    projects: snapshot.projects.map((p) => ({
      key: p.key,
      host: p.hostId,
      name: p.name,
      stale: p.stale,
    })),
    workspaces: snapshot.workspaces.map((w) => ({
      key: w.key,
      host: w.hostId,
      project: w.projectKey,
      name: w.name,
      stale: w.stale,
      labels: w.labels,
      ...(w.autoMerge ? { autoMerge: true } : {}),
      ...(w.created ? { created: w.created } : {}),
      ...(probe[`${w.hostId}:${w.id}`] ? { probe: probe[`${w.hostId}:${w.id}`] } : {}),
    })),
    agents: snapshot.agents.map((a) => ({
      key: a.key,
      host: a.hostId,
      project: a.projectKey,
      workspace: a.workspaceKey,
      name: a.name,
      model: a.model,
      state: a.stale
        ? "offline"
        : a.state === "attention"
          ? questions.has(a.clientId ?? a.id)
            ? "question"
            : "approval"
          : (a.state === "unread" || a.state === "idle") &&
              asking.has(a.clientId ?? a.id)
            ? "asking"
            : a.state === "unread"
              ? "done"
              : a.state,
      subagents: a.subagentCount,
      subagentModels: a.subagentModels,
      created: a.created,
    })),
  };
}
/** The world key the app's selection points at, if it is drawn. */
function selectionKey(selection: Selection, snapshot: WorldSnapshot) {
  if (!selection) return null;
  if (selection.type === "agent")
    return (
      snapshot.agents.find(
        (a) =>
          (a.clientId ?? a.id) === selection.id &&
          (!selection.host || a.hostId === selection.host),
      )?.key ?? null
    );
  const host = (id: string) => (id === "local" ? undefined : id);
  if (selection.type === "project")
    return (
      snapshot.projects.find(
        (p) =>
          projectKey({ projectId: p.id, host: host(p.hostId) }) ===
          selection.id,
      )?.key ?? null
    );
  if (selection.type === "workspace")
    return (
      snapshot.workspaces.find(
        (w) =>
          workspaceKey({ workspaceId: w.id, host: host(w.hostId) }) ===
          selection.id,
      )?.key ?? null
    );
  return null;
}
type Tip = { entity: Entity; at: ScreenPoint; detail: string; flag?: MapFlag };
/** A hover card over the map, placed before it paints so it lies wholly inside the map the user sees: the surface
 * (the world frame beside the session panel and below the top bar), within the window. Above the thing it's about
 * when it fits, else below it, else where there's more room, cut to the map's height if it's taller (`placeCard`).
 * Placed again as its content or anchor changes (each render) and as the map resizes. */
function MapCard(props: { at: ScreenPoint; surface: RefObject<HTMLDivElement | null>; className: string; children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef(props.at);
  at.current = props.at;
  const place = useRef(() => {});
  place.current = () => {
    const card = ref.current;
    const surface = props.surface.current;
    if (!card || !surface) return;
    const parent = (card.offsetParent as HTMLElement | null) ?? surface;
    const s = surface.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    // The map as it shows: the surface, cut to the window.
    const root = document.documentElement;
    const left = Math.max(s.left, 0);
    const top = Math.max(s.top, 0);
    const view = { width: Math.min(s.right, root.clientWidth) - left, height: Math.min(s.bottom, root.clientHeight) - top };
    if (view.width <= 0 || view.height <= 0) return;
    // Measured where nothing narrows it (its last place, or a cap from it).
    card.style.left = "0px";
    card.style.top = "0px";
    card.style.maxWidth = "";
    card.style.maxHeight = "";
    let size = card.getBoundingClientRect();
    const room = Math.max(0, view.width - 2 * CARD_MARGIN);
    if (size.width > room) {
      card.style.maxWidth = `${room}px`;
      size = card.getBoundingClientRect();
    }
    // Swift's points are the surface's; the card's place is in its offset parent's padding box.
    const a = at.current;
    const dy = s.top - top;
    const p = placeCard(view, { x: a.x + s.left - left, y: a.y + dy, bottom: a.bottom === undefined ? undefined : a.bottom + dy }, size);
    card.style.left = `${Math.round(p.left + left - box.left - parent.clientLeft)}px`;
    card.style.top = `${Math.round(p.top + top - box.top - parent.clientTop)}px`;
    if (p.maxHeight !== undefined) card.style.maxHeight = `${p.maxHeight}px`;
    card.dataset.side = p.side;
  };
  useLayoutEffect(() => place.current());
  useEffect(() => {
    const surface = props.surface.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place.current());
    observer.observe(surface);
    return () => observer.disconnect();
  }, [props.surface]);
  return (
    <div ref={ref} className={props.className} role="tooltip" style={props.style}>
      {props.children}
    </div>
  );
}
export function NativeWorld(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const [hudHeight, setHudHeight] = useState(145);
  const world = useRef<AtlasWorld | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [tip, setTip] = useState<Tip | null>(null);
  // Only the macOS app draws the world; a plain browser shows the panels alone.
  const [absent, setAbsent] = useState(false);
  const revision = useRef(0);
  // What was last clicked on the map: choosing it there never moves the camera.
  const picked = useRef<string | null>(null);
  const snapshot = useMemo(
    () => worldSnapshot({ ...props, revision: ++revision.current }),
    [
      props.hosts,
      props.projects,
      props.workspaces,
      props.agents,
      props.permissions,
      props.unread,
    ],
  );
  const current = useRef(snapshot);
  current.current = snapshot;
  const probe = useProbe();
  const style = useMapStyle();
  const tooltipFrame = useGameTooltipFrame(style === "dungeon");
  const hudShown = props.hudVisible !== false && style === "dungeon";
  const stats = useHostStats();
  // Work queues are React UI state: polling them must never rebuild the native world.
  const dashboardCounts = useDashboardCounts(hudShown);
  const data = useMemo(() => atlasData(snapshot,props.questions,props.asking,probe,stats), [snapshot,props.questions,props.asking,probe,stats]);
  const [card, setCard] = useState<{ title: string; detail: string; lines: string[]; at: ScreenPoint } | null>(null);
  const currentData = useRef(data);
  currentData.current = data;
  const describe = (entity: Entity) => {
    const d = currentData.current;
    if (entity.kind === "agent")
      return [STATE_NAMES[entity.state!], entity.modelName]
        .filter(Boolean)
        .join(" · ");
    if (entity.kind === "workspace") {
      const n = d.agents.filter((a) => a.workspace === entity.id).length;
      return entity.camp
        ? `${n} agent${n === 1 ? "" : "s"} without a workspace`
        : `Workspace · ${n} agent${n === 1 ? "" : "s"}`;
    }
    if (entity.kind === "project") {
      const n = d.workspaces.filter((w) => w.project === entity.id).length;
      return `Project · ${n} workspace${n === 1 ? "" : "s"}`;
    }
    return "Host";
  };
  // The Islands and Overworld are one world, switched in place; the Dungeon Board is a
  // world of its own, mounted in their place (and back) when the style crosses that line.
  const worldKind = style === "dungeon" ? style : "atlas";
  const worldName = style === "dungeon" ? "Dungeon Board" : "";
  // Mount once per world: handlers read current props through refs.
  useEffect(() => {
    const node = surface.current!;
    setReady(false);
    setTip(null);
    // The panels keep the Paseo Command look from the native app: Galaxy, or
    // Light while the system is light.
    setUnityWorldTheme("galaxy");
    let atlas: AtlasWorld | null;
    try {
      atlas = mountAtlas(node, {
        ready: () => {
          setReady(true);
          setFailure("");
        },
        error: setFailure,
        // The live connection's state, for the app's map diagnostics.
        status: () => ({ live: liveConnection().diagnostics() }),
        pick: (entity) => {
          const p = latest.current;
          if (p.blocked) return;
          if (!entity) return p.select(null);
          if (entity.kind === "host") return p.chooseHost(entity.id);
          const selection = targetSelection(
            { kind: entity.kind, key: entity.id },
            current.current,
          );
          if (selection) {
            picked.current = entity.id;
            p.select(selection);
          }
        },
        card: (c, at) => setCard(c && at ? { ...c, at } : null),
        // A tile's PR opens in the GitHub tab, an issue in Linear (else Conquer), as links do elsewhere.
        open: (url) => openAppLink(url),
        hover: (entity, at, flag) => {
          const p = latest.current;
          setTip(entity && at ? { entity, at, detail: describe(entity), flag } : null);
          const row =
            entity?.kind === "agent"
              ? current.current.agents.find((a) => a.key === entity.id)
              : undefined;
          p.hover(row ? (row.clientId ?? row.id) : null);
        },
      }, mapStyle());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not start the Atlas.");
      return;
    }
    if (!atlas) {
      setAbsent(true);
      return () => setUnityWorldTheme(null);
    }
    world.current = atlas;
    // The native app draws the world under a transparent page.
    document.documentElement.dataset.renderer = "native";
    atlas.update(currentData.current);
    Object.assign(window, { paseoAtlas: atlas, paseoWorld: atlas });
    return () => {
      world.current = null;
      atlas.destroy();
      delete document.documentElement.dataset.renderer;
      setUnityWorldTheme(null);
    };
  }, [worldKind]);
  useEffect(() => {
    if ((style === "islands" || style === "overworld") && world.current?.kind === "atlas") world.current.style(style);
    // The app's View → Map Style marks the style shown.
    (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.paseoWorld?.postMessage({
      type: "mapStyle",
      style,
    });
  }, [style]);
  useEffect(() => {
    // The world re-reports a hover that survives the update.
    safely(() => world.current?.update(data));
  }, [data]);
  // Tell the macOS app the world has the fleet; its splash lifts once the map draws.
  useEffect(() => {
    if (props.loaded && world.current)
      (
        window as unknown as {
          webkit?: {
            messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } };
          };
        }
      ).webkit?.messageHandlers?.paseoWorld?.postMessage({ type: "loaded" });
  }, [props.loaded]);
  /** World calls never take the app down: a renderer fault becomes the world's notice. */
  const safely = (call: () => unknown) => {
    try {
      call();
    } catch (error) {
      console.error(error);
      setFailure("The world hit a problem. Reload to redraw it.");
    }
  };
  const focusedRevision = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const key =
      selectionKey(props.selection, snapshot) ??
      (props.selection || props.host === null ? null : props.host || "local");
    safely(() => world.current?.select(key));
    if (!props.selection) focusedRevision.current = props.focusRevision;
    if (key && props.focusRevision > focusedRevision.current) {
      focusedRevision.current = props.focusRevision;
      // Chosen elsewhere (the list, a notification): pan to it if it's out of view.
      if (picked.current !== key) safely(() => world.current?.focus(key));
    }
    picked.current = null;
  }, [props.selection, props.host, props.focusRevision, snapshot, ready]);
  // The terminal drawer shows the selected workspace's (or agent's) terminals.
  useEffect(() => {
    const key = selectionKey(props.selection, snapshot);
    const agent = props.selection?.type === "agent" ? snapshot.agents.find((a) => a.key === key) : undefined;
    const row = snapshot.workspaces.find((w) => w.key === (agent ? agent.workspaceKey : key));
    safely(() =>
      world.current?.workspace(
        row ? { id: row.id, host: row.hostId === "local" ? "" : row.hostId, name: row.name } : null,
      ),
    );
  }, [props.selection, snapshot, ready]);
  // The dialogue box's speaker, framed above the box (the Dungeon Board's; other worlds ignore it).
  const talkKey = props.talking ? selectionKey(props.selection, snapshot) : null;
  const talkInset = props.talking ? Math.round(props.talkInset ?? 0) : 0;
  useEffect(() => {
    if (!ready) return;
    safely(() => world.current?.talk(talkKey, talkInset));
  }, [talkKey, talkInset, ready, worldKind]);
  useEffect(() => {
    if (!ready) return;
    safely(() => world.current?.input(!props.blocked));
    if (props.blocked) setTip(null);
  }, [props.blocked, ready]);
  useEffect(() => {
    if (!ready) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => world.current?.motion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [ready]);
  const fitWorld = () => {
    soundEvent("focused");
    world.current?.command("home");
  };
  // F fits the world from anywhere in the page unless something is being typed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !isFitWorldKey(event) ||
        event.defaultPrevented ||
        latest.current.blocked ||
        modalOpen() ||
        isTyping(document.activeElement as HTMLElement | null) ||
        surface.current?.contains(document.activeElement)
      )
        return;
      event.preventDefault();
      fitWorld();
    };
    window.addEventListener("keydown", onKey);
    const offCommand = onAppCommand("fit-world", fitWorld);
    // View → Map Style in the macOS app asks for a style by name.
    const offStyles = MAP_STYLES.map((m) => onAppCommand(`map-style-${m.id}`, () => setMapStyle(m.id)));
    return () => {
      window.removeEventListener("keydown", onKey);
      offCommand();
      offStyles.forEach((off) => off());
    };
  }, []);
  const empty = ready && data.hosts.length === 0;
  const hoveredAgent = tip?.entity.kind === "agent"
    ? snapshot.agents.find((a) => a.key === tip.entity.id)
    : undefined;
  const hoveredSummary = hoveredAgent && props.workingOn?.[hoveredAgent.clientId ?? hoveredAgent.id];
  // A hovered PR flag's card: what it means, from its workspace's PR.
  const flagCard = (() => {
    if (!tip?.flag || tip.entity.kind !== "workspace") return null;
    const w = snapshot.workspaces.find((x) => x.key === tip.entity.id);
    const row = w && props.workspaces.find((x) => x.workspaceId === w.id && (x.host || "local") === w.hostId);
    return flagTip(tip.flag, row?.pr, tip.flag === "probe" ? tip.entity.probe : undefined);
  })();
  // The Overworld draws no medallions: a workspace's card says its pull request instead.
  const prLines = (() => {
    if (style !== "overworld" || tip?.flag || tip?.entity.kind !== "workspace") return [];
    const w = snapshot.workspaces.find((x) => x.key === tip.entity.id);
    const row = w && props.workspaces.find((x) => x.workspaceId === w.id && (x.host || "local") === w.hostId);
    const ws = data.workspaces.find((x) => x.key === tip.entity.id);
    return workspacePrLines(ws?.labels, row?.pr, ws?.probe, ws?.autoMerge);
  })();
  return (
    <>
      <div
        ref={surface}
        className="atlas-world-surface native-map-surface"
        data-world={style}
        style={hudShown ? { bottom: hudHeight } : undefined}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={`${worldName || "Atlas world"}. Drag to pan, scroll to zoom, Up/Down pan, Left/Right select agents, F fits every host. Select a robot to open its conversation.`}
        onPointerLeave={() => setTip(null)}
      />
      {hudShown && <DungeonHud data={data} dashboard={dashboardCounts} onNotice={props.onNotice} agents={props.agents} snapshot={snapshot} summaries={props.workingOn} blocked={props.blocked} talking={!!props.talking}
        onPick={(key) => { const s = targetSelection({ kind: "agent", key }, snapshot); if (s) props.select(s); }}
        onDispatch={props.onDispatch} onBrowse={props.onBrowseHud} onTray={props.onHudTray}
        onHeight={(height) => { setHudHeight(height); surface.current?.parentElement?.style.setProperty("--dungeon-belt-height", `${height}px`); }} />}
      {props.blocked && <div className="atlas-input-cover" />}
      {card && (
        <MapCard className={`atlas-world-tip atlas-world-card${style === "dungeon" ? " dungeon-tooltip" : ""}`} style={tooltipFrame} surface={surface} at={card.at}>
          <b>{card.title}</b>
          <span>{card.detail}</span>
          {card.lines.map((line, i) => (
            <span key={i} className="atlas-card-line">{line}</span>
          ))}
        </MapCard>
      )}
      {tip && (
        <MapCard className={`atlas-world-tip${style === "dungeon" ? " dungeon-tooltip" : ""}`} style={tooltipFrame} surface={surface} at={tip.at}>
          {flagCard ? (
            <>
              <b>{flagCard.title}</b>
              <span>{flagCard.description}</span>
              {flagCard.facts && <span>{flagCard.facts}</span>}
              {flagCard.autoMerge && <span className="atlas-flag-auto-merge">{flagCard.autoMerge}</span>}
              {flagCard.pr && <span className="atlas-flag-pr">{flagCard.pr}</span>}
            </>
          ) : (
            <>
              <b>{tip.entity.name}</b>
              <span>{tip.detail}</span>
              {prLines.map((line, i) => (
                <span key={i} className="atlas-card-line">{line}</span>
              ))}
            </>
          )}
          {hoveredSummary?.sentence && (
            <span className="atlas-work-summary">{hoveredSummary.sentence}</span>
          )}
        </MapCard>
      )}
      {absent ? (
        <div className="atlas-world-notice" role="status">
          The map is drawn by the Paseo Command macOS app (<code>npm run native:run</code>).
        </div>
      ) : (
        !ready &&
        !failure && (
          <div className="atlas-world-notice" role="status">
            {worldName ? `Preparing the ${worldName}…` : "Preparing the atlas…"}
          </div>
        )
      )}
      {empty && (
        <div className="atlas-world-notice" role="status">
          Waiting for Paseo hosts…
        </div>
      )}
      {failure && (
        <div className="atlas-world-notice" role="alert">
          {failure} <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {/* The Dungeon Board says what it shows in its own HUD and hover cards. */}
      {ready && !worldName && <WorldLegend data={data} />}
    </>
  );
}

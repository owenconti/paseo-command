/** Atlas world adapter. The inherited React work surface owns all daemon actions;
 * the world only draws the host-qualified snapshot and reports what was picked. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Home, Minus, Plus } from "lucide-react";
import {
  mountAtlas,
  STATE_NAMES,
  WORLDS,
  type WorldKind,
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
import { soundEvent } from "./soundCues";
import { setUnityWorldTheme } from "./theme";
import { readStore, writeStore } from "./api";
import type { Agent, Host, Project, Selection, Workspace } from "./types";
import { WorldLegend } from "./WorldLegend";
import "./atlas-world.css";
type Props = {
  hosts: Host[];
  projects: Project[];
  workspaces: Workspace[];
  agents: Agent[];
  permissions: Set<string>;
  /** Agents whose pending request is a question rather than an approval. */
  questions: Set<string>;
  unread: Set<string>;
  selection: Selection;
  focusRevision: number;
  select: (value: Selection) => void;
  hover: (id: string | null) => void;
  onNotice: (message: string) => void;
  blocked: boolean;
};
/** Hosts are keyed by their bridge id ("local" or a server id), as rows reference them. */
export function atlasData(
  snapshot: WorldSnapshot,
  questions: Set<string>,
): AtlasData {
  return {
    hosts: snapshot.hosts.map((h) => ({
      key: h.id,
      name: h.name,
      online: !/offline|stale/.test(h.state),
      local: h.local,
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
          : a.state === "unread"
            ? "done"
            : a.state,
      subagents: a.subagentCount,
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
type Tip = { entity: Entity; at: ScreenPoint; detail: string };
export function NativeWorld(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const world = useRef<AtlasWorld | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [tip, setTip] = useState<Tip | null>(null);
  // The world on show; every world draws the same fleet.
  const [kind, setKind] = useState<WorldKind>(() => {
    const saved = readStore<string>("phaser-world-kind", "atlas");
    return saved in WORLDS ? (saved as WorldKind) : "atlas";
  });
  const chooseWorld = (next: WorldKind) => {
    writeStore("phaser-world-kind", next);
    setKind(next);
  };
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
  const data = useMemo(
    () => atlasData(snapshot, props.questions),
    [snapshot, props.questions],
  );
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
  // Mount per world: handlers read current props through refs.
  useEffect(() => {
    const node = surface.current!;
    setReady(false);
    setTip(null);
    document.documentElement.dataset.renderer = kind;
    // The panels keep the Paseo Command look from the native app (its Galaxy theme).
    setUnityWorldTheme("galaxy");
    let atlas: AtlasWorld;
    try {
      atlas = mountAtlas(node, {
        ready: () => {
          setReady(true);
          setFailure("");
        },
        error: setFailure,
        pick: (entity) => {
          const p = latest.current;
          if (p.blocked) return;
          if (!entity) return p.select(null);
          if (entity.kind === "host") return;
          const selection = targetSelection(
            { kind: entity.kind, key: entity.id },
            current.current,
          );
          if (selection) {
            picked.current = entity.id;
            p.select(selection);
          }
        },
        hover: (entity, at) => {
          const p = latest.current;
          setTip(entity && at ? { entity, at, detail: describe(entity) } : null);
          const row =
            entity?.kind === "agent"
              ? current.current.agents.find((a) => a.key === entity.id)
              : undefined;
          p.hover(row ? (row.clientId ?? row.id) : null);
        },
      }, kind);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : `Could not start the ${WORLDS[kind]}.`,
      );
      return;
    }
    world.current = atlas;
    atlas.update(currentData.current);
    Object.assign(window, { paseoAtlas: atlas, paseoWorld: atlas });
    return () => {
      world.current = null;
      atlas.destroy();
      delete document.documentElement.dataset.renderer;
      setUnityWorldTheme(null);
    };
  }, [kind]);
  // The app's world shortcut (⌘⌥T) steps to the next world.
  useEffect(() => {
    const next = () => {
      if (latest.current.blocked) return;
      const kinds = Object.keys(WORLDS) as WorldKind[];
      setKind((current) => {
        const value = kinds[(kinds.indexOf(current) + 1) % kinds.length]!;
        writeStore("phaser-world-kind", value);
        return value;
      });
    };
    window.addEventListener("paseo:world-theme-request", next);
    return () => window.removeEventListener("paseo:world-theme-request", next);
  }, []);
  useEffect(() => {
    safely(() => world.current?.update(data));
    setTip(null);
  }, [data]);
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
    const key = selectionKey(props.selection, snapshot);
    safely(() => world.current?.select(key));
    if (!props.selection) focusedRevision.current = props.focusRevision;
    if (key && props.focusRevision > focusedRevision.current) {
      focusedRevision.current = props.focusRevision;
      // Chosen elsewhere (the list, a notification): pan to it if it's out of view.
      if (picked.current !== key) safely(() => world.current?.focus(key));
    }
    picked.current = null;
  }, [props.selection, props.focusRevision, snapshot, ready]);
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
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const empty = ready && data.hosts.length === 0;
  return (
    <>
      <div
        ref={surface}
        className="atlas-world-surface native-map-surface"
        data-world={kind}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={`${WORLDS[kind]} world. Drag to pan, scroll to zoom, arrow keys pan, F fits every host. Select ${kind === "galaxy" ? "a satellite" : "a robot"} to open its conversation.`}
        onPointerLeave={() => setTip(null)}
      />
      {props.blocked && <div className="atlas-input-cover" />}
      {tip && (
        <div
          className="atlas-world-tip"
          role="tooltip"
          style={{ left: tip.at.x, top: tip.at.y }}
        >
          <b>{tip.entity.name}</b>
          <span>{tip.detail}</span>
        </div>
      )}
      <div
        className="unity-world-toolbar"
        role="toolbar"
        aria-label="World controls"
      >
        <label>
          World
          <select
            aria-label="Choose world"
            value={kind}
            disabled={props.blocked}
            onChange={(e) => chooseWorld(e.target.value as WorldKind)}
          >
            {Object.entries(WORLDS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Fit all hosts"
          title="Fit all hosts · F"
          disabled={!ready || props.blocked}
          onClick={fitWorld}
        >
          <Home size={17} />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out"
          disabled={!ready || props.blocked}
          onClick={() => world.current?.command("out")}
        >
          <Minus size={17} />
        </button>
        <button
          aria-label="Zoom in"
          title="Zoom in"
          disabled={!ready || props.blocked}
          onClick={() => world.current?.command("in")}
        >
          <Plus size={17} />
        </button>
      </div>
      {!ready && !failure && (
        <div className="atlas-world-notice" role="status">
          Preparing the {WORLDS[kind].toLowerCase()}…
        </div>
      )}
      {empty && (
        <div className="atlas-world-notice" role="status">
          Waiting for Paseo hosts…
        </div>
      )}
      {failure && (
        <div className="atlas-world-notice" role="alert">
          {failure}{" "}
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {ready && <WorldLegend kind={kind} data={data} />}
      <div className="atlas-world-help">
        Drag to explore · Scroll to zoom · F to fit · Select{" "}
        {kind === "galaxy" ? "a satellite" : "a robot"} to open its conversation
      </div>
    </>
  );
}

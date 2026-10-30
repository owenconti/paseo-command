export const UNITY_WORLDS = {
  galaxy: "Galaxy",
  lake: "Lake Country",
  atlas: "Atlas",
  diorama: "Diorama",
} as const;
export type UnityWorldKind = keyof typeof UNITY_WORLDS;
export function isUnityWorldKind(value: unknown): value is UnityWorldKind {
  return typeof value === "string" && Object.hasOwn(UNITY_WORLDS, value);
}

import { daemonAgentId, qualifyAgent } from "./agentIdentity";
import { projectKey, workspaceKey } from "./workspaces";
import { activeAgents, agentExcluded } from "./activeAgents";
import { hostText, placeText, sessionName } from "./names";
import type { Agent, Host, Project, Selection, Workspace } from "./types";
import { isFailed, isRunning, sameHost } from "./types";

export const WORLD_BRIDGE_VERSION = 1 as const;
export const worldKey = (host: string | undefined, id: string) =>
  JSON.stringify([host || "local", id]);
/** A host's key in the world (its island or galaxy region). */
export const hostWorldKey = (h: { local: boolean; serverId: string }) =>
  worldKey(h.local ? undefined : h.serverId, h.local ? "local" : h.serverId);
export type WorldTarget = {
  /** A subagent's key is its agent's key, U+001F, then its own id. */
  kind: "agent" | "host" | "project" | "workspace" | "subagent";
  key: string;
};
/** A subagent target's agent key and subagent id. */
export function subagentTarget(key: string) {
  const at = key.indexOf("\u001f");
  return at > 0 ? { agent: key.slice(0, at), id: key.slice(at + 1) } : null;
}
export type WorldSnapshot = {
  version: 1;
  type: "snapshot";
  revision: number;
  hosts: {
    key: string;
    id: string;
    name: string;
    state: string;
    local: boolean;
  }[];
  projects: {
    key: string;
    id: string;
    hostId: string;
    name: string;
    stale: boolean;
  }[];
  workspaces: {
    key: string;
    id: string;
    hostId: string;
    projectKey?: string;
    name: string;
    stale: boolean;
    /** Its Paseo labels (the PR status ones plant flags). */
    labels: string[];
    /** Its open pull request has auto-merge on. */
    autoMerge?: boolean;
    /** When the daemon created it (ISO), if known. */
    created?: string;
  }[];
  agents: {
    key: string;
    id: string;
    clientId?: string;
    hostId: string;
    projectKey?: string;
    workspaceKey?: string;
    /** The session's own title as the Paseo app shows it (not its workspace's). */
    name: string;
    /** The agent's provider/model; Galaxy colours its satellite and beam by the provider. */
    model: string;
    status: string;
    /** Needs you (a question), unread (a reply not read yet), failed,
     *  running or idle (nothing new), in that precedence. */
    state: "running" | "attention" | "unread" | "failed" | "idle";
    unread: boolean;
    stale: boolean;
    /** How many subagents it is running now (0 when none). They are not
     *  separate agent rows: a listed subagent is its own row instead. */
    subagentCount: number;
    /** When the daemon created it (ISO), if known. */
    created?: string;
    /** Its subagents, running and finished (until archived in Paseo),
     *  oldest first; the worlds draw each one beside it. */
    subagents: WorldSubagent[];
  }[];
};
/** A subagent of a world agent, as the bridge carries it. */
export type WorldSubagent = {
  /** Unique within its parent agent. */
  id: string;
  name: string;
  /** The provider's subagent type, or a daemon child agent's provider ("" when unknown). */
  kind: string;
  /** The daemon's status: running, or finished (completed, failed, canceled…). */
  status: string;
  source: "provider" | "agent";
  /** The id of the subagent that dispatched it when nested, else "". */
  parent: string;
};
export type WorldMap = {
  hosts: {
    key: string;
    name: string;
    x: number;
    z: number;
    state: string;
    color?: string;
    width?: number;
    depth?: number;
  }[];
  /** Lake Country project villages, in their scheme colour. */
  villages?: {
    key: string;
    name: string;
    color: string;
    x: number;
    z: number;
  }[];
  context?: string;
  theme?: string;
  image?: string;
  camera: {
    x: number;
    z: number;
    scale: number;
    azimuth: number;
    footprint?: { x: number; z: number }[];
  };
  extent: { minX: number; minZ: number; maxX: number; maxZ: number };
};
export type NativeEvent = {
  version: 1;
  type:
    | "ready"
    | "selection"
    | "hover"
    | "camera"
    | "error"
    | "notification"
    | "lifecycle"
    | "platformResult"
    | "worldLayout"
    | "themeChanged"
    | "themeError"
    | "worldStorage"
    | "helper"
    | "appReload"
    | "menu";
  revision?: number;
  rendererEpoch?: string;
  inputSequence?: number;
  target?: WorldTarget | null;
  message?: string;
  worldAvailable?: boolean;
  recovery?: string;
  agentId?: string;
  state?: string;
  theme?: string;
  azimuth?: number;
  polar?: number;
  action?: string;
  /** A menu's requested session-panel side ("left" or "right"). */
  side?: string;
  id?: string;
  value?: unknown;
  error?: string;
  context?: string;
  image?: string;
  imageChanged?: boolean;
  hosts?: WorldMap["hosts"];
  villages?: WorldMap["villages"];
  camera?: WorldMap["camera"];
  extent?: WorldMap["extent"];
};
export type NativeMessage =
  WorldSnapshot | { version: 1; type: string; [key: string]: unknown };
declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        worldBridge?: { postMessage(message: NativeMessage): void };
      };
    };
    __PASEO_NATIVE__?: boolean;
    __PASEO_UNITY__?: boolean;
    __PASEO_NATIVE_DOCUMENT__?: string;
  }
}
export const nativeAvailable = () =>
  typeof window !== "undefined" &&
  !!window.webkit?.messageHandlers?.worldBridge;
/** The macOS app's channel (its Atlas world, menus and terminal), which
 * `nativeAvailable`'s older bridge is not. */
type AppChannel = { postMessage(message: unknown): void };
const appChannel = () =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: AppChannel } } })
        .webkit?.messageHandlers?.paseoWorld;
/** Whether the page runs inside the macOS app. */
export const macApp = () => !!appChannel();
/** Choose one of the macOS app's menu items (View → Terminal, …). */
export const postAppMenu = (action: string) =>
  appChannel()?.postMessage({ type: "menu", action });
export function postNative(message: { type: string; [key: string]: unknown }) {
  window.webkit?.messageHandlers?.worldBridge?.postMessage({
    ...message,
    version: WORLD_BRIDGE_VERSION,
    ...(window.__PASEO_NATIVE_DOCUMENT__
      ? { documentID: window.__PASEO_NATIVE_DOCUMENT__ }
      : {}),
  } as NativeMessage);
}
export function nativeEvents(handler: (event: NativeEvent) => void) {
  const receive = (event: Event) => {
    const payload = (event as CustomEvent).detail;
    if (
      payload?.version === WORLD_BRIDGE_VERSION &&
      typeof payload.type === "string"
    )
      handler(payload);
  };
  window.addEventListener("paseo:native", receive);
  return () => window.removeEventListener("paseo:native", receive);
}
/** A subagent status the worlds draw as running (as the server counts it). */
export const subagentRunning = (status: string) =>
  /running|starting|initializing/.test(status);
export function worldSnapshot(input: {
  revision: number;
  hosts: Host[];
  projects: Project[];
  workspaces: Workspace[];
  agents: Agent[];
  permissions: Set<string>;
  unread: Set<string>;
}): WorldSnapshot {
  const { hosts, projects, workspaces, permissions, unread } = input;
  const contains = (root: string, path: string) =>
    !!root && (path === root || path.startsWith(root.replace(/\/$/, "") + "/"));
  const workspaceOwner = (workspace: Workspace) => {
    if (workspace.projectId) return workspace.projectId;
    const local = projects.filter((project) => sameHost(project, workspace));
    const byPath = local
      .filter((project) => contains(project.path, workspace.cwd))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (byPath) return byPath.projectId;
    const named = local.filter((project) => project.name === workspace.project);
    return named.length === 1 ? named[0].projectId : undefined;
  };
  return {
    version: 1,
    type: "snapshot",
    revision: input.revision,
    hosts: hosts.map((h) => ({
      key: hostWorldKey(h),
      id: h.local ? "local" : h.serverId,
      name: hostText(h),
      state: h.state || h.status,
      local: h.local,
    })),
    projects: projects.map((p) => ({
      key: worldKey(p.host, p.projectId),
      id: p.projectId,
      hostId: p.host || "local",
      name: placeText(p.name, "Project", [p.projectId]),
      stale: !!p.stale,
    })),
    workspaces: workspaces.map((w) => ({
      key: worldKey(w.host, w.workspaceId),
      id: w.workspaceId,
      hostId: w.host || "local",
      projectKey: (() => {
        const id = workspaceOwner(w);
        return id ? worldKey(w.host, id) : undefined;
      })(),
      name: placeText(w.name || w.branch, "Workspace", [w.workspaceId]),
      stale: !!w.stale,
      labels: w.labels ?? [],
      ...(w.pr?.autoMerge && (w.pr.state === "open" || w.pr.state === "draft") ? { autoMerge: true } : {}),
      ...(w.createdAt ? { created: w.createdAt } : {}),
    })),
    agents: activeAgents(input.agents)
      .map(qualifyAgent)
      .map((a) => {
        const w = workspaces
          .filter(
            (w) =>
              sameHost(w, a) &&
              ((a.workspaceId && w.workspaceId === a.workspaceId) ||
                contains(w.cwd, a.cwd)),
          )
          .sort(
            (left, right) =>
              Number(right.workspaceId === a.workspaceId) -
                Number(left.workspaceId === a.workspaceId) ||
              right.cwd.length - left.cwd.length,
          )[0];
        const projectId =
          (w ? workspaceOwner(w) : undefined) ||
          a.projectId ||
          projects
            .filter((p) => sameHost(p, a) && contains(p.path, a.cwd))
            .sort((left, right) => right.path.length - left.path.length)[0]
            ?.projectId;
        return {
          key: worldKey(a.host, daemonAgentId(a)),
          id: daemonAgentId(a),
          clientId: a.id,
          hostId: a.host || "local",
          projectKey: projectId ? worldKey(a.host, projectId) : undefined,
          workspaceKey: w ? worldKey(w.host, w.workspaceId) : undefined,
          // The session's own title, as the Paseo app names it: a droid
          // or satellite is the agent, so never its workspace's title.
          name: sessionName(a, w?.branch),
          model: a.provider,
          status: a.status,
          state: permissions.has(a.id)
            ? ("attention" as const)
            : unread.has(a.id)
              ? ("unread" as const)
              : isFailed(a.status)
                ? ("failed" as const)
                : isRunning(a.status) || a.subagentsRunning
                  ? ("running" as const)
                  : ("idle" as const),
          unread: unread.has(a.id),
          stale: !!a.stale,
          ...(a.createdAt ? { created: a.createdAt } : {}),
          subagentCount: (a.subagents ?? []).filter((s) =>
            subagentRunning(s.status),
          ).length,
          subagents: (a.subagents ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind ?? "",
            status: s.status,
            source: s.source,
            parent: s.parent ?? "",
          })),
        };
      }),
  };
}
export function targetSelection(
  target: WorldTarget | null | undefined,
  snapshot: WorldSnapshot,
): Selection {
  if (!target) return null;
  if (target.kind === "subagent") {
    // Picking a subagent opens its conversation; its agent stays selected.
    const parts = subagentTarget(target.key);
    const row = parts
      ? snapshot.agents.find((a) => a.key === parts.agent)
      : undefined;
    if (!parts || !row?.subagents.some((s) => s.id === parts.id)) return null;
    const agent = targetSelection(
      { kind: "agent", key: parts.agent },
      snapshot,
    );
    return agent ? { ...agent, subagent: parts.id } : null;
  }
  if (target.kind === "agent") {
    const row = snapshot.agents.find(
      (a) =>
        a.key === target.key &&
        !agentExcluded({
          id: a.clientId ?? a.id,
          host: a.hostId === "local" ? undefined : a.hostId,
          status: a.status,
        }),
    );
    return row
      ? {
          type: "agent",
          id: row.clientId ?? row.id,
          ...(row.hostId !== "local" ? { host: row.hostId } : {}),
        }
      : null;
  }
  if (target.kind === "project" || target.kind === "workspace") {
    const rows =
      target.kind === "project" ? snapshot.projects : snapshot.workspaces;
    const row = rows.find((r) => r.key === target.key);
    if (!row) return null;
    return {
      type: target.kind,
      id:
        target.kind === "project"
          ? projectKey({
              projectId: row.id,
              host: row.hostId === "local" ? undefined : row.hostId,
            })
          : workspaceKey({
              workspaceId: row.id,
              host: row.hostId === "local" ? undefined : row.hostId,
            }),
    };
  }
  return null;
}

/** A WebKit process can restart while the native scene survives. Resume above
 * that scene's accepted revision so the very first resync is authoritative. */
export function resumeSceneRevision(
  localRevision: number,
  rendererRevision: unknown,
) {
  return typeof rendererRevision === "number" &&
    Number.isSafeInteger(rendererRevision) &&
    rendererRevision >= 0
    ? Math.max(localRevision, rendererRevision)
    : localRevision;
}

/** Input is ordered independently of asynchronous scene preparation. A fresh
 * click may describe the previous rendered revision while React already holds
 * a newer semantic snapshot; identity must still exist in that latest state. */
export class WorldInputGate {
  private epoch: string | null = null;
  private retired = new Set<string>();
  private sequence = { selection: 0, hover: 0 };
  ready(epoch: unknown) {
    if (typeof epoch !== "string" || !epoch) return true;
    if (epoch === this.epoch) return true;
    if (this.retired.has(epoch)) return false;
    if (this.epoch) this.retired.add(this.epoch);
    this.epoch = epoch;
    this.sequence = { selection: 0, hover: 0 };
    return true;
  }
  accepts(event: NativeEvent, snapshot: WorldSnapshot) {
    if (event.type !== "selection" && event.type !== "hover") return false;
    if (
      !Number.isSafeInteger(event.revision) ||
      event.revision! > snapshot.revision
    )
      return false;
    if (event.inputSequence !== undefined) {
      if (
        !Number.isSafeInteger(event.inputSequence) ||
        event.inputSequence <= 0 ||
        !this.epoch ||
        event.rendererEpoch !== this.epoch ||
        event.inputSequence <= this.sequence[event.type]
      )
        return false;
      this.sequence[event.type] = event.inputSequence;
    } else {
      if (
        event.revision !== snapshot.revision ||
        (event.rendererEpoch && event.rendererEpoch !== this.epoch)
      )
        return false;
    }
    if (event.target === null) return true;
    const target = event.target;
    if (!target || typeof target.key !== "string") return false;
    if (target.kind === "agent" || target.kind === "subagent")
      return targetSelection(target, snapshot) !== null;
    const rows =
      target.kind === "project"
        ? snapshot.projects
        : target.kind === "workspace"
          ? snapshot.workspaces
          : target.kind === "host"
            ? snapshot.hosts
            : [];
    return rows.some((row) => row.key === target.key);
  }
}

/**
 * The page's side of the map's watchdog. Every scene and agents message the
 * bridge posts carries a revision; Swift says which it last applied (its
 * `state`, `sceneRevision` and `agentsRevision`). When Swift stays behind what
 * was posted, or says its loop stalled, the bridge posts the world again.
 */
export const WORLD_WATCH = {
  /** How often the bridge looks. */
  everyMs: 5000,
  /** How long Swift may stay behind a post before the world is posted again. */
  lagMs: 10000,
};

/** What was posted, and since when Swift has been behind it (null: caught up). */
export type Watch = { scene: number; agents: number; waitingSince: number | null };
export type Applied = { sceneRevision?: unknown; agentsRevision?: unknown };

export const newWatch = (): Watch => ({ scene: 0, agents: 0, waitingSince: null });

/** The next revision for a `kind` message posted at `now`. */
export function post(watch: Watch, kind: "scene" | "agents", now: number): number {
  watch[kind] = Math.max(watch.scene, watch.agents) + 1;
  watch.waitingSince ??= now;
  return watch[kind];
}

const rev = (v: unknown) => (typeof v === "number" ? v : 0);

/** Swift's account of what it applied: caught up, the wait ends. */
export function applied(watch: Watch, state: Applied) {
  if (rev(state.sceneRevision) >= watch.scene && rev(state.agentsRevision) >= watch.agents) watch.waitingSince = null;
}

/** Whether Swift has stayed behind a post for longer than `lagMs`. */
export const behind = (watch: Watch, now: number, lagMs = WORLD_WATCH.lagMs) =>
  watch.waitingSince !== null && now - watch.waitingSince > lagMs;

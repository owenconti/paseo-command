/**
 * Which interface sound plays when, as pure logic (src/sounds.ts plays them).
 * The kit and its intended meanings are in docs/unity/SOUND-DIRECTION.md; the
 * files are art/audio/<set>/<cue>.wav. Unity stays silent: only the web
 * layer plays these.
 */
import { isFailed, isRunning } from "./types";
import type { ResolvedTheme } from "./themeOptions";
import type { FleetSource } from "./live";

export const CUES = [
  "select",
  "focus",
  "dispatch",
  "complete",
  "attention",
  "error",
  "world-enter",
] as const;
export type Cue = (typeof CUES)[number];
export const SOUND_SETS = ["galaxy", "lake"] as const;
export type SoundSet = (typeof SOUND_SETS)[number];

/** Lake Country plays the crafted set; Galaxy, Light and Dark the synthetic one. */
export const soundSetFor = (theme: ResolvedTheme): SoundSet =>
  theme === "lake-country" ? "lake" : "galaxy";

/** Live cues report agents' state changes; the rest answer the user's own actions. */
export const LIVE_CUES: readonly Cue[] = ["complete", "attention", "error"];
export const isLive = (cue: Cue) => LIVE_CUES.includes(cue);

/** Higher wins a voice or a coalesced burst. */
export const PRIORITY: Record<Cue, number> = {
  error: 6,
  attention: 5,
  complete: 4,
  dispatch: 3,
  "world-enter": 2,
  focus: 1,
  select: 0,
};

/** The kit's lengths (manifest.json), for counting voices before decoding. */
export const DURATION_MS: Record<Cue, number> = {
  select: 120,
  focus: 500,
  dispatch: 620,
  complete: 1050,
  attention: 900,
  error: 420,
  "world-enter": 1600,
};

/** The semantic events the app reports, and the cue each plays. */
export type SoundEvent =
  | "selected"
  | "focused"
  | "dispatched"
  | "sent"
  | "finished"
  | "needsYou"
  | "failed"
  | "actionFailed"
  | "worldChanged";
export const CUE_FOR: Record<SoundEvent, Cue> = {
  selected: "select",
  focused: "focus",
  dispatched: "dispatch",
  sent: "dispatch",
  finished: "complete",
  needsYou: "attention",
  failed: "error",
  actionFailed: "error",
  worldChanged: "world-enter",
};

export const GATE = {
  /** The same cue never stacks on itself within this. */
  repeatMs: 80,
  /** Selection also focuses the camera: one cue, the selection. */
  focusAfterSelectMs: 120,
  /** Live cues in a burst are one cue (a louder one may still interrupt). */
  liveBurstMs: 1000,
  voices: 2,
};

export type Voice = { cue: Cue; until: number };
export type Admission =
  { play: false; reason: string } | { play: true; replace?: Voice };

/**
 * Rate limits and the voice cap. Cues are never queued: one that can't play
 * now is dropped.
 */
export class CueGate {
  private last = new Map<Cue, number>();
  private live?: { at: number; cue: Cue };
  admit(cue: Cue, now: number, playing: readonly Voice[]): Admission {
    const voices = playing.filter((v) => v.until > now);
    const last = this.last.get(cue);
    if (last !== undefined && now - last < GATE.repeatMs)
      return { play: false, reason: "repeat" };
    const selected = this.last.get("select");
    if (
      cue === "focus" &&
      selected !== undefined &&
      now - selected < GATE.focusAfterSelectMs
    )
      return { play: false, reason: "selected" };
    if (
      isLive(cue) &&
      this.live &&
      now - this.live.at < GATE.liveBurstMs &&
      PRIORITY[cue] <= PRIORITY[this.live.cue]
    )
      return { play: false, reason: "burst" };
    let replace: Voice | undefined;
    if (voices.length >= GATE.voices) {
      const weakest = voices.reduce((a, b) =>
        PRIORITY[b.cue] < PRIORITY[a.cue] ? b : a,
      );
      if (PRIORITY[weakest.cue] >= PRIORITY[cue])
        return { play: false, reason: "voices" };
      replace = weakest;
    }
    this.last.set(cue, now);
    if (isLive(cue)) this.live = { at: now, cue };
    return replace ? { play: true, replace } : { play: true };
  }
}

export type WatchedAgent = {
  id: string;
  status: string;
  child?: boolean;
  stale?: boolean;
  subagentsRunning?: boolean;
};
export type WatchedPermission = { agentId: string; id: string };
export type { FleetSource };

/** Ignore transitions this long after a snapshot (load, reconnect, resync). */
export const SETTLE_MS = 2500;

/**
 * Agents' live transitions, as cues. Only changes observed live count: the
 * first fleet, a reconnect's reset, fallback reads while disconnected and the
 * moments just after them set a new baseline without a sound. Subagents and
 * stale rows (a host not answering) never sound; an agent seen again after
 * being stale or missing starts afresh. An agent that goes idle while its
 * subagents still run isn't finished: their results wake it for a turn
 * each, so it sounds only on the turn that ends with none running. One observation yields at most one
 * cue, the most important of its transitions.
 */
export class LiveCueWatcher {
  private statuses: Map<string, string> | null = null;
  private permissions = new Set<string>();
  private quietUntil = 0;
  observe(
    agents: readonly WatchedAgent[],
    permissions: readonly WatchedPermission[],
    source: FleetSource,
    live: boolean,
    now: number,
  ): Cue | null {
    const watched = agents.filter((a) => !a.child && !a.stale);
    const ids = new Set(watched.map((a) => a.id));
    const statuses = new Map(watched.map((a) => [a.id, a.status]));
    const busy = new Set(
      watched.filter((a) => a.subagentsRunning).map((a) => a.id),
    );
    const asks = new Set(
      permissions
        .filter((p) => ids.has(p.agentId))
        .map((p) => `${p.agentId}\n${p.id}`),
    );
    const before = this.statuses;
    const asked = this.permissions;
    this.statuses = statuses;
    this.permissions = asks;
    const snapshot = source === "reset" || source === "lost" || !live;
    if (!before || snapshot) {
      this.quietUntil = now + SETTLE_MS;
      return null;
    }
    if (now < this.quietUntil) return null;
    const cues = new Set<Cue>();
    for (const [id, status] of statuses) {
      const was = before.get(id);
      if (was === undefined || was === status) continue;
      if (isFailed(status) && !isFailed(was)) cues.add("error");
      else if (
        isRunning(was) &&
        !isRunning(status) &&
        !isFailed(status) &&
        !busy.has(id)
      )
        cues.add("complete");
    }
    for (const key of asks)
      if (!asked.has(key) && before.has(key.split("\n")[0]))
        cues.add("attention");
    return strongest(cues);
  }
}

export function strongest(cues: Iterable<Cue>): Cue | null {
  let best: Cue | null = null;
  for (const cue of cues)
    if (best === null || PRIORITY[cue] > PRIORITY[best]) best = cue;
  return best;
}

export type SoundSettings = { enabled: boolean; volume: number };
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.35,
};
export function validSoundSettings(value: unknown): SoundSettings {
  const v = (value ?? {}) as Partial<Record<keyof SoundSettings, unknown>>;
  const volume =
    typeof v.volume === "number" && Number.isFinite(v.volume)
      ? Math.min(1, Math.max(0, v.volume))
      : DEFAULT_SOUND_SETTINGS.volume;
  return {
    enabled:
      typeof v.enabled === "boolean"
        ? v.enabled
        : DEFAULT_SOUND_SETTINGS.enabled,
    volume,
  };
}

export type SoundOptions = { set?: SoundSet };
type Player = (event: SoundEvent, options?: SoundOptions) => void;
let player: Player | null = null;
/** src/sounds.ts plays; anything can report (a no-op until it's loaded). */
export function setSoundPlayer(next: Player | null) {
  player = next;
}
export function soundEvent(event: SoundEvent, options?: SoundOptions) {
  player?.(event, options);
}

/** The event each cue answers (for reporting a watcher's cue). */
export const EVENT_OF_CUE = {
  complete: "finished",
  attention: "needsYou",
  error: "failed",
  select: "selected",
  focus: "focused",
  dispatch: "dispatched",
  "world-enter": "worldChanged",
} as const satisfies Record<Cue, SoundEvent>;

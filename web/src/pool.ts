/**
 * Pool boxes: warm-pool Sprites the paseo-boxes scripts on this Mac claim and
 * release (`claim.sh --any`, `release.sh pool-N`). New agent's "New pool box"
 * claims one, waits for its Paseo host to come online and dispatches the agent
 * into its checkout; the Hosts tab releases a claimed one. Pure: shared by the
 * server (`web/server/pool.ts`) and the page (`poolStore.ts`).
 */

/** Where the scripts live and the checkout agents work in on a box ("" until set in Settings). */
export type PoolSettings = { dir: string; checkout: string };
export const DEFAULT_POOL: PoolSettings = { dir: "", checkout: "" };

/** `settings.json`'s `pool`, each field checked; anything else is unset. */
export function poolSettings(value: unknown): PoolSettings {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const dir = typeof raw.dir === "string" && !poolDirProblem(raw.dir) ? raw.dir.trim() : DEFAULT_POOL.dir;
  const checkout =
    typeof raw.checkout === "string" && !poolCheckoutProblem(raw.checkout)
      ? raw.checkout.trim()
      : DEFAULT_POOL.checkout;
  return { dir, checkout };
}

/** Why a scripts folder can't be used, or "": a path on this Mac, absolute or `~/…`. */
export function poolDirProblem(value: string) {
  const v = value.trim();
  if (!v) return "Name the paseo-boxes folder.";
  if (v.length > 500 || /[\0\n\r]/.test(value)) return "That folder name can't be used.";
  if (!v.startsWith("/") && !v.startsWith("~/")) return "Give the folder as an absolute path or one starting with ~/.";
  if (v.split("/").includes("..")) return "The folder can't contain “..”.";
  return "";
}

/** Why a checkout path can't be used, or "": an absolute path on the box. */
export function poolCheckoutProblem(value: string) {
  const v = value.trim();
  if (!v) return "Name the checkout on the box.";
  if (v.length > 500 || /[\0\n\r\\]/.test(value)) return "That path can't be used.";
  if (!v.startsWith("/")) return "Give the checkout as an absolute path on the box.";
  if (v.split("/").includes("..")) return "The path can't contain “..”.";
  return "";
}

/** A pool box as `pool-state.json` records it (no secrets are read). */
export type PoolBox = {
  /** `pool-N`, also its Paseo host label. */
  id: string;
  label: string;
  status: "claimed" | "idle";
  claimedAt?: string;
};

/** A claim (then dispatch) or a release, one at a time. */
export type PoolJob = {
  id: string;
  kind: "claim" | "release";
  /** The box, once the script names it (a claim picks the first idle one). */
  pool?: string;
  phase: "claiming" | "waiting" | "dispatching" | "releasing" | "done" | "failed";
  /** The script's own step lines, newest last. */
  steps: string[];
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** A claim's dispatched agent and its host (serverId). */
  agentId?: string;
  host?: string;
};

export type PoolStatus = {
  enabled: boolean;
  /** Why claiming or releasing can't work now (scripts missing, state unreadable), or "". */
  problem: string;
  settings: PoolSettings;
  boxes: PoolBox[];
  /** The running job, else the last one (until the next starts). */
  job: PoolJob | null;
};

export const POOL_ID = /^pool-[0-9]{1,4}$/;

/** `pool-state.json`'s boxes, each field checked, nothing else kept. */
export function poolBoxes(state: unknown): PoolBox[] {
  const boxes =
    state && typeof state === "object" && !Array.isArray(state)
      ? (state as { boxes?: unknown }).boxes
      : undefined;
  if (!boxes || typeof boxes !== "object" || Array.isArray(boxes)) return [];
  return Object.entries(boxes as Record<string, unknown>)
    .filter(([id, box]) => POOL_ID.test(id) && box && typeof box === "object")
    .map(([id, box]) => {
      const b = box as Record<string, unknown>;
      const label = typeof b.label === "string" && /^[\w.-]{1,64}$/.test(b.label) ? b.label : id;
      const claimedAt =
        typeof b.claimed_at === "string" && b.claimed_at.length <= 40 ? b.claimed_at : undefined;
      return {
        id,
        label,
        status: b.status === "claimed" ? ("claimed" as const) : ("idle" as const),
        ...(claimedAt ? { claimedAt } : {}),
      };
    })
    .sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
}

/** Which box a claim's output says it is claiming (`claiming pool-1 (paseo-pool-1)`). */
export function claimedPool(line: string) {
  const m = /^claiming (pool-[0-9]{1,4}) /.exec(line.trim());
  return m ? m[1] : undefined;
}

/**
 * The lines of a script's output worth showing as progress: its `step:` lines
 * and its outcome (`ok:`, `error:`, `warning:`, `releasing`, `restoring`), as
 * plain short text. Nothing else (status blocks, timings) is kept.
 */
export function progressLine(line: string) {
  const t = line.trim();
  const step = /^step: (.+?)\.{0,3}$/.exec(t);
  if (step) return capitalise(step[1]);
  if (/^(ok|error|warning|note): /.test(t)) return capitalise(t.replace(/^(ok|note): /, ""));
  if (/^(releasing|restoring|box is dirty|box is already clean|claiming) /.test(t)) return capitalise(t);
  return "";
}
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s).slice(0, 200);

/** The last `error:` line of a failed script, without its prefix. */
export function scriptError(output: string) {
  const lines = output.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--)
    if (lines[i].startsWith("error: ")) return lines[i].slice(7).slice(0, 300);
  return "";
}

/** The box a host is, while it's claimed: its label is a claimed box's. */
export function claimedBoxOf(boxes: PoolBox[], label: string | undefined) {
  return label ? boxes.find((b) => b.status === "claimed" && b.label === label) : undefined;
}

export const idleBoxes = (boxes: PoolBox[]) => boxes.filter((b) => b.status !== "claimed");

/** Why the settings can't be used yet, or "". */
export function poolSettingsProblem(s: PoolSettings) {
  if (!s.dir) return "Set the paseo-boxes folder in Settings → Pool boxes.";
  if (!s.checkout) return "Set the checkout on the box in Settings → Pool boxes.";
  return "";
}

/** A job still running. */
export const jobRunning = (job: PoolJob | null | undefined) =>
  !!job && job.phase !== "done" && job.phase !== "failed";

/** What a job is doing now, in a few words. */
export function jobText(job: PoolJob) {
  const box = job.pool ?? "a pool box";
  switch (job.phase) {
    case "claiming":
      return `Claiming ${box}…`;
    case "waiting":
      return `Waiting for ${box} to come online…`;
    case "dispatching":
      return `Starting the agent on ${box}…`;
    case "releasing":
      return `Releasing ${box}…`;
    case "done":
      return job.kind === "release" ? `Released ${box}` : `Agent started on ${box}`;
    case "failed":
      return job.kind === "release"
        ? `Couldn't release ${box}${job.error ? `: ${job.error}` : ""}`
        : `Couldn't start the agent on ${box}${job.error ? `: ${job.error}` : ""}`;
  }
}

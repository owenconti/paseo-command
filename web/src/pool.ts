/**
 * Pool boxes: warm-pool Sprites the paseo-boxes scripts on this Mac claim and
 * release (`claim.sh --any`, `release.sh pool-N`). New agent's "New pool box"
 * claims one, waits for its Paseo host to come online and dispatches the agent
 * into its checkout; the Hosts tab releases a claimed one. Pure: shared by the
 * server (`web/server/pool.ts`) and the page (`poolStore.ts`).
 *
 * paseo-boxes is the source of truth: the boxes come from its
 * `pool-state.json`, the checkout from `BOX_REPO_PATH` in its `config.env`.
 * The app keeps only where that folder is.
 */

/** Where the paseo-boxes folder is on this Mac ("" until set in Settings). */
export type PoolSettings = { dir: string };
export const DEFAULT_POOL: PoolSettings = { dir: "" };

/** `settings.json`'s `pool`, checked; anything else is unset. */
export function poolSettings(value: unknown): PoolSettings {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { dir: typeof raw.dir === "string" && !poolDirProblem(raw.dir) ? raw.dir.trim() : DEFAULT_POOL.dir };
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

/**
 * Why `BOX_REPO_PATH` can't be the agent's checkout, or "": an absolute path
 * on the box. A `~` path isn't taken: nothing here knows the box's home, and
 * a Mac's shell would expand it to the Mac's.
 */
export function poolCheckoutProblem(value: string) {
  const v = value.trim();
  if (!v) return "config.env has no BOX_REPO_PATH.";
  if (v.length > 500 || /[\0\n\r\\]/.test(value)) return "BOX_REPO_PATH in config.env can't be used.";
  if (!v.startsWith("/")) return "BOX_REPO_PATH in config.env must be an absolute path on the box (not ~/…).";
  if (v.split("/").includes("..")) return "BOX_REPO_PATH in config.env can't contain “..”.";
  return "";
}

/** A value from a `KEY=value` env file (`config.env`), as bash would read a plain assignment. */
export function envValue(text: string, key: string) {
  let found: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    found = v;
  }
  return found;
}

/** A pool box as `pool-state.json` records it (no secrets are read). */
export type PoolBox = {
  /** `pool-N`, also its Paseo host label. */
  id: string;
  label: string;
  /**
   * As paseo-boxes keeps it: `provisioning` while provision.sh or rotate.sh rebuilds it, `failed` when that failed;
   * claim.sh refuses both (and `--any` skips them).
   */
  status: "claimed" | "idle" | "provisioning" | "failed";
  claimedAt?: string;
  /** `pool-N.<BASE_DOMAIN>`: the box's app URLs (tailnet only) are under it. */
  baseDomain?: string;
};

/** A claim (then dispatch) or a release, one at a time. */
export type PoolJob = {
  id: string;
  kind: "claim" | "release";
  /** The box, once the script names it (a claim picks the first idle one, or wakes the one named). */
  pool?: string;
  /** Waking a named box (its host was asleep), rather than claiming any idle one. */
  wake?: boolean;
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
  /** `BOX_REPO_PATH` from config.env, where a box's agent works ("" when it can't be read). */
  checkout: string;
  /** The checkout's GitHub repository, `GITHUB_ORG/GITHUB_REPO` from config.env ("" when it doesn't say). */
  repo: string;
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
      const baseDomain =
        typeof b.base_domain === "string" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(b.base_domain) && b.base_domain.length <= 200
          ? b.base_domain.toLowerCase()
          : undefined;
      return {
        id,
        label,
        status: (b.status === "claimed" || b.status === "provisioning" || b.status === "failed"
          ? b.status
          : "idle") as PoolBox["status"],
        ...(claimedAt ? { claimedAt } : {}),
        ...(baseDomain ? { baseDomain } : {}),
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

/**
 * The pool box a host is, claimed or not: its label is a box's. A released box is paused (its daemon down until
 * it's claimed), so its host shows offline; New agent can still pick it and wakes it (`claim.sh pool-N`).
 */
export function boxOfLabel(boxes: PoolBox[], label: string | undefined) {
  return label ? boxes.find((b) => b.label === label) : undefined;
}

/** The box a host is, while it's claimed: its label is a claimed box's. */
export function claimedBoxOf(boxes: PoolBox[], label: string | undefined) {
  return label ? boxes.find((b) => b.status === "claimed" && b.label === label) : undefined;
}

export const idleBoxes = (boxes: PoolBox[]) => boxes.filter((b) => b.status === "idle");
/** A box claim.sh will take by name: idle, or claimed (it confirms it's ready); never one being or failed to be provisioned. */
export const claimable = (b: PoolBox) => b.status === "idle" || b.status === "claimed";
/** Why claim.sh won't take a box, or "". */
export function unclaimableWhy(b: PoolBox) {
  if (b.status === "provisioning") return `${b.label} is being provisioned`;
  if (b.status === "failed") return `${b.label} failed its last provision (re-run provision.sh)`;
  return "";
}

/** Why the settings can't be used yet, or "". */
export function poolSettingsProblem(s: PoolSettings) {
  return s.dir ? "" : "Set the paseo-boxes folder in Settings → Pool boxes.";
}

/**
 * What a pool box's agent is told about where it is, beside the app's
 * standing prompt: the box, its checkout, how to start the app (the claim
 * leaves it down) and the app's URLs.
 */
export function poolBoxPrompt(box: Pick<PoolBox, "id" | "baseDomain">, checkout: string) {
  const urls = box.baseDomain
    ? ` Its URLs, reachable only on the tailnet: https://control-panel.${box.baseDomain}/login and https://e2e.${box.baseDomain}/login.`
    : "";
  return [
    "<paseo_pool_box>",
    `You are on ${box.id}, a warm-pool Sprite claimed for you alone; your checkout is ${checkout}.`,
    "The app stack (Docker compose, the database, Octane) is not running after the claim. Start it with `paseo-box-up` only when you need the running app or a database (`paseo-box-up --reseed` also reseeds the e2e data); it takes a few minutes. ~/PASEO-BOX.md on the box explains." +
      urls,
    "Push work you want to keep: releasing the box restores it and discards everything changed on it.",
    "</paseo_pool_box>",
  ].join("\n");
}

/** A job still running. */
export const jobRunning = (job: PoolJob | null | undefined) =>
  !!job && job.phase !== "done" && job.phase !== "failed";

/** What a job is doing now, in a few words. */
export function jobText(job: PoolJob) {
  const box = job.pool ?? "a pool box";
  switch (job.phase) {
    case "claiming":
      return job.wake ? `Waking ${box}…` : `Claiming ${box}…`;
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

/**
 * A pool box's checkout as its daemon reports it (`getCheckoutStatus`), read
 * before archiving a workspace on the box: releasing restores the box, so
 * whatever isn't pushed goes with it. `known` false when it couldn't be read.
 */
export type PoolCheckout = {
  known: boolean;
  branch?: string;
  /** Uncommitted changes. */
  dirty?: boolean;
  /** Commits not on the remote: ahead of its upstream, else (never pushed) ahead of its base. */
  unpushed?: number;
  error?: string;
};

/** The daemon's checkout status, read for what releasing would lose. */
export function poolCheckoutOf(status: unknown, branch?: string): PoolCheckout {
  const s = status && typeof status === "object" ? (status as Record<string, unknown>) : null;
  const named = typeof s?.currentBranch === "string" && s.currentBranch ? s.currentBranch : branch;
  const base = named ? { branch: named } : {};
  if (!s) return { known: false, ...base, error: "its daemon didn't answer" };
  const error = s.error && typeof s.error === "object" ? (s.error as { message?: unknown }).message : undefined;
  if (error) return { known: false, ...base, error: String(error).slice(0, 200) };
  if (s.isGit !== true) return { known: false, ...base, error: "it isn't a git checkout" };
  const ahead = (s.aheadBehind as { ahead?: unknown } | null)?.ahead;
  const unpushed =
    typeof s.aheadOfOrigin === "number"
      ? s.aheadOfOrigin
      : // No upstream: the branch was never pushed, so its commits past the base are only here.
        typeof ahead === "number"
        ? ahead
        : 0;
  return { known: true, ...base, dirty: s.isDirty === true, unpushed: Math.max(0, unpushed) };
}

/** Releasing loses nothing only when the checkout was read and has nothing uncommitted or unpushed. */
export const checkoutClean = (c: PoolCheckout | null | undefined) =>
  !!c?.known && !c.dirty && !c.unpushed;

/** What releasing `box` after archiving would lose, as the confirmation says it. */
export function releaseWarning(label: string, c: PoolCheckout | null | undefined) {
  const where = c?.branch ? ` in ${c.branch}` : "";
  if (!c?.known)
    return `Releasing ${label} discards anything unpushed${where}: its changes couldn't be checked${c?.error ? ` (${c.error})` : ""}.`;
  const parts = [
    c.dirty ? "uncommitted changes" : "",
    c.unpushed ? `${c.unpushed} unpushed ${c.unpushed === 1 ? "commit" : "commits"}` : "",
  ].filter(Boolean);
  return `Releasing ${label} discards unpushed changes${where} (${parts.join(" and ")}).`;
}

/** What else keeps a box busy after a workspace on it was archived. */
export type PoolRemaining = { workspaces: number; agents: number };
export const boxIdle = (r: PoolRemaining) => r.workspaces === 0 && r.agents === 0;

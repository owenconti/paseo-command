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
  status: "claimed" | "idle";
  claimedAt?: string;
  /** `pool-N.<BASE_DOMAIN>`: the box's app URLs (tailnet only) are under it. */
  baseDomain?: string;
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
  /** `BOX_REPO_PATH` from config.env, where a box's agent works ("" when it can't be read). */
  checkout: string;
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
        status: b.status === "claimed" ? ("claimed" as const) : ("idle" as const),
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

/** The box a host is, while it's claimed: its label is a claimed box's. */
export function claimedBoxOf(boxes: PoolBox[], label: string | undefined) {
  return label ? boxes.find((b) => b.status === "claimed" && b.label === label) : undefined;
}

export const idleBoxes = (boxes: PoolBox[]) => boxes.filter((b) => b.status !== "claimed");

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

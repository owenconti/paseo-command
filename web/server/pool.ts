/**
 * Pool boxes (src/pool.ts): claim a warm-pool Sprite with the paseo-boxes
 * scripts on this Mac, wait for its Paseo host to come online, then dispatch
 * the agent New agent described into its checkout; or release a claimed box.
 *
 * - Opt-in (`integrations.pool` in settings.json); the scripts' folder and the
 *   box's checkout are `pool` there. Nothing else is configurable: the server
 *   runs `claim.sh --any` and `release.sh pool-N` only, never a shell.
 * - One job at a time (claims would race for the same idle box). The page
 *   polls `GET /api/pool` for it.
 * - The scripts never print secrets; their output is redacted all the same,
 *   and only their step and outcome lines are kept.
 * - `pool-state.json` is read for each box's id, label and claimed state
 *   only. It is never written here (the scripts own it).
 *
 * Tests replace `POOL_DEPS` (no script, daemon or Sprite is reached).
 */
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  claimedPool,
  idleBoxes,
  jobRunning,
  poolBoxes,
  poolSettings,
  poolSettingsProblem,
  progressLine,
  scriptError,
  POOL_ID,
  type PoolJob,
  type PoolSettings,
  type PoolStatus,
} from "../src/pool";
import { checkPoolDispatch, poolDispatch, type Changed } from "./api/commands";
import { cliEnv } from "./api/cli";
import { HostOffline, hostRegistry, resolveHost, type Remote } from "./api/hosts";
import { bodyOf, type replier } from "./api/http";
import { settleChange } from "./api/settle";
import { startLive } from "./api/stream";
import type { Body } from "./api/validate";
import { integrationEnabled } from "./integrations";
import { run, RunError } from "./proc";
import { redactText } from "./redact";
import { readSettings } from "./settings";
import { errorText } from "./wire";

export const POOL = {
  /** A claim restores a checkpoint at worst (~1–2 min); generous. */
  claimMs: 8 * 60_000,
  /** A release always restores one. */
  releaseMs: 12 * 60_000,
  /** After the claim, for the box's host to be online in the registry. */
  onlineMs: 3 * 60_000,
  /** After that, for its daemon to answer the dispatch's first read. */
  readyMs: 90_000,
  pollMs: 2000,
  maxSteps: 40,
};

/** What a job reaches; tests replace each. */
export const POOL_DEPS = {
  /** Run a script, each output line to `onLine`; rejects (a `RunError`) on failure. */
  runScript(
    file: string,
    args: string[],
    cwd: string,
    timeout: number,
    onLine: (line: string) => void,
  ): Promise<{ stdout: string; stderr: string }> {
    let partial = "";
    const { result } = run(file, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: cliEnv(),
      cwd,
      onStdout: (chunk) => {
        const lines = (partial + chunk.toString("utf8")).split("\n");
        partial = lines.pop() ?? "";
        lines.forEach(onLine);
      },
    });
    return result.finally(() => {
      if (partial) onLine(partial);
    });
  },
  /** The box's host, once the registry says it's online. */
  async online(label: string, deadline: number): Promise<Remote> {
    let last: unknown;
    for (;;) {
      const registry = await hostRegistry().catch(() => undefined);
      const row = registry?.hosts.find((h) => !h.local && h.label === label);
      if (row) {
        try {
          return (await resolveHost(row.serverId, "write"))!;
        } catch (error) {
          last = error;
        }
      }
      if (Date.now() >= deadline)
        throw new Error(
          row
            ? `${label} didn't come online in time${last instanceof HostOffline ? "" : last ? ` (${errorText(last)})` : ""}.`
            : `No Paseo host is labelled ${label}.`,
        );
      await sleep(POOL.pollMs);
    }
  },
  /** Dispatch into the box; may be asked again while nothing was issued. */
  dispatch: (body: Body, host: Remote, checkout: string, mark: (c: Changed) => void) =>
    poolDispatch(body, host, checkout, mark),
  settle: settleChange,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `~/…` on this Mac. */
const expand = (dir: string) => (dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir);

function settings(): PoolSettings {
  return poolSettings(readSettings()?.pool);
}

/** The scripts' folder checked: its scripts runnable and its state readable. */
function scripts(s: PoolSettings) {
  const unset = poolSettingsProblem(s);
  if (unset) return { dir: "", problem: unset };
  const dir = expand(s.dir);
  try {
    if (!statSync(dir).isDirectory()) throw new Error();
  } catch {
    return { dir, problem: `${s.dir} isn't a folder on this Mac.` };
  }
  for (const name of ["claim.sh", "release.sh"])
    try {
      accessSync(join(dir, name), constants.X_OK);
    } catch {
      return { dir, problem: `${name} isn't in ${s.dir}, or can't be run.` };
    }
  try {
    return { dir, boxes: poolBoxes(JSON.parse(readFileSync(join(dir, "pool-state.json"), "utf8"))), problem: "" };
  } catch {
    return { dir, problem: `pool-state.json in ${s.dir} can't be read.` };
  }
}

let current: PoolJob | null = null;
let counter = 0;

/** For tests: forget the last job. */
export function resetPool() {
  current = null;
}

const copy = (job: PoolJob | null) => (job ? { ...job, steps: [...job.steps] } : null);

export function poolStatus(): PoolStatus {
  const s = settings();
  if (!integrationEnabled("pool")) return { enabled: false, problem: "", settings: s, boxes: [], job: copy(current) };
  const found = scripts(s);
  return { enabled: true, problem: found.problem, settings: s, boxes: found.boxes ?? [], job: copy(current) };
}

function ready() {
  if (!integrationEnabled("pool")) throw new Error("Turn on Pool boxes in Settings first.");
  if (jobRunning(current))
    throw new Error(
      current!.kind === "claim" ? "A pool box is being claimed already." : "A pool box is being released.",
    );
  const s = settings();
  const found = scripts(s);
  if (found.problem) throw new Error(found.problem);
  return { s, dir: found.dir, boxes: found.boxes! };
}

function begin(kind: PoolJob["kind"], phase: PoolJob["phase"], pool?: string): PoolJob {
  current = {
    id: `pj${Date.now().toString(36)}${(++counter).toString(36)}`,
    kind,
    phase,
    steps: [],
    startedAt: Date.now(),
    ...(pool ? { pool } : {}),
  };
  return current;
}

/** A line of the script's output: which box, and its progress. */
function follow(job: PoolJob) {
  return (raw: string) => {
    const line = redactText(raw);
    const box = job.kind === "claim" ? claimedPool(line) : undefined;
    if (box && !job.pool) job.pool = box;
    const step = progressLine(line);
    if (step && job.steps[job.steps.length - 1] !== step) {
      job.steps.push(step);
      if (job.steps.length > POOL.maxSteps) job.steps.splice(0, job.steps.length - POOL.maxSteps);
    }
  };
}

function failed(job: PoolJob, error: unknown, script?: string) {
  let message: string;
  if (error instanceof RunError) {
    const said = scriptError(redactText(`${error.stdout}\n${error.stderr}`));
    message = said || (error.timedOut ? `${script} took too long and was stopped.` : `${script} failed.`);
  } else message = errorText(error);
  job.phase = "failed";
  job.error = message.slice(0, 400);
  job.endedAt = Date.now();
}

/**
 * `POST /api/pool/claim`: New agent's first message for a new pool box.
 * Answers at once with the job; the claim, the wait and the dispatch go on.
 */
export function startClaim(body: Body) {
  const { s, dir, boxes } = ready();
  checkPoolDispatch(body, s.checkout);
  if (!idleBoxes(boxes).length) throw new Error("Every pool box is claimed. Release one first.");
  const job = begin("claim", "claiming");
  void claim(job, body, dir, s.checkout);
  return copy(job);
}

async function claim(job: PoolJob, body: Body, dir: string, checkout: string) {
  try {
    await POOL_DEPS.runScript(join(dir, "claim.sh"), ["--any"], dir, POOL.claimMs, follow(job));
  } catch (error) {
    return failed(job, error, "claim.sh");
  }
  if (!job.pool) return failed(job, new Error("The claim didn't say which pool box it claimed."));
  const label = boxLabel(dir, job.pool);
  try {
    job.phase = "waiting";
    const host = await POOL_DEPS.online(label, Date.now() + POOL.onlineMs);
    job.phase = "dispatching";
    job.host = host.serverId;
    const until = Date.now() + POOL.readyMs;
    for (;;) {
      let changed: Changed | undefined;
      try {
        const result = await POOL_DEPS.dispatch(body, host, checkout, (c) => (changed = c));
        job.agentId = typeof result?.agentId === "string" ? result.agentId : undefined;
        break;
      } catch (error) {
        // Asked again only while nothing was sent (the daemon not answering yet).
        if (changed || Date.now() >= until) throw error;
        await sleep(POOL.pollMs);
      } finally {
        await POOL_DEPS.settle(changed).catch(() => {});
      }
    }
    job.phase = "done";
    job.endedAt = Date.now();
  } catch (error) {
    failed(job, error);
  }
}

/** The box's Paseo host label, as `pool-state.json` names it (else its id). */
function boxLabel(dir: string, pool: string) {
  try {
    return (
      poolBoxes(JSON.parse(readFileSync(join(dir, "pool-state.json"), "utf8"))).find((b) => b.id === pool)?.label ??
      pool
    );
  } catch {
    return pool;
  }
}

/** `POST /api/pool/release`: run `release.sh` for a claimed box. */
export function startRelease(body: Body) {
  const pool = typeof body.pool === "string" ? body.pool : "";
  if (!POOL_ID.test(pool)) throw new Error("Invalid pool box");
  const { dir, boxes } = ready();
  const box = boxes.find((b) => b.id === pool);
  if (!box) throw new Error(`${pool} isn't in pool-state.json.`);
  if (box.status !== "claimed") throw new Error(`${pool} isn't claimed.`);
  const job = begin("release", "releasing", pool);
  void (async () => {
    try {
      await POOL_DEPS.runScript(join(dir, "release.sh"), [pool], dir, POOL.releaseMs, follow(job));
      job.phase = "done";
      job.endedAt = Date.now();
    } catch (error) {
      failed(job, error, "release.sh");
    }
  })();
  return copy(job);
}

/** `/api/pool…`. */
export async function poolRoute(
  req: IncomingMessage,
  url: URL,
  reply: ReturnType<typeof replier>,
) {
  try {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (url.pathname === "/api/pool") {
      if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
      return reply(200, poolStatus());
    }
    const action = url.pathname.slice("/api/pool/".length);
    if (action !== "claim" && action !== "release") return reply(404, { error: "Unknown endpoint" });
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    // A claim carries New agent's first message, pasted screenshots too.
    const body = await bodyOf(req, action === "claim" ? 30 * 1024 * 1024 : 4000);
    // The registry the wait and the dispatch read follows the local daemon.
    if (action === "claim") startLive();
    return reply(200, { job: action === "claim" ? startClaim(body) : startRelease(body) });
  } catch (error) {
    return reply(400, { error: errorText(error) });
  }
}

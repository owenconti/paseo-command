/**
 * Pool boxes (src/pool.ts): claim a warm-pool Sprite with the paseo-boxes
 * scripts on this Mac, wait for its Paseo host to come online, then dispatch
 * the agent New agent described into its checkout; or release a claimed box.
 *
 * - Opt-in (`integrations.pool` in settings.json); the scripts' folder is
 *   `pool.dir` there. Everything else is paseo-boxes' own: the boxes from its
 *   `pool-state.json`, the checkout from `BOX_REPO_PATH` in its `config.env`
 *   (never secrets.env or private/). The server runs `claim.sh --any` and
 *   `release.sh pool-N` only, never a shell, and never provision-named.sh.
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
  boxIdle,
  claimedPool,
  envValue,
  poolCheckoutOf,
  idleBoxes,
  unclaimableWhy,
  jobRunning,
  poolBoxPrompt,
  poolBoxes,
  poolCheckoutProblem,
  poolSettings,
  poolSettingsProblem,
  progressLine,
  scriptError,
  POOL_ID,
  type PoolBox,
  type PoolCheckout,
  type PoolJob,
  type PoolRemaining,
  type PoolSettings,
  type PoolStatus,
} from "../src/pool";
import { checkPoolDispatch, poolDispatch, type Changed } from "./api/commands";
import { cliEnv } from "./api/cli";
import { HostOffline, hostRegistry, resolveHost, sdk, timed, type Remote } from "./api/hosts";
import { currentWorkspaces } from "./api/reads";
import { id } from "./api/validate";
import { unarchivedAgents } from "./live/hostRows";
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
  /** After claim.sh exits 0, for the box's host to be online (Paseo binds ~16–19 s into a claim). */
  onlineMs: 90_000,
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
            ? `${label} was claimed but its Paseo host didn't come online within ${Math.round(POOL.onlineMs / 1000)} s${last instanceof HostOffline ? "" : last ? ` (${errorText(last)})` : ""}. Check it with status.sh.`
            : `No Paseo host is labelled ${label}.`,
        );
      await sleep(POOL.pollMs);
    }
  },
  /** Dispatch into the box; may be asked again while nothing was issued. */
  dispatch: (body: Body, host: Remote, checkout: string, mark: (c: Changed) => void, prompt: string) =>
    poolDispatch(body, host, checkout, mark, prompt),
  settle: settleChange,
  /** A registered host's label, from the registry (the host needn't answer). */
  async hostLabel(serverId: string) {
    const registry = await hostRegistry();
    return registry.hosts.find((h) => !h.local && h.serverId === serverId)?.label;
  },
  /** A workspace's checkout on the box, read for what releasing would lose. */
  async checkout(serverId: string, workspaceId: string): Promise<PoolCheckout> {
    try {
      const host = (await resolveHost(serverId, "read"))!;
      const ws = (await currentWorkspaces(host)).find((w) => w.workspaceId === workspaceId) as
        | { cwd?: string; branch?: string }
        | undefined;
      if (!ws?.cwd) return { known: false, error: "the workspace wasn't found on the box" };
      const client = await sdk(host);
      return poolCheckoutOf(await timed(client.getCheckoutStatus(ws.cwd), undefined, client), ws.branch);
    } catch (error) {
      return { known: false, error: errorText(error).slice(0, 200) };
    }
  },
  /** What's still active on the box's host besides the archived workspace and its agents. */
  async remaining(serverId: string, except: { workspaceId: string; cwd?: string }): Promise<PoolRemaining> {
    const host = (await resolveHost(serverId, "write"))!;
    const client = await sdk(host);
    const [workspaces, agents] = await Promise.all([
      currentWorkspaces(host),
      timed(unarchivedAgents(client), undefined, client),
    ]);
    const outside = (a: { workspaceId?: string | null; cwd?: string | null }) =>
      a.workspaceId !== except.workspaceId && !(except.cwd && a.cwd === except.cwd);
    return {
      workspaces: workspaces.filter((w) => w.workspaceId !== except.workspaceId).length,
      agents: agents.filter((e) => outside(e.agent as { workspaceId?: string | null; cwd?: string | null })).length,
    };
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `~/…` on this Mac. */
const expand = (dir: string) => (dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir);

function settings(): PoolSettings {
  return poolSettings(readSettings()?.pool);
}

type Found = { dir: string; problem: string; boxes?: PoolBox[]; checkout?: string; repo?: string };
/** The scripts' folder checked: its scripts runnable, its state and config readable. */
function scripts(s: PoolSettings): Found {
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
  let boxes: PoolBox[];
  try {
    boxes = poolBoxes(JSON.parse(readFileSync(join(dir, "pool-state.json"), "utf8")));
  } catch {
    return { dir, problem: `pool-state.json in ${s.dir} can't be read.` };
  }
  let config: string;
  try {
    config = readFileSync(join(dir, "config.env"), "utf8");
  } catch {
    return { dir, boxes, problem: `config.env in ${s.dir} can't be read (copy config.env.example to it).` };
  }
  const checkout = (envValue(config, "BOX_REPO_PATH") ?? "").trim();
  const bad = poolCheckoutProblem(checkout);
  if (bad) return { dir, boxes, problem: bad };
  const org = (envValue(config, "GITHUB_ORG") ?? "").trim();
  const name = (envValue(config, "GITHUB_REPO") ?? "").trim();
  const repo = /^[\w.-]+$/.test(org) && /^[\w.-]+$/.test(name) ? `${org}/${name}` : "";
  return { dir, boxes, checkout, repo, problem: "" };
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
  if (!integrationEnabled("pool"))
    return { enabled: false, problem: "", settings: s, checkout: "", repo: "", boxes: [], job: copy(current) };
  const found = scripts(s);
  return {
    enabled: true,
    problem: found.problem,
    settings: s,
    checkout: found.checkout ?? "",
    repo: found.repo ?? "",
    boxes: found.boxes ?? [],
    job: copy(current),
  };
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
  return { dir: found.dir, boxes: found.boxes!, checkout: found.checkout! };
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
 * `POST /api/pool/claim`: New agent's first message for a new pool box, or
 * (`pool`: `pool-N`) for a box whose host is asleep, which is woken by name
 * (`claim.sh pool-N`; claimed already, it just confirms it's ready).
 * Answers at once with the job; the claim, the wait and the dispatch go on.
 */
export function startClaim(input: Body) {
  const { pool: named, ...body } = input;
  const { dir, boxes, checkout } = ready();
  checkPoolDispatch(body, checkout);
  let wake: string | undefined;
  if (named !== undefined) {
    if (typeof named !== "string" || !POOL_ID.test(named)) throw new Error("Invalid pool box");
    const target = boxes.find((b) => b.id === named);
    if (!target) throw new Error(`${named} isn't in pool-state.json.`);
    const why = unclaimableWhy(target);
    if (why) throw new Error(`${why}; it can't be woken now.`);
    wake = named;
  } else if (!idleBoxes(boxes).length) throw new Error("Every pool box is claimed. Release one first.");
  const job = begin("claim", "claiming", wake);
  if (wake) job.wake = true;
  void claim(job, body, dir, checkout);
  return copy(job);
}

async function claim(job: PoolJob, body: Body, dir: string, checkout: string) {
  try {
    // Exits 0 once claimed, or when the box was claimed already (its claim marker there); 1 otherwise.
    const args = job.wake && job.pool ? [job.pool] : ["--any"];
    await POOL_DEPS.runScript(join(dir, "claim.sh"), args, dir, POOL.claimMs, follow(job));
  } catch (error) {
    return failed(job, error, "claim.sh");
  }
  if (!job.pool) return failed(job, new Error("The claim didn't say which pool box it claimed."));
  const box = boxOf(dir, job.pool);
  const label = box.label;
  const prompt = poolBoxPrompt(box, checkout);
  try {
    job.phase = "waiting";
    const host = await POOL_DEPS.online(label, Date.now() + POOL.onlineMs);
    job.phase = "dispatching";
    job.host = host.serverId;
    const until = Date.now() + POOL.readyMs;
    for (;;) {
      let changed: Changed | undefined;
      try {
        const result = await POOL_DEPS.dispatch(body, host, checkout, (c) => (changed = c), prompt);
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

/** The box as `pool-state.json` has it after the claim (its label is its Paseo host's). */
function boxOf(dir: string, pool: string): PoolBox {
  try {
    const found = poolBoxes(JSON.parse(readFileSync(join(dir, "pool-state.json"), "utf8"))).find((b) => b.id === pool);
    if (found) return found;
  } catch {
    // The claim's own word for the box stands.
  }
  return { id: pool, label: pool, status: "claimed" };
}

/** The claimed box a registered host is (its label is the box's), else null: other hosts are never pool boxes. */
async function boxOfHost(serverId: string): Promise<PoolBox | null> {
  if (!integrationEnabled("pool")) return null;
  const found = scripts(settings());
  if (found.problem || !found.boxes) return null;
  const label = await POOL_DEPS.hostLabel(serverId).catch(() => undefined);
  return (label && found.boxes.find((b) => b.status === "claimed" && b.label === label)) || null;
}

/**
 * `POST /api/pool/before-archive {host, workspace}`: before a workspace on a
 * claimed pool box is archived (a worktree may go with it), what releasing
 * the box would lose. `{box: null}` for any other host.
 */
export async function beforeArchive(body: Body) {
  const serverId = id(body.host);
  const workspaceId = id(body.workspace);
  const box = await boxOfHost(serverId);
  if (!box) return { box: null };
  return { box, checkout: await POOL_DEPS.checkout(serverId, workspaceId) };
}

/**
 * `POST /api/pool/after-archive {host, workspace, cwd?}`: once it's archived,
 * what else is still active on the box's host. `{box: null}` for any other host.
 */
export async function afterArchive(body: Body) {
  const serverId = id(body.host);
  const workspaceId = id(body.workspace);
  const cwd = typeof body.cwd === "string" && body.cwd.length <= 1000 ? body.cwd : undefined;
  const box = await boxOfHost(serverId);
  if (!box) return { box: null };
  return { box, remaining: await POOL_DEPS.remaining(serverId, { workspaceId, cwd }) };
}

/**
 * `POST /api/pool/release {pool, host?, workspace?}`: run `release.sh` for a
 * claimed box. Asked after an archive (`host`, the box's host, and the archived
 * `workspace`), the box's host is checked again first: released only if it is
 * that box's and nothing else is active on it.
 */
export async function releaseRoute(body: Body) {
  if (body.host === undefined) return startRelease(body);
  const pool = typeof body.pool === "string" ? body.pool : "";
  if (!POOL_ID.test(pool)) throw new Error("Invalid pool box");
  const serverId = id(body.host);
  const box = await boxOfHost(serverId);
  if (box?.id !== pool) throw new Error(`That host isn't ${pool}'s.`);
  const left = await POOL_DEPS.remaining(serverId, { workspaceId: id(body.workspace) });
  if (!boxIdle(left))
    throw new Error(`${box.label} still has ${left.workspaces} active ${left.workspaces === 1 ? "workspace" : "workspaces"} and ${left.agents} ${left.agents === 1 ? "agent" : "agents"}; it stays claimed.`);
  return startRelease({ pool });
}

/** `POST /api/pool/release {pool}`: run `release.sh` for a claimed box. */
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
    if (!["claim", "release", "before-archive", "after-archive"].includes(action))
      return reply(404, { error: "Unknown endpoint" });
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    // A claim carries New agent's first message, pasted screenshots too.
    const body = await bodyOf(req, action === "claim" ? 30 * 1024 * 1024 : 4000);
    // The registry the wait and the dispatch read follows the local daemon.
    if (action !== "release" || body.host !== undefined) startLive();
    if (action === "before-archive") return reply(200, await beforeArchive(body));
    if (action === "after-archive") return reply(200, await afterArchive(body));
    return reply(200, { job: action === "claim" ? startClaim(body) : await releaseRoute(body) });
  } catch (error) {
    return reply(400, { error: errorText(error) });
  }
}

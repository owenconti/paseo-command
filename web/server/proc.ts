import { execFile, spawn } from "node:child_process";
import { errorCode } from "./errors";

/**
 * Run a command in its own process group, so a timeout takes down everything
 * it started (an `ssh` transport, helpers), not just the direct child.
 *
 * - On timeout the group gets SIGTERM, then SIGKILL once the grace period is
 *   over, so a CLI that cleans up on SIGTERM gets to finish doing so.
 * - The call settles on a deadline, never on its pipes closing: after a
 *   timeout it settles within grace + `settleMs`; after a normal exit,
 *   leftovers get `drainMs` to let go of the output. Either way the streams
 *   are then destroyed.
 * - Output is collected as bytes and decoded once, so multi-byte characters
 *   split across writes survive.
 *
 * Limitation: a descendant that deliberately leaves the process group
 * (setsid, daemonising) is out of reach; nothing here can identify it
 * safely. The Paseo CLI and ssh don't do that. Such a process can't hold a
 * call open, though: the deadlines above don't wait for it.
 *
 * Groups still running when the server stops are stopped with it: through
 * the dev and preview servers' own close (see `stopAll`, which they await),
 * on a signal nothing else handles, and as a last resort on process exit.
 * That cleanup is installed once per process, however often this module is
 * reloaded.
 */
export type Run = {
  stdout: string;
  stderr: string;
};
export class RunError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly code: string | number | null,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

export const PROC = {
  /** SIGTERM → SIGKILL grace. */
  graceMs: 1000,
  /** After the child exits, how long leftovers may hold its output open. */
  drainMs: 500,
  /** After a timeout, the call settles within grace + this, whatever happens. */
  settleMs: 500,
};

const windows = process.platform === "win32";

type Shared = {
  /** Running groups, by leader pid → their kill (SIGTERM, then SIGKILL). */
  groups: Map<number, () => Promise<void>>;
  /** Servers whose lifetime the process handlers follow. */
  hosts: Set<object>;
  installed: boolean;
  onExit: () => void;
  onSignal: Map<NodeJS.Signals, () => void>;
  stopping?: Promise<void>;
  /** Shutting down: no new CLI work is admitted. */
  closing: boolean;
};
// Module reloads (Vite restarts its config, tests import fresh copies) must
// share one registry and one set of process handlers.
const KEY = Symbol.for("paseo-command.proc");
const shared: Shared = ((globalThis as typeof globalThis & { [KEY]?: Shared })[
  KEY
] ??= {
  groups: new Map(),
  hosts: new Set(),
  installed: false,
  onExit: () => {},
  onSignal: new Map(),
  closing: false,
});
shared.closing ??= false;

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    if (windows) {
      if (signal === "SIGKILL" || signal === "SIGTERM")
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
    } else process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/** True while any process (including an unreaped one) is in the group. */
function alive(pid: number) {
  if (windows) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}
/** Resolves once the group has no members left, or after `ms`. */
async function gone(pid: number, ms: number) {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until)
    await new Promise((r) => setTimeout(r, 10));
}
/** SIGTERM, then SIGKILL after the grace period; resolves once it's gone. */
async function stopGroup(pid: number) {
  signalGroup(pid, "SIGTERM");
  await gone(pid, PROC.graceMs);
  signalGroup(pid, "SIGKILL");
  await gone(pid, 500);
}

/**
 * Stop every running group (SIGTERM, then SIGKILL after the grace period)
 * and wait until they're gone. Concurrent callers share one stop.
 *
 * `drain` (shutdown): keep going until no group is left, including any that
 * started while stopping, bounded by grace + 2s in total. Admission should
 * already be closed (`closeAdmission`), so nothing new can start.
 */
export function stopAll(options: { drain?: boolean } = {}): Promise<void> {
  const once = () =>
    Promise.all([...shared.groups.values()].map((stop) => stop())).then(
      () => {},
    );
  if (!options.drain)
    return (shared.stopping ??= once().finally(
      () => (shared.stopping = undefined),
    ));
  return (async () => {
    const until = Date.now() + PROC.graceMs + 2000;
    while (shared.groups.size && Date.now() < until) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        once(),
        new Promise((r) => {
          timer = setTimeout(r, Math.max(0, until - Date.now()));
        }),
      ]);
      // The losing deadline mustn't keep the process alive after the drain.
      clearTimeout(timer);
    }
  })();
}

/**
 * Refuse new CLI work from now on: the process is shutting down. `run`
 * rejects without spawning anything.
 */
export function closeAdmission() {
  shared.closing = true;
}
/** Admission is closed (tests; the API answers 503 meanwhile). */
export function admissionClosed() {
  return shared.closing;
}
/** Re-open admission (tests). */
export function reopenAdmission() {
  shared.closing = false;
}

/**
 * Install process-level cleanup once. `exit` kills synchronously (the last
 * resort: nothing can be awaited there). A signal handler is prepended so it
 * runs before anyone else's: when another handler exists (Vite on SIGTERM)
 * it leaves shutdown to it, whose close awaits `stopAll`; when none does, it
 * stops the groups and then re-raises the signal for its default action.
 */
export function installCleanup() {
  if (shared.installed) return;
  shared.installed = true;
  shared.onExit = () => {
    for (const pid of shared.groups.keys()) signalGroup(pid, "SIGKILL");
  };
  process.on("exit", shared.onExit);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      shared.onSignal.delete(signal);
      const others = process.listenerCount(signal) > 0;
      // The process is going: admit nothing new, then drain every group.
      // Someone else may shut down too (and await this in the server's
      // close); we still start now, in case they exit without closing.
      closeAdmission();
      const stopping = stopAll({ drain: true });
      if (others) return;
      void stopping.then(() => {
        // Only the signal handlers go, so the re-raised signal takes its
        // default action; the exit safeguard stays until the very end.
        for (const [s, h] of shared.onSignal) process.off(s, h);
        shared.onSignal.clear();
        process.kill(process.pid, signal);
      });
    };
    shared.onSignal.set(signal, handler);
    process.prependOnceListener(signal, handler);
  }
}

/** Remove the process handlers (they come back with the next run). */
export function uninstallCleanup() {
  if (!shared.installed) return;
  shared.installed = false;
  process.off("exit", shared.onExit);
  for (const [signal, handler] of shared.onSignal) process.off(signal, handler);
  shared.onSignal.clear();
}

/**
 * Tie cleanup to a server's lifetime: when the last such server has closed,
 * the process handlers are removed.
 */
export function retainCleanup(host: object) {
  shared.hosts.add(host);
  installCleanup();
}
export function releaseCleanup(host: object) {
  shared.hosts.delete(host);
  // While shutting down, the exit safeguard stays until the process ends.
  if (!shared.hosts.size && !shared.groups.size && !shared.closing)
    uninstallCleanup();
}
/** True when `host` is the only server being followed (closing it ends the app). */
export function lastHost(host: object) {
  return shared.hosts.size === 1 && shared.hosts.has(host);
}

/** Process listeners this module currently has installed (tests). */
export function cleanupListeners() {
  return {
    installed: shared.installed,
    signals: [...shared.onSignal.keys()],
  };
}

/** Live process groups started here (tests use this to prove cleanup). */
export function activeGroups() {
  return [...shared.groups.keys()];
}

/**
 * Resolves with the output once the command exits 0; rejects on a non-zero
 * exit, spawn failure, oversized output, or timeout. `exited` settles once
 * the group is gone (bounded), for callers that bound concurrency. Neither
 * ever waits on pipes a stray process holds open.
 */
export function run(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
): { result: Promise<Run>; exited: Promise<void> } {
  if (shared.closing) {
    const refused = Promise.reject(
      new RunError("The server is shutting down.", "", "", null),
    );
    refused.catch(() => {});
    return { result: refused, exited: Promise.resolve() };
  }
  installCleanup();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(file, args, {
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
    });
  } catch (error) {
    // spawn throws Errors (bad arguments, an unusable cwd).
    const { message, code } = error as NodeJS.ErrnoException;
    const failed = Promise.reject(new RunError(message, "", "", code ?? null));
    return { result: failed, exited: Promise.resolve() };
  }
  const pid = child.pid;
  const out: Buffer[] = [],
    err: Buffer[] = [];
  let size = 0,
    settled = false,
    timedOut = false,
    overflow = false,
    finished = false;
  const text = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");
  let resolve!: (r: Run) => void, reject!: (e: RunError) => void;
  const result = new Promise<Run>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let markExited!: () => void;
  const exited = new Promise<void>((r) => (markExited = r));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(fn, ms);
    t.unref();
    timers.push(t);
  };
  const settle = (error?: RunError) => {
    if (settled) return;
    settled = true;
    if (error) reject(error);
    else resolve({ stdout: text(out), stderr: text(err) });
  };
  const fail = (message: string, code: string | number | null) =>
    new RunError(message, text(out), text(err), code, timedOut);
  const failure = () => fail(overflow ? "Output too large" : "Timed out", null);
  let stopping: Promise<void> | undefined;
  /** SIGTERM the group, SIGKILL it after the grace period; shared. */
  const stop = () => (stopping ??= pid ? stopGroup(pid) : Promise.resolve());
  if (pid) shared.groups.set(pid, stop);
  /** Stop listening, make sure the group goes, then resolve `exited`. */
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const t of timers) clearTimeout(t);
    // Whoever still holds the pipes can't keep us waiting, nor keep this
    // process alive.
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    void stop().then(() => {
      if (pid) shared.groups.delete(pid);
      // A timeout is reported once the group is down (bounded).
      if (timedOut || overflow) settle(failure());
      markExited();
    });
  };
  const kill = () => {
    void stop();
    // Settle on a deadline, never on pipe closure or the group's exit.
    later(PROC.graceMs + PROC.settleMs, () => {
      settle(failure());
      finish();
    });
  };
  const collect = (into: Buffer[]) => (chunk: Buffer) => {
    if (overflow || settled) return;
    size += chunk.length;
    if (size > options.maxBuffer) {
      overflow = true;
      kill();
      return;
    }
    into.push(chunk);
  };
  child.stdout!.on("data", collect(out));
  child.stderr!.on("data", collect(err));
  // Destroyed streams can report errors; they're not the command's result.
  child.stdout!.on("error", () => {});
  child.stderr!.on("error", () => {});
  later(options.timeout, () => {
    timedOut = true;
    kill();
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    settle(fail(error.message, error.code ?? null));
    finish();
  });
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;
  const report = () => {
    if (timedOut || overflow || !exit) return;
    settle(
      exit.code === 0
        ? undefined
        : fail(`Command failed (${exit.code ?? exit.signal})`, exit.code),
    );
  };
  child.on("exit", (code, signal) => {
    exit = { code, signal };
    // Leftovers may still hold the pipes open; give them `drainMs`, then
    // report what was written and stop listening.
    later(PROC.drainMs, () => {
      report();
      finish();
    });
  });
  child.on("close", () => {
    report();
    finish();
  });
  return { result, exited };
}

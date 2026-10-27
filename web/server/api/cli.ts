import { homedir } from "node:os";
import { TUNING, scopeOf } from "../fleet";
import { errorCode } from "../errors";
import { run, type RunError } from "../proc";
import { redactText } from "../redact";

/** A daemon or CLI failure. `message` is safe to show; `detail` is redacted output for internal checks only. */
export class PaseoError extends Error {
  constructor(
    message: string,
    readonly detail = "",
    readonly timedOut = false,
  ) {
    super(message);
  }
}
/** A failed run's fields, whatever was thrown (as `error?.stderr` reads them). */
const runFields = (error: unknown) =>
  (error === null || error === undefined ? {} : Object(error)) as Partial<
    Pick<RunError, "stderr" | "stdout" | "timedOut">
  >;
const cliOutput = (error: unknown) =>
  redactText(
    `${runFields(error).stderr || ""}\n${runFields(error).stdout || ""}`,
  ).slice(0, 4000);
// A server started from inside an agent session inherits that agent's identity;
// the CLI would then attribute GUI commands to it and parent new agents under it.
export function cliEnv(env: NodeJS.ProcessEnv = process.env) {
  const clean = { ...env };
  delete clean.PASEO_AGENT_ID;
  delete clean.PASEO_AGENT_CWD;
  return clean;
}
// The CLI is used only where the SDK can't do the job (see README): finding
// the local daemon's address, and opening Paseo Desktop. Reads to one daemon
// start at most `perDaemon` CLI processes at a time; the rest queue, each
// daemon with its own slots, and a process that has run for `holdMs` gives
// its slot back while it finishes. Mutations never queue.
export const CLI_SLOTS = { perDaemon: 6, holdMs: 3000 };
const slots = new Map<string, { busy: number; queue: (() => void)[] }>();
async function slot(scope: string) {
  let s = slots.get(scope);
  if (!s) slots.set(scope, (s = { busy: 0, queue: [] }));
  if (s.busy >= CLI_SLOTS.perDaemon)
    await new Promise<void>((resolve) => s!.queue.push(resolve));
  s.busy++;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    clearTimeout(timer);
    s!.busy--;
    s!.queue.shift()?.();
  };
  const timer = setTimeout(release, CLI_SLOTS.holdMs);
  timer.unref();
  return release;
}
/** Queued and running CLI reads per daemon scope (tests and diagnostics). */
export function cliLoad() {
  return Object.fromEntries(
    [...slots].map(([k, s]) => [
      k,
      { running: s.busy, queued: s.queue.length },
    ]),
  );
}
/** Let every queued CLI read go and forget the slots (tests). */
export function resetCliSlots() {
  for (const s of slots.values()) for (const go of s.queue.splice(0)) go();
  slots.clear();
}
/**
 * Run the Paseo CLI without a shell, in its own process group (proc.ts).
 * `timeout` defaults to a read limit; `write` marks a command, which bypasses
 * the read slots.
 */
export async function paseo(
  args: string[],
  plain = false,
  target?: string,
  timeout = target ? TUNING.remoteReadMs : TUNING.localReadMs,
  write = false,
): Promise<unknown> {
  const cli = process.env.PASEO_COMMAND_CLI || "paseo";
  const jsonArgs = [...(target ? ["--host", target] : []), ...args];
  jsonArgs.splice(
    jsonArgs.includes("--") ? jsonArgs.indexOf("--") : jsonArgs.length,
    0,
    "--json",
  );
  const options = { timeout, maxBuffer: 8 * 1024 * 1024, env: cliEnv() };
  const failure = (error: unknown, message: string) =>
    runFields(error).timedOut
      ? new PaseoError(
          `Paseo command timed out after ${Math.round(timeout / 1000)}s.`,
          cliOutput(error),
          true,
        )
      : new PaseoError(message, cliOutput(error));
  const release = write ? () => {} : await slot(scopeOf(target));
  const attempt = async (file: string) => {
    const { result, exited } = run(file, jsonArgs, options);
    // The slot is held until the whole process group is gone.
    void exited.then(release, release);
    return (await result).stdout;
  };
  let stdout: string;
  try {
    stdout = await attempt(cli);
  } catch (error) {
    if (errorCode(error) === "ENOENT" && cli === "paseo") {
      try {
        const again = write ? () => {} : await slot(scopeOf(target));
        const { result, exited } = run(
          `${homedir()}/.local/bin/paseo`,
          jsonArgs,
          options,
        );
        void exited.then(again, again);
        stdout = (await result).stdout;
      } catch (fallbackError) {
        throw failure(
          fallbackError,
          "Paseo CLI is unavailable or the daemon is unreachable.",
        );
      }
    } else
      throw failure(
        error,
        "Paseo command failed. Check that the daemon is reachable and the request is valid.",
      );
  }
  if (plain) {
    stdout = redactText(stdout);
    return { lines: stdout.replace(/\x1b\[[0-9;]*m/g, "").split("\n") };
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Paseo returned an unexpected response.");
  }
}

/**
 * Paseo Command over Tailscale (the user's ask; the release app only, and only for the Mac owner's own Tailscale
 * login, the user's calls). Off by default: Settings → Tailscale turns it on (`tailnet.enabled` in settings.json),
 * which has Tailscale serve the app tailnet-only over HTTPS (`tailscale serve --bg --https=4310
 * http://127.0.0.1:<app port>`, so `https://<this Mac>.<tailnet>.ts.net:4310`), and off again (`… --https=4310 off`).
 *
 * The app's server still listens on 127.0.0.1 only; Tailscale's proxy reaches it there. A request it forwards
 * carries the Host it was asked for and Tailscale's identity headers (`Tailscale-User-Login`, set by tailscaled,
 * which strips any a client sent). `tailnetOrigin` admits one only while this is on, for this Mac's Tailscale name
 * and port, from the login this Mac's Tailscale is signed in as; never a tagged device's or a shared user's. A
 * request that looks forwarded (`forwarded`) is never taken for a local one.
 */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { readSettings, writeSettings } from "./settings";

type Headers = Record<string, string | string[] | undefined>;

export const TAILNET = {
  /** The port on the tailnet. */
  port: 4310,
  /** Runs the Tailscale CLI (tests fake it). */
  run: (args: string[]) => runTailscale(args),
  /** How often this Mac's Tailscale name and login are read again while it's on. */
  refreshMs: 60_000,
};

/** Only the release app offers it (`PASEO_COMMAND_FLAVOR`, set by the app's ServerManager). */
export const tailnetAvailable = () => process.env.PASEO_COMMAND_FLAVOR === "release";

const CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
];
function tailscaleBinary() {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, "tailscale"));
  for (const file of [...onPath, ...CANDIDATES])
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not there.
    }
  return null;
}

function runTailscale(args: string[]): Promise<string> {
  const bin = tailscaleBinary();
  if (!bin) return Promise.reject(new Error("Tailscale isn't installed on this Mac."));
  return new Promise((done, fail) =>
    execFile(bin, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) fail(new Error(String(stderr || error.message).trim().split("\n")[0] || "Tailscale didn't answer."));
      else done(String(stdout));
    }),
  );
}

type Self = { dns: string; owner: string };
let self: Self | null = null;
let enabled = false;
let appPort = 0;
let problem = "";
let timer: ReturnType<typeof setInterval> | undefined;

/** This Mac's Tailscale name and the login it's signed in as. */
async function readSelf(): Promise<Self> {
  const status = JSON.parse(await TAILNET.run(["status", "--self", "--json"]));
  if (status?.BackendState && status.BackendState !== "Running")
    throw new Error(`Tailscale isn't connected (${status.BackendState}).`);
  const dns = String(status?.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase();
  const owner = status?.User?.[String(status?.Self?.UserID)]?.LoginName;
  if (!dns) throw new Error("Tailscale didn't say this Mac's name.");
  if (typeof owner !== "string" || !owner || /tagged/i.test(owner))
    throw new Error("This Mac is a tagged device on your tailnet: there's no login to let in.");
  return { dns, owner: owner.toLowerCase() };
}

/** Whether Tailscale serves the app on the port: ours, nothing, or something else there. */
async function serveState(dns: string): Promise<"on" | "off" | "other"> {
  const config = JSON.parse((await TAILNET.run(["serve", "status", "--json"])) || "{}");
  const site = config?.Web?.[`${dns}:${TAILNET.port}`];
  const proxy = site?.Handlers?.["/"]?.Proxy;
  if (proxy === `http://127.0.0.1:${appPort}`) return "on";
  return site || config?.TCP?.[String(TAILNET.port)] ? "other" : "off";
}

const settingOn = () => {
  const t = readSettings()?.tailnet as { enabled?: unknown } | undefined;
  return t?.enabled === true;
};

export type TailnetStatus = {
  available: boolean;
  /** Why it can't be offered here. */
  why?: string;
  enabled: boolean;
  /** The address on the tailnet, while on. */
  url?: string;
  /** Who it lets in. */
  owner?: string;
  /** What went wrong last. */
  error?: string;
};

export function tailnetStatus(): TailnetStatus {
  if (!tailnetAvailable())
    return { available: false, why: "Only the installed Paseo Command offers access over Tailscale.", enabled: false };
  return {
    available: true,
    enabled,
    ...(enabled && self ? { url: `https://${self.dns}:${TAILNET.port}`, owner: self.owner } : {}),
    ...(problem ? { error: problem } : {}),
  };
}

/** Turn it on (Tailscale serves the app, the setting saved) or off. */
export async function setTailnet(on: boolean): Promise<TailnetStatus> {
  if (!tailnetAvailable()) throw new Error("Only the installed Paseo Command offers access over Tailscale.");
  if (!appPort) throw new Error("The app's server isn't listening yet.");
  try {
    if (on) {
      const me = await readSelf();
      const state = await serveState(me.dns);
      if (state === "other")
        throw new Error(`Port ${TAILNET.port} on your tailnet is already served by something else (tailscale serve status).`);
      if (state === "off")
        await TAILNET.run(["serve", "--bg", "--yes", `--https=${TAILNET.port}`, `http://127.0.0.1:${appPort}`]);
      self = me;
      writeSettings({ tailnet: { enabled: true } });
      enabled = true;
      watch();
    } else {
      // Off first, so nothing is let in while Tailscale is asked.
      enabled = false;
      writeSettings({ tailnet: { enabled: false } });
      unwatch();
      const me = self ?? (await readSelf().catch(() => null));
      if (me && (await serveState(me.dns)) === "on") await TAILNET.run(["serve", `--https=${TAILNET.port}`, "off"]);
    }
    problem = "";
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    throw error;
  }
  return tailnetStatus();
}

function watch() {
  if (timer) return;
  timer = setInterval(() => {
    readSelf().then(
      (me) => {
        self = me;
        problem = "";
      },
      (error) => {
        // Unreadable, nobody is let in until it reads again.
        self = null;
        problem = error instanceof Error ? error.message : String(error);
      },
    );
  }, TAILNET.refreshMs);
  timer.unref?.();
}
function unwatch() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** As the app's server starts (`native.ts`): on again if it was left on. */
export async function startTailnet(port: number) {
  appPort = port;
  if (!tailnetAvailable() || !settingOn()) return;
  try {
    await setTailnet(true);
  } catch (error) {
    console.error("tailnet: couldn't serve the app on Tailscale:", error);
  }
}

/** Tests: forget what's known. */
export function resetTailnet(port = 0) {
  unwatch();
  self = null;
  enabled = false;
  problem = "";
  appPort = port;
}

const header = (headers: Headers, name: string) => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** A request a proxy passed on (Tailscale's, or any other): never taken for a local one. */
export const forwarded = (headers: Headers) =>
  ["tailscale-user-login", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded"].some(
    (h) => header(headers, h) !== undefined,
  );

/** The tailnet origin a forwarded request is let in under, else null: on, this Mac's name and port, your login. */
export function tailnetOrigin(headers: Headers): string | null {
  if (!enabled || !self || !tailnetAvailable()) return null;
  const host = header(headers, "host")?.toLowerCase();
  if (host !== `${self.dns}:${TAILNET.port}`) return null;
  if (header(headers, "tailscale-user-login")?.toLowerCase() !== self.owner) return null;
  return `https://${self.dns}:${TAILNET.port}`;
}

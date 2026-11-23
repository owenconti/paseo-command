/**
 * Headless mode (the user's ask: run Paseo Command on another Mac, a Mac mini, set up entirely over SSH or by an agent,
 * and use its web UI from an iPad): `paseo-command`, the app bundle's command-line tool
 * (`Contents/Resources/bin/paseo-command`, running this file, `server/headless.mjs`, with the bundle's own Node).
 *
 *   paseo-command install            run the app's server as a launchd service (at login, kept alive), no app window
 *   paseo-command uninstall          stop it and remove the service
 *   paseo-command status             the service, its server and access over Tailscale
 *   paseo-command restart            restart the server (after an update the app didn't do)
 *   paseo-command logs [-f]          the server's log
 *   paseo-command tailscale on|off|status   serve it on your tailnet, for your own Tailscale login (server/tailnet.ts)
 *   paseo-command update             install the latest release over this app, verified, and restart the server
 *
 * The service is a per-user LaunchAgent (`<bundle id>.headless`) running the bundle's `server.mjs` with its `ui`, in the
 * app's own data folder and port, as the app's server would but with `PASEO_NATIVE_HEADLESS=1` (no app to end with). It
 * starts through your login shell (`-i -l`, as the app reads your environment), so your PATH and tokens come from your
 * profile each time and none are written into the plist. The app, opened on the same Mac, uses a running headless server
 * (restarting it when its version differs: ServerManager.swift) rather than starting its own.
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const REPO = "owenconti/paseo-command";

type Run = (cmd: string, args: string[], options?: { timeout?: number }) => Promise<{ code: number; out: string; err: string }>;

/** What the tool reaches outside itself (tests replace these). */
export const HEADLESS = {
  run: ((cmd, args, options) =>
    new Promise((done) =>
      execFile(cmd, args, { timeout: options?.timeout ?? 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, out, err) =>
        done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: String(out), err: String(err) }),
      ),
    )) as Run,
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  home: () => homedir(),
  uid: () => process.getuid?.() ?? 501,
  shell: () => process.env.SHELL || "/bin/zsh",
  out: (line: string) => console.log(line),
};

/** The app bundle this tool belongs to: `<app>/Contents/Resources/server/headless.mjs`. */
export function bundlePath(file = fileURLToPath(import.meta.url)) {
  return process.env.PASEO_COMMAND_APP || resolve(dirname(file), "..", "..", "..");
}

export type Bundle = {
  app: string;
  id: string;
  name: string;
  version: string;
  flavor: string;
  port: number;
  node: string;
  server: string;
  ui: string;
};

async function plistValue(plist: string, key: string) {
  const r = await HEADLESS.run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
  return r.code === 0 ? r.out.trim() : "";
}

export async function readBundle(app = bundlePath()): Promise<Bundle> {
  const plist = join(app, "Contents", "Info.plist");
  if (!existsSync(plist)) throw new Error(`${app} isn't a Paseo Command app (no Info.plist).`);
  const [id, name, version, flavor, port] = await Promise.all(
    ["CFBundleIdentifier", "CFBundleName", "CFBundleShortVersionString", "PaseoCommandFlavor", "PaseoCommandPort"].map((k) =>
      plistValue(plist, k),
    ),
  );
  if (!id || !flavor) throw new Error(`${app} isn't a Paseo Command app.`);
  const res = join(app, "Contents", "Resources");
  return {
    app,
    id,
    name: name || "Paseo Command",
    version: version || "dev",
    flavor,
    port: Number(port) || (flavor === "release" ? 4310 : 4321),
    node: join(res, "node", "node"),
    server: join(res, "server", "server.mjs"),
    ui: join(res, "ui"),
  };
}

export const label = (b: Bundle) => `${b.id}.headless`;
export const plistFile = (b: Bundle) => join(HEADLESS.home(), "Library", "LaunchAgents", `${label(b)}.plist`);
/** The app's own data folder (AppFlavor.dataFolder), so the app and the service share settings, keys and logs. */
export const dataFolder = (b: Bundle) => join(HEADLESS.home(), "Library", "Application Support", b.name);
export const logFile = (b: Bundle) => join(dataFolder(b), "logs", "server.log");

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (s: string) => `<string>${xml(s)}</string>`;

/** The LaunchAgent: the bundle's Node running its server through your login shell, kept alive. */
export function servicePlist(b: Bundle, shell = HEADLESS.shell()) {
  const env: Record<string, string> = {
    PASEO_NATIVE_HEADLESS: "1",
    PASEO_COMMAND_DATA: dataFolder(b),
    PASEO_NATIVE_UI: b.ui,
    PASEO_NATIVE_PORT: String(b.port),
    PASEO_COMMAND_VERSION: b.version,
    PASEO_COMMAND_FLAVOR: b.flavor,
  };
  const log = logFile(b);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(label(b))}
  <key>ProgramArguments</key>
  <array>
    ${str(shell)}
    <string>-i</string>
    <string>-l</string>
    <string>-c</string>
    <string>exec /usr/bin/env -u NODE_OPTIONS -u NODE_PATH "$0" "$1"</string>
    ${str(b.node)}
    ${str(b.server)}
  </array>
  <key>WorkingDirectory</key>
  ${str(dataFolder(b))}
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${xml(k)}</key>\n    ${str(v)}`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  ${str(log)}
  <key>StandardErrorPath</key>
  ${str(log)}
</dict>
</plist>
`;
}

/** The launchd domain: the logged-in session's, else the user's (an SSH-only login). */
async function domain() {
  const gui = `gui/${HEADLESS.uid()}`;
  return (await HEADLESS.run("/bin/launchctl", ["print", gui])).code === 0 ? gui : `user/${HEADLESS.uid()}`;
}

async function loaded(b: Bundle) {
  const d = await domain();
  return (await HEADLESS.run("/bin/launchctl", ["print", `${d}/${label(b)}`])).code === 0 ? d : null;
}

type Health = { ready?: boolean; pid?: number; version?: string; headless?: boolean; ownerPid?: number };
async function health(b: Bundle): Promise<Health | null> {
  try {
    const r = await HEADLESS.fetch(`http://127.0.0.1:${b.port}/__native/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? ((await r.json()) as Health) : null;
  } catch {
    return null;
  }
}

async function waitForServer(b: Bundle, seconds = 30, want = (h: Health) => !!h.headless) {
  for (let i = 0; i < seconds * 2; i++) {
    const h = await health(b);
    if (h?.ready && want(h)) return h;
    await HEADLESS.sleep(500);
  }
  return null;
}

async function api<T>(b: Bundle, path: string, body?: unknown): Promise<T> {
  const r = await HEADLESS.fetch(`http://127.0.0.1:${b.port}/api/${path}`, {
    ...(body === undefined
      ? {}
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(json.error || `The server answered ${r.status}.`);
  return json;
}

export async function install(b: Bundle) {
  const running = await health(b);
  if (running?.ready && !running.headless)
    throw new Error(
      `${b.name} (the app) is running its own server on port ${b.port}. Quit the app first; opened later, it uses the headless server.`,
    );
  const file = plistFile(b);
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(dirname(logFile(b)), { recursive: true });
  writeFileSync(file, servicePlist(b), { mode: 0o644 });
  const d = await domain();
  // Replace one already loaded (a reinstall picks up a moved app or a new shell).
  await HEADLESS.run("/bin/launchctl", ["bootout", `${d}/${label(b)}`]);
  const boot = await HEADLESS.run("/bin/launchctl", ["bootstrap", d, file]);
  if (boot.code !== 0) throw new Error(`launchctl bootstrap ${d} failed: ${boot.err.trim() || boot.out.trim()}`);
  const up = await waitForServer(b);
  if (!up) throw new Error(`The service is installed but its server didn't answer on port ${b.port} within 30 s. See ${logFile(b)}.`);
  HEADLESS.out(`Installed ${label(b)} (${d}): ${b.name} ${up.version} is serving on http://127.0.0.1:${b.port}.`);
  HEADLESS.out(`It starts when you log in and restarts if it stops. Logs: ${logFile(b)}`);
  if (b.flavor === "release") HEADLESS.out("To use it from another device on your tailnet: paseo-command tailscale on");
}

export async function uninstall(b: Bundle) {
  const d = await loaded(b);
  if (d) {
    const out = await HEADLESS.run("/bin/launchctl", ["bootout", `${d}/${label(b)}`]);
    if (out.code !== 0) throw new Error(`launchctl bootout failed: ${out.err.trim()}`);
  }
  rmSync(plistFile(b), { force: true });
  HEADLESS.out(`Uninstalled ${label(b)}${d ? "" : " (it wasn't loaded)"}. Your settings and data stay in ${dataFolder(b)}.`);
}

export async function restart(b: Bundle) {
  const d = await loaded(b);
  if (!d) throw new Error("The headless service isn't installed: paseo-command install");
  const r = await HEADLESS.run("/bin/launchctl", ["kickstart", "-k", `${d}/${label(b)}`]);
  if (r.code !== 0) throw new Error(`launchctl kickstart failed: ${r.err.trim()}`);
  const up = await waitForServer(b);
  if (!up) throw new Error(`The server didn't come back within 30 s. See ${logFile(b)}.`);
  HEADLESS.out(`Restarted: ${b.name} ${up.version} on http://127.0.0.1:${b.port}.`);
}

type Tailnet = { available: boolean; why?: string; enabled: boolean; url?: string; owner?: string; error?: string };
const tailnetLine = (t: Tailnet) =>
  !t.available
    ? `Tailscale: ${t.why ?? "not offered"}`
    : t.enabled
      ? `Tailscale: on, ${t.url ?? "(address unknown)"} for ${t.owner ?? "your login"} only${t.error ? ` (${t.error})` : ""}`
      : `Tailscale: off${t.error ? ` (${t.error})` : ""}`;

export async function status(b: Bundle) {
  const d = await loaded(b);
  const h = await health(b);
  HEADLESS.out(`App: ${b.app} (${b.version})`);
  HEADLESS.out(`Service: ${existsSync(plistFile(b)) ? (d ? `installed and loaded (${d}/${label(b)})` : "installed, not loaded") : "not installed"}`);
  HEADLESS.out(
    `Server: ${
      h?.ready
        ? `${h.headless ? "headless" : "the app's own"}, ${h.version}, pid ${h.pid}, http://127.0.0.1:${b.port}${
            h.version !== b.version ? ` (the app on disk is ${b.version}: paseo-command restart)` : ""
          }`
        : `not answering on port ${b.port}`
    }`,
  );
  if (h?.ready) HEADLESS.out(tailnetLine(await api<Tailnet>(b, "tailnet").catch((e) => ({ available: true, enabled: false, error: String(e.message ?? e) }))));
  HEADLESS.out(`Logs: ${logFile(b)}`);
}

export async function tailscale(b: Bundle, what: string | undefined) {
  if (!(await health(b))?.ready) throw new Error(`No server is answering on port ${b.port}: paseo-command install`);
  if (what === "on" || what === "off") {
    const t = await api<Tailnet>(b, "tailnet", { enabled: what === "on" });
    HEADLESS.out(tailnetLine(t));
  } else if (!what || what === "status") HEADLESS.out(tailnetLine(await api<Tailnet>(b, "tailnet")));
  else throw new Error("usage: paseo-command tailscale on | off | status");
}

export function logs(b: Bundle, follow: boolean) {
  const file = logFile(b);
  if (!existsSync(file)) throw new Error(`No log yet at ${file}.`);
  return new Promise<void>((done) => {
    const tail = spawn("/usr/bin/tail", [...(follow ? ["-f"] : []), "-n", "200", file], { stdio: "inherit" });
    tail.on("exit", () => done());
  });
}

/** `1.2.10` > `1.2.9`. */
export const newer = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
};

async function teamOf(app: string) {
  const r = await HEADLESS.run("/usr/bin/codesign", ["-dv", app]);
  return /TeamIdentifier=(\S+)/.exec(r.err + r.out)?.[1] ?? "";
}

/**
 * The latest release over this app: its zip from GitHub, checked (signature intact, notarized, the same bundle id and
 * signing team as this one) before it replaces this app, the old one kept until the new one is in place; then the
 * service restarts on it. Not while the app itself is open (Sparkle updates it then).
 */
export async function update(b: Bundle) {
  if (b.flavor !== "release") throw new Error("Only the installed Paseo Command updates itself; build the Dev app from its checkout.");
  const latest = await HEADLESS.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "paseo-command-headless" },
  });
  if (!latest.ok) throw new Error(`GitHub answered ${latest.status} for the latest release.`);
  const release = (await latest.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
  const version = String(release.tag_name ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("GitHub's latest release has no version.");
  if (!newer(version, b.version)) return HEADLESS.out(`Already up to date (${b.version}).`);
  const asset = release.assets?.find((a) => a.name === `Paseo-Command-${version}.zip`);
  if (!asset || !asset.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`))
    throw new Error(`Release ${version} has no Paseo-Command-${version}.zip.`);
  const app = await HEADLESS.run("/usr/bin/pgrep", ["-f", join(b.app, "Contents", "MacOS") + "/"]);
  if (app.code === 0) throw new Error(`${b.name} is open on this Mac: it updates itself. Quit it to update from here.`);

  const work = mkdtempSync(join(tmpdir(), "paseo-command-update-"));
  try {
    HEADLESS.out(`Downloading ${b.name} ${version}…`);
    const zip = join(work, asset.name);
    const dl = await HEADLESS.fetch(asset.browser_download_url, { headers: { "User-Agent": "paseo-command-headless" } });
    if (!dl.ok || !dl.body) throw new Error(`The download answered ${dl.status}.`);
    await pipeline(Readable.fromWeb(dl.body as never), createWriteStream(zip));
    const unzip = await HEADLESS.run("/usr/bin/ditto", ["-x", "-k", zip, join(work, "x")]);
    if (unzip.code !== 0) throw new Error(`Couldn't unpack it: ${unzip.err.trim()}`);
    const fresh = join(work, "x", basename(b.app));
    const next = await readBundle(fresh);
    if (next.id !== b.id) throw new Error(`The download is ${next.id}, not ${b.id}.`);
    if (next.version !== version) throw new Error(`The download says it's ${next.version}, not ${version}.`);
    const sig = await HEADLESS.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", fresh]);
    if (sig.code !== 0) throw new Error(`Its signature doesn't verify: ${sig.err.trim()}`);
    const gate = await HEADLESS.run("/usr/sbin/spctl", ["--assess", "--type", "execute", fresh]);
    if (gate.code !== 0) throw new Error(`Gatekeeper refuses it (not notarized?): ${gate.err.trim()}`);
    const [mine, theirs] = await Promise.all([teamOf(b.app), teamOf(fresh)]);
    if (!theirs || theirs !== mine) throw new Error(`It's signed by another team (${theirs || "none"}, this app ${mine || "none"}).`);

    const old = `${b.app}.old-${Date.now()}`;
    renameSync(b.app, old);
    try {
      const copy = await HEADLESS.run("/usr/bin/ditto", [fresh, b.app]);
      if (copy.code !== 0) throw new Error(`Couldn't put it in place: ${copy.err.trim()}`);
    } catch (error) {
      rmSync(b.app, { recursive: true, force: true });
      renameSync(old, b.app);
      throw error;
    }
    rmSync(old, { recursive: true, force: true });
    HEADLESS.out(`Installed ${b.name} ${version} at ${b.app}.`);
    if (await loaded(b)) await restart(await readBundle(b.app));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const HELP = `paseo-command: Paseo Command without its window, for a Mac you reach over SSH.

  paseo-command install              run the server as a service (starts at login, restarts if it stops)
  paseo-command uninstall            stop and remove the service (your data stays)
  paseo-command status               the service, its server and access over Tailscale
  paseo-command restart              restart the server
  paseo-command logs [-f]            the server's log (-f follows it)
  paseo-command tailscale on|off|status
                                     serve it on your tailnet over HTTPS, for your own Tailscale login only
  paseo-command update               install the latest release over this app and restart the server

Needs this Mac's user logged in (automatic login suits a Mac mini), Paseo's daemon and, for
"tailscale on", Tailscale connected.`;

export async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return HEADLESS.out(HELP);
  const b = await readBundle();
  if (cmd === "install") return install(b);
  if (cmd === "uninstall") return uninstall(b);
  if (cmd === "status") return status(b);
  if (cmd === "restart") return restart(b);
  if (cmd === "logs") return logs(b, rest.includes("-f"));
  if (cmd === "tailscale") return tailscale(b, rest[0]);
  if (cmd === "update") return update(b);
  throw new Error(`Unknown command "${cmd}".\n\n${HELP}`);
}

if (process.argv[1] && /headless\.mjs$/.test(process.argv[1]))
  main(process.argv.slice(2)).catch((error) => {
    console.error(`paseo-command: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

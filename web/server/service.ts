/**
 * The production background service on macOS: a per-user launchd agent that
 * runs `npm run serve` from the main checkout at login, restarts it if it
 * crashes, and logs to `.paseo-command/logs/`.
 *
 *   tsx server/service.ts install | uninstall | status
 *
 * `PASEO_COMMAND_LAUNCH_AGENTS` moves the plist's directory (for tests).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mainCheckout } from "./checkout";

export { mainCheckout };

export const LABEL = "com.paseo-command.serve";

export const agentsDir = () =>
  resolve(
    process.env.PASEO_COMMAND_LAUNCH_AGENTS ||
      join(homedir(), "Library", "LaunchAgents"),
  );
export const plistPath = (dir = agentsDir()) => join(dir, `${LABEL}.plist`);
export const logPath = (repo: string) =>
  join(repo, ".paseo-command", "logs", "serve.log");

/** The user's PATH, without the `node_modules/.bin` entries `npm run` adds. */
export const userPath = (path = process.env.PATH ?? "") =>
  path
    .split(":")
    .filter((p) => p && !/(^|\/)node_modules\/\.bin\/?$/.test(p))
    .join(":");

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plist(repo: string, env: Record<string, string>) {
  const vars = Object.entries(env)
    .map(
      ([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>\n`,
    )
    .join("");
  const log = xml(logPath(repo));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>exec npm run serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${vars}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}

/** Writes the plist (and the log directory) without loading it; returns its path. */
export function writePlist(repo = mainCheckout(), dir = agentsDir()) {
  const env: Record<string, string> = { PATH: userPath() };
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(repo, ".paseo-command", "logs"), { recursive: true });
  const file = plistPath(dir);
  writeFileSync(file, plist(repo, env));
  return file;
}

const domain = () => `gui/${process.getuid?.()}`;
const launchctl = (...args: string[]) =>
  spawnSync("launchctl", args, {
    stdio: args[0] === "print" ? "ignore" : "inherit",
  }).status;

/**
 * Boots the agent out (if it's loaded) and removes its plist. A failed bootout
 * of a loaded agent leaves the plist in place and returns false.
 */
export function uninstall(run = launchctl, dir = agentsDir()) {
  const target = `${domain()}/${LABEL}`;
  const loaded = run("print", target) === 0;
  if (loaded && run("bootout", target) !== 0) {
    console.error(
      `launchctl bootout ${target} failed; left ${plistPath(dir)} in place`,
    );
    return false;
  }
  rmSync(plistPath(dir), { force: true });
  console.log(`Uninstalled ${LABEL}${loaded ? "" : " (it wasn't loaded)"}`);
  return true;
}

function main(cmd: string | undefined) {
  if (cmd === "install") {
    const file = writePlist();
    launchctl("bootout", `${domain()}/${LABEL}`); // replace a running one; fails harmlessly if none
    if (launchctl("bootstrap", domain(), file) !== 0) process.exit(1);
    console.log(
      `Installed ${file}\nServing ${mainCheckout()}; logs: ${logPath(mainCheckout())}`,
    );
  } else if (cmd === "uninstall") {
    if (!uninstall()) process.exit(1);
  } else if (cmd === "status") {
    if (!existsSync(plistPath()))
      return console.log(`Not installed (${plistPath()} missing)`);
    console.log(`Installed: ${plistPath()}\nLogs: ${logPath(mainCheckout())}`);
    try {
      console.log(
        execFileSync("launchctl", ["list", LABEL], { encoding: "utf8" }),
      );
    } catch {
      console.log("Not loaded");
    }
  } else {
    console.error("usage: tsx server/service.ts install | uninstall | status");
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv[2]);

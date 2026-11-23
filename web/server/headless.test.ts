import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADLESS, install, label, newer, plistFile, servicePlist, tailscale, uninstall, update, type Bundle } from "./headless";

const real = { ...HEADLESS };
let home: string;
let ran: string[];
let lines: string[];
let health: Record<string, unknown> | null;
let posted: unknown[];

const bundle: Bundle = {
  app: "/Applications/Paseo Command.app",
  id: "io.github.owenconti.paseo-command",
  name: "Paseo Command",
  version: "0.48.0",
  flavor: "release",
  port: 4310,
  node: "/Applications/Paseo Command.app/Contents/Resources/node/node",
  server: "/Applications/Paseo Command.app/Contents/Resources/server/server.mjs",
  ui: "/Applications/Paseo Command.app/Contents/Resources/ui",
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "headless-home-"));
  ran = [];
  lines = [];
  health = null;
  posted = [];
  HEADLESS.home = () => home;
  HEADLESS.uid = () => 501;
  HEADLESS.shell = () => "/bin/zsh";
  HEADLESS.sleep = async () => {};
  HEADLESS.out = (line) => void lines.push(line);
  HEADLESS.run = async (cmd, args) => {
    ran.push([cmd, ...args].join(" "));
    // A logged-in session; the service loaded once bootstrapped.
    if (args[0] === "print") return { code: args[1] === "gui/501" || ran.some((r) => r.includes("bootstrap")) ? 0 : 1, out: "", err: "" };
    if (args[0] === "bootstrap") health = { ready: true, pid: 9, ownerPid: 0, version: "0.48.0", headless: true };
    return { code: 0, out: "", err: "" };
  };
  HEADLESS.fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/__native/health")) {
      if (!health) throw new Error("ECONNREFUSED");
      return Response.json(health);
    }
    if (url.endsWith("/api/tailnet")) {
      if (init?.body) posted.push(JSON.parse(String(init.body)));
      return Response.json({ available: true, enabled: !!posted.length, url: "https://mini.tail1.ts.net:4310", owner: "me@example.com" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => {
  Object.assign(HEADLESS, real);
  rmSync(home, { recursive: true, force: true });
});

test("the service runs the bundle's server headless through your login shell, in the app's data folder", () => {
  const text = servicePlist(bundle, "/bin/zsh");
  const file = join(home, "x.plist");
  writeFileSync(file, text);
  execFileSync("/usr/bin/plutil", ["-lint", file]);
  const json = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
  assert.equal(json.Label, "io.github.owenconti.paseo-command.headless");
  assert.deepEqual(json.ProgramArguments, [
    "/bin/zsh",
    "-i",
    "-l",
    "-c",
    'exec /usr/bin/env -u NODE_OPTIONS -u NODE_PATH "$0" "$1"',
    bundle.node,
    bundle.server,
  ]);
  assert.deepEqual(json.EnvironmentVariables, {
    PASEO_NATIVE_HEADLESS: "1",
    PASEO_COMMAND_DATA: join(home, "Library", "Application Support", "Paseo Command"),
    PASEO_NATIVE_UI: bundle.ui,
    PASEO_NATIVE_PORT: "4310",
    PASEO_COMMAND_VERSION: "0.48.0",
    PASEO_COMMAND_FLAVOR: "release",
  });
  assert.equal(json.RunAtLoad, true);
  assert.equal(json.KeepAlive, true);
  assert.equal(json.StandardOutPath, join(home, "Library", "Application Support", "Paseo Command", "logs", "server.log"));
});

test("install loads the service in the logged-in session and waits for its server; uninstall removes it", async () => {
  await install(bundle);
  assert.equal(existsSync(plistFile(bundle)), true);
  assert.ok(readFileSync(plistFile(bundle), "utf8").includes(label(bundle)));
  assert.ok(ran.includes(`/bin/launchctl bootstrap gui/501 ${plistFile(bundle)}`));
  assert.match(lines[0]!, /serving on http:\/\/127\.0\.0\.1:4310/);
  assert.match(lines.at(-1)!, /paseo-command tailscale on/);

  await uninstall(bundle);
  assert.ok(ran.includes(`/bin/launchctl bootout gui/501/${label(bundle)}`));
  assert.equal(existsSync(plistFile(bundle)), false);
});

test("install leaves the app's own server alone", async () => {
  health = { ready: true, pid: 3, ownerPid: 77, version: "0.48.0" };
  await assert.rejects(install(bundle), /Quit the app first/);
  assert.equal(ran.some((r) => r.includes("bootstrap")), false);
  assert.equal(existsSync(plistFile(bundle)), false);
});

test("tailscale on asks the running server, as the Settings switch does", async () => {
  await assert.rejects(tailscale(bundle, "on"), /No server is answering/);
  health = { ready: true, pid: 9, ownerPid: 0, version: "0.48.0", headless: true };
  await tailscale(bundle, "on");
  assert.deepEqual(posted, [{ enabled: true }]);
  assert.equal(lines.at(-1), "Tailscale: on, https://mini.tail1.ts.net:4310 for me@example.com only");
  await assert.rejects(tailscale(bundle, "maybe"), /usage/);
});

test("update compares versions, and takes only this repository's zip", async () => {
  assert.equal(newer("0.48.10", "0.48.9"), true);
  assert.equal(newer("0.48.0", "0.48.0"), false);
  assert.equal(newer("0.47.9", "0.48.0"), false);
  let latest: unknown = { tag_name: "v0.48.0", assets: [] };
  HEADLESS.fetch = async () => Response.json(latest);
  await update(bundle);
  assert.equal(lines.at(-1), "Already up to date (0.48.0).");
  latest = { tag_name: "v0.49.0", assets: [{ name: "Paseo-Command-0.49.0.zip", browser_download_url: "https://evil.example/x.zip" }] };
  await assert.rejects(update(bundle), /has no Paseo-Command-0\.49\.0\.zip/);
  await assert.rejects(update({ ...bundle, flavor: "dev" }), /Only the installed Paseo Command/);
});

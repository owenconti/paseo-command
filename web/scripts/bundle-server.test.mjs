// Runs the bundled server as the packaged app does: one file, no checkout.
import assert from "node:assert/strict";
import { isBuiltin } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const web = resolve(fileURLToPath(import.meta.url), "../..");
const bundle = join(web, "dist-server/server.mjs");

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

const build = spawnSync(process.execPath, [join(web, "scripts/bundle-server.mjs")], {
  cwd: web,
  encoding: "utf8",
});

test("bundler succeeds", () => {
  assert.equal(build.status, 0, build.stderr);
});

test("bundle imports nothing from node_modules", () => {
  const text = readFileSync(bundle, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const outside = specs.filter((s) => !isBuiltin(s) && !["bufferutil", "utf-8-validate"].includes(s));
  assert.deepEqual(outside, []);
});

const children = [];
const dirs = [];
after(() => {
  for (const c of children) c.kill("SIGKILL");
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test("bundle serves the UI and API, and only starts the helper", async () => {
  const data = mkdtempSync(join(tmpdir(), "bundle-data-"));
  dirs.push(data);
  const owner = spawn("sleep", ["60"], { stdio: "ignore" });
  children.push(owner);
  const port = await freePort();
  const server = spawn(process.execPath, [bundle], {
    cwd: data,
    env: {
      ...process.env,
      PASEO_COMMAND_DATA: data,
      PASEO_NATIVE_UI: join(web, "dist"),
      PASEO_NATIVE_PORT: String(port),
      PASEO_NATIVE_OWNER_PID: String(owner.pid),
      PASEO_COMMAND_DAEMON: "127.0.0.1:1",
      PASEO_COMMAND_SETTINGS: join(data, "settings.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(server);
  let out = "";
  let err = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (err += d));
  const exited = new Promise((ok) => server.once("exit", (code, sig) => ok({ code, sig })));
  const base = `http://127.0.0.1:${port}`;

  let health;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !health) {
    try {
      const r = await fetch(`${base}/__native/health`);
      const j = await r.json();
      if (j.ready) health = j;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(health, `no health in 10s\n${out}\n${err}`);
  assert.equal(health.ownerPid, owner.pid);

  const index = await (await fetch(`${base}/`)).text();
  assert.ok(index.includes('<div id="root"'));
  assert.equal((await fetch(`${base}/api/presets`)).status, 200);

  // Only the helper starts: no service CLI usage text, nothing else on stdout.
  assert.ok(!/usage:|launchd|Installed/i.test(out + err), out + err);

  server.kill("SIGTERM");
  const { code } = await exited;
  assert.equal(code, 0, err);
});

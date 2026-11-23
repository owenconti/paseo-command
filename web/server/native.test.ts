import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "./subagentArchive";
import { startNativeHelper, validateNativeConfig } from "./native";

/** A live process other than this one, to stand in for the owning app. */
const owner = () => {
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  return { pid: child.pid!, stop: () => child.kill() };
};
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "native-test-")));

test("validateNativeConfig accepts no checkout", () => {
  const app = owner();
  try {
    const config = validateNativeConfig({
      PASEO_COMMAND_DATA: "/tmp/d",
      PASEO_NATIVE_OWNER_PID: String(app.pid),
      PASEO_NATIVE_UI: "/tmp/ui",
    });
    assert.equal(config.checkout, undefined);
    assert.equal(config.data, "/tmp/d");
    assert.equal(config.port, 4310);
    assert.equal(config.version, "dev");
  } finally {
    app.stop();
  }
});

test("validateNativeConfig rejects a relative data path", () => {
  assert.throws(
    () => validateNativeConfig({ PASEO_COMMAND_DATA: "d", PASEO_NATIVE_OWNER_PID: "2" }),
    /absolute PASEO_COMMAND_DATA/,
  );
});

test("the standalone server serves health with its version, the UI, and runs in the data folder", async () => {
  const app = owner();
  const root = temp();
  const ui = join(root, "ui");
  const data = join(root, "data");
  mkdirSync(ui);
  writeFileSync(join(ui, "index.html"), "<p>hello</p>");
  const saved = { cwd: process.cwd(), env: { ...process.env } };
  process.env.PASEO_COMMAND_CLI = "/bin/echo";
  process.env.PASEO_COMMAND_VERSION = "0.2.0";
  const config = validateNativeConfig({
    ...process.env,
    PASEO_COMMAND_DATA: data,
    PASEO_NATIVE_OWNER_PID: String(app.pid),
    PASEO_NATIVE_UI: ui,
    PASEO_NATIVE_PORT: "0",
  });
  const helper = await startNativeHelper(config, {
    connect: (async () => {
      throw new Error("no daemon in this test");
    }) as never,
  });
  try {
    const health = await (await fetch(`${helper.origin}/__native/health`)).json();
    assert.equal(health.version, "0.2.0");
    assert.equal(health.ready, true);
    assert.equal(health.ownerPid, app.pid);
    assert.equal(await (await fetch(`${helper.origin}/`)).text(), "<p>hello</p>");
    const port = new URL(helper.origin).port;
    const foreign = await new Promise<number>((resolve, reject) => {
      import("node:http")
        .then(({ request }) =>
          request(
            { host: "127.0.0.1", port, path: "/", headers: { Host: "evil.example" } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          )
            .on("error", reject)
            .end(),
        )
        .catch(reject);
    });
    assert.equal(foreign, 403);
    assert.equal(process.cwd(), realpathSync(data));
    assert.equal(dataDir(), data);
  } finally {
    await helper.close();
    app.stop();
    process.chdir(saved.cwd);
    process.env = saved.env;
  }
});

test("the app's server lets your own Tailscale login in through Tailscale's proxy only while it's on", async () => {
  const { TAILNET, resetTailnet, setTailnet } = await import("./tailnet");
  const app = owner();
  const root = temp();
  const ui = join(root, "ui");
  mkdirSync(ui);
  writeFileSync(join(ui, "index.html"), "<p>hello</p>");
  const saved = { cwd: process.cwd(), env: { ...process.env } };
  const run = TAILNET.run;
  process.env.PASEO_COMMAND_CLI = "/bin/echo";
  process.env.PASEO_COMMAND_FLAVOR = "release";
  const site = "mac.tail1.ts.net:4310";
  let served = "{}";
  TAILNET.run = async (args) => {
    if (args[0] === "status")
      return JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tail1.ts.net.", UserID: 1 }, User: { "1": { LoginName: "me@example.com" } } });
    if (args[1] === "status") return served;
    served = args.includes("off") ? "{}" : JSON.stringify({ Web: { [site]: { Handlers: { "/": { Proxy: args.at(-1) } } } } });
    return "";
  };
  const config = validateNativeConfig({
    ...process.env,
    PASEO_COMMAND_DATA: join(root, "data"),
    PASEO_NATIVE_OWNER_PID: String(app.pid),
    PASEO_NATIVE_UI: ui,
    PASEO_NATIVE_PORT: "0",
  });
  const helper = await startNativeHelper(config, {
    connect: (async () => {
      throw new Error("no daemon in this test");
    }) as never,
  });
  const port = new URL(helper.origin).port;
  const ask = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      import("node:http")
        .then(({ request }) =>
          request({ host: "127.0.0.1", port, path: "/", headers }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          })
            .on("error", reject)
            .end(),
        )
        .catch(reject);
    });
  const mine = { Host: site, "X-Forwarded-For": "100.64.0.2", "Tailscale-User-Login": "me@example.com" };
  try {
    assert.equal(await ask(mine), 403, "off");
    await setTailnet(true);
    assert.equal(await ask(mine), 200);
    assert.equal(await ask({ ...mine, Origin: `https://${site}` }), 200);
    assert.equal(await ask({ ...mine, Origin: "https://evil.example" }), 403);
    assert.equal(await ask({ ...mine, "Tailscale-User-Login": "them@example.com" }), 403);
    assert.equal(await ask({ ...mine, Host: `127.0.0.1:${port}` }), 403, "forwarded, never local");
    await setTailnet(false);
    assert.equal(await ask(mine), 403, "off again");
  } finally {
    TAILNET.run = run;
    resetTailnet();
    await helper.close();
    app.stop();
    process.chdir(saved.cwd);
    process.env = saved.env;
  }
});

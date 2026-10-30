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

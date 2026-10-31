import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./subagentArchive";
import {
  appSettings,
  saveAppSettings,
  settingsFile,
  writeSettings,
} from "./settings";
import { integrationEnabled, integrationKey } from "./integrations";
import { readSecret } from "./secrets";
import { DISABLED, LinearError, resetLinearClient } from "./linear/client";
import { linearImage } from "./linear/image";
import { readIssue, readIssues, readWorkspace, resetLinearReads } from "./linear/reads";
import { linearWrite } from "./linear/writes";
import { LINEAR, linearIssue, resetLinks } from "./links";
import { createAsksService, type Judge } from "./asks";
import { DEFAULT_INTEGRATIONS } from "../src/integrations";

const file = () => join(dataDir(), "secrets.json");
const secrets = (value: unknown) => {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(value));
};
const realFetch = LINEAR.fetch;
afterEach(() => {
  rmSync(file(), { force: true });
  rmSync(settingsFile(), { force: true });
  delete process.env.LINEAR_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  LINEAR.fetch = realFetch;
  resetLinearClient();
  resetLinearReads();
  resetLinks();
});

test("integrations stay off with saved keys; every Linear route and TypeSafe avoid external work", async () => {
  secrets({
    linearApiKey: "test-linear-key",
    typesafeApiKey: "test-typesafe-key",
  });
  assert.deepEqual(appSettings().integrations, DEFAULT_INTEGRATIONS);
  LINEAR.fetch = (() => {
    throw new Error("Linear must not be contacted");
  }) as typeof fetch;
  const disabled = (e: unknown) =>
    e instanceof LinearError && e.kind === "no-key" && e.message === DISABLED;
  await assert.rejects(() => readWorkspace(), disabled);
  await assert.rejects(() => readIssues("assigned"), disabled);
  await assert.rejects(() => readIssue("ENG-12"), disabled);
  await assert.rejects(
    () => linearWrite("issueUpdate", { id: "11111111-1111-4111-8111-111111111111", priority: 2 }),
    disabled,
  );
  assert.equal((await linearIssue("ENG-12")).available, false);
  assert.equal(
    (await linearImage("https://uploads.linear.app/test.png")).status,
    404,
  );
  let judges = 0;
  const service = createAsksService(() => {
    judges++;
    return undefined;
  });
  assert.equal(service.status().available, false);
  const result = service.request({} as never, "local", {
    id: "a",
    status: "idle",
  } as never);
  assert.equal(result.pending, false);
  assert.equal(judges, 0);
});

test("keys come only from secrets.json and are never returned by settings", () => {
  writeSettings({ integrations: { linear: true, typesafe: true } });
  process.env.LINEAR_API_KEY = "test-env-linear";
  process.env.TYPESAFE_API_KEY = "test-env-typesafe";
  assert.equal(integrationKey("linear"), undefined);
  assert.equal(integrationKey("typesafe"), undefined);
  secrets({
    linearApiKey: " test-file-linear ",
    typesafeApiKey: "test-file-typesafe",
  });
  assert.equal(integrationKey("linear"), "test-file-linear");
  assert.equal(integrationKey("typesafe"), "test-file-typesafe");
  assert.ok(!JSON.stringify(appSettings()).includes("test-file"));
  secrets({ linearApiKey: 123, typesafeApiKey: " " });
  assert.equal(readSecret("linearApiKey"), undefined);
  assert.equal(readSecret("typesafeApiKey"), undefined);
  writeFileSync(file(), "{invalid");
  assert.equal(readSecret("linearApiKey"), undefined);
});

test("integration choices validate booleans and preserve other settings", () => {
  writeSettings({
    presets: [{ name: "Keep", prompt: "Keep it" }],
    linearWorkspace: "acme",
  });
  saveAppSettings({ integrations: { linear: true } });
  saveAppSettings({ integrations: { typesafe: true } });
  assert.deepEqual(appSettings().integrations, {
    linear: true,
    typesafe: true,
  });
  assert.equal(appSettings().linearWorkspace, "acme");
  for (const integrations of [null, [], { linear: "true" }, { unknown: true }, { appleMusic: true }])
    assert.throws(() => saveAppSettings({ integrations }), /Invalid/);
  writeFileSync(settingsFile(), "{invalid");
  assert.equal(integrationEnabled("linear"), false);
  assert.throws(
    () => saveAppSettings({ integrations: { linear: true } }),
    /can't be read/,
  );
});

test("Linear tooltips use the same saved key and stop using cached results when disabled", async () => {
  writeSettings({ integrations: { linear: true } });
  secrets({ linearApiKey: "test-file-linear" });
  let requests = 0;
  LINEAR.fetch = (async (_url, init) => {
    requests++;
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "test-file-linear",
    );
    return new Response(
      JSON.stringify({
        data: {
          issue: {
            identifier: "ENG-12",
            title: "Example",
            url: "https://linear.app/acme/issue/ENG-12",
            state: { name: "Todo" },
          },
        },
      }),
    );
  }) as typeof fetch;
  assert.equal((await linearIssue("ENG-12")).available, true);
  saveAppSettings({ integrations: { linear: false } });
  assert.equal((await linearIssue("ENG-12")).available, false);
  assert.equal(requests, 1);
});

test("TypeSafe opt-out prevents a pending judgment from starting drafted answers", async () => {
  writeSettings({ integrations: { typesafe: true } });
  let resolve: (value: Awaited<ReturnType<Judge>>) => void = () => {};
  const judge: Judge = () =>
    new Promise((done) => {
      resolve = done;
    });
  let drafts = 0;
  const service = createAsksService(
    () => judge,
    Date.now,
    async () => {
      drafts++;
      return [];
    },
  );
  const client = {
    fetchAgentTimeline: async () => ({
      entries: [
        {
          seqStart: 1,
          seqEnd: 1,
          item: { type: "assistant_message", text: "Which file should I use?" },
        },
      ],
    }),
  };
  const agent = { id: "a", status: "idle", updatedAt: "now" };
  assert.equal(
    service.request(client as never, "local", agent as never).pending,
    true,
  );
  await new Promise((done) => setTimeout(done, 0));
  saveAppSettings({ integrations: { typesafe: false } });
  resolve({
    answers: {
      waiting: { noul: 1 },
      ask_0: { noul: 1 },
      kind_0: { choice: "open" },
    },
  });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(drafts, 0);
  assert.deepEqual(
    service.request(client as never, "local", agent as never).questions,
    [],
  );
  saveAppSettings({ integrations: { typesafe: true } });
  assert.equal(service.request(client as never, "local", agent as never).pending, true,
    "opting back in can judge the same reply instead of keeping an abandoned pending entry");
});

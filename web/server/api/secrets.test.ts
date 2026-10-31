import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dataDir } from "../subagentArchive";
import { readSecret, secretsFile } from "../secrets";
import { readSettings } from "../settings";
import { call, fleet, get, install, post } from "../fake-daemon";

const { network } = fleet();
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});
beforeEach(() => {
  mkdirSync(dataDir(), { recursive: true });
  rmSync(secretsFile(), { force: true });
});

test("secrets: save, replace and remove one key without returning it or touching preferences", async () => {
  const preferences = readSettings();
  writeFileSync(
    secretsFile(),
    JSON.stringify({
      typesafeApiKey: "test-other-key",
      custom: { kept: true },
    }),
  );
  const saved = await post("secrets", {
    name: "linearApiKey",
    value: " test-first-key ",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, {
    configured: { linearApiKey: true, typesafeApiKey: true },
    error: null,
  });
  assert.equal(readSecret("linearApiKey"), "test-first-key");
  assert.equal(statSync(secretsFile()).mode & 0o777, 0o600);
  const loaded = await get("secrets");
  assert.equal(loaded.headers["cache-control"], "no-store");
  assert.deepEqual(loaded.data, saved.data);
  assert.ok(!JSON.stringify(loaded.data).includes("test-"));
  await post("secrets", {
    name: "linearApiKey",
    value: "test-replacement-key",
  });
  assert.equal(readSecret("linearApiKey"), "test-replacement-key");
  const removed = await post("secrets", { name: "linearApiKey", value: null });
  assert.equal(removed.data.configured.linearApiKey, false);
  assert.deepEqual(JSON.parse(readFileSync(secretsFile(), "utf8")), {
    typesafeApiKey: "test-other-key",
    custom: { kept: true },
  });
  assert.deepEqual(
    readSettings(),
    preferences,
    "saving a key never enables an integration",
  );
});

test("secrets: create an owner-only file and reject invalid updates without echoing input", async () => {
  assert.deepEqual((await get("secrets")).data, {
    configured: { linearApiKey: false, typesafeApiKey: false },
    error: null,
  });
  assert.equal(
    (
      await post("secrets", {
        name: "typesafeApiKey",
        value: "test-created-key",
      })
    ).status,
    200,
  );
  assert.equal(statSync(secretsFile()).mode & 0o777, 0o600);
  const original = readFileSync(secretsFile(), "utf8");
  for (const body of [
    { name: "unknown", value: "test-sensitive-marker" },
    { name: "linearApiKey", value: "" },
    { name: "linearApiKey", value: 123 },
    { name: "linearApiKey", value: "test-sensitive-marker\ninvalid" },
    { name: "linearApiKey", value: "test-sensitive-marker", extra: true },
    { name: "linearApiKey", value: "test-sensitive-marker".repeat(1000) },
  ]) {
    const result = await post("secrets", body);
    assert.equal(result.status, 400);
    assert.ok(!JSON.stringify(result.data).includes("test-sensitive-marker"));
    assert.equal(readFileSync(secretsFile(), "utf8"), original);
  }
});

test("secrets: malformed files are never overwritten or reflected in an error", async () => {
  for (const text of [
    '{"linearApiKey":"test-private-marker", broken',
    "[]",
    "null",
  ]) {
    writeFileSync(secretsFile(), text);
    const loaded = await get("secrets");
    assert.match(loaded.data.error, /secrets.json can't be read/);
    const saved = await post("secrets", {
      name: "linearApiKey",
      value: "test-new-key",
    });
    assert.equal(saved.status, 400);
    assert.ok(
      !JSON.stringify([loaded.data, saved.data]).includes(
        "test-private-marker",
      ),
    );
    assert.equal(readFileSync(secretsFile(), "utf8"), text);
  }
});

test("secrets: same-origin JSON access only, with no query parameters", async () => {
  const body = { name: "linearApiKey", value: "test-forbidden-key" };
  assert.equal(
    (await call("POST", "secrets", body, { origin: "https://example.com" }))
      .status,
    403,
  );
  assert.equal(
    (await call("POST", "secrets", body, { "content-type": "text/plain" }))
      .status,
    415,
  );
  assert.equal((await call("DELETE", "secrets")).status, 405);
  assert.equal((await get("secrets?name=linearApiKey")).status, 400);
  assert.equal(readSecret("linearApiKey"), undefined);
});

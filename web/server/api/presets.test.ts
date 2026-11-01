import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fleet, get, install, post } from "../fake-daemon";
import { settingsFile } from "../presets";
import { DEFAULT_INTEGRATIONS } from "../../src/integrations";
import { fillPreset, presetNeedsPr, prNumberOf } from "../../src/presets";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
local.addProject({ projectId: "prj_app", path: "/home/review/app", name: "app" });
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  // The API keeps live connections and timers; nothing else runs here.
  setTimeout(() => process.exit(0), 50).unref();
});

const writeSettings = (text: string) => {
  mkdirSync(dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), text);
};

test("presets: none without settings.json, then read afresh from it", async () => {
  rmSync(settingsFile(), { force: true });
  assert.deepEqual((await get("presets")).data, { presets: [], error: null });
  writeSettings(
    JSON.stringify({
      presets: [
        { name: " Review PR ", prompt: "Review {{pr}} carefully." },
        { name: "No prompt" },
        { prompt: "No name" },
      ],
    }),
  );
  assert.deepEqual((await get("presets")).data, {
    presets: [{ name: "Review PR", prompt: "Review {{pr}} carefully." }],
    error: null,
  });
  writeSettings("{ not json");
  const broken = await get("presets");
  assert.equal(broken.status, 200);
  assert.deepEqual(broken.data.presets, []);
  assert.match(broken.data.error, /settings\.json/);
});

test("presets: saving replaces them in order and keeps the file's other keys", async () => {
  writeSettings(JSON.stringify({ theme: "galaxy", presets: [{ name: "Old", prompt: "x" }] }));
  const r = await post("presets", {
    presets: [
      { name: " Review PR ", prompt: " Review {{pr}}. " },
      { name: "Tidy", prompt: "Tidy the README." },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const saved = JSON.parse(readFileSync(settingsFile(), "utf8"));
  assert.deepEqual(saved, {
    theme: "galaxy",
    presets: [
      { name: "Review PR", prompt: "Review {{pr}}." },
      { name: "Tidy", prompt: "Tidy the README." },
    ],
  });
  assert.deepEqual((await get("presets")).data.presets, saved.presets);
  // No file yet: one is made.
  rmSync(settingsFile());
  assert.equal((await post("presets", { presets: [] })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(settingsFile(), "utf8")), { presets: [] });
});

test("presets: a blank name, a repeated name or an empty prompt is refused", async () => {
  writeSettings(JSON.stringify({ presets: [{ name: "Keep", prompt: "Kept." }] }));
  const refused = async (presets: unknown, why: RegExp) => {
    const r = await post("presets", { presets });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.match(r.data.error, why);
  };
  await refused([{ name: " ", prompt: "x" }], /Preset 1 needs a name/);
  await refused(
    [
      { name: "Review", prompt: "a" },
      { name: "review", prompt: "b" },
    ],
    /Two presets are named/,
  );
  await refused([{ name: "Empty", prompt: "  " }], /needs a prompt/);
  await refused("nope", /required/);
  assert.deepEqual((await get("presets")).data.presets, [{ name: "Keep", prompt: "Kept." }]);
});

test("presets: a damaged settings.json is never overwritten", async () => {
  writeSettings("{ not json");
  const r = await post("presets", { presets: [{ name: "A", prompt: "b" }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /can't be read/);
  assert.equal(readFileSync(settingsFile(), "utf8"), "{ not json");
});

test("settings: the Linear workspace is saved beside the presets", async () => {
  writeSettings(JSON.stringify({ presets: [{ name: "Keep", prompt: "Kept." }] }));
  assert.deepEqual((await get("settings")).data, { linearWorkspace: "", integrations: DEFAULT_INTEGRATIONS, error: null });
  const r = await post("settings", { linearWorkspace: "https://linear.app/Acme/issue/X-1" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { linearWorkspace: "acme", integrations: DEFAULT_INTEGRATIONS, error: null });
  assert.deepEqual(JSON.parse(readFileSync(settingsFile(), "utf8")), {
    presets: [{ name: "Keep", prompt: "Kept." }],
    linearWorkspace: "acme",
  });
  assert.equal((await post("settings", { linearWorkspace: "not a slug!" })).status, 400);
  assert.equal((await post("settings", {})).status, 400);
  // Empty clears it.
  await post("settings", { linearWorkspace: "" });
  assert.equal((await get("settings")).data.linearWorkspace, "");
  writeSettings("[1]");
  assert.match((await get("settings")).data.error, /can't be read/);
  assert.equal((await post("settings", { linearWorkspace: "acme" })).status, 400);
  assert.equal(readFileSync(settingsFile(), "utf8"), "[1]");
});

test("fillPreset names the pull request; prNumberOf reads numbers and URLs", () => {
  const pr = { number: 42, url: "https://github.com/acme/app/pull/42" };
  assert.equal(
    fillPreset("Review {{pr}}, then {{ pr }}.", pr),
    "Review #42 (https://github.com/acme/app/pull/42), then #42 (https://github.com/acme/app/pull/42).",
  );
  assert.equal(presetNeedsPr({ name: "r", prompt: "Review {{pr}}" }), true);
  assert.equal(presetNeedsPr({ name: "r", prompt: "Tidy up" }), false);
  assert.equal(prNumberOf("42"), 42);
  assert.equal(prNumberOf(" #57 "), 57);
  assert.equal(prNumberOf("https://github.com/acme/app/pull/12/files"), 12);
  assert.equal(prNumberOf("review flag"), undefined);
  assert.equal(prNumberOf("0"), undefined);
});

test("drafts/prs: the project's pull requests from the daemon's GitHub search", async () => {
  const r = await get("drafts/prs?cwd=%2Fhome%2Freview%2Fapp&q=harbour");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.prs, [
    {
      number: 57,
      title: "Fix the harbour lights",
      url: "https://github.com/acme/app/pull/57",
      state: "open",
      head: "harbour-lights",
    },
  ]);
  assert.deepEqual(local.callsOf("searchGitHub").at(-1)?.args[0], {
    cwd: "/home/review/app",
    query: "harbour",
    kinds: ["github-pr"],
    limit: 20,
  });
  // Only the host's own project and workspace folders are searched.
  assert.equal((await get("drafts/prs?cwd=%2Fetc&q=1")).status, 400);
});

test("dispatch with a pull request checks out its branch in a new worktree", async () => {
  for (const prHead of [undefined, "review-flag"]) {
    const r = await post("dispatch", {
      projectId: "prj_app",
      prompt: "Review #42",
      provider: "claude",
      pr: 42,
      ...(prHead ? { prHead } : {}),
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(local.callsOf("createWorkspace").at(-1)?.args[0].source, {
      kind: "worktree",
      cwd: "/home/review/app",
      action: "checkout",
      ...(prHead ? { refName: prHead } : {}),
      checkoutSource: { kind: "change_request", forge: "github", number: 42 },
      githubPrNumber: 42,
    });
    const agent = local.callsOf("createAgent").at(-1)?.args[0];
    assert.equal(agent.initialPrompt, "Review #42");
    assert.equal(agent.cwd, "/home/review/app-review-flag");
    assert.equal(
      local.workspaces.get(r.data.workspaceId)?.gitRuntime.currentBranch,
      "review-flag",
    );
  }
  // A pull request's worktree takes its own branch, and needs a project.
  const both = await post("dispatch", {
    projectId: "prj_app",
    prompt: "x",
    provider: "claude",
    pr: 42,
    branch: "other",
  });
  assert.equal(both.status, 400);
  assert.match(both.data.error, /own branch/);
  const bad = await post("dispatch", {
    projectId: "prj_app",
    prompt: "x",
    provider: "claude",
    pr: -3,
  });
  assert.equal(bad.status, 400);
});

test("a failed PR checkout never starts the agent on the project's current branch", async () => {
  const before = local.callsOf("createAgent").length;
  const r = await post("dispatch", {
    projectId: "prj_app", prompt: "Review #999", provider: "claude", pr: 999,
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Pull request not found/);
  assert.equal(local.callsOf("createAgent").length, before);
});

/**
 * The Atlas world against a fixture fleet: every agent state is drawn
 * truthfully, a robot opens its conversation, and the list selects on the
 * map. Every /api request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import {
  agentRow,
  launch,
  mockApi,
  newContext,
  startApp,
  waitFor,
} from "./harness";

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
before(async () => {
  [app, browser] = await Promise.all([startApp(), launch()]);
});
after(async () => {
  await browser?.close();
  await app?.stop();
  assert.deepEqual(app?.apiHits ?? [], []);
});

const MAC = "srv_macmini";
const hosts = [
  { serverId: "srv_local", label: "Studio", status: "online", local: true, state: "online" },
  { serverId: MAC, label: "macmini", status: "offline", local: false, state: "offline" },
];
const projects = [
  { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
  { projectId: "prj_api", name: "api", kind: "git", path: "/work/api" },
  { projectId: "prj_infra", name: "infra", kind: "git", path: "/srv/infra", host: MAC },
];
const ws = (id: string, projectId: string, name: string, cwd: string, host?: string) => ({
  workspaceId: id,
  projectId,
  project: projectId.slice(4),
  name,
  isolation: "local",
  cwd,
  branch: "main",
  ...(host ? { host } : {}),
});
const workspaces = [
  ws("wks_a", "prj_atlas", "Map polish", "/work/atlas/a"),
  ws("wks_b", "prj_atlas", "Labels", "/work/atlas/b"),
  ws("wks_c", "prj_api", "Schema", "/work/api/c"),
  ws("wks_d", "prj_infra", "Deploy", "/srv/infra/d", MAC),
];
const agent = (
  id: string,
  status: string,
  name: string,
  workspaceId: string,
  cwd: string,
  extra: Record<string, unknown> = {},
) => ({ ...agentRow(id, status, name), workspaceId, cwd, ...extra });
const agents = [
  agent("a-running", "running", "Runner", "wks_a", "/work/atlas/a"),
  agent("a-idle", "idle", "Idler", "wks_a", "/work/atlas/a"),
  agent("a-done", "idle", "Finisher", "wks_b", "/work/atlas/b", { unread: true }),
  agent("a-approval", "idle", "Asker for leave", "wks_b", "/work/atlas/b"),
  agent("a-question", "idle", "Questioner", "wks_c", "/work/api/c", {
    provider: "codex/gpt-6.1-sol",
  }),
  agent("a-failed", "error", "Breaker", "wks_c", "/work/api/c"),
  agent("a-offline", "running", "Far away", "wks_d", "/srv/infra/d", {
    host: MAC,
    stale: true,
  }),
];
const permissions = [
  { id: "p1", agentId: "a-approval", name: "Bash", description: "rm -rf build" },
  {
    id: "p2",
    agentId: "a-question",
    name: "AskUserQuestion",
    description: "-",
    kind: "question",
  },
];

async function open(): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => agents,
    permissions: () => permissions,
    hosts: () => hosts,
    projects: () => projects,
    workspaces: () => workspaces,
  });
  await page.goto(app.url);
  return page;
}
type Inspect = {
  selected: string | null;
  islands: { name: string; host: string; online: boolean }[];
  agents: { id: string; name: string; state: string; model: string }[];
  workspaces: { id: string; name: string }[];
  zoom: number;
  builds: number;
  tiles: Record<string, string>;
};
const inspect = (page: Page) =>
  page.evaluate(() => (window as any).paseoAtlas?.inspect() as Inspect | undefined);
const agentKey = (id: string, host = "local") => JSON.stringify([host, id]);

const robotAt = (page: Page, key: string) =>
  page.evaluate((k) => {
    const atlas = (window as any).paseoWorld;
    const s = atlas.scene.screenOf(k);
    const i = atlas.inspect();
    const r = document
      .querySelector(".atlas-world-surface")!
      .getBoundingClientRect();
    const loc = i.agents.find((x: any) => x.id === k).at;
    return {
      x: Math.round(r.x + s.x),
      y: Math.round(r.y + s.y + (loc.height / 2) * i.zoom),
    };
  }, key);

test("every agent state is drawn as the daemon reports it", async () => {
  const page = await open();
  const world = (await waitFor(
    () => inspect(page),
    (i) => i?.agents?.length === agents.length,
    "the Atlas to draw every agent",
    30000,
  ))!;
  const state = Object.fromEntries(world.agents.map((a) => [a.name, a.state]));
  assert.deepEqual(state, {
    Runner: "running",
    Idler: "idle",
    Finisher: "done",
    "Asker for leave": "approval",
    Questioner: "question",
    Breaker: "failed",
    "Far away": "offline",
  });
  assert.deepEqual(
    world.islands.map((i) => [i.name, i.online]),
    [
      ["api", true],
      ["atlas", true],
      ["infra", false],
    ],
  );
  // Each agent's own tile shows its state; idle tiles stay plain.
  assert.deepEqual(world.tiles, {
    [agentKey("a-running")]: "running",
    [agentKey("a-done")]: "done",
    [agentKey("a-approval")]: "approval",
    [agentKey("a-question")]: "question",
    [agentKey("a-failed")]: "failed",
    [agentKey("a-offline", MAC)]: "offline",
  });
  // Model colours follow the provider.
  assert.equal(world.agents.find((a) => a.name === "Questioner")!.model, "white");
  assert.equal(world.agents.find((a) => a.name === "Runner")!.model, "orange");
  // ATLAS_SHOT=dir saves the fitted world for review.
  if (process.env.ATLAS_SHOT) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.ATLAS_SHOT}/atlas-states.png` });
  }
  await page.context().close();
});

test("picking a robot opens its conversation; the list selects on the map", async () => {
  const page = await open();
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  const key = agentKey("a-failed");
  await page.evaluate((k) => (window as any).paseoAtlas.focus(k, true), key);
  // The camera eases toward the robot; click once it has settled.
  let last = await robotAt(page, key);
  const settled = await waitFor(
    async () => {
      await page.waitForTimeout(300);
      const next = await robotAt(page, key);
      const still = next.x === last.x && next.y === last.y;
      last = next;
      return still ? next : null;
    },
    (v) => v !== null,
    "the camera to settle",
  );
  await page.mouse.move(settled!.x, settled!.y);
  const tip = await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t,
    "a tooltip",
  );
  assert.match(tip!, /Breaker.*Failed/);
  await page.mouse.down();
  await page.mouse.up();
  await waitFor(
    async () => (await inspect(page))?.selected,
    (v) => v === key,
    "the robot to be selected",
  );
  await page.locator(".session-title h2", { hasText: "Breaker" }).waitFor();
  // Choose another agent from the fleet list: the map follows.
  await page.getByRole("button", { name: /Fleet/ }).first().click();
  await page.getByRole("tab", { name: /Agents/ }).click();
  await page.getByText("Questioner").first().click();
  await waitFor(
    async () => (await inspect(page))?.selected,
    (v) => v === agentKey("a-question"),
    "the list choice to select on the map",
  );
  await page.context().close();
});

test("two workspaces sharing a checkout each list only their own agents", async () => {
  // The daemon can register the same checkout twice; the agent names its workspace.
  workspaces.unshift(ws("wks_twin", "prj_atlas", "Map polish", "/work/atlas/a"));
  try {
    const page = await open();
    await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
    const pick = (id: string) =>
      page.evaluate(
        (key) =>
          (window as any).paseoAtlas.scene.game.events.emit("atlas:pick", {
            id: key,
            kind: "workspace",
            name: "",
            host: "",
          }),
        JSON.stringify(["local", id]),
      );
    const here = () => page.locator(".section-label", { hasText: "Agents here" }).locator("span");
    await pick("wks_twin");
    await waitFor(() => here().textContent(), (t) => t === "0", "the empty twin to list no agents");
    await pick("wks_a");
    await waitFor(() => here().textContent(), (t) => t === "2", "the agents' own workspace to list them");
    await page.context().close();
  } finally {
    workspaces.shift();
  }
});

test("the session header shows its PR's CI and merge queue standing", async () => {
  // Paseo lags behind queue changes. GitHub status refreshes independently
  // while the same header stays open, without any daemon update.
  const i = workspaces.findIndex((w) => w.workspaceId === "wks_c");
  const before = workspaces[i];
  workspaces[i] = {
    ...before,
    branch: "feat/schema",
    pr: {
      number: 42,
      title: "Tighten the schema",
      state: "open",
      url: "https://github.com/acme/api/pull/42",
      ci: {
        state: "failing",
        checks: [
          { name: "lint", status: "failure", url: "https://ci.example/1" },
          { name: "build", status: "success" },
        ],
      },
      queue: { enabled: true, queued: false },
    },
  } as typeof before;
  const asked: string[] = [];
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    page.on("request", (r) => {
      if (r.url().includes("/api/merge-queue")) asked.push(r.url());
    });
    await page.clock.install();
    const status = {
      available: true,
      state: "open",
      queue: { enabled: true, queued: true, state: "awaiting_checks", position: 2 },
    };
    await mockApi(page, {
      agents: () => agents,
      permissions: () => permissions,
      hosts: () => hosts,
      projects: () => projects,
      workspaces: () => workspaces,
      lists: {
        "merge-queue": status,
      },
    });
    await page.goto(app.url);
    await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
    await page.evaluate(
      (key) =>
        (window as any).paseoAtlas.scene.game.events.emit("atlas:pick", {
          id: key,
          kind: "agent",
          name: "Breaker",
          host: "",
        }),
      agentKey("a-failed"),
    );
    await page.locator(".session-title h2", { hasText: "Breaker" }).waitFor();
    const chip = page.locator(".pr-chip");
    await chip.locator(".pr-queue", { hasText: "2" }).waitFor();
    assert.equal(await chip.locator(".link-chip-state").textContent(), "Queued for merge");
    assert.equal(await chip.locator(".pr-ci").getAttribute("data-ci"), "failing");
    assert.equal(
      await chip.getAttribute("data-tip"),
      "Tighten the schema\nCheck failing: lint\nIn merge queue: position 2, awaiting checks",
    );
    assert.equal(asked.length, 1);
    assert.match(asked[0], /workspace=wks_c/);
    // Exercise all five states and reopening against an unchanged daemon row.
    // Checks and stale queue flags must never override draft/closed/merged.
    for (const [state, queued, label] of [
      ["closed", true, "Closed"],
      ["draft", true, "Draft"],
      ["open", false, "Open"],
      ["open", true, "Queued for merge"],
      ["merged", true, "Merged"],
      ["open", false, "Open"],
    ] as const) {
      status.state = state;
      status.queue.queued = queued;
      await page.clock.fastForward(16000);
      await waitFor(
        () => chip.locator(".link-chip-state").textContent(),
        (text) => text === label,
        `PR badge to refresh to ${label}`,
      );
      assert.equal(await chip.getAttribute("data-state"), state);
      assert.equal(await chip.locator(".pr-queue").count(), state === "open" && queued ? 1 : 0);
      if (state === "closed" || state === "merged")
        assert.equal(await chip.locator(".pr-ci").count(), 0);
    }
    await context.close();
  } finally {
    workspaces[i] = before;
  }
});

test("live changes redraw the world without a reload", async () => {
  const page = await open();
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  const builds = (await inspect(page))!.builds;
  const idler = agents.find((a) => a.id === "a-idle")!;
  const before = idler.status;
  idler.status = "running";
  try {
    await waitFor(
      async () => (await inspect(page))?.agents.find((a) => a.name === "Idler")?.state,
      (s) => s === "running",
      "the idle robot to start working",
    );
    // A status change only redraws the robots, never the whole world.
    assert.equal((await inspect(page))!.builds, builds);
    workspaces.push(ws("wks_e", "prj_api", "Fresh", "/work/api/e"));
    await waitFor(
      async () => (await inspect(page))?.workspaces.map((w) => w.name),
      (names) => !!names?.includes("Fresh"),
      "the new cottage",
    );
    assert.equal((await inspect(page))!.builds, builds + 1);
  } finally {
    idler.status = before;
    workspaces.pop();
  }
  await page.context().close();
});

test("the Galaxy draws the same fleet truthfully and opens a satellite's conversation", async () => {
  const page = await open();
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  await page.selectOption('select[aria-label="Choose world"]', "galaxy");
  const world = (await waitFor(
    () => page.evaluate(() => (window as any).paseoWorld?.inspect()),
    (i: any) => i?.scene === "galaxy" && i.agents?.length === agents.length,
    "the Galaxy to draw every agent",
    30000,
  )) as any;
  const state = Object.fromEntries(world.agents.map((a: any) => [a.name, a.state]));
  assert.deepEqual(state, {
    Runner: "running",
    Idler: "idle",
    Finisher: "done",
    "Asker for leave": "approval",
    Questioner: "question",
    Breaker: "failed",
    "Far away": "offline",
  });
  // Satellites take their provider's colour; stations their most urgent agent.
  assert.equal(world.agents.find((a: any) => a.name === "Questioner").model, "codex");
  assert.equal(world.tiles[agentKey("wks_c")], "failed");
  assert.deepEqual(world.regions.map((r: any) => [r.name, r.online]), [
    ["local", true],
    ["macmini", false],
  ]);
  if (process.env.ATLAS_SHOT) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.ATLAS_SHOT}/galaxy-states.png` });
  }
  const key = agentKey("a-question");
  await page.evaluate((k) => (window as any).paseoWorld.focus(k, true), key);
  let last = await robotAt(page, key);
  const settled = await waitFor(
    async () => {
      await page.waitForTimeout(300);
      const next = await robotAt(page, key);
      const still = Math.abs(next.x - last.x) < 1 && Math.abs(next.y - last.y) < 1;
      last = next;
      return still ? next : null;
    },
    (v) => v !== null,
    "the camera to settle",
  );
  await page.mouse.click(settled!.x, settled!.y);
  await page.locator(".session-title h2", { hasText: "Questioner" }).waitFor();
  // The choice of world is remembered.
  await page.reload();
  await waitFor(
    () => page.evaluate(() => (window as any).paseoWorld?.inspect()?.scene),
    (s) => s === "galaxy",
    "the Galaxy after a reload",
    30000,
  );
  await page.context().close();
});

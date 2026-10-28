/**
 * The Atlas world against a fixture fleet: every agent state is drawn
 * truthfully, a robot opens its conversation, and the list selects on the
 * map. The macOS app draws the world; here its side of the bridge is a stub
 * that answers as Swift does, so the page's bridge world and React's wiring
 * run for real. Every /api request is answered in the browser; none reaches
 * a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { MAC, small, ws } from "./fleets";

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

const { hosts, projects, workspaces, agents, permissions } = small;

/** The macOS app's side of the world bridge, stubbed: ready once the art
 * arrives, keeping what the page sends. */
async function nativeHost(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    const host: { sent: string[]; selected: string | null; focused: string | null } = { sent: [], selected: null, focused: null };
    (window as any).__native = host;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            host.sent.push(m.type);
            if (m.type === "art")
              setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            if (m.type === "select") host.selected = m.id;
            if (m.type === "focus") host.focused = m.id;
          },
        },
      },
    };
  });
}
/** What Swift reports from the map: a pick, or the pointer over an entity. */
const swift = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((d) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: d })), detail);

async function open(): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await nativeHost(page);
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
  flags: Record<string, { ci?: string; review?: string }>;
  planted: {
    workspace: string;
    flag: string;
    sway: boolean;
    footOffset: number;
    plantInCell: boolean;
  }[];
};
const inspect = (page: Page) =>
  page.evaluate(() => (window as any).paseoAtlas?.inspect() as Inspect | undefined);
const agentKey = (id: string, host = "local") => JSON.stringify([host, id]);


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
  await page.context().close();
});

test("picking a robot opens its conversation; the list selects on the map", async () => {
  const page = await open();
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  const key = agentKey("a-failed");
  // The pointer over the robot: its tooltip, where Swift says it stands.
  await swift(page, { type: "hover", id: key, x: 300, y: 200 });
  const tip = await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t,
    "a tooltip",
  );
  assert.match(tip!, /Breaker.*Failed/);
  await swift(page, { type: "pick", id: key });
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
  // The selection reaches Swift, which draws it.
  assert.equal(await page.evaluate(() => (window as any).__native.selected), agentKey("a-question"));
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
          window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "pick", id: key } })),
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
    await nativeHost(page);
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
        window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "pick", id: key } })),
      agentKey("a-failed"),
    );
    await page.locator(".session-title h2", { hasText: "Breaker" }).waitFor();
    const chip = page.locator(".pr-chip");
    await chip.locator(".pr-queue", { hasText: "2" }).waitFor();
    assert.equal(await chip.locator(".link-chip-state").textContent(), "Queued for merge");
    assert.equal(await chip.locator(".pr-ci").getAttribute("data-ci"), "failing");
    assert.equal(
      await chip.getAttribute("data-tip"),
      "Tighten the schema\nCheck failing: lint\nIn merge queue: position 2, awaiting checks (G)",
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

test("Enter focuses the chat input; G and L open the PR and Linear issue", async () => {
  const i = workspaces.findIndex((w) => w.workspaceId === "wks_c");
  const before = workspaces[i];
  workspaces[i] = {
    ...before,
    branch: "owen/api-123-schema",
    pr: {
      number: 42,
      title: "Tighten the schema",
      state: "open",
      url: "https://github.com/acme/api/pull/42",
    },
  } as typeof before;
  try {
    const context = await newContext(browser);
    await context.addInitScript(() => {
      localStorage.setItem("paseo-command:linear-workspace", JSON.stringify("acme"));
      (window as any).__opened = [];
      window.open = ((url: string) => {
        (window as any).__opened.push(url);
        return null;
      }) as typeof window.open;
    });
    const page = await context.newPage();
    await nativeHost(page);
    await mockApi(page, {
      agents: () => agents,
      permissions: () => permissions,
      hosts: () => hosts,
      projects: () => projects,
      workspaces: () => workspaces,
    });
    await page.goto(app.url);
    await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
    const opened = () => page.evaluate(() => (window as any).__opened as string[]);
    const pick = (kind: string, key: string) =>
      page.evaluate(
        ([, key]) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "pick", id: key } })),
        [kind, key],
      );
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // A workspace: no chat input to focus, but its PR and issue open.
    await pick("workspace", JSON.stringify(["local", "wks_c"]));
    await page.locator(".section-label", { hasText: "Agents here" }).waitFor();
    await blur();
    await page.keyboard.press("g");
    await page.keyboard.press("l");
    await waitFor(opened, (o) => o.length === 2, "the workspace's links to open");
    assert.deepEqual(await opened(), [
      "https://github.com/acme/api/pull/42",
      "https://linear.app/acme/issue/API-123",
    ]);
    await page.keyboard.press("Enter");
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), "composer");
    // A new agent's chat input takes Enter too.
    await page.keyboard.press("d");
    await page.locator("#composer:not([disabled])").waitFor();
    await blur();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "composer");
    await blur();
    await page.keyboard.press("Escape");
    await page.locator("#composer").waitFor({ state: "detached" });

    // An agent in it: Enter focuses its composer, G and L still open its links.
    await pick("agent", agentKey("a-failed"));
    await page.locator(".session-title h2", { hasText: "Breaker" }).waitFor();
    await page.locator("#composer:not([disabled])").waitFor();
    await blur();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "composer");
    await blur();
    await page.keyboard.press("g");
    await page.keyboard.press("l");
    await waitFor(opened, (o) => o.length === 4, "the agent's links to open");
    assert.deepEqual((await opened()).slice(2), [
      "https://github.com/acme/api/pull/42",
      "https://linear.app/acme/issue/API-123",
    ]);

    // An agent without a PR or issue opens nothing.
    await pick("agent", agentKey("a-running"));
    await page.locator(".session-title h2", { hasText: "Runner" }).waitFor();
    await blur();
    await page.keyboard.press("g");
    await page.keyboard.press("l");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await opened()).length, 4);
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

test("workspace PR labels plant flags on the map", async () => {
  const a = workspaces.find((w) => w.workspaceId === "wks_a")! as Record<string, unknown>;
  const b = workspaces.find((w) => w.workspaceId === "wks_b")! as Record<string, unknown>;
  a.labels = ["CI running", "Awaiting review"];
  b.labels = ["CI green", "Approved", "bug"];
  try {
    const page = await open();
    const flags = (await waitFor(
      async () => (await inspect(page))?.flags,
      (f) => !!f && Object.keys(f).length === 2,
      "the Atlas to plant both workspaces' flags",
      30000,
    ))!;
    assert.deepEqual(flags, {
      [agentKey("wks_a")]: { ci: "ci-running", review: "review-awaiting" },
      [agentKey("wks_b")]: { ci: "ci-green", review: "review-approved" },
    });
    // Each is sent to Swift standing at its own cell's centre, in place of that cell's plant;
    // the running CI flag sways.
    const planted = (await inspect(page))!.planted;
    assert.deepEqual(
      planted.map((p) => [p.workspace, p.flag]).sort(),
      [
        [agentKey("wks_a"), "ci-running"],
        [agentKey("wks_a"), "review-awaiting"],
        [agentKey("wks_b"), "ci-green"],
        [agentKey("wks_b"), "review-approved"],
      ],
    );
    for (const p of planted) {
      assert.equal(p.sway, p.flag === "ci-running", `${p.flag} sways only while CI runs`);
      assert.ok(p.footOffset < 0.5, `${p.flag} stands at its cell's centre`);
      assert.ok(!p.plantInCell, `${p.flag} replaces its cell's plant`);
    }
    // The legend explains them.
    const legend = page.locator('section[aria-label="Map legend"]');
    await legend.getByText("Workspace flag · PR").waitFor();
    for (const name of ["CI running", "CI green", "CI failing", "Awaiting review", "Approved", "Changes requested"])
      assert.equal(await legend.getByText(name, { exact: true }).count(), 1, name);
    // The labeller takes them away (merged, say): the flags go too.
    delete a.labels;
    await waitFor(
      async () => (await inspect(page))?.flags,
      (f) => !!f && !(agentKey("wks_a") in f) && agentKey("wks_b") in f,
      "wks_a's flags to come down",
    );
    await page.context().close();
  } finally {
    delete a.labels;
    delete b.labels;
  }
});

test("merge conflicts fly in the review flag's place, and a flag's tooltip describes it", async () => {
  const b = workspaces.find((w) => w.workspaceId === "wks_b")! as Record<string, unknown>;
  b.labels = ["CI failing", "Approved", "Merge conflicts"];
  b.pr = {
    number: 7,
    title: "Plant flags",
    state: "open",
    url: "https://github.com/acme/app/pull/7",
    review: "approved",
    conflicts: true,
    ci: {
      state: "failing",
      checks: [
        { name: "lint", status: "failure" },
        { name: "unit", status: "success" },
      ],
    },
  };
  try {
    const page = await open();
    const key = agentKey("wks_b");
    await waitFor(
      async () => (await inspect(page))?.flags?.[key],
      (f) => f?.review === "conflicts",
      "the conflicts flag",
      30000,
    );
    const planted = (await inspect(page))!.planted.filter((p) => p.workspace === key);
    assert.deepEqual(planted.map((p) => p.flag).sort(), ["ci-failing", "conflicts"]);
    for (const p of planted) assert.ok(p.footOffset < 0.5, `${p.flag} stands at its cell's centre`);
    const tip = () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => "");
    // Swift reports the flag under the pointer along with its workspace.
    await swift(page, { type: "hover", id: key, flag: "conflicts", x: 300, y: 200 });
    const conflicts = await waitFor(tip, (t) => !!t?.includes("Merge conflicts"), "the conflicts flag's tooltip");
    assert.match(conflicts!, /conflicts with its base branch/);
    assert.match(conflicts!, /#7 · Plant flags/);
    await swift(page, { type: "hover", id: key, flag: "ci-failing", x: 280, y: 200 });
    const failing = await waitFor(tip, (t) => !!t?.includes("CI failing"), "the CI flag's tooltip");
    assert.match(failing!, /1 of 2 checks failed\./);
    // Off the flag, the workspace's own card returns.
    await swift(page, { type: "hover", id: key, x: 300, y: 200 });
    await waitFor(tip, (t) => !!t && /Workspace · /.test(t) && !t.includes("CI failing"), "the workspace's tooltip");
    await page.locator('section[aria-label="Map legend"]').getByText("Merge conflicts", { exact: true }).waitFor();
    await page.context().close();
  } finally {
    delete b.labels;
    delete b.pr;
  }
});

test("current work appears in the running agent tooltip and above its composer, then clears on idle", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await nativeHost(page);
  let status = "running";
  const requests: { path: string; body: unknown }[] = [];
  const sentence = "Fitting project islands within their host landmass.";
  await mockApi(page, {
    agents: () => [{ ...agents[0], status }],
    permissions: () => [],
    hosts: () => hosts.slice(0, 1),
    projects: () => projects.slice(0, 1),
    workspaces: () => workspaces.slice(0, 1),
    detail: () => ({ Status: status, PendingPermissions: [], Modes: [] }),
    timeline: () => ({ items: [] }),
    accept: (path, body) => {
      requests.push({ path, body });
      return path === "/api/agents/a-running/working-on" ? { sentence, pending: false } : false;
    },
  });
  await page.goto(app.url);
  const key = agentKey("a-running");
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  await waitFor(async () => requests.length, (n) => n > 0, "the summary request");
  await swift(page, { type: "hover", id: key, x: 300, y: 200 });
  await waitFor(() => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t?.includes(sentence), "the generated summary in the tooltip");
  await swift(page, { type: "pick", id: key });
  await page.locator(".session-working-on").waitFor();
  assert.equal(await page.locator(".session-working-on").textContent(), sentence);
  assert.equal(await page.locator(".session-working-on").evaluate((el) => el.nextElementSibling?.classList.contains("composer2")), true);
  if (process.env.ATLAS_SHOT) await page.screenshot({ path: `${process.env.ATLAS_SHOT}/working-on-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".session-working-on").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  if (process.env.ATLAS_SHOT) await page.screenshot({ path: `${process.env.ATLAS_SHOT}/working-on-mobile.png` });
  status = "idle";
  await waitFor(() => page.locator(".session-working-on").count(), (n) => n === 0, "idle to clear the active summary");
  assert.ok(requests.every((r) => r.path === "/api/agents/a-running/working-on"));
  await context.close();
});

/**
 * The Crew map (src/crew/): the fleet as a chat app, drawn by the page in the map's place, in a plain browser as in
 * the macOS app. The map groups host › project › workspace, each workspace a panel of its agents' robots (the
 * board's robots, marks and PR medallions); picking one opens the app's own detail across the view (one copy: the
 * side panel is absent). With the app's bridge stubbed, it tells the app the page draws the map, that the fleet is
 * in and where the map's place is, and shows the open agent's browser beside its conversation.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { appEvent, detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { dungeon, sideBySide } from "./fleets";

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

type Sent = { type: string; [field: string]: any };
async function open(opts: { mac?: boolean; style?: string; fleet?: typeof dungeon; usage?: Record<string, number>; lists?: Record<string, unknown>; detail?: Record<string, unknown>; accept?: (path: string, body: unknown) => unknown; timeline?: unknown[] } = {}): Promise<Page> {
  const fleet = opts.fleet ?? dungeon;
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ([style, mac]) => {
      if (!sessionStorage.getItem("e2e-opened")) localStorage.setItem("paseo-command:atlas:style", JSON.stringify(style));
      sessionStorage.setItem("e2e-opened", "1");
      if (!mac) return;
      const sent: unknown[] = [];
      (window as any).__sent = sent;
      (window as any).webkit = {
        messageHandlers: {
          paseoWorld: {
            postMessage(m: any) {
              if (m.type === "art") setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
              if (["pageMap", "mapStyle", "loaded", "workspace", "viewport", "barState", "art", "detach", "browser", "browserDo", "openLink", "glanceClick"].includes(m.type)) sent.push(m);
            },
          },
        },
      };
    },
    [opts.style ?? "crew", !!opts.mac] as const,
  );
  await mockApi(page, {
    agents: () => fleet.agents,
    permissions: () => fleet.permissions,
    hosts: () => fleet.hosts,
    projects: () => fleet.projects,
    workspaces: () => fleet.workspaces,
    detail: (id: string) => {
      const row = (dungeon.agents as unknown as { id: string; status: string }[]).find((a) => a.id === id);
      return detailOf(id, row?.status ?? "idle", { ...(opts.usage ? { LastUsage: opts.usage } : {}), ...opts.detail });
    },
    timeline: () => ({ items: opts.timeline ?? [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done. Shall I open the pull request?", messageId: "r1" }] }),
    accept: opts.accept ?? (() => true),
    ...(opts.lists ? { lists: opts.lists } : {}),
  } as any);
  await page.goto(app.url);
  return page;
}
const sent = (page: Page, type: string) => page.evaluate((t) => ((window as any).__sent as Sent[]).filter((m) => m.type === t), type);
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const map = (page: Page) => page.getByRole("region", { name: "Crew" });

test("in a browser: the map groups host, project and workspace, each workspace a panel of robots, and there's no side panel", async () => {
  const page = await open();
  await map(page).locator(".crew-node").first().waitFor();
  // Every agent once, in its workspace's panel; running ones in their work pose.
  assert.equal(await page.locator(".crew-node").count(), dungeon.agents.filter((a) => !(a as { child?: unknown }).child).length);
  assert.ok((await page.locator('.crew-node[data-state="running"] .crew-bot.work').count()) > 0);
  // Hosts, then their projects, then their workspaces, as the graphical maps group them.
  const hosts = await page.locator(".crew-host").count();
  assert.ok(hosts >= 2, `hosts: ${hosts}`);
  const first = page.locator(".crew-host").first();
  assert.ok((await first.locator(".crew-project").count()) > 0);
  assert.ok((await first.locator(".crew-project").first().locator(".crew-ws .crew-node").count()) > 0);
  await page.getByRole("heading", { name: "Your crew" }).waitFor();
  // No filter, Add project or New agent on the map: they're ⌘K's (New agent ⌘N, Add project; its search finds agents).
  for (const name of ["New agent", "Add project"]) assert.equal(await map(page).getByRole("button", { name }).count(), 0, name);
  assert.equal(await page.getByRole("textbox", { name: "Filter agents" }).count(), 0);
  // No side panel, no panel buttons in the bar, no roster, no notice.
  await page.locator('.floating-command[data-absent="true"]').waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: /session panel/ }).count(), 0);
  assert.equal(await page.locator(".atlas-world-notice").count(), 0, "no 'drawn by the macOS app' notice");
  await page.context().close();
});

const GLANCE = {
  linear: {
    groups: [
      { state: "In Progress", type: "started", color: "#f2c94c", total: 2, issues: [
        { id: "a", key: "DE-1", title: "Fix the login form", url: "https://linear.app/acme/issue/DE-1", team: "DE", priority: 2, updatedAt: "2026-11-02T00:00:00Z" },
        { id: "b", key: "DE-2", title: "Speed up search", url: "https://linear.app/acme/issue/DE-2", team: "DE", priority: 0, updatedAt: "2026-11-01T00:00:00Z" },
      ] },
      { state: "In Review", type: "started", color: "#0f783c", total: 1, issues: [
        { id: "c", key: "DE-3", title: "Ship the glance", url: "https://linear.app/acme/issue/DE-3", team: "DE", priority: 0, updatedAt: "2026-11-01T00:00:00Z" },
      ] },
      { state: "Todo", type: "unstarted", color: "", total: 0, issues: [] },
    ],
  },
  github: {
    review: { total: 1, rows: [{ id: "p1", repo: "acme/app", number: 12, title: "Add a cache", url: "https://github.com/acme/app/pull/12", state: "open", checks: "passing", updatedAt: "2026-11-01T00:00:00Z", author: "sam" }] },
    assigned: { total: 0, rows: [] },
  },
  health: { checkedAt: Date.now(), up: true, took: 80, services: [{ name: "pgsql", ms: 0.47 }, { name: "redis-cache", ms: 1.4 }, { name: "mongodb", ms: 3.2 }] },
};

test("at a glance: your Linear issues by state, the PRs asking you and Diagonal's health sit on the top bar, left of the gear, each opening a menu", async () => {
  const page = await open({ lists: { settings: { integrations: { linear: true, github: true, health: true, typesafe: false } }, glance: GLANCE } });
  const glance = page.locator(".app-bar").getByRole("group", { name: "At a glance" });
  await glance.waitFor();
  assert.equal(await map(page).locator(".crew-glance").count(), 0, "not on the crew's head");
  // Each group's name, then its counts: Linear's states, GitHub's two lists, Diagonal's slowest service.
  assert.deepEqual(await glance.locator(".crew-glance-source").allTextContents(), ["Linear", "GitHub", "Diagonal"]);
  assert.deepEqual((await glance.locator(".crew-glance-count").allTextContents()).map((t) => t.trim()), ["2", "1", "0", "1", "0", "3.20 ms"]);
  // Left of the Settings gear, on the bar's row.
  const [strip, gear] = await Promise.all([glance, page.locator(".app-bar").getByRole("button", { name: "Settings", exact: true })].map((l) => l.evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(strip.right <= gear.left + 1 && Math.abs(strip.top + strip.height / 2 - (gear.top + gear.height / 2)) <= 2, `left of the gear: ${JSON.stringify({ strip, gear })}`);
  // A light for each service: green under 1 ms, yellow under 3, red past it; the count is as bad as the worst.
  const diagonal = glance.getByRole("button", { name: /^Diagonal health:/ });
  assert.deepEqual(await diagonal.locator(".crew-glance-dot").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor)), ["rgb(63, 191, 134)", "rgb(242, 201, 76)", "rgb(210, 69, 47)"]);
  assert.equal(await diagonal.getAttribute("data-tone"), "bad");
  // A state's chip lists its issues, newest first; one opens where it lives (a browser tab here).
  await page.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((url: string) => ((window as any).__opened.push(url), null)) as typeof window.open;
  });
  // Every count's menu opens beneath it, whole: nothing of the panel or the board clips it.
  for (const [button, name] of [
    ["In Progress: 2 issues", "Your issues in progress"],
    ["Review requests: 1 pull request", "Pull requests asking your review"],
    ["Assigned to you: 0 pull requests", "Pull requests assigned to you"],
    [/^Diagonal health:/, "Diagonal's health"],
  ] as const) {
    const count = page.getByRole("button", { name: button });
    await count.click();
    const shown = page.getByRole("menu", { name });
    await shown.waitFor();
    const seen = await shown.evaluate((el, chip) => {
      const r = el.getBoundingClientRect();
      const c = chip!.getBoundingClientRect();
      // Each corner (a little inside) is the menu's own, not something drawn over or clipping it.
      const corners = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
      return { below: r.top >= c.bottom - 1, place: el.dataset.place, whole: corners.every(([x, y]) => el.contains(document.elementFromPoint(x!, y!))) };
    }, await count.elementHandle());
    assert.deepEqual(seen, { below: true, place: "down", whole: true }, `${name}: ${JSON.stringify(seen)}`);
    await page.keyboard.press("Escape");
    await shown.waitFor({ state: "detached" });
  }
  await page.getByRole("button", { name: "In Progress: 2 issues" }).click();
  const menu = page.getByRole("menu", { name: "Your issues in progress" });
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Fix the login formDE-1", "Speed up searchDE-2"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => (window as any).__opened), ["https://linear.app/acme/issue/DE-2"]);
  // Esc closes a menu, back on its chip.
  await page.getByRole("button", { name: "Review requests: 1 pull request" }).click();
  await page.getByRole("menu", { name: "Pull requests asking your review" }).getByRole("menuitem", { name: /Add a cache/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  // ⌘K opens Diagonal's health: each service and its time.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Diagonal’s health");
  await palette(page).getByRole("option", { name: /Show Diagonal’s health/ }).click();
  const health = page.getByRole("menu", { name: "Diagonal's health" });
  await health.waitFor();
  assert.match((await health.textContent())!, /pgsql0\.47 ms.*redis-cache1\.40 ms.*mongodb3\.20 ms/);
  await page.context().close();
});

test("in the macOS app the glance is the native bar's: the page sends its counts and opens a count's menu beneath it", async () => {
  const page = await open({ mac: true, lists: { settings: { integrations: { linear: true, github: true, health: true, typesafe: false } }, glance: GLANCE } });
  const counts = () => sent(page, "barState").then((m) => (m.at(-1)?.glance ?? []) as { id: string; group: string; text: string; tone: string; dots: string[] }[]);
  await waitFor(counts, (c) => c.length === 6, "the counts sent to the bar");
  assert.deepEqual((await counts()).map((c) => [c.id, c.group, c.text, c.tone]), [
    ["linear:in progress", "Linear", "2", ""],
    ["linear:in review", "Linear", "1", ""],
    ["linear:todo", "Linear", "0", "none"],
    ["review", "GitHub", "1", "ask"],
    ["assigned", "GitHub", "0", "none"],
    ["health", "Diagonal", "3.20 ms", "bad"],
  ]);
  assert.equal(await page.locator(".crew-glance").count(), 0, "the page draws no counts of its own");
  // The native count's click: its menu beneath where the app says it is.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:bar", { detail: { action: "glance:review", x: 900, y: -32, width: 40, height: 22 } })));
  const menu = page.getByRole("menu", { name: "Pull requests asking your review" });
  await menu.waitFor();
  const box = (await menu.boundingBox())!;
  assert.ok(Math.abs(box.x - 900) <= 1 && box.y >= 0 && box.y <= 12, `beneath it: ${JSON.stringify(box)}`);
  await menu.getByRole("menuitem", { name: /Add a cache/ }).waitFor();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  // ⌘K asks the app to click the count, so the menu opens beneath it.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("asking your review");
  await palette(page).getByRole("option", { name: /Show pull requests asking your review/ }).click();
  await waitFor(() => sent(page, "glanceClick"), (m) => m.length === 1, "the app asked to click it");
  assert.equal((await sent(page, "glanceClick"))[0]!.id, "review");
  await page.context().close();
});

test("at a glance shows nothing while Linear, GitHub and Diagonal health are off, and asks nothing", async () => {
  let asked = 0;
  const page = await open({ lists: { settings: { integrations: { linear: false, github: false, health: false, typesafe: false } } } });
  page.on("request", (r) => r.url().includes("/api/glance") && asked++);
  await map(page).locator(".crew-node").first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".crew-glance").count(), 0);
  assert.equal(asked, 0);
  await page.context().close();
});

test("in a browser, picking a robot opens it in focus (the map steps aside, ← Crew goes back), its robot above the message box and beside its replies; Esc leaves the message box, then closes it", async () => {
  const page = await open();
  const node = page.locator('.crew-node[data-state="idle"]').first();
  const name = (await node.locator(".crew-node-name").textContent())!;
  const key = (await node.getAttribute("data-key"))!;
  await node.click();
  await page.locator(".crew-drawer .crew-detail .session").waitFor();
  assert.equal(await page.locator(".session").count(), 1, "one copy of the conversation");
  assert.equal(await page.locator(".crew-board").count(), 1, "the map is kept");
  assert.equal(await node.getAttribute("aria-current"), "true");
  // Focus (in a browser): the map steps aside, the conversation takes the window under a strip back to the crew.
  assert.equal(await page.locator(".crew-board").evaluate((el) => getComputedStyle(el).visibility), "hidden", "the map steps aside");
  const focusStrip = page.getByRole("navigation", { name: "The crew" });
  await focusStrip.waitFor();
  const [stripBox, drawer] = await Promise.all([focusStrip, page.locator(".crew-drawer")].map((l) => l.evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(drawer.top >= stripBox.bottom - 1 && drawer.left <= 1 && drawer.width >= stripBox.width - 2, `the conversation under the strip, the window wide: ${JSON.stringify({ stripBox, drawer })}`);
  // The strip is only ← Crew now (no tabs for the other robots: the user's call); the conversation's own "← Fleet"
  // gives way to it.
  assert.equal(await focusStrip.locator(".crew-focus-agent").count(), 0);
  await focusStrip.getByRole("button", { name: "Crew" }).waitFor();
  assert.equal(await page.locator(".crew-drawer .session-back").isVisible(), false);
  // The robot, its state and progress sit at the foot, above the message box.
  const stage = page.locator(".crew-detail .session-footer .crew-stage");
  assert.equal(await stage.getAttribute("data-state"), "idle");
  const [strip, input] = await Promise.all([stage, page.locator(".crew-detail .session-footer textarea").first()].map((l) => l.evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(strip.bottom <= input.top + 1, "above the message box");
  await page.locator(".crew-detail .msg.assistant .msg-avatar .crew-bot").waitFor();
  assert.match((await page.locator(".crew-detail .session-title").textContent())!, new RegExp(name));
  assert.equal(await page.locator(".crew-stage button").count(), 0, "no buttons on the card");
  // Esc in the message box only leaves it; the next Esc closes the conversation, and the robot it left has the keyboard.
  const box = page.locator(".crew-detail .session-footer textarea").first();
  await box.focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.activeElement?.matches("textarea"));
  assert.equal(await page.locator(".crew-drawer").count(), 1, "still open after leaving the message box");
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
  await page.waitForFunction((k) => document.activeElement?.getAttribute("data-key") === k, key);
  // The arrow keys move through the map.
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("data-key")), key);
  // A workspace's head opens the workspace beside the map (no focus); Esc closes that too.
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  assert.equal(await page.locator(".crew-stage").count(), 0);
  assert.equal(await page.locator(".crew-board").evaluate((el) => getComputedStyle(el).visibility), "visible", "the map stays beside a workspace");
  assert.equal(await page.getByRole("navigation", { name: "The crew" }).count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
  await page.context().close();
});

test("a started conversation's permission mode still changes, from its message box and from ⌘K", async () => {
  const posts: { path: string; body: any }[] = [];
  const page = await open({
    detail: { Mode: "default", AvailableModes: [{ id: "default", label: "Always Ask" }, { id: "acceptEdits", label: "Accept Edits" }, { id: "plan", label: "Plan" }] },
    accept: (path, body) => (posts.push({ path, body }), true),
  });
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await page.locator(".crew-drawer .session .msg.user").first().waitFor();
  // Started: the mode is a picker in the settings line, set to the conversation's mode.
  const picker = page.locator(".crew-drawer .session-footer").getByLabel("Permission mode");
  await picker.waitFor({ state: "attached" });
  assert.equal(await picker.inputValue(), "default");
  assert.equal(await picker.isDisabled(), false);
  assert.equal((await page.locator(".crew-drawer .session-footer .agent-controls .control > span").allInnerTexts()).join(" "), "Always Ask");
  await picker.selectOption("plan");
  await waitFor(() => posts.find((p) => p.path.endsWith("/mode")), Boolean, "the mode to be set");
  assert.equal(posts.find((p) => p.path.endsWith("/mode"))!.body.mode, "plan");
  // ⌘K offers the other modes.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("permission mode");
  const options = palette(page).getByRole("option", { name: /^Set the permission mode/ });
  await options.first().waitFor();
  assert.deepEqual(
    (await options.allTextContents()).map((t) => t.replace(/Command.*$/, "").trim()),
    ["Set the permission mode: Accept Edits", "Set the permission mode: Plan"],
    "every mode but the one it's in",
  );
  await palette(page).getByRole("option", { name: /Set the permission mode: Accept Edits/ }).click();
  await waitFor(() => posts.filter((p) => p.path.endsWith("/mode")).length, (n) => n === 2, "the second mode change");
  assert.equal(posts.filter((p) => p.path.endsWith("/mode"))[1]!.body.mode, "acceptEdits");
  await page.context().close();
});

test("a row's workspace panels are one height, and so are their robots", async () => {
  const page = await open();
  await map(page).locator(".crew-node").first().waitFor();
  const rows = await page.locator(".crew-workspaces").evaluateAll((grids) =>
    grids.map((g) => {
      const panels = [...g.querySelectorAll(":scope > .crew-ws")].map((el) => el.getBoundingClientRect());
      const byTop = new Map<number, number[]>();
      for (const r of panels) byTop.set(Math.round(r.top), [...(byTop.get(Math.round(r.top)) ?? []), Math.round(r.height)]);
      return [...byTop.values()];
    }),
  );
  let compared = 0;
  for (const row of rows.flat()) if (row.length > 1) {
    compared++;
    assert.equal(new Set(row).size, 1, `heights ${row}`);
  }
  assert.ok(compared > 0, "some row has several panels");
  const nodes = await page.locator(".crew-node").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  assert.equal(new Set(nodes).size, 1, `node heights ${[...new Set(nodes)]}`);
  await page.context().close();
});

test("the panel beside the map (a workspace) resizes from its left edge, and keeps its width", async () => {
  const page = await open();
  await map(page).locator(".crew-node").first().waitFor();
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  const width = () => page.locator(".crew-drawer").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const before = await width();
  const edge = page.getByRole("separator", { name: "Resize the conversation" });
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = await width();
  assert.ok(Math.abs(dragged - (before + 150)) <= 2, `${before} → ${dragged}`);
  // The keyboard nudges it; it never takes all the map.
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await width(), dragged + 16);
  for (let i = 0; i < 80; i++) await page.keyboard.press("Shift+ArrowLeft");
  const widest = await width();
  const mapLeft = await page.locator(".crew-board").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.ok(mapLeft >= 318, `the map keeps ${mapLeft}px`);
  // Kept across a reload; a double-click puts the default back.
  await page.reload();
  await page.locator(".crew-drawer .place").first().waitFor();
  assert.equal(await width(), widest);
  await page.getByRole("separator", { name: "Resize the conversation" }).dblclick();
  assert.equal(await width(), before);
  await page.context().close();
});

test("the pages keep the Galaxy theme while Crew is the map style, whatever tab shows", async () => {
  const page = await open();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await map(page).locator(".crew-node").first().waitFor();
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await theme(), "galaxy");
  // Settings (or GitHub, Activity): Crew gives way, the theme stays.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "settings" } })));
  await page.locator(".crew-map").waitFor({ state: "detached" });
  await page.waitForTimeout(100);
  assert.equal(await theme(), "galaxy");
  await page.context().close();
});

test("a workspace's medallions show what they mean on hover", async () => {
  const labelled = structuredClone(dungeon);
  labelled.workspaces[0]!.labels = ["CI running", "Awaiting review"];
  const page = await open({ fleet: labelled });
  const ws = page.locator(".crew-ws").filter({ has: page.locator(".crew-medals") }).first();
  const medal = ws.locator(".crew-medals .crew-status").first();
  await medal.waitFor();
  await medal.hover();
  const tip = page.locator(".tooltip.shown");
  await tip.waitFor();
  assert.match((await tip.textContent())!, /^CI running/);
  await ws.locator(".crew-medals .crew-status").nth(1).hover();
  await page.waitForFunction(() => /^Awaiting review/.test(document.querySelector(".tooltip.shown")?.textContent ?? ""));
  await page.context().close();
});

test("the conversation's header shows how full its context window is", async () => {
  const page = await open({ usage: { ContextUsedTokens: 150_000, ContextMaxTokens: 200_000, InputTokens: 1200, CachedTokens: 48_000, OutputTokens: 900, CostUsd: 0.4 } });
  await page.locator('.crew-node[data-state="idle"]').first().click();
  const meter = page.locator(".crew-detail .session-meta .context-meter");
  await meter.waitFor();
  assert.match((await meter.textContent())!, /150k \/ 200k · 75%$/);
  assert.equal(await meter.getAttribute("data-level"), "high");
  assert.ok(Number(await meter.locator(".context-ring-fill").getAttribute("stroke-dasharray").then((d) => d!.split(" ")[0])) > 0);
  await meter.hover();
  await page.waitForFunction(() => /^Context: 150,000 of 200,000 tokens \(75%\); last turn 1\.2k in · 48k cached · 900 out · \$0\.40/.test(document.querySelector(".tooltip.shown")?.textContent ?? ""));
  await page.context().close();
});

test("tiles lie on their side, shorter, when the map is narrowed by what opens beside it", async () => {
  const page = await open();
  const node = page.locator('.crew-node[data-state="idle"]').first();
  await node.waitFor();
  const shape = () =>
    node.evaluate((el) => {
      const r = el.getBoundingClientRect(), bot = el.querySelector(".crew-portrait")!.getBoundingClientRect(), text = el.querySelector(".crew-node-text")!.getBoundingClientRect();
      return { width: r.width, height: r.height, beside: bot.right <= text.left + 1 };
    });
  const tall = await shape();
  assert.equal(tall.beside, false, "standing: the name under the robot");
  // A workspace opens beside the map (an agent opens in focus, the map stepping aside).
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  const side = await shape();
  assert.equal(side.beside, true, "on its side: the name beside the robot");
  assert.ok(side.height < tall.height * 0.6 && side.width > tall.width, `${JSON.stringify(tall)} → ${JSON.stringify(side)}`);
  // A working robot's bar runs its text's full width, to the tile's right padding.
  const bar = await page.locator('.crew-board .crew-node[data-state="running"]').first().evaluate((el) => {
    const r = el.getBoundingClientRect(), text = el.querySelector(".crew-node-text")!.getBoundingClientRect(), bar = el.querySelector(".crew-progress")!.getBoundingClientRect();
    return { left: bar.left - text.left, right: text.right - bar.right, toEdge: r.right - bar.right, pad: parseFloat(getComputedStyle(el).paddingRight) };
  });
  assert.ok(Math.abs(bar.left) <= 1 && Math.abs(bar.right) <= 1 && Math.abs(bar.toEdge - bar.pad) <= 2, `bar spans the text: ${JSON.stringify(bar)}`);
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
  assert.equal((await shape()).beside, false, "standing again with the room back");
  await page.context().close();
});

test("the map's header keeps its title readable when the conversation narrows the map: the tools wrap beneath it", async () => {
  const page = await open();
  // The drawer as wide as it goes leaves the board 320–500 px.
  await page.evaluate(() => localStorage.setItem("paseo-command:crew:drawerWidth", JSON.stringify(760)));
  await page.reload();
  const node = page.locator(".crew-node").first();
  await node.waitFor();
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  for (const width of [1260, 1100, 1000, 920]) {
    await page.setViewportSize({ width, height: 800 });
    const head = await page.locator(".crew-board-head").evaluate((el) => {
      const line = el.querySelector(".crew-board-title h2")!, title = line.getBoundingClientRect();
      const parts = [...el.querySelectorAll(".crew-board-title, .crew-glance")].map((p) => p.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], b = parts[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
        }
      const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || title.height;
      return { board: el.getBoundingClientRect().width, titleLines: Math.round(title.height / lineHeight), overlap, fits: parts.every((r) => r.right <= el.getBoundingClientRect().right + 1) };
    });
    assert.equal(head.titleLines, 1, `"Your crew" on one line at ${width}px: ${JSON.stringify(head)}`);
    assert.equal(head.overlap, false, `nothing in the header overlaps at ${width}px`);
    assert.equal(head.fits, true, `the header fits the board at ${width}px: ${JSON.stringify(head)}`);
  }
  await page.context().close();
});

test("cards keep to one grid of equal columns, each spanning its robots, no row left short a card could fill; tiles fill their cards", async () => {
  // Long titles, as Linear-named workspaces and agents have: a card's width never follows its text.
  const long = structuredClone(dungeon);
  for (const w of long.workspaces) w.name = `DE-8379 · Commit custom workspace field definitions and values to Git (${w.name})`;
  for (const a of long.agents) a.name = `DE-8379 · Commit custom workspace field definitions and values to Git`;
  const page = await open({ fleet: long });
  await map(page).locator(".crew-node").first().waitFor();
  const check = () =>
    page.evaluate(() => {
      const bad: string[] = [];
      const cols = Number(getComputedStyle(document.querySelector(".crew-board")!).getPropertyValue("--crew-cols"));
      let one = 0;
      // Every group keeps to the board's columns.
      const board = document.querySelector(".crew-hosts")!.getBoundingClientRect();
      const col = (board.width - (cols - 1) * 14) / cols;
      for (const g of document.querySelectorAll(".crew-workspaces")) {
        const box = g.getBoundingClientRect();
        const cards = [...g.querySelectorAll<HTMLElement>(":scope > .crew-ws")].map((c) => ({
          label: c.getAttribute("aria-label"),
          n: Math.max(1, c.querySelectorAll(".crew-node").length),
          r: c.getBoundingClientRect(),
        }));
        let spans = 0;
        for (const c of cards) {
          const span = Math.min(cols, c.n);
          spans += span;
          const want = span * col + (span - 1) * 14;
          if (Math.abs(c.r.width - want) > 1.5) bad.push(`${c.label}: ${Math.round(c.r.width)} wide, not ${Math.round(want)} (${span} of ${cols} columns)`);
          if (c.n === 1) one = one || Math.round(c.r.width);
          if (c.n === 1 && Math.abs(Math.round(c.r.width) - one) > 1) bad.push(`${c.label}: one-robot cards differ (${Math.round(c.r.width)} vs ${one})`);
        }
        // A row ends early only where no card from a later row would fit in what it leaves.
        const tops = [...new Set(cards.map((c) => Math.round(c.r.top)))].sort((x, y) => x - y);
        for (const top of tops) {
          const room = box.right - Math.max(...cards.filter((c) => Math.round(c.r.top) === top).map((c) => c.r.right));
          const later = cards.filter((c) => Math.round(c.r.top) > top);
          for (const c of later) if (c.r.width + 14 <= room + 1.5) bad.push(`${c.label} would fit in the ${Math.round(room)}px a row above leaves`);
        }
        void spans;
      }
      // Tiles fill each line of their card.
      for (const n of document.querySelectorAll(".crew-nodes")) {
        const right = n.getBoundingClientRect().right - parseFloat(getComputedStyle(n).paddingRight);
        const ends = new Map<number, number>();
        for (const el of n.querySelectorAll(":scope > .crew-node")) {
          const r = el.getBoundingClientRect();
          ends.set(Math.round(r.top), Math.max(ends.get(Math.round(r.top)) ?? 0, r.right));
        }
        for (const end of ends.values()) if (right - end > 1.5) bad.push(`tiles leave ${Math.round(right - end)}px`);
      }
      return { cols, bad };
    });
  const wide = await check();
  assert.ok(wide.cols >= 3, `columns: ${wide.cols}`);
  assert.deepEqual(wide.bad, []);
  // A workspace opens beside the map (an agent opens in focus, the map stepping aside).
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  await page.waitForTimeout(100);
  const narrow = await check();
  assert.ok(narrow.cols < wide.cols, `fewer columns beside the workspace: ${narrow.cols}`);
  assert.deepEqual(narrow.bad, []);
  await page.context().close();
});

test("a folded project or host shows its agents' states as a tally on its head", async () => {
  const page = await open();
  await page.locator(".crew-node").first().waitFor();
  const project = page.locator(".crew-project").first();
  const states = await project.locator(".crew-node").evaluateAll((els) => els.map((el) => el.getAttribute("data-state")));
  assert.equal(await project.locator(".crew-tally").count(), 0, "no tally while open");
  await project.locator(".crew-project-head .crew-fold").click();
  const tally = project.locator(".crew-project-head .crew-tally-item");
  await tally.first().waitFor();
  const shown = await tally.evaluateAll((els) => els.map((el) => [el.getAttribute("data-state"), Number(el.textContent)] as const));
  const expected = new Map<string, number>();
  for (const s of states) expected.set(s!, (expected.get(s!) ?? 0) + 1);
  assert.deepEqual(new Map(shown), expected, "a count for each state its agents are in");
  assert.equal(shown.length, expected.size);
  // A folded host counts all its agents.
  const host = page.locator(".crew-host[data-host]").first();
  const all = await host.locator(".crew-node").count();
  await host.locator(".crew-host-head .crew-fold").click();
  const hostTally = host.locator(".crew-host-head .crew-tally-item");
  await hostTally.first().waitFor();
  const total = (await hostTally.allTextContents()).reduce((n, t) => n + Number(t), 0);
  assert.ok(total >= all, `${total} counted, ${all} on show before folding (its folded project's too)`);
  assert.match((await host.locator(".crew-tally").getAttribute("aria-label"))!, /^\d+ /);
  await page.context().close();
});

test("small hosts and projects sit side by side, each taking only the columns its cards need", async () => {
  const page = await open({ fleet: sideBySide });
  await page.setViewportSize({ width: 1730, height: 1000 });
  await map(page).locator(".crew-node").first().waitFor();
  const boxes = async () =>
    page.evaluate(() => {
      const hosts = [...document.querySelectorAll(".crew-hosts > .crew-host")].map((h) => ({
        name: h.getAttribute("aria-label"),
        top: Math.round(h.getBoundingClientRect().top),
        left: Math.round(h.getBoundingClientRect().left),
        right: Math.round(h.getBoundingClientRect().right),
        projects: [...h.querySelectorAll(":scope > .crew-project")].map((p) => ({ name: p.getAttribute("aria-label"), top: Math.round(p.getBoundingClientRect().top), left: Math.round(p.getBoundingClientRect().left), width: Math.round(p.getBoundingClientRect().width) })),
      }));
      const cards = [...document.querySelectorAll(".crew-ws")].map((c) => Math.round(c.getBoundingClientRect().width));
      return { hosts, cards };
    });
  const wide = await boxes();
  const [local, lab] = wide.hosts;
  // This Mac's two one-card projects side by side, and the lab beside this Mac.
  assert.equal(local!.projects.length, 2);
  assert.equal(local!.projects[0]!.top, local!.projects[1]!.top, "this Mac's projects on one row");
  assert.ok(local!.projects[1]!.left > local!.projects[0]!.left);
  assert.equal(lab!.top, local!.top, "the hosts on one row");
  assert.ok(lab!.left >= local!.right, "the lab beside this Mac");
  // Every card one column wide, whatever group it's in.
  assert.ok(Math.max(...wide.cards) - Math.min(...wide.cards) <= 1, `cards: ${wide.cards}`);
  // Folding a host makes it one column: the next sits beside it.
  await page.locator(".crew-host[data-host] .crew-host-head .crew-fold").first().click();
  await waitFor(boxes, (b) => b.hosts[0]!.right - b.hosts[0]!.left <= wide.cards[0]! + 1, "the folded host one column wide");
  // Narrower, a host that doesn't fit beside another goes beneath it.
  await page.locator(".crew-host[data-host] .crew-host-head .crew-fold").first().click();
  await page.setViewportSize({ width: 1100, height: 1000 });
  await waitFor(boxes, (b) => b.hosts[1]!.top > b.hosts[0]!.top, "the lab beneath this Mac");
  await page.context().close();
});

test("hosts reorder by dragging a head, ⌥↑ / ⌥↓ on it or ⌘K, and keep their order", async () => {
  const page = await open({ fleet: sideBySide });
  await map(page).locator(".crew-node").first().waitFor();
  const order = () => page.locator(".crew-host").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  assert.deepEqual(await order(), ["local", "DIAGONAL-LAB-1"]);
  // Drag the lab's head onto this Mac's, its first half: the lab goes first.
  const lab = page.locator('.crew-host[aria-label="DIAGONAL-LAB-1"] .crew-host-head');
  const local = page.locator('.crew-host[aria-label="local"]');
  await lab.dragTo(local, { targetPosition: { x: 10, y: 10 } });
  await waitFor(order, (o) => o[0] === "DIAGONAL-LAB-1", "the lab first");
  assert.equal(await page.locator(".crew-host[data-drop], .crew-host[data-dragging]").count(), 0, "no drag marks left");
  // Kept across a reload.
  await page.reload();
  await map(page).locator(".crew-node").first().waitFor();
  assert.deepEqual(await order(), ["DIAGONAL-LAB-1", "local"]);
  // ⌥↓ on its head moves it later, keeping the keyboard.
  await page.locator('.crew-host[aria-label="DIAGONAL-LAB-1"] .crew-host-head .crew-fold').focus();
  await page.keyboard.press("Alt+ArrowDown");
  await waitFor(order, (o) => o[0] === "local", "the lab later");
  await waitFor(() => page.evaluate(() => document.activeElement?.closest(".crew-host")?.getAttribute("aria-label")), (n) => n === "DIAGONAL-LAB-1", "the head keeps the keyboard");
  // ⌘K moves it back, then resets the order.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Move host");
  assert.deepEqual(
    (await palette(page).getByRole("option", { name: /^Move host/ }).allTextContents()).map((t) => t.replace(/Command.*$/, "").trim()).sort(),
    ["Move host “DIAGONAL-LAB-1” earlier", "Move host “LOCAL” later"],
  );
  await palette(page).getByRole("option", { name: /Move host “DIAGONAL-LAB-1” earlier/ }).click();
  await waitFor(order, (o) => o[0] === "DIAGONAL-LAB-1", "earlier again");
  // And back to the fleet's order (J/K follow it too: conversationOrder.test.ts).
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Reset the host order");
  await palette(page).getByRole("option", { name: /Reset the host order/ }).click();
  await waitFor(order, (o) => o[0] === "local", "the fleet's order again");
  await page.context().close();
});

test("folded projects stay folded across a reload", async () => {
  const page = await open();
  await map(page).locator(".crew-node").first().waitFor();
  const all = await page.locator(".crew-node").count();
  const project = (await page.locator(".crew-head.project").first().textContent())!;
  await page.getByRole("button", { name: `Hide ${project}` }).first().click();
  const fewer = await page.locator(".crew-node").count();
  assert.ok(fewer < all);
  await page.reload();
  await map(page).locator(".crew-node").first().waitFor();
  assert.equal(await page.locator(".crew-node").count(), fewer, "kept across a reload");
  await page.context().close();
});

test("in the macOS app: a tool row's web address opens in the agent's browser, shown for it", async () => {
  const page = await open({
    mac: true,
    timeline: [
      { kind: "user", text: "Build the preview", messageId: "u1" },
      { kind: "tool", id: "t1", name: "Task_notification", status: "completed", summary: 'Background command "Run the preview" completed: http://localhost:4173/', detail: "Preview at http://localhost:4173/app.\nAlso https://example.com/docs" },
      { kind: "assistant", text: "The preview is up.", messageId: "r1" },
    ],
  });
  await map(page).locator(".crew-node").first().waitFor();
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await page.locator(".crew-detail .step.tool").waitFor();
  assert.equal(await page.locator(".board-browser").count(), 0, "the browser is hidden");
  // In the row's summary: the browser shows and the address opens there; the row doesn't fold open.
  await page.locator(".crew-detail .step.tool .tool-link").click();
  await page.locator(".board-browser.crew").waitFor();
  const opened = await waitFor(() => sent(page, "browserDo"), (m) => m.some((x) => x.action === "open"), "opened in the agent's browser");
  assert.equal(opened.find((x) => x.action === "open")!.url, "http://localhost:4173/");
  assert.equal(await page.locator(".crew-detail .step-detail").count(), 0);
  // In what it returned: links, without the sentence's full stop, also to the agent's browser (now showing).
  await page.locator(".crew-detail .step.tool b").click();
  const links = page.locator(".crew-detail .step-detail a.tool-link");
  assert.deepEqual(await links.allInnerTexts(), ["http://localhost:4173/app", "https://example.com/docs"]);
  await links.nth(1).click();
  await waitFor(() => sent(page, "browserDo"), (m) => m.some((x) => x.action === "open" && x.url === "https://example.com/docs"), "the second address in the agent's browser");
  assert.equal((await sent(page, "openLink")).length, 0, "not your default browser");
  await page.context().close();
});

test("in the macOS app: the open agent's browser stands beside its conversation (⇧⌘B, B, ⌘K)", async () => {
  const page = await open({ mac: true });
  await map(page).locator(".crew-node").first().waitFor();
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await page.locator(".crew-detail .session").waitFor();
  // The card above the message box has no buttons now (the user's call): no workspace chip, Browser or Editor.
  assert.equal(await page.locator(".crew-stage button").count(), 0);
  assert.equal(await page.locator(".crew-tool-tabs").count(), 0, "no tools shown yet");
  const showBrowser = () => appEvent(page, "paseo:command", "tools-browser");
  await showBrowser();
  await page.locator(".board-browser.crew").waitFor();
  assert.equal(await page.locator(".crew-map[data-browser]").count(), 1);
  // Focus: right of the conversation, under the tools' tabs (Files · Browser), not over it.
  const [chat, browser, tabs] = await Promise.all([".crew-drawer", ".board-browser.crew", ".crew-tool-tabs"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(browser.left >= chat.right - 2 && browser.right >= tabs.right - 2, `conversation to ${chat.right}, browser from ${browser.left}`);
  assert.ok(browser.top >= tabs.bottom - 1, "under its tabs");
  assert.equal(await page.locator(".crew-tool-tabs").getByRole("tab", { name: /Browser/ }).getAttribute("aria-selected"), "true");
  const placed = await waitFor(() => sent(page, "browser"), (m) => (m.at(-1)?.width ?? 0) > 0, "the web page's box told");
  assert.ok(placed.at(-1).x >= chat.right - 2);
  // It follows the conversation's edge as that is resized (from its right, in focus).
  await page.getByRole("separator", { name: "Resize the conversation beside its tools" }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  const [chat2, browser2] = await Promise.all([".crew-drawer", ".board-browser.crew"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(chat2.right > chat.right + 100, "wider");
  assert.ok(Math.abs(browser2.left - chat2.right) <= 2, `conversation to ${chat2.right}, browser from ${browser2.left}`);
  // The tools' Editor tab swaps your editor in; × hides the tools, the conversation taking the width.
  await page.locator(".crew-tool-tabs").getByRole("tab", { name: "Editor" }).click();
  await page.locator(".crew-files").waitFor();
  assert.equal(await page.locator(".board-browser").count(), 0);
  // The Terminal tab: a shell in the workspace, in the same place.
  await page.locator(".crew-tool-tabs").getByRole("tab", { name: "Terminal" }).click();
  await page.locator('.crew-editor[data-tool="terminal"]').waitFor();
  assert.equal(await page.locator('.crew-editor[data-tool="editor"]').count(), 0);
  // ⇧⌘E, ⇧⌘B, ⇧⌘T (the app's View menu asks the page): each tool in turn; ⇧⌘D the message box.
  await appEvent(page, "paseo:command", "tools-editor");
  await page.locator('.crew-editor[data-tool="editor"]').waitFor();
  await appEvent(page, "paseo:command", "tools-browser");
  await page.locator(".board-browser.crew").waitFor();
  await appEvent(page, "paseo:command", "tools-terminal");
  await page.locator('.crew-editor[data-tool="terminal"]').waitFor();
  assert.equal(await page.locator(".board-browser").count(), 0);
  await appEvent(page, "paseo:command", "focus-composer");
  await page.waitForFunction(() => document.activeElement?.matches(".crew-detail textarea"));
  // No strip of the other robots in the app: its Crew tab is the way back.
  assert.equal(await page.locator(".crew-focus-strip").count(), 0);
  await page.locator(".crew-tool-tabs").getByRole("button", { name: "Hide the tools" }).click();
  await page.locator(".crew-files").waitFor({ state: "detached" });
  assert.equal(await page.locator(".crew-tool-tabs").count(), 0);
  // The Crew tab: the map, the open agent marked and its conversation kept for the Command tab; Esc from the
  // conversation goes there too.
  await page.locator(".crew-detail textarea").first().evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press("Escape");
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "map", "on the Crew tab");
  assert.equal(await page.locator(".crew-drawer").count(), 0, "the conversation waits for the Command tab");
  assert.equal(await page.locator(".crew-node[aria-current], .crew-head[aria-current]").count(), 0, "no card stays marked on the Crew tab");
  assert.equal(await page.locator(".crew-board").evaluate((el) => getComputedStyle(el).visibility), "visible");
  // The same agent clicked again opens it on the Command tab again (nothing about what's open changes).
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "conversation", "the same agent on the Command tab");
  await appEvent(page, "paseo:mode", { mode: "command" });
  await page.locator(".crew-detail .session").waitFor();
  // Opening another robot on the Crew tab moves to the Command tab.
  await appEvent(page, "paseo:mode", { mode: "crew" });
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "map", "on the Crew tab again");
  await page.locator('.crew-node[data-state="running"]').first().click();
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "conversation", "on the Command tab");
  await page.locator(".crew-detail .session").waitFor();
  // A workspace opened on the Crew tab goes there too: the Crew tab is the map alone, full width.
  await appEvent(page, "paseo:mode", { mode: "crew" });
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "map", "on the Crew tab, a third time");
  await page.locator(".crew-head.workspace").first().click();
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "conversation", "the workspace on the Command tab");
  await appEvent(page, "paseo:mode", { mode: "crew" });
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "map", "back on the Crew tab");
  assert.equal(await page.locator(".crew-drawer").count(), 0, "nothing beside the map");
  await page.locator('.crew-node[data-state="running"]').first().click();
  await waitFor(() => page.locator(".crew-map").getAttribute("data-place"), (p) => p === "conversation", "the agent on the Command tab again");
  await showBrowser();
  await page.locator(".board-browser.crew").waitFor();
  // B hides it (outside a field), and ⌘K shows it again.
  await page.locator(".crew-stage-state").click();
  await page.keyboard.press("b");
  await page.locator(".board-browser").waitFor({ state: "detached" });
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("browser");
  await palette(page).getByRole("option", { name: /Show .*’s browser/ }).click();
  await page.locator(".board-browser.crew").waitFor();
  // New agent (⌘N) opens over the agent: no tools beside it, the web page's box told gone.
  await page.locator(".crew-stage-state").click();
  await page.keyboard.press("Meta+n");
  await page.locator(".crew-detail .new-agent-form").waitFor();
  await page.locator(".board-browser").waitFor({ state: "detached" });
  assert.equal(await page.locator(".crew-tool-tabs").count(), 0, "no Editor, Terminal or Browser tabs for a new agent");
  await page.context().close();
});

test("in the macOS app: the page lifts the splash and reports the map's place", async () => {
  const page = await open({ mac: true });
  await map(page).locator(".crew-node").first().waitFor();
  await waitFor(() => sent(page, "loaded"), (m) => m.length > 0, "loaded");
  // The map's place: as it moves, the app lays your editor and the agent's browser over their boxes again.
  await waitFor(() => sent(page, "viewport"), (m) => (m.at(-1)?.width ?? 0) > 0 && (m.at(-1)?.height ?? 0) > 0, "the viewport");
  assert.equal((await sent(page, "art")).length, 0, "no native world");
  assert.equal((await sent(page, "pageMap")).length, 0, "nothing to switch off: the page always draws the map");
  await waitFor(() => sent(page, "barState"), (m) => m.at(-1)?.panelAbsent === true, "the bar's panel buttons go");
  // No Terminal tab follows the selection any more: the page tells the app no workspace.
  await page.locator(".crew-node").first().click();
  await page.locator(".crew-detail").first().waitFor();
  assert.equal((await sent(page, "workspace")).length, 0);
  // No map styles are offered.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("map");
  await palette(page).getByRole("option").first().waitFor();
  assert.equal(await palette(page).getByRole("option", { name: /Use the .* map/ }).count(), 0);
  await page.context().close();
});


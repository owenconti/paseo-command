/**
 * The Crew map (src/crew/): the fleet as a chat app, drawn by the page in the map's place, in a plain browser as in
 * the macOS app. The map groups host › project › workspace, each workspace a panel of its agents' robots (the
 * board's robots, marks and PR medallions); picking one opens the app's own detail across the view (one copy: the
 * side panel is absent). With the app's bridge stubbed, it tells the app the page draws the map, that the fleet is
 * in and which workspace the Terminal tab follows, and shows the open agent's browser beside its conversation.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { dungeon } from "./fleets";

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
async function open(opts: { mac?: boolean; style?: string } = {}): Promise<Page> {
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
              if (["pageMap", "mapStyle", "loaded", "workspace", "barState", "art", "detach", "browser"].includes(m.type)) sent.push(m);
            },
          },
        },
      };
    },
    [opts.style ?? "crew", !!opts.mac] as const,
  );
  await mockApi(page, {
    agents: () => dungeon.agents,
    permissions: () => dungeon.permissions,
    hosts: () => dungeon.hosts,
    projects: () => dungeon.projects,
    workspaces: () => dungeon.workspaces,
    detail: (id: string) => {
      const row = (dungeon.agents as unknown as { id: string; status: string }[]).find((a) => a.id === id);
      return detailOf(id, row?.status ?? "idle", {});
    },
    timeline: () => ({ items: [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done. Shall I open the pull request?", messageId: "r1" }] }),
    accept: () => true,
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
  assert.ok(await page.getByRole("button", { name: "New agent" }).isVisible());
  // No side panel, no panel buttons in the bar, no roster, no notice.
  await page.locator('.floating-command[data-absent="true"]').waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: /session panel/ }).count(), 0);
  assert.equal(await page.locator(".atlas-world-notice").count(), 0, "no 'drawn by the macOS app' notice");
  await page.context().close();
});

test("picking a robot opens its conversation across the view, with its robot on the stage and beside its replies; Back returns to it", async () => {
  const page = await open();
  const node = page.locator('.crew-node[data-state="idle"]').first();
  const name = (await node.locator(".crew-node-name").textContent())!;
  const key = (await node.getAttribute("data-key"))!;
  await node.click();
  await page.locator(".crew-detail .session").waitFor();
  assert.equal(await page.locator(".session").count(), 1, "one copy of the conversation");
  assert.equal(await page.locator(".crew-board").count(), 0, "the map gives way");
  assert.equal(await page.locator(".crew-stage").getAttribute("data-state"), "idle");
  await page.locator(".crew-detail .msg.assistant .msg-avatar .crew-bot").waitFor();
  assert.match((await page.locator(".crew-detail .session-title").textContent())!, new RegExp(name));
  assert.equal(await page.locator(".crew-browser-toggle").count(), 0, "the browser is the macOS app's");
  // Back (the conversation's Fleet) returns to the map, the robot it left focused.
  await page.getByRole("button", { name: "Fleet" }).click();
  await page.getByRole("heading", { name: "Your crew" }).waitFor();
  await page.waitForFunction((k) => document.activeElement?.getAttribute("data-key") === k, key);
  // The arrow keys move through the map.
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("data-key")), key);
  // A workspace's head opens the workspace; a project's opens the project.
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-detail .place").first().waitFor();
  assert.equal(await page.locator(".crew-stage").count(), 0);
  await page.getByRole("button", { name: "Fleet" }).first().click().catch(() => {});
  await page.context().close();
});

test("the filter narrows the map, and folded projects stay folded", async () => {
  const page = await open();
  await map(page).locator(".crew-node").first().waitFor();
  const all = await page.locator(".crew-node").count();
  // ⌘K "Filter the crew…" takes the keyboard to it.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Filter the crew");
  await palette(page).getByRole("option", { name: /Filter the crew/ }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Filter agents");
  await page.keyboard.type("events");
  await waitFor(() => page.locator(".crew-node").count(), (n) => n > 0 && n < all, "narrowed");
  await page.getByRole("textbox", { name: "Filter agents" }).press("Escape");
  await waitFor(() => page.locator(".crew-node").count(), (n) => n === all, "the filter cleared");
  const project = (await page.locator(".crew-head.project").first().textContent())!;
  await page.getByRole("button", { name: `Hide ${project}` }).first().click();
  const fewer = await page.locator(".crew-node").count();
  assert.ok(fewer < all);
  await page.reload();
  await map(page).locator(".crew-node").first().waitFor();
  assert.equal(await page.locator(".crew-node").count(), fewer, "kept across a reload");
  await page.context().close();
});

test("in the macOS app: the open agent's browser stands beside its conversation (its button, B, ⌘K)", async () => {
  const page = await open({ mac: true });
  await map(page).locator(".crew-node").first().waitFor();
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await page.locator(".crew-detail .session").waitFor();
  const toggle = page.locator(".crew-browser-toggle");
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  await toggle.click();
  await page.locator(".board-browser.crew").waitFor();
  assert.equal(await page.locator(".crew-map[data-browser]").count(), 1);
  // Beside the conversation, not over it.
  const [chat, browser] = await Promise.all([".crew-main", ".board-browser.crew"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(browser.left >= chat.right - 2, `browser at ${browser.left}, conversation to ${chat.right}`);
  const placed = await waitFor(() => sent(page, "browser"), (m) => (m.at(-1)?.width ?? 0) > 0, "the web page's box told");
  assert.ok(placed.at(-1).x >= chat.right - 2);
  // B hides it (outside a field), and ⌘K shows it again.
  await page.locator(".crew-stage").click();
  await page.keyboard.press("b");
  await page.locator(".board-browser").waitFor({ state: "detached" });
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("browser");
  await palette(page).getByRole("option", { name: /Show .*’s browser/ }).click();
  await page.locator(".board-browser.crew").waitFor();
  await page.context().close();
});

test("in the macOS app: the page draws the map, says so, lifts the splash and follows the Terminal tab's workspace; other styles take it back", async () => {
  const page = await open({ mac: true });
  await map(page).locator(".crew-node").first().waitFor();
  await waitFor(() => sent(page, "pageMap"), (m) => m.at(-1)?.on === true, "pageMap on");
  await waitFor(() => sent(page, "loaded"), (m) => m.length > 0, "loaded");
  assert.equal((await sent(page, "mapStyle")).at(-1)?.style, "crew");
  assert.equal((await sent(page, "art")).length, 0, "no native world mounted");
  await waitFor(() => sent(page, "barState"), (m) => m.at(-1)?.panelAbsent === true, "the bar's panel buttons go");
  // An agent's workspace is the Terminal tab's.
  await page.locator(".crew-node").first().click();
  await waitFor(() => sent(page, "workspace"), (m) => !!m.at(-1)?.workspace?.id, "the workspace told");
  // ⌘K offers the other styles; the Islands mount their native world again and the panel returns.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Use the Islands map");
  await palette(page).getByRole("option", { name: /Use the Islands map/ }).click();
  await waitFor(() => sent(page, "pageMap"), (m) => m.at(-1)?.on === false, "pageMap off");
  await waitFor(() => sent(page, "art"), (m) => m.length > 0, "the native world mounted");
  assert.equal(await page.locator(".crew-map").count(), 0);
  await page.locator('.floating-command:not([data-absent])').waitFor({ state: "attached" });
  // And View → Map Style can choose Crew again (it asks the page's `map-style-crew`).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:command", { detail: "map-style-crew" })));
  // The agent picked before is still open there.
  await page.locator(".crew-map .crew-detail .session").waitFor();
  await waitFor(() => sent(page, "detach"), (m) => m.length > 0, "the native world let go");
  await waitFor(() => sent(page, "pageMap"), (m) => m.at(-1)?.on === true, "pageMap on again");
  await page.context().close();
});

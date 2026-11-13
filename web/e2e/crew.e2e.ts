/**
 * The Crew map (src/crew/): the fleet as a chat app, drawn by the page in the map's place, in a plain browser as in
 * the macOS app. Its roster pins who needs you, then lists host › project › workspace › agent with the board's robots,
 * marks and PR medallions; its conversation side is the app's own detail (one copy: the side panel is absent).
 * With the app's bridge stubbed, it tells the app the page draws the map, that the fleet is in and which workspace
 * the Terminal tab follows. Every /api request is answered in the browser.
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
              if (["pageMap", "mapStyle", "loaded", "workspace", "barState", "art", "detach"].includes(m.type)) sent.push(m);
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
const roster = (page: Page) => page.getByRole("navigation", { name: "Crew" });

test("in a browser: the roster pins who needs you, the overview shows every robot, and there's no side panel", async () => {
  const page = await open();
  await roster(page).locator(".crew-row").first().waitFor();
  // Needs you, most urgent first: failures, then approvals, then questions.
  const pinned = await page.locator(".crew-need .crew-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-state")));
  assert.ok(pinned.length >= 3, `pinned: ${pinned}`);
  const rank = ["failed", "approval", "question", "asking"];
  assert.deepEqual([...pinned].sort((a, b) => rank.indexOf(a!) - rank.indexOf(b!)), pinned, "most urgent first");
  // Each listed agent once below, with its robot; running ones in their work pose.
  const listed = await page.locator(".crew-group:not(.crew-need) .crew-row").count();
  assert.equal(listed, dungeon.agents.filter((a) => !(a as { child?: unknown }).child).length);
  assert.ok((await page.locator('.crew-row[data-state="running"] .crew-bot.work').count()) > 0);
  // Workspaces carry their medallions where they have a PR status (none in this fleet's labels is fine).
  // The overview: sections by state, and New agent.
  await page.getByRole("heading", { name: "Your crew" }).waitFor();
  assert.ok(await page.locator(".crew-overview").getByRole("region", { name: "Needs you" }).isVisible());
  assert.ok(await page.getByRole("button", { name: "New agent" }).first().isVisible());
  // No side panel, and no panel buttons in the bar.
  await page.locator('.floating-command[data-absent="true"]').waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: /session panel/ }).count(), 0);
  assert.equal(await page.locator(".atlas-world-notice").count(), 0, "no 'drawn by the macOS app' notice");
  await page.context().close();
});

test("picking a robot opens its conversation beside the roster, with its robot on the stage and beside its replies", async () => {
  const page = await open();
  const row = page.locator('.crew-group:not(.crew-need) .crew-row[data-state="idle"]').first();
  const name = (await row.locator("b").textContent())!;
  await row.click();
  await page.locator(".crew-detail .session").waitFor();
  assert.equal(await page.locator(".session").count(), 1, "one copy of the conversation");
  assert.equal(await row.getAttribute("aria-current"), "true");
  assert.equal(await page.locator(".crew-stage").getAttribute("data-state"), "idle");
  await page.locator(".crew-detail .msg.assistant .msg-avatar .crew-bot").waitFor();
  assert.match((await page.locator(".crew-detail .session-title").textContent())!, new RegExp(name));
  // Back (the conversation's Fleet) lets it go for the overview.
  await page.getByRole("button", { name: "Fleet" }).click();
  await page.getByRole("heading", { name: "Your crew" }).waitFor();
  // A workspace's head opens the workspace there; a project's opens the project.
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-detail .place").first().waitFor();
  assert.equal(await page.locator(".crew-stage").count(), 0);
  await page.locator(".crew-head.project").first().click();
  await page.waitForFunction(() => document.querySelector(".crew-head.project")?.getAttribute("aria-current") === "true");
  await page.context().close();
});

test("the filter narrows the roster, and folded projects stay folded", async () => {
  const page = await open();
  await roster(page).locator(".crew-row").first().waitFor();
  const all = await page.locator(".crew-row").count();
  // ⌘K "Filter the crew…" takes the keyboard to it.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Filter the crew");
  await palette(page).getByRole("option", { name: /Filter the crew/ }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Filter agents");
  await page.keyboard.type("events");
  await waitFor(() => page.locator(".crew-row").count(), (n) => n > 0 && n < all, "narrowed");
  for (const text of await page.locator(".crew-group:not(.crew-need) .crew-row b").allTextContents()) assert.match(text, /events/i);
  await page.getByRole("textbox", { name: "Filter agents" }).press("Escape");
  await waitFor(() => page.locator(".crew-row").count(), (n) => n === all, "the filter cleared");
  const project = (await page.locator(".crew-head.project").first().textContent())!;
  await page.getByRole("button", { name: `Hide ${project}` }).click();
  const fewer = await page.locator(".crew-row").count();
  assert.ok(fewer < all);
  await page.reload();
  await roster(page).locator(".crew-row").first().waitFor();
  assert.equal(await page.locator(".crew-row").count(), fewer, "kept across a reload");
  await page.context().close();
});

test("in the macOS app: the page draws the map, says so, lifts the splash and follows the Terminal tab's workspace; other styles take it back", async () => {
  const page = await open({ mac: true });
  await roster(page).locator(".crew-row").first().waitFor();
  await waitFor(() => sent(page, "pageMap"), (m) => m.at(-1)?.on === true, "pageMap on");
  await waitFor(() => sent(page, "loaded"), (m) => m.length > 0, "loaded");
  assert.equal((await sent(page, "mapStyle")).at(-1)?.style, "crew");
  assert.equal((await sent(page, "art")).length, 0, "no native world mounted");
  await waitFor(() => sent(page, "barState"), (m) => m.at(-1)?.panelAbsent === true, "the bar's panel buttons go");
  // An agent's workspace is the Terminal tab's.
  await page.locator('.crew-group:not(.crew-need) .crew-row').first().click();
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
  await roster(page).locator(".crew-row").first().waitFor();
  await waitFor(() => sent(page, "detach"), (m) => m.length > 0, "the native world let go");
  await waitFor(() => sent(page, "pageMap"), (m) => m.at(-1)?.on === true, "pageMap on again");
  await page.context().close();
});

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
async function open(opts: { mac?: boolean; style?: string; fleet?: typeof dungeon; usage?: Record<string, number> } = {}): Promise<Page> {
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
              if (["pageMap", "mapStyle", "loaded", "workspace", "viewport", "barState", "art", "detach", "browser"].includes(m.type)) sent.push(m);
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
      return detailOf(id, row?.status ?? "idle", opts.usage ? { LastUsage: opts.usage } : {});
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

test("picking a robot opens its conversation beside the map, its robot above the message box and beside its replies; Esc closes it", async () => {
  const page = await open();
  const node = page.locator('.crew-node[data-state="idle"]').first();
  const name = (await node.locator(".crew-node-name").textContent())!;
  const key = (await node.getAttribute("data-key"))!;
  await node.click();
  await page.locator(".crew-drawer .crew-detail .session").waitFor();
  assert.equal(await page.locator(".session").count(), 1, "one copy of the conversation");
  assert.equal(await page.locator(".crew-board").count(), 1, "the map stays beside it");
  assert.equal(await node.getAttribute("aria-current"), "true");
  const [map, drawer] = await Promise.all([".crew-board", ".crew-drawer"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(drawer.left >= map.right - 1, "on the map's right");
  // The robot, its state and progress sit at the foot, above the message box.
  const stage = page.locator(".crew-detail .session-footer .crew-stage");
  assert.equal(await stage.getAttribute("data-state"), "idle");
  const [strip, input] = await Promise.all([stage, page.locator(".crew-detail .session-footer textarea").first()].map((l) => l.evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(strip.bottom <= input.top + 1, "above the message box");
  await page.locator(".crew-detail .msg.assistant .msg-avatar .crew-bot").waitFor();
  assert.match((await page.locator(".crew-detail .session-title").textContent())!, new RegExp(name));
  assert.equal(await page.locator(".crew-browser-toggle").count(), 0, "the browser is the macOS app's");
  // Esc closes it, from the message box too; the robot it left has the keyboard.
  await page.locator(".crew-detail .session-footer textarea").first().focus();
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
  await page.waitForFunction((k) => document.activeElement?.getAttribute("data-key") === k, key);
  // The arrow keys move through the map.
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("data-key")), key);
  // A workspace's head opens the workspace beside it; Esc closes that too.
  await page.locator(".crew-head.workspace").first().click();
  await page.locator(".crew-drawer .place").first().waitFor();
  assert.equal(await page.locator(".crew-stage").count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
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

test("the conversation panel resizes from its left edge, and keeps its width", async () => {
  const page = await open();
  await page.locator('.crew-node[data-state="idle"]').first().click();
  await page.locator(".crew-drawer .session").waitFor();
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
  await page.locator(".crew-drawer .session").waitFor();
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
  // Files (or GitHub, Activity): Crew gives way, the theme stays.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "files" } })));
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

test("tiles lie on their side, shorter, when the map is narrowed by the conversation beside it", async () => {
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
  await node.click();
  await page.locator(".crew-drawer .session").waitFor();
  const side = await shape();
  assert.equal(side.beside, true, "on its side: the name beside the robot");
  assert.ok(side.height < tall.height * 0.6 && side.width > tall.width, `${JSON.stringify(tall)} → ${JSON.stringify(side)}`);
  await page.keyboard.press("Escape");
  await page.locator(".crew-drawer").waitFor({ state: "detached" });
  assert.equal((await shape()).beside, false, "standing again with the room back");
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
      for (const g of document.querySelectorAll(".crew-workspaces")) {
        const box = g.getBoundingClientRect();
        const col = (box.width - (cols - 1) * 14) / cols;
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
  await page.locator(".crew-node").first().click();
  await page.locator(".crew-drawer .session").waitFor();
  await page.waitForTimeout(100);
  const narrow = await check();
  assert.ok(narrow.cols < wide.cols, `fewer columns beside the conversation: ${narrow.cols}`);
  assert.deepEqual(narrow.bad, []);
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
  // Over the map, beside the conversation, not over it.
  const [chat, browser] = await Promise.all([".crew-drawer", ".board-browser.crew"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(browser.right <= chat.left + 2, `browser to ${browser.right}, conversation from ${chat.left}`);
  const placed = await waitFor(() => sent(page, "browser"), (m) => (m.at(-1)?.width ?? 0) > 0, "the web page's box told");
  assert.ok(placed.at(-1).x + placed.at(-1).width <= chat.left + 2);
  // It follows the conversation's edge as that is resized.
  await page.getByRole("separator", { name: "Resize the conversation" }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  const [chat2, browser2] = await Promise.all([".crew-drawer", ".board-browser.crew"].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())));
  assert.ok(chat2.left < chat.left - 100, "wider");
  assert.ok(Math.abs(browser2.right - chat2.left) <= 2, `browser to ${browser2.right}, conversation from ${chat2.left}`);
  // B hides it (outside a field), and ⌘K shows it again.
  await page.locator(".crew-stage-state").click();
  await page.keyboard.press("b");
  await page.locator(".board-browser").waitFor({ state: "detached" });
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("browser");
  await palette(page).getByRole("option", { name: /Show .*’s browser/ }).click();
  await page.locator(".board-browser.crew").waitFor();
  await page.context().close();
});

test("in the macOS app: the page lifts the splash, reports the map's place and follows the Terminal tab's workspace", async () => {
  const page = await open({ mac: true });
  await map(page).locator(".crew-node").first().waitFor();
  await waitFor(() => sent(page, "loaded"), (m) => m.length > 0, "loaded");
  // The map's place, for Conquer, the Terminal tab and the Files editors to lie over.
  await waitFor(() => sent(page, "viewport"), (m) => (m.at(-1)?.width ?? 0) > 0 && (m.at(-1)?.height ?? 0) > 0, "the viewport");
  assert.equal((await sent(page, "art")).length, 0, "no native world");
  assert.equal((await sent(page, "pageMap")).length, 0, "nothing to switch off: the page always draws the map");
  await waitFor(() => sent(page, "barState"), (m) => m.at(-1)?.panelAbsent === true, "the bar's panel buttons go");
  // An agent's workspace is the Terminal tab's.
  await page.locator(".crew-node").first().click();
  await waitFor(() => sent(page, "workspace"), (m) => !!m.at(-1)?.workspace?.id, "the workspace told");
  // No map styles are offered.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("map");
  await palette(page).getByRole("option").first().waitFor();
  assert.equal(await palette(page).getByRole("option", { name: /Use the .* map/ }).count(), 0);
  await page.context().close();
});


/**
 * The browser attached to a robot on the Dungeon Board (src/worldChat/BoardBrowser.tsx): B in its dialogue box
 * shows it over the board above the box; the page draws the tabs and the address bar and tells the macOS app
 * whose browser shows and where its web page goes, with the page's own things lying over it. A tab the agent
 * opens with its browser tools shows at once (Settings → Map), and Settings says whether the app is the daemons'
 * browser. Swift's side of the bridge is a stub; every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { DUNGEON_STATS, DASHBOARD_ISSUES, DASHBOARD_PRS, dungeon } from "./fleets";

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
async function open(store: Record<string, unknown> = {}, reply = "The preview is up. Shall I open it, or carry on?"): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((kept) => {
    localStorage.setItem("paseo-command:atlas:style", JSON.stringify("dungeon"));
    for (const [key, value] of Object.entries(kept)) localStorage.setItem(`paseo-command:${key}`, JSON.stringify(value));
    const sent: unknown[] = [];
    (window as any).__sent = sent;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            if (typeof m.type === "string" && (m.type.startsWith("browser") || m.type === "openLink" || m.type === "menu")) sent.push(m);
          },
        },
      },
    };
  }, store);
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
    timeline: () => ({
      items: [{ kind: "user", text: "Show me the preview", messageId: "u1" }, { kind: "assistant", text: reply, messageId: "r1" }],
    }),
    accept: () => true,
    lists: {
      hoststats: DUNGEON_STATS,
      github: DASHBOARD_PRS,
      linear: DASHBOARD_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: false }, error: null },
    },
  } as any);
  await page.goto(app.url);
  await waitFor(() => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any), (i) => i?.scene === "dungeon" && !!i.agents?.length, "the board", 30000);
  return page;
}
const sent = (page: Page, type?: string) => page.evaluate((t) => ((window as any).__sent as Sent[]).filter((m) => !t || m.type === t), type);
const lastOf = async (page: Page, type: string) => (await sent(page, type)).at(-1);
const swift = (page: Page, event: string, detail: Record<string, unknown>) =>
  page.evaluate(([e, d]) => window.dispatchEvent(new CustomEvent(e as string, { detail: d })), [event, detail] as const);
const pick = (page: Page, id: string) => swift(page, "paseo:world", { type: "pick", id: JSON.stringify(["local", id]) });
const box = (page: Page) => page.getByRole("dialog", { name: /^Conversation with / });
const panel = (page: Page) => page.getByRole("region", { name: /’s browser$/ });
const TAB_A = "0f8b3c1e-52a7-4c9d-9b1e-2f6a7d8c9e10";
const TAB_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const tab = (id: string, url: string, title: string, more: Record<string, unknown> = {}) => ({ id, url, title, loading: false, back: false, forward: false, ...more });
/** The app's account of the browsers, as `BoardBrowser.swift` sends it. */
const state = (page: Page, tabs: unknown[], more: { current?: string; hosting?: unknown; agent?: string } = {}) =>
  swift(page, "paseo:browser", {
    type: "state",
    browsers: tabs.length
      ? { [`local|${more.agent ?? "a-api-1"}`]: { host: "local", agent: more.agent ?? "a-api-1", current: more.current ?? (tabs[0] as { id: string }).id, tabs } }
      : {},
    hosting: more.hosting ?? { enabled: false, connected: false, hosts: [] },
  });

test("B shows the robot's browser over the board above its dialogue box; the app is told whose and where", async () => {
  const page = await open();
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  // The app is asked what it holds as the page loads, and told agents' tools aren't on (the default).
  assert.equal((await lastOf(page, "browserHost"))?.enabled, false);
  assert.ok((await sent(page, "browserState")).length >= 1);
  const toggle = dialog.getByRole("button", { name: /^Show its browser \(B\)/ });
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  await dialog.focus();
  await page.keyboard.press("b");
  const view = panel(page);
  await view.waitFor();
  assert.match((await view.getAttribute("aria-label")) ?? "", /api agent 2/);
  // Empty: it says how to fill it, and that agents' tools are off, with the way to Settings.
  await view.getByText("No pages yet").waitFor();
  await view.getByText(/can open pages here itself once “Agents’ browser tools open tabs here” is on/).waitFor();
  // Whose browser, and its box: inside the panel, above the dialogue box.
  const placed = await waitFor(() => lastOf(page, "browser"), (m) => m?.agent === "a-api-1" && m.width > 200, "the placement");
  assert.equal(placed!.host, "local");
  assert.equal(typeof placed!.workspace, "string");
  assert.equal(placed!.covered, false);
  const geometry = await page.evaluate(() => {
    const slot = document.querySelector(".bb-view")!.getBoundingClientRect();
    const chat = document.querySelector(".world-chat")!.getBoundingClientRect();
    const plate = document.querySelector(".wc-nameplate")!.getBoundingClientRect();
    return { slot: { x: Math.round(slot.left), y: Math.round(slot.top), width: Math.round(slot.width), height: Math.round(slot.height), bottom: slot.bottom }, chatTop: chat.top, plateTop: plate.top };
  });
  assert.deepEqual({ x: placed!.x, y: placed!.y, width: placed!.width, height: placed!.height }, { x: geometry.slot.x, y: geometry.slot.y, width: geometry.slot.width, height: geometry.slot.height });
  assert.ok(geometry.slot.bottom < geometry.plateTop, `the browser ends above the name plate: ${geometry.slot.bottom} < ${geometry.plateTop}`);
  assert.ok(geometry.slot.height > 150, `it has room: ${geometry.slot.height}`);
  // An address typed with no tab opens one in this agent's browser.
  const address = view.getByRole("textbox", { name: "Address" });
  await address.fill("localhost:5173");
  await address.press("Enter");
  const opened = await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "open", "the open");
  assert.deepEqual({ host: opened!.host, agent: opened!.agent, url: opened!.url }, { host: "local", agent: "a-api-1", url: "localhost:5173" });
  // The app's tabs show: titles, the current one, the address, back and forward as they stand.
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App", { back: true }), tab(TAB_B, "https://example.com/docs", "", { loading: true })]);
  const tabs = view.getByRole("tab");
  await waitFor(() => tabs.allTextContents(), (t) => t.join("|") === "Vite App|example.com/docs", "the tabs");
  assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
  assert.equal(await address.inputValue(), "localhost:5173");
  assert.equal(await view.getByRole("button", { name: "Back", exact: true }).isDisabled(), false);
  assert.equal(await view.getByRole("button", { name: "Forward", exact: true }).isDisabled(), true);
  await waitFor(() => dialog.getByRole("button", { name: /^Hide its browser \(B\): 2 tabs/ }).count(), (n) => n === 1, "the button counts its tabs");
  // The tab strip and bar ask the app.
  await tabs.nth(1).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["select", TAB_B]);
  await view.getByRole("button", { name: "Back", exact: true }).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["back", TAB_A]);
  await view.getByRole("button", { name: "Reload", exact: true }).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["reload", TAB_A]);
  await address.click();
  assert.equal(await address.inputValue(), "http://localhost:5173/", "the whole address, to edit");
  await address.fill("example.com/pricing");
  await address.press("Enter");
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab, m!.url]), ["navigate", TAB_A, "example.com/pricing"]);
  await view.getByRole("button", { name: "Close example.com/docs" }).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["close", TAB_B]);
  await view.getByRole("button", { name: "New tab" }).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.agent, m!.url]), ["open", "a-api-1", undefined]);
  await waitFor(() => page.evaluate(() => document.activeElement?.id), (id) => id === "board-browser-address", "a new tab starts in its address");
  await address.press("Escape");
  await view.getByRole("button", { name: "Open this page in Conquer" }).click();
  assert.equal((await lastOf(page, "openLink"))?.url, "http://localhost:5173/");
  // Clicking the page's box gives the web page the keyboard.
  await page.locator(".bb-view").click({ position: { x: 40, y: 40 } });
  assert.equal((await lastOf(page, "browserDo"))?.action, "focus");
  // B again (or its ×) hides it: the app shows nothing.
  await dialog.focus();
  await page.keyboard.press("b");
  await view.waitFor({ state: "detached" });
  await waitFor(() => lastOf(page, "browser"), (m) => !m?.agent && m?.width === 0, "the browser hidden");
  await page.context().close();
});

test("the page's own things over the web page are cut out of it; a dialog of the app's covers it", async () => {
  const page = await open({ "world:browserOpen": true });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const view = panel(page);
  await view.waitFor();
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App")]);
  // The dialogue's choices rise over the browser's foot: the app leaves that part to the page.
  for (let i = 0; i < 20 && !(await page.getByRole("menu", { name: "What you can say" }).isVisible()); i++) await page.keyboard.press("Enter");
  const holed = await waitFor(() => lastOf(page, "browser"), (m) => m?.holes?.length === 1, "the choices' hole");
  const overlap = await page.evaluate(() => {
    const menu = document.querySelector(".wc-choices")!.getBoundingClientRect();
    const slot = document.querySelector(".bb-view")!.getBoundingClientRect();
    return { menu: { left: menu.left, top: menu.top, right: menu.right, bottom: menu.bottom }, slotBottom: slot.bottom };
  });
  assert.ok(overlap.menu.top < overlap.slotBottom, "the choices do overlap the page's box");
  const hole = holed!.holes[0];
  assert.ok(hole.x <= overlap.menu.left && hole.y <= overlap.menu.top && hole.x + hole.width >= overlap.menu.right && hole.y + hole.height >= overlap.menu.bottom, JSON.stringify({ hole, overlap }));
  // ⌘K is the page's dialog: the web page steps aside for it, and comes back.
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor();
  await waitFor(() => lastOf(page, "browser"), (m) => m?.covered === true, "covered by the palette");
  // Its entries: the browser's own, while it shows.
  await palette.getByRole("combobox").fill("board’s browser");
  for (const name of [/Open a new tab in the board’s browser/, /Type an address in the board’s browser/, /Reload Vite App in the board’s browser/, /Close Vite App in the board’s browser/, /Make the board’s browser fill the board/])
    await palette.getByRole("option", { name }).waitFor();
  assert.equal(await palette.getByRole("option", { name: /Go back in the board’s browser/ }).count(), 0, "nothing to go back to");
  await palette.getByRole("option", { name: /Reload Vite App/ }).click();
  await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "reload" && m.tab === TAB_A, "the reload");
  await waitFor(() => lastOf(page, "browser"), (m) => m?.covered === false, "uncovered");
  // Filling the board: the browser lies over the dialogue box, whose choices are behind it (no hole for them).
  await view.getByRole("button", { name: "Fill the board with the browser" }).click();
  const filled = await page.evaluate(() => {
    const slot = document.querySelector(".bb-view")!.getBoundingClientRect();
    const chat = document.querySelector(".world-chat")!.getBoundingClientRect();
    return { slotBottom: slot.bottom, chatTop: chat.top };
  });
  assert.ok(filled.slotBottom > filled.chatTop + 80, "it covers the dialogue box");
  await waitFor(() => lastOf(page, "browser"), (m) => m?.holes?.length === 0 && m.height > 400, "no hole for the hidden choices");
  await view.getByRole("button", { name: "Show the dialogue box again" }).click();
  await waitFor(() => lastOf(page, "browser"), (m) => m?.holes?.length === 1, "the choices' hole again");
  await page.context().close();
});

const sides = (page: Page) =>
  page.evaluate(
    () =>
      Object.fromEntries(
        Object.entries({ chat: ".world-chat", browser: ".board-browser", slot: ".bb-view", frame: ".native-world-frame", belt: ".dungeon-hud" }).map(([name, selector]) => {
          const r = document.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect();
          return [name, { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }];
        }),
      ) as Record<"chat" | "browser" | "slot" | "frame" | "belt", { left: number; right: number; top: number; bottom: number; width: number; height: number }>,
  );

test("the whole conversation and the browser show side by side: the conversation on the left, narrower, the browser on its right", async () => {
  const page = await open({ "world:browserOpen": true });
  await page.setViewportSize({ width: 1700, height: 1000 });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const view = panel(page);
  await view.waitFor();
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App")]);
  const boxWidth = (await sides(page)).chat.width;
  // H: the whole conversation opens, and the browser stays, to its right.
  await dialog.focus();
  await page.keyboard.press("h");
  await dialog.locator(".wc-log").waitFor();
  await page.locator(".world-chat.log.beside").waitFor();
  await page.locator(".board-browser.beside").waitFor();
  const s = await sides(page);
  assert.ok(s.chat.left >= s.frame.left && s.chat.right < s.browser.left, `the conversation is left of the browser: ${JSON.stringify(s)}`);
  assert.ok(s.browser.left - s.chat.right >= 8 && s.browser.left - s.chat.right <= 32, `a gap between them: ${s.browser.left - s.chat.right}`);
  assert.ok(s.chat.width < boxWidth && s.chat.width >= 380 && s.chat.width <= 560, `the conversation is narrower than its box (${boxWidth}): ${s.chat.width}`);
  assert.ok(s.browser.width > s.chat.width, `the browser has the wider side: ${s.browser.width} > ${s.chat.width}`);
  assert.ok(s.browser.right <= s.frame.right - 8, "the browser keeps inside the map");
  assert.ok(Math.abs(s.browser.top - s.chat.top) <= 2 && Math.abs(s.browser.bottom - s.chat.bottom) <= 2, `they stand level: ${JSON.stringify([s.chat, s.browser])}`);
  assert.ok(s.browser.bottom <= s.belt.top, "both end above the belt");
  // The app is told the page's box there.
  const placed = await waitFor(() => lastOf(page, "browser"), (m) => m?.agent === "a-api-1" && m.x === s.slot.left && m.width === s.slot.width && m.height === s.slot.height, "the placement beside");
  assert.equal(placed!.covered, false);
  // The conversation is whole in its column: its messages, its composer, and the robots' arrows at its foot.
  await dialog.getByText("The preview is up.").first().waitFor();
  await dialog.locator("#world-composer").waitFor();
  const inside = await page.evaluate(() => {
    const chat = document.querySelector(".world-chat")!.getBoundingClientRect();
    return [...document.querySelectorAll(".world-chat .wc-nav, .world-chat .wc-browser-toggle, .world-chat .wc-log-toggle, .world-chat #world-composer")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= chat.left && r.right <= chat.right && r.top >= chat.top && r.bottom <= chat.bottom;
    });
  });
  assert.ok(inside.length >= 4 && inside.every(Boolean), `its controls stay inside the column: ${inside}`);
  // Typing in the conversation's message box doesn't move the browser; B outside a field hides it, and the
  // conversation takes its full width back.
  await dialog.locator("#world-composer").fill("b");
  assert.equal(await view.count(), 1);
  await dialog.locator("#world-composer").fill("");
  await dialog.focus();
  await page.keyboard.press("b");
  await view.waitFor({ state: "detached" });
  assert.equal(await page.locator(".world-chat.log.beside").count(), 0);
  const alone = await page.evaluate(() => Math.round(document.querySelector(".world-chat")!.getBoundingClientRect().width));
  assert.ok(alone > 560, `alone, the conversation is as wide as before: ${alone}`);
  // B outside the box too (the page's body has the keyboard): the browser, never the mini games.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("b");
  await page.locator(".board-browser.beside").waitFor();
  assert.equal(await page.getByRole("region", { name: "Mini games" }).count(), 0, "B never opens the mini games");
  await page.keyboard.press("b");
  await view.waitFor({ state: "detached" });
  // B again brings the browser back beside it (the conversation stays open); Back (H) leaves the browser above the box.
  await page.keyboard.press("b");
  await page.locator(".board-browser.beside").waitFor();
  assert.equal(await dialog.locator(".wc-log").count(), 1);
  await page.keyboard.press("h");
  await page.locator(".board-browser:not(.beside)").waitFor();
  assert.equal(await dialog.locator(".wc-log").count(), 0);
  const above = await sides(page);
  assert.ok(above.slot.bottom < above.chat.top, "above the dialogue box again");
  // Esc with both open leaves for the bare board: the conversation and the browser go together.
  await page.keyboard.press("h");
  await page.locator(".world-chat.log.beside").waitFor();
  await dialog.focus();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await view.waitFor({ state: "detached" });
  await waitFor(() => lastOf(page, "browser"), (m) => !m?.agent, "the app shows no page");
  assert.equal(await page.locator(".world-chat, .board-browser").count(), 0, "only the board");
  await page.context().close();
});

test("on a map too narrow for both, the conversation takes the browser's place, and B takes it back", async () => {
  const page = await open({ "world:browserOpen": true });
  await page.setViewportSize({ width: 860, height: 900 });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const view = panel(page);
  await view.waitFor();
  const frame = await page.evaluate(() => document.querySelector(".native-world-frame")!.getBoundingClientRect().width);
  assert.ok(frame < 900, `the map is narrow here: ${frame}`);
  await dialog.focus();
  await page.keyboard.press("h");
  await dialog.locator(".wc-log").waitFor();
  await view.waitFor({ state: "detached" });
  await waitFor(() => lastOf(page, "browser"), (m) => !m?.agent, "hidden under the conversation");
  assert.equal(await page.locator(".world-chat.beside").count(), 0);
  // B: the browser, and the dialogue box under it.
  await page.keyboard.press("b");
  await view.waitFor();
  assert.equal(await dialog.locator(".wc-log").count(), 0);
  // Widened, both fit: H opens the conversation beside the browser.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.keyboard.press("h");
  await page.locator(".world-chat.log.beside").waitFor();
  await page.locator(".board-browser.beside").waitFor();
  // Narrowed again while both show, the conversation keeps the board and the browser steps aside.
  await page.setViewportSize({ width: 860, height: 900 });
  await view.waitFor({ state: "detached" });
  assert.equal(await page.locator(".world-chat.log").count(), 1);
  assert.equal(await page.locator(".world-chat.beside").count(), 0);
  await page.context().close();
});

test("⇧⌘W hides the browser from anywhere: a field of the page, or the web page itself (the app says so)", async () => {
  const page = await open({ "world:browserOpen": true });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const view = panel(page);
  await view.waitFor();
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App")]);
  // In its address field, where B is a letter.
  const address = view.getByRole("textbox", { name: "Address" });
  await address.click();
  await address.press("b");
  assert.equal(await view.count(), 1, "B in a field types");
  await page.keyboard.press("Meta+Shift+W");
  await view.waitFor({ state: "detached" });
  await waitFor(() => lastOf(page, "browser"), (m) => !m?.agent, "the app shows nothing");
  assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:world:browserOpen")), "false");
  assert.equal(await dialog.count(), 1, "the dialogue box stays");
  // From the web page, the app takes the key and tells the page.
  await dialog.focus();
  await page.keyboard.press("b");
  await view.waitFor();
  await swift(page, "paseo:browser", { type: "key", action: "hide" });
  await view.waitFor({ state: "detached" });
  // ⌘K hides it too.
  await page.keyboard.press("b");
  await view.waitFor();
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Hide the browser on the board");
  await palette.getByRole("option", { name: /Hide the browser on the board/ }).click();
  await view.waitFor({ state: "detached" });
  await page.context().close();
});

test("a tab the agent opens shows at once while you talk to it; another agent's is only said", async () => {
  const page = await open();
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  assert.equal(await panel(page).count(), 0);
  // The agent's browser_new_tab, as the app reports it.
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App")]);
  await swift(page, "paseo:browser", { type: "opened", host: "local", agent: "a-api-1", tab: TAB_A });
  await panel(page).waitFor();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["select", TAB_A]);
  await panel(page).getByRole("tab", { name: "Vite App" }).waitFor();
  // A page that didn't load says why in the box (the app shows no page over it), and offers to try again.
  await state(page, [tab(TAB_A, "http://localhost:5173/", "", { error: "Could not connect to the server." })]);
  await panel(page).getByRole("alert").getByText("Could not connect to the server.").waitFor();
  await panel(page).getByRole("button", { name: "Try again" }).click();
  assert.deepEqual(await lastOf(page, "browserDo").then((m) => [m!.action, m!.tab]), ["reload", TAB_A]);
  // An address the app refuses is said.
  await swift(page, "paseo:browser", { type: "refused", message: "That isn't a web address." });
  await page.getByText("That isn't a web address.").waitFor();
  // Hidden, then another agent opens a page: a notice, and the browser stays hidden.
  await panel(page).getByRole("button", { name: "Hide the browser (B, ⇧⌘W)" }).click();
  await panel(page).waitFor({ state: "detached" });
  const other = (dungeon.agents as unknown as { id: string; host?: string }[]).find((a) => a.id !== "a-api-1" && !a.host)!;
  await swift(page, "paseo:browser", { type: "opened", host: "local", agent: other.id, tab: TAB_B });
  await page.getByText(/opened a page in its browser\./).waitFor();
  assert.equal(await panel(page).count(), 0);
  await page.context().close();
});

test("with following off, a tab the agent opens is only counted on the box's Browser button", async () => {
  const page = await open({ "world:browserFollows": false });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  await state(page, [tab(TAB_A, "http://localhost:5173/", "Vite App")]);
  await swift(page, "paseo:browser", { type: "opened", host: "local", agent: "a-api-1", tab: TAB_A });
  await dialog.getByRole("button", { name: /^Show its browser \(B\): 1 tab$/ }).waitFor();
  assert.equal(await panel(page).count(), 0);
  assert.equal((await sent(page, "browserDo")).length, 0);
  await page.context().close();
});

test("Settings → Map: agents' browser tools open tabs here, told to the app, with how it stands", async () => {
  const page = await open();
  await pick(page, "a-api-1");
  await box(page).waitFor();
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Let agents’ browser tools open tabs");
  await palette.getByRole("option", { name: /Let agents’ browser tools open tabs in the Dungeon Board’s browser/ }).click();
  await waitFor(() => lastOf(page, "browserHost"), (m) => m?.enabled === true, "hosting asked for");
  assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:world:browserTools")), "true");
  // The empty browser says how it stands as the app connects and the daemon answers.
  await page.keyboard.press("b");
  const view = panel(page);
  await view.waitFor();
  await state(page, [], { hosting: { enabled: true, connected: false, hosts: [] } });
  await view.getByText("Connecting this app to its daemons as their browser…").waitFor();
  await state(page, [], { hosting: { enabled: true, connected: true, hosts: [{ host: "local", state: "registered" }] } });
  await view.getByText(/can open pages here itself with its browser tools\./).waitFor();
  await state(page, [], { hosting: { enabled: true, connected: true, hosts: [{ host: "local", state: "refused", error: "Unknown request" }] } });
  await view.getByText(/didn’t take this app as its browser: Unknown request/).waitFor();
  // Off again from ⌘K.
  await page.keyboard.press("Meta+k");
  await palette.getByRole("combobox").fill("Stop agents’ browser tools");
  await palette.getByRole("option", { name: /Stop agents’ browser tools opening tabs/ }).click();
  await waitFor(() => lastOf(page, "browserHost"), (m) => m?.enabled === false, "hosting off");
  // The empty browser's way to Settings asks the app for its Settings side.
  await state(page, []);
  await view.getByRole("button", { name: "Open Settings" }).click();
  await waitFor(() => lastOf(page, "menu"), (m) => m?.action === "settings", "Settings asked for");
  await page.context().close();
});

test("a web link clicked in the board's conversation opens in the robot's browser while it shows, else in Conquer", async () => {
  const PREVIEW = "https://preview.example.test/admin/files";
  const page = await open(
    {},
    `The preview is at [the admin files](${PREVIEW}). The pull request is https://github.com/acme/app/pull/42 and the issue https://linear.app/acme/issue/DE-7884/move-branch-operations.`,
  );
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const link = (name: string | RegExp) => dialog.getByRole("link", { name }).first();
  const dos = () => sent(page, "browserDo");
  const links = async () => (await sent(page, "openLink")).map((m) => m.url as string);
  // The browser hidden: the app's own place for links (a Conquer tab).
  await link("the admin files").click();
  await waitFor(links, (l) => l.length === 1, "the link sent to the app");
  assert.deepEqual(await links(), [PREVIEW]);
  assert.equal((await dos()).length, 0);
  // The browser on show: the link opens there, in this robot's browser, and the app is asked nothing else.
  await dialog.focus();
  await page.keyboard.press("b");
  await panel(page).waitFor();
  await link("the admin files").click();
  const opened = await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "open", "opened in the browser");
  assert.deepEqual({ host: opened!.host, agent: opened!.agent, url: opened!.url }, { host: "local", agent: "a-api-1", url: PREVIEW });
  assert.deepEqual(await links(), [PREVIEW], "not sent to Conquer again");
  // A tab already at that address is shown, not opened twice.
  await state(page, [tab(TAB_A, "https://example.com/", "Example"), tab(TAB_B, PREVIEW, "Files")], { current: TAB_A });
  await panel(page).getByRole("tab", { name: "Files" }).waitFor();
  await link("the admin files").click();
  await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "select" && m.tab === TAB_B, "its tab shown");
  // A blank tab on show takes the page.
  await state(page, [tab(TAB_A, "", "")]);
  await waitFor(() => panel(page).getByRole("tab").count(), (n) => n === 1, "one blank tab");
  await link("the admin files").click();
  await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "navigate" && m.tab === TAB_A && m.url === PREVIEW, "the blank tab used");
  // A pull request and a Linear issue keep the app's own places (the GitHub tab, Linear's app).
  const before = (await dos()).length;
  await link(/github\.com\/acme\/app\/pull\/42/).click();
  await link(/linear\.app\/acme\/issue/).click();
  await waitFor(links, (l) => l.length === 3, "both sent to the app");
  assert.deepEqual((await links()).slice(1), ["https://github.com/acme/app/pull/42", "https://linear.app/acme/issue/DE-7884/move-branch-operations"]);
  assert.equal((await dos()).length, before, "neither opened in the board's browser");
  // In the whole conversation beside the browser, the same.
  await page.setViewportSize({ width: 1700, height: 1000 });
  await dialog.focus();
  await page.keyboard.press("h");
  await page.locator(".world-chat.log.beside").waitFor();
  await state(page, [tab(TAB_A, "https://example.com/", "Example")]);
  await dialog.locator(".wc-log").getByRole("link", { name: "the admin files" }).click();
  await waitFor(() => lastOf(page, "browserDo"), (m) => m?.action === "open" && m.url === PREVIEW, "opened from the whole conversation");
  assert.equal((await links()).length, 3);
  // Hidden again (⇧⌘W), links go back to the app.
  await page.keyboard.press("Meta+Shift+W");
  await panel(page).waitFor({ state: "detached" });
  await dialog.locator(".wc-log").getByRole("link", { name: "the admin files" }).click();
  await waitFor(links, (l) => l.length === 4, "sent to the app again");
  await page.context().close();
});

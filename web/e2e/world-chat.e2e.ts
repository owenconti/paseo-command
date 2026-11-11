/**
 * Talking to robots on the Dungeon Board (src/worldChat/): picking a robot opens its dialogue box over the
 * board (not the hidden panel), its reply typed out and paged, then the choices: reply, answer its request
 * or question, follow up while it works, open the full chat or leave. The board is told to frame the robot
 * above the box (`talk`). Swift's side of the bridge is a stub; every /api request is answered in the browser.
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

const REPLY = [
  "I tidied the README and moved the setup steps into their own section.",
  "",
  "- The install command now uses `npm ci`, so the lockfile is respected.",
  "- The badges point at the new CI workflow.",
  "- The licence section links to the full text.",
  "",
  "I also checked every link in the file: two were dead, both to the old docs site, and I pointed them at the new one. The table of contents is generated again, so it matches the headings.",
  "",
  "Shall I open the pull request now, or would you like to read the diff first?",
].join("\n");

type Post = { path: string; body: any };
type Options = {
  timelines?: Record<string, unknown[]>;
  details?: Record<string, Record<string, unknown>>;
  /** Picking a robot opens the box (Settings → Map); kept before the page loads. */
  talkOnPick?: boolean;
  motion?: boolean;
  filter?: "running";
  names?: Record<string, string>;
  /** The fleet's agents, when a test changes them (an archive, a dispatch). */
  agents?: () => unknown[];
  /** Answers for an agent's other routes (its forks). */
  routes?: (id: string, sub: string) => unknown;
  /** A POST's answer, in place of a plain acceptance. */
  answer?: (path: string, body: any) => unknown;
  /** TypeSafe is on: the reply's questions are judged (`POST /api/agents/:id/asks`). */
  typesafe?: boolean;
};
async function open(options: Options = {}): Promise<{ page: Page; posts: Post[] }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  if (!options.motion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((talkOnPick) => {
    localStorage.setItem("paseo-command:atlas:style", JSON.stringify("dungeon"));
    if (talkOnPick === false) localStorage.setItem("paseo-command:world:talkOnPick", "false");
    const host = { arts: [] as string[], talks: [] as unknown[], keys: [] as string[], reveals: [] as string[], selected: null as string | null };
    (window as any).__native = host;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") {
              host.arts.push(m.scene);
              setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            }
            if (m.type === "key") host.keys.push(m.key);
            if (m.type === "select") host.selected = m.id;
            if (m.type === "talk") host.talks.push({ id: m.id, inset: m.inset });
            if (m.type === "revealFile") host.reveals.push(m.path);
          },
        },
      },
    };
  }, options.talkOnPick ?? true);
  const posts: Post[] = [];
  await mockApi(page, {
    agents: () => options.agents?.() ?? dungeon.agents.map((a) => options.names?.[a.id] ? { ...a, name: options.names[a.id] } : a),
    permissions: () => dungeon.permissions,
    hosts: () => dungeon.hosts,
    projects: () => dungeon.projects,
    workspaces: () => dungeon.workspaces,
    detail: (id: string) => {
      const row = (dungeon.agents as unknown as { id: string; status: string }[]).find((a) => a.id === id);
      return detailOf(id, row?.status ?? "idle", options.details?.[id] ?? {});
    },
    timeline: (id: string) => ({ items: options.timelines?.[id] ?? [] }),
    routes: (id: string, sub: string) => options.routes?.(id, sub),
    accept: (path: string, body: any) => {
      posts.push({ path, body });
      return options.answer?.(path, body) ?? true;
    },
    lists: {
      hoststats: DUNGEON_STATS,
      github: DASHBOARD_PRS,
      linear: DASHBOARD_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: !!options.typesafe }, error: null },
    },
  } as any);
  await page.goto(options.filter ? `${app.url}?filter=${options.filter}` : app.url);
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && !!i.agents?.length, "the board", 30000);
  return { page, posts };
}
const inspect = (page: Page) => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any);
const native = (page: Page) => page.evaluate(() => (window as any).__native as { talks: { id: string | null; inset: number }[]; selected: string | null; keys: string[] });
const swift = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((d) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: d })), detail);
const key = (id: string, host = "local") => JSON.stringify([host, id]);
const pick = (page: Page, id: string, host?: string) => swift(page, { type: "pick", id: key(id, host) });
const box = (page: Page) => page.getByRole("dialog", { name: /^Conversation with / });
const choices = (page: Page) => page.getByRole("menu", { name: "What you can say" });
const posted = (posts: Post[], path: string) => waitFor(async () => posts.find((p) => p.path === path), Boolean, `POST ${path}`);
/** Page through the box until its choices show. */
async function readToChoices(page: Page) {
  for (let i = 0; i < 20 && !(await choices(page).isVisible()); i++) await page.keyboard.press("Enter");
  await choices(page).waitFor();
}

test("picking a robot opens its dialogue box over the board, not the hidden panel; its reply pages through, then a reply is sent", async () => {
  const { page, posts } = await open({
    timelines: { "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: REPLY, messageId: "r1" }] },
  });
  // The panel hidden (⌘B): picking a robot keeps it so; the box speaks instead.
  await page.keyboard.press("Meta+b");
  await page.locator('.floating-command[data-collapsed="true"]').waitFor({ state: "attached" });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  assert.match((await dialog.getAttribute("aria-label")) ?? "", /api agent 2/);
  assert.equal(await page.locator('.floating-command[data-collapsed="true"]').count(), 1, "the panel stays hidden");
  assert.equal((await native(page)).selected, key("a-api-1"), "the robot is selected");
  // The board frames the robot above the box.
  const talk = await waitFor(() => native(page), (n) => n.talks.at(-1)?.id === key("a-api-1"), "the talk message");
  assert.ok((talk.talks.at(-1)?.inset ?? 0) > 150, `inset ${talk.talks.at(-1)?.inset}`);
  // Its reply, paged: the first page first, the page count beside it.
  await dialog.locator(".wc-page").getByText("I tidied the README").waitFor();
  const count = await dialog.locator(".wc-pages").textContent();
  assert.match(count ?? "", /^1 \/ [2-9]$/, `pages ${count}`);
  assert.equal(await choices(page).count(), 0, "no choices before the last page");
  // ↓ in the box never steps to the next robot (the page's J/K).
  await page.keyboard.press("ArrowDown");
  assert.match((await dialog.getAttribute("aria-label")) ?? "", /api agent 2/);
  await readToChoices(page);
  await dialog.locator(".wc-page").getByText("Shall I open the pull request now").waitFor();
  const menu = choices(page);
  // The actions sit above the raised Conversation tab at both supported panel widths.
  for (const [width, height] of [[1600, 1000], [1200, 1000], [1200, 560]]) {
    await page.setViewportSize({ width, height });
    const gap = await page.evaluate(() => {
      const actions = document.querySelector(".wc-choices")!.getBoundingClientRect();
      const tab = document.querySelector(".wc-log-toggle")!.getBoundingClientRect();
      return { gap: tab.top - actions.bottom, top: actions.top };
    });
    assert.ok(gap.gap >= 8, `Conversation stays clear of the actions at ${width}px: ${gap.gap}px gap`);
    assert.ok(gap.top >= 0, `actions stay on screen at ${width}×${height}`);
  }
  await page.setViewportSize({ width: 1200, height: 1000 });
  for (const label of ["Reply…", "Open the full chat", "Leave"]) await menu.getByRole("menuitem", { name: new RegExp(label) }).waitFor();
  // Home goes back to the first page, already typed; Left/Right belong to robot navigation.
  await dialog.focus();
  await page.keyboard.press("Home");
  assert.equal(await choices(page).count(), 0);
  await page.keyboard.press("End");
  await choices(page).waitFor();
  // R: the app's own composer (files, /skills, @files) in the box; Enter sends.
  await page.keyboard.press("r");
  const field = dialog.locator("#world-composer");
  await field.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "world-composer", "the composer has the keyboard");
  await dialog.locator(".composer2").waitFor();
  await field.fill("Open it, thanks");
  await page.keyboard.press("Enter");
  const send = await posted(posts, "/api/agents/a-api-1/send");
  assert.equal(send.body.prompt, "Open it, thanks");
  assert.ok(send.body.messageId, "sent with a message id");
  await field.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Show conversation actions (Enter)" }).waitFor();
  assert.equal(await choices(page).count(), 0, "sending a reply keeps the actions closed");
  // The explicit action is also available through the palette.
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Show conversation actions on the board");
  await palette.getByRole("option", { name: /Show conversation actions on the board/ }).click();
  await choices(page).waitFor();
  // Esc leaves the conversation; the robot stays selected and the board's camera is let go.
  await dialog.focus();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal((await native(page)).selected, key("a-api-1"));
  await waitFor(() => native(page), (n) => n.talks.at(-1)?.id === null, "the talk ended");
});

test("an approval is answered from the box", async () => {
  const { page, posts } = await open({
    details: { "a-web-1": { PendingPermissions: [{ id: "perm-a-web-1", name: "Bash", description: "npm publish" }] } },
  });
  await pick(page, "a-web-1");
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.getByText("Approval requested").waitFor();
  await dialog.locator(".wc-page").getByText("npm publish").waitFor();
  await readToChoices(page);
  await choices(page).getByRole("menuitem", { name: /^1\s*Allow/ }).waitFor();
  // A key pressed while the box hasn't the keyboard (a click in the panel's transcript) is never its choice.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Enter");
  await page.keyboard.press("1");
  await page.waitForTimeout(300);
  assert.equal(posts.filter((p) => p.path.endsWith("/respond")).length, 0, "nothing approved from outside the box");
  await box(page).focus();
  await page.keyboard.press("1");
  const respond = await posted(posts, "/api/agents/a-web-1/respond");
  assert.deepEqual({ requestId: respond.body.requestId, behavior: respond.body.behavior }, { requestId: "perm-a-web-1", behavior: "allow" });
});

test("a question is answered with its options, keyed by its header, on its own host", async () => {
  const { page, posts } = await open({
    details: {
      "a-analytics-0": {
        PendingPermissions: [
          {
            id: "perm-a-analytics-0",
            name: "AskUserQuestion",
            description: "",
            kind: "question",
            questions: [
              {
                question: "Which events should the dashboard count?",
                header: "Scope",
                options: [{ label: "Groups 1 + 2", description: "Everything shipped" }, { label: "Group 1 only" }],
                multiSelect: false,
                allowOther: true,
                allowEmpty: false,
              },
            ],
          },
        ],
      },
    },
  });
  await pick(page, "a-analytics-0", "srv_staging");
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.locator(".wc-page").getByText("Which events should the dashboard count?").waitFor();
  await dialog.locator(".wc-caption").getByText("Scope").waitFor();
  await readToChoices(page);
  await choices(page).getByRole("menuitem", { name: /Something else/ }).waitFor();
  await choices(page).getByRole("menuitem", { name: /Group 1 only/ }).click();
  const respond = await posted(posts, "/api/agents/a-analytics-0/respond");
  assert.equal(respond.body.requestId, "perm-a-analytics-0");
  assert.equal(respond.body.behavior, "allow");
  assert.deepEqual(respond.body.answers, { Scope: "Group 1 only" });
  assert.equal(respond.body.host, "srv_staging");
});

test("a working robot says what it is doing; a follow-up is queued, not sent", async () => {
  const timelines: Record<string, unknown[]> = {
    "a-api-2": [
      { kind: "user", text: "Run the tests", messageId: "u1" },
      { kind: "tool", name: "Bash", status: "running", summary: "npm test", detail: "npm test" },
    ],
  };
  const { page, posts } = await open({ timelines });
  await pick(page, "a-api-2");
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.locator(".wc-page").getByText(/is working/).waitFor();
  await dialog.locator(".wc-caption").getByText("You said: Run the tests").waitFor();
  await choices(page).getByRole("menuitem", { name: /Interrupt/ }).waitFor();
  await choices(page).getByRole("menuitem", { name: /Send a follow-up/ }).click();
  const field = dialog.locator("#world-composer");
  await field.fill("Also run the e2e suite");
  await page.keyboard.press("Enter");
  await waitFor(
    () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("queue")).map((k) => localStorage.getItem(k) ?? "").join("\n")),
    (all) => all.includes("Also run the e2e suite"),
    "the follow-up queued",
  );
  assert.equal(posts.filter((p) => p.path.endsWith("/send")).length, 0, "nothing sent while it works");
  await field.waitFor({ state: "detached" });
  const actions = dialog.getByRole("button", { name: "Show conversation actions (Enter)" });
  await actions.waitFor();
  assert.equal(await choices(page).count(), 0, "queueing a follow-up keeps the actions closed");
  timelines["a-api-2"].push(
    { kind: "assistant", text: "The first checks passed; running the rest.", messageId: "progress-1" },
    { kind: "tool", name: "Bash", status: "running", summary: "npm run updated-tests", detail: "npm run updated-tests" },
  );
  await dialog.locator(".wc-page").getByText(/updated-tests/).waitFor();
  assert.equal(await choices(page).count(), 0, "live progress doesn't reopen the actions");
  await actions.click();
  await choices(page).getByRole("menuitem", { name: /Interrupt/ }).waitFor();
  // Queued, it's gone from the box's draft: opening the composer again starts empty.
  await page.keyboard.press("r");
  await field.waitFor();
  assert.equal(await field.inputValue(), "");
  assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:draft:a-api-2:world")), null);
  await field.fill("And check the build");
  await page.keyboard.press("Enter");
  await field.waitFor({ state: "detached" });
  await actions.waitFor();
  assert.equal(await choices(page).count(), 0);
  await page.keyboard.press("Enter");
  await choices(page).getByRole("menuitem", { name: /Interrupt/ }).waitFor();
});

test("reading a finished robot's reply in the box marks it read; T opens the box when picks don't", async () => {
  const { page, posts } = await open({
    talkOnPick: false,
    timelines: { "a-cli-0": [{ kind: "user", text: "Ship it", messageId: "u1" }, { kind: "assistant", text: "Shipped v2.", messageId: "r1" }] },
  });
  await page.keyboard.press("Meta+b");
  await page.locator('.floating-command[data-collapsed="true"]').waitFor({ state: "attached" });
  await pick(page, "a-cli-0");
  await waitFor(() => native(page), (n) => n.selected === key("a-cli-0"), "the robot selected");
  assert.equal(await box(page).count(), 0, "picking doesn't open the box with the setting off");
  await page.locator(".native-map-surface").focus();
  await page.keyboard.press("t");
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.locator(".wc-page").getByText("Shipped v2.").waitFor();
  await posted(posts, "/api/agents/a-cli-0/read");
});

test("the box types its line out; Enter finishes it at once", async () => {
  const { page } = await open({
    motion: true,
    timelines: { "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: REPLY, messageId: "r1" }] },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const skip = dialog.getByRole("button", { name: /Show the whole page/ });
  await skip.waitFor();
  assert.equal(await page.evaluate(() => CSS.highlights.has("world-chat-untyped")), true, "the untyped rest is hidden");
  await page.keyboard.press("Enter");
  await skip.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => CSS.highlights.has("world-chat-untyped")), false);
});

test("H opens the whole conversation upward over the board, scrolling up does too; Esc goes back to the box", async () => {
  const { page } = await open({
    timelines: {
      "a-api-1": [
        ...Array.from({ length: 12 }, (_, i) => [
          { kind: "user", text: `Earlier request ${i + 1}`, messageId: `e-u${i}` },
          { kind: "assistant", text: `Earlier answer ${i + 1}: ${"done and checked. ".repeat(6)}`, messageId: `e-r${i}` },
        ]).flat(),
        { kind: "user", text: "Look at the flaky login test first", messageId: "u0" },
        { kind: "assistant", text: "The login test waits on a fixed timer; I made it wait for the redirect instead.", messageId: "r0" },
        { kind: "user", text: "Tidy the README", messageId: "u1" },
        { kind: "assistant", text: REPLY, messageId: "r1" },
      ],
    },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const talk = await waitFor(() => native(page), (n) => n.talks.at(-1)?.id === key("a-api-1"), "the talk message");
  const inset = talk.talks.at(-1)!.inset;
  await page.keyboard.press("h");
  const log = dialog.locator(".wc-log .timeline");
  await log.waitFor();
  // The earlier exchange is there, as the panel shows it, with the app's composer under it.
  await log.getByText("Look at the flaky login test first").waitFor();
  await log.getByText("waits on a fixed timer").waitFor();
  await dialog.locator(".wc-log #world-composer").waitFor();
  assert.equal(await choices(page).count(), 0, "the log has no choices menu");
  // It opens upward: the box reaches most of the map's height, and the board keeps the box's own room.
  const tall = (await dialog.boundingBox())!.height;
  assert.ok(tall > 500, `the log is ${tall}px tall`);
  assert.equal((await native(page)).talks.at(-1)?.inset, inset, "the camera keeps the box's room under the log");
  // The keys scroll it, and it stays where they leave it (it doesn't pin itself back to the latest).
  const gap = () => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await waitFor(gap, (g) => g < 2, "the log opens at its latest");
  await page.keyboard.press("PageUp");
  await page.waitForTimeout(700);
  assert.ok((await gap()) > 100, `PageUp scrolled up and stayed (${await gap()}px from the end)`);
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  assert.equal(await log.evaluate((el) => el.scrollTop), 0);
  await page.keyboard.press("Escape");
  await log.waitFor({ state: "detached" });
  await dialog.waitFor();
  // Scrolling up over the page opens it too.
  await dialog.locator(".wc-text").hover();
  await page.mouse.wheel(0, -400);
  await log.waitFor();
  await dialog.getByRole("button", { name: /Back to the dialogue box/ }).click();
  await log.waitFor({ state: "detached" });
});

test("painted navigation buttons and plain Left/Right step through robots despite sidebar filters", async () => {
  const { page } = await open({
    filter: "running",
    timelines: {
      "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done.", messageId: "r1" }],
    },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  const next = dialog.getByRole("button", { name: /^Next agent: .+ \(→\)$/ });
  const prev = dialog.getByRole("button", { name: /^Previous agent: .+ \(←\)$/ });
  await next.waitFor();
  await prev.waitFor();
  const nextName = /^Next agent: (.+) \(→\)$/.exec((await next.getAttribute("aria-label"))!)![1]!;
  // The ◀ ▶ sit outside the box, either side of it.
  const [b, l, r] = await Promise.all([dialog.boundingBox(), prev.boundingBox(), next.boundingBox()]);
  assert.ok(l!.x + l!.width <= b!.x && r!.x >= b!.x + b!.width, "the buttons flank the box");
  await next.click();
  await waitFor(async () => (await box(page).getAttribute("aria-label")) ?? "", (label) => label === `Conversation with ${nextName}`, "the next robot's box");
  const stepped = (await native(page)).selected;
  assert.notEqual(stepped, key("a-api-1"));
  await waitFor(() => native(page), (n) => n.talks.at(-1)?.id === stepped, "the board frames the next robot");
  await box(page).focus();
  await page.keyboard.press("ArrowLeft");
  await waitFor(async () => (await box(page).getAttribute("aria-label")) ?? "", (label) => /api agent 2/.test(label), "back to the first robot");
  assert.equal(await box(page).locator(".wc-nav .wc-key").count(), 0, "navigation has no shortcut badges");
  await box(page).getByRole("button", { name: /^Previous agent:/ }).click();
  assert.notEqual((await native(page)).selected, key("a-api-1"), "the previous button works too");
  await box(page).focus();
  await page.keyboard.press("ArrowRight");
  await waitFor(() => native(page), (n) => n.selected === key("a-api-1"), "Right returns to the original robot");
  await box(page).getByRole("button", { name: "Leave the conversation (Esc)" }).click();
  await page.locator(".native-map-surface").focus();
  await page.keyboard.press("ArrowRight");
  await waitFor(() => native(page), (n) => n.selected !== key("a-api-1"), "Right navigates from the map too");
  assert.ok(!(await native(page)).keys.some((k) => k === "ArrowLeft" || k === "ArrowRight"), "Left/Right never pan the native map");
});


test("Conversation stays clear of a long banner, works in narrow maps, and user links contrast on parchment", async () => {
  const { page } = await open({
    names: { "a-cli-0": "An unusually long robot name which must never cover the conversation button" },
    timelines: { "a-cli-0": [{ kind: "user", text: "Please review https://example.com/a/long/path?with=parameters", messageId: "u1" }, { kind: "assistant", text: "Done.", messageId: "r1" }] },
  });
  await pick(page, "a-cli-0");
  await box(page).waitFor();
  for (const [width, height] of [[1600, 1000], [1000, 900], [800, 820]] as const) {
    await page.setViewportSize({ width, height });
    await waitFor(() => page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>(".wc-log-toggle")!;
      const r = button.getBoundingClientRect(), banner = document.querySelector(".wc-nameplate")!.getBoundingClientRect();
      const covers = banner.left < r.right && banner.right > r.left && banner.top < r.bottom && banner.bottom > r.top;
      return { clear: !covers, receivesClick: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("button") === button };
    }), (r) => r.clear && r.receivesClick, `Conversation is clickable at ${width}px`);
    await box(page).getByRole("button", { name: /Show the whole conversation/ }).click();
    await box(page).locator(".wc-log").waitFor();
    await box(page).getByRole("button", { name: /Back to the dialogue box/ }).click();
    await box(page).locator(".wc-log").waitFor({ state: "detached" });
  }
  // The navigation controls stay visible and clickable inside the compact dialogue.
  for (const name of [/^Next agent:/, /^Previous agent:/]) {
    const button = box(page).getByRole("button", { name });
    assert.equal(await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("button") === el;
    }), true);
  }
  await box(page).getByRole("button", { name: /Show the whole conversation/ }).click();
  const link = box(page).locator(".msg.user .user-text a");
  await link.waitFor();
  const appearance = await link.evaluate((el) => {
    const style = getComputedStyle(el), bubble = getComputedStyle(el.closest(".msg.user")!);
    const [a, b] = [style.color, bubble.backgroundColor].map((color) => {
      const rgb = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map((c) => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    });
    return { contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), underline: style.textDecorationLine };
  });
  assert.ok(appearance.contrast >= 4.5, `link contrast ${appearance.contrast}`);
  assert.match(appearance.underline, /underline/);
  await page.keyboard.press("Tab");
  await link.focus();
  await waitFor(() => link.evaluate((e) => e === document.activeElement), Boolean, "the link receives keyboard focus");
  assert.equal(await link.evaluate((e) => getComputedStyle(e).outlineStyle), "solid");
  const field = box(page).locator("#world-composer");
  await field.fill("Keep this draft");
  await field.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(5, 5));
  await page.keyboard.press("ArrowLeft");
  assert.equal(await field.evaluate((e: HTMLTextAreaElement) => e.selectionStart), 4);
  assert.equal((await native(page)).selected, key("a-cli-0"), "arrows in the composer edit text, never switch robots");
  await page.context().close();
});

test("the full map conversation keeps readable Dungeon colors across app themes", async () => {
  const { page } = await open({ timelines: { "a-api-1": [
    { kind: "user", text: "Check the colors in https://example.com/docs", messageId: "theme-user" },
    { kind: "notice", id: "compact", level: "info", text: "Context compacted\n\nThe earlier messages are summarized here." },
    { kind: "tool", id: "theme-tool", name: "Bash", status: "completed", summary: "npm test", detail: "All checks passed." },
    { kind: "assistant", messageId: "theme-reply", text: [
      "The theme now uses readable text and `inline code`.", "", "> Secondary text remains legible.", "",
      "```js", "// A readable comment", "const count = 42;", 'const status = "ready";', "```", "",
      "| Check | Result |", "| --- | --- |", "| Contrast | Passed |",
    ].join("\n") },
  ] } });
  await pick(page, "a-api-1");
  await box(page).getByRole("button", { name: /Show the whole conversation/ }).click();
  const log = box(page).locator(".wc-log");
  await log.locator(".msg.event").waitFor();
  await log.locator(".msg.event summary").click();
  await log.locator(".step.tool").click();
  const selectors = [".msg.event summary", ".event-label", ".msg.event .md", ".step code", ".step-detail", ".msg.assistant", ".md-code-bar", ".md pre code", ".tok-comment", ".tok-keyword", ".tok-number", ".tok-string", ".md blockquote", ".md th", ".md td", ".msg.user", ".msg.user a"];
  for (const theme of ["light", "dark", "lake-country", "galaxy"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    const results = await log.evaluate((root, selectors) => {
      return selectors.map((selector) => {
        const el = root.querySelector(selector)!;
        if (!el) return { selector, contrast: 0, background: "missing" };
        let parent: Element | null = el, background = "";
        while (parent && !background) {
          const color = getComputedStyle(parent).backgroundColor, c = color.match(/[\d.]+/g)!.map(Number);
          if (c.length === 3 || c[3] === 1) background = color;
          parent = parent.parentElement;
        }
        // The dialogue's opaque panel is painted by its border image.
        if (parent === null) background = "rgb(37, 30, 64)";
        const [a, b] = [getComputedStyle(el).color, background].map((color) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => {
          const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
        }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i]!, 0)) as [number, number];
        return { selector, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), background };
      });
    }, selectors);
    for (const r of results) assert.ok(r.contrast >= 4.5, `${theme} ${r.selector}: ${r.contrast.toFixed(2)} on ${r.background}`);
    assert.equal(await log.locator(".msg.event").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(48, 38, 63)", "event cards never inherit the light app's surface");
  }
  await log.locator(".timeline").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/dungeon-chat-theme-desktop.png" });
  await page.setViewportSize({ width: 800, height: 900 });
  const bounds = await box(page).boundingBox(), composer = await log.locator(".session-footer").boundingBox();
  const transcript = await log.locator(".timeline").boundingBox();
  assert.ok(transcript && transcript.height > 180, "the narrow conversation keeps room for its transcript");
  assert.ok(composer && bounds && composer.y + composer.height <= bounds.y + bounds.height, "the composer stays inside the narrow dialogue");
  await page.screenshot({ path: "/tmp/dungeon-chat-theme-narrow.png" });
  await page.context().close();
});

test("questions in the full map conversation use readable dark surfaces and gold focus", async () => {
  const { page } = await open({ details: { "a-api-1": { PendingPermissions: [{
    id: "theme-question", name: "AskUserQuestion", description: "", kind: "question", questions: [{
      question: "Which public staging page should I monitor during the database migration? Please paste its full URL, ideally a published page that loads content from the database.",
      header: "Question 1", options: [], multiSelect: false, allowOther: true, allowEmpty: false,
    }],
  }] } }, timelines: { "a-api-1": [
    { kind: "tool", name: "Shell", status: "completed", summary: "python3 -m py_compile scripts/monitor-public-page.py", detail: "Syntax checked." },
  ] } });
  await pick(page, "a-api-1");
  await box(page).getByRole("button", { name: /Show the whole conversation/ }).click();
  const card = box(page).locator(".question-card"), input = card.getByPlaceholder("Type your answer");
  await input.focus();
  const styles = await card.evaluate((el) => {
    const text = getComputedStyle(el.querySelector(".question-text")!), field = el.querySelector("input")!;
    return { background: getComputedStyle(el).backgroundColor, color: text.color, focus: getComputedStyle(field).boxShadow, placeholder: getComputedStyle(field, "::placeholder").color };
  });
  assert.equal(styles.background, "rgb(71, 54, 35)", "question cards use dark amber, not the light app's cream");
  assert.equal(styles.color, "rgb(242, 234, 214)");
  assert.equal(styles.placeholder, "rgb(185, 173, 203)");
  assert.match(styles.focus, /255, 229, 110/, "the focus ring is gold");
  assert.doesNotMatch(styles.focus, /53, 103, 230/, "no inherited blue app focus ring");
  await input.fill("https://staging.example.com");
  assert.equal(await card.getByRole("button", { name: /Submit answer/ }).isEnabled(), true);
  await page.screenshot({ path: "/tmp/dungeon-chat-question-theme.png" });
  await page.context().close();
});

test("local file links work in both the map dialogue and its full conversation", async () => {
  const path = "/Users/me/Downloads/diagram.mp4";
  const { page } = await open({ timelines: { "a-api-1": [{ kind: "assistant", text: `[Open the animated diagram (MP4)](${path})\n\nThe file is here: \`${path}\`.`, messageId: "file" }] } });
  try {
    await pick(page, "a-api-1");
    const dialog = box(page);
    const compact = dialog.locator(".wc-page");
    await compact.getByRole("link", { name: "Open the animated diagram (MP4)" }).click();
    assert.equal(await dialog.isVisible(), true, "opening a file does not advance or close the dialogue");
    await compact.getByRole("link", { name: path }).click();
    await dialog.getByRole("button", { name: /Show the whole conversation/ }).click();
    const log = dialog.locator(".wc-log");
    await log.getByRole("link", { name: "Open the animated diagram (MP4)" }).click();
    await log.getByRole("link", { name: path }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).__native.reveals), [path, path, path, path]);
    await page.screenshot({ path: "/tmp/chat-file-links-dungeon.png" });
  } finally { await page.context().close(); }
});

test("Mermaid diagrams render in both the map dialogue and its full conversation", async () => {
  const source = ['```mermaid', 'flowchart TD', ...Array.from({ length: 12 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`), '```'].join('\n');
  const { page } = await open({ timelines: { "a-api-1": [{ kind: "assistant", text: source, messageId: "diagram" }] } });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.locator(".wc-page .mermaid-image").waitFor();
  const compactImage = dialog.locator(".wc-page .mermaid-image");
  assert.equal(await compactImage.evaluate((el) => getComputedStyle(el).maxHeight), "none", "the portrait image cap never squashes a chart");
  await dialog.getByRole("button", { name: /Show the whole conversation/ }).click();
  const chart = dialog.locator(".wc-log .mermaid-block");
  await chart.getByAltText("Mermaid diagram").waitFor();
  const expanded = chart.getByRole("button", { name: "Expand Mermaid diagram" });
  const toolbar = await chart.locator(".mermaid-toolbar").boundingBox(), timeline = await dialog.locator(".wc-log .timeline").boundingBox();
  assert.ok(toolbar && timeline && toolbar.y >= timeline.y - 1, "chart controls stay visible when the log pins to a tall chart's end");
  await expanded.click();
  const viewer = page.getByRole("dialog", { name: "Expanded Mermaid diagram" });
  await viewer.waitFor();
  assert.equal(await viewer.evaluate((el) => getComputedStyle(el).getPropertyValue("--panel").trim()), "#251e40", "the expanded chart retains the Dungeon palette outside its portal");
  await page.screenshot({ path: "/tmp/chat-mermaid-dungeon-expanded.png" });
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "detached" });
  assert.equal(await dialog.locator(".wc-log").count(), 1, "closing a chart keeps the world conversation open");
  await page.screenshot({ path: "/tmp/chat-mermaid-dungeon.png" });
  await page.context().close();
});

test("/clear in the box archives the robot and opens the board's Dispatch in its workspace with its settings", async () => {
  const { page, posts } = await open({
    timelines: { "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done.", messageId: "r1" }] },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  await readToChoices(page);
  await page.keyboard.press("r");
  const field = dialog.locator("#world-composer");
  await field.waitFor();
  await field.fill("/clear");
  await page.locator(".autocomplete").getByText(/clear/).first().waitFor();
  await page.keyboard.press("Enter");
  const archive = await posted(posts, "/api/agents/a-api-1/archive");
  assert.equal(archive.body.confirm, true);
  assert.ok(!posts.some((p) => p.path === "/api/agents/a-api-1/send"), "/clear is never sent to the agent");
  // The board's own Dispatch, in the cleared agent's workspace.
  const dispatch = page.getByRole("dialog", { name: "Dispatch an agent" });
  await dispatch.waitFor();
  await dialog.waitFor({ state: "detached" });
});

test("the whole conversation on the board is the side panel's: its tools, the Ask / Add / Answer pill, a fork, the reply's questions", async () => {
  const QUESTION = "Shall I open the pull request now?";
  const BADGES = "The badges point at the new CI workflow.";
  const forks: any[] = [];
  const { page, posts } = await open({
    typesafe: true,
    timelines: {
      "a-api-1": [
        { kind: "user", text: "Tidy the README", messageId: "u1" },
        { kind: "assistant", text: ["I tidied the README and moved the setup steps.", BADGES, QUESTION].join("\n\n"), messageId: "r1" },
      ],
      h1: [{ kind: "assistant", text: "They moved with the workflow file." }],
    },
    routes: (_id, sub) => (sub === "forks" ? { supported: true, forks } : undefined),
    answer: (path, body) => {
      if (path === "/api/agents/a-api-1/asks")
        return { messageId: "r1", waiting: true, questions: [{ text: QUESTION, kind: "yes_no" }], pending: false };
      if (path === "/api/agents/a-api-1/forks") {
        const fork = { id: "fork_1", host: null, agentId: "a-api-1", helperId: "h1", boundary: body.boundary, quotes: body.quotes, question: body.question, colour: 0, createdAt: new Date().toISOString() };
        forks.push(fork);
        return fork;
      }
      return undefined;
    },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  await page.keyboard.press("h");
  const log = dialog.locator(".wc-log");
  // The panel's own component, over the box's session: its header's tools and chips.
  await log.locator(".session.world-session .timeline").getByText(BADGES).waitFor();
  for (const name of ["New agent in this workspace", "Copy agent ID", "Open in Paseo", "Archive agent"])
    assert.equal(await log.locator(".session-header").getByRole("button", { name, exact: true }).count(), 1, `the header's ${name}`);
  assert.equal(await log.locator(".session-header").getByRole("button", { name: /Fleet/ }).count(), 0, "no way back to a list the board doesn't have");
  await log.locator(".session-links .branch-chip").waitFor();
  // What its reply asks, above the composer, as in the panel.
  const strip = dialog.getByRole("region", { name: "Questions in this reply" });
  await strip.getByText(QUESTION).waitFor();
  // A click on a block of the reply picks it: Ask, Add, Answer.
  const pill = dialog.getByRole("toolbar", { name: "Ask about the selection" });
  await log.getByText(BADGES).click();
  await pill.waitFor();
  for (const name of ["Ask", "Add to question", "Answer in my message"])
    assert.equal(await pill.getByRole("button", { name, exact: true }).count(), 1, `the pill's ${name}`);
  const inside = await page.evaluate(() => {
    const p = document.querySelector(".fork-pill")!.getBoundingClientRect(), d = document.querySelector(".world-chat")!.getBoundingClientRect();
    return p.left >= d.left && p.right <= d.right && p.top >= d.top && p.bottom <= d.bottom;
  });
  assert.ok(inside, "the pill stands inside the dialogue");
  // Escape lets the picked block go; the conversation stays.
  await page.keyboard.press("Escape");
  await pill.waitFor({ state: "detached" });
  assert.equal(await log.count(), 1, "Escape let the block go, not the conversation");
  // Answer quotes it as a question to answer in the next message.
  await log.getByText(BADGES).click();
  await pill.getByRole("button", { name: "Answer in my message" }).click();
  const answers = dialog.getByRole("list", { name: "Questions to answer" });
  await answers.getByText(BADGES).waitFor();
  await answers.getByRole("textbox").fill("Good");
  await dialog.locator("#world-composer").press("Enter");
  const send = await posted(posts, "/api/agents/a-api-1/send");
  assert.equal(send.body.prompt, `> ${BADGES}\nGood`);
  // Ask opens a fork beside the conversation; its first message starts it.
  await log.getByText("I tidied the README").click();
  await pill.getByRole("button", { name: "Ask", exact: true }).click();
  const pane = dialog.getByRole("region", { name: "Fork", exact: true });
  await pane.waitFor();
  await pane.locator("#fork-composer").fill("Where did the steps go?");
  await pane.locator("#fork-composer").press("Enter");
  const fork = await posted(posts, "/api/agents/a-api-1/forks");
  assert.equal(fork.body.question, "Where did the steps go?");
  assert.equal(fork.body.quotes[0].text, "I tidied the README and moved the setup steps.");
  await pane.getByText("They moved with the workflow file.").waitFor();
  await log.locator(".fork-marker").waitFor();
  await page.screenshot({ path: "/tmp/world-chat-session-fork.png" });
  // Escape: the fork goes back to the conversation (the keyboard was the asked question's, which went), not the
  // conversation to the box.
  await page.keyboard.press("Escape");
  await pane.waitFor({ state: "detached" });
  // From a field of the fork, Escape first leaves the field.
  await log.locator(".fork-marker").click();
  await pane.locator("#fork-composer").click();
  await page.keyboard.press("Escape");
  await waitFor(() => dialog.evaluate((el) => el === document.activeElement), Boolean, "the box has the keyboard");
  assert.equal(await pane.count(), 1, "Escape left the fork's field, not the fork");
  await page.keyboard.press("Escape");
  await pane.waitFor({ state: "detached" });
  assert.equal(await log.count(), 1, "Escape closed the fork, not the conversation");
  await page.screenshot({ path: "/tmp/world-chat-session.png" });
  // The header's Archive asks in the box, as the board's other ways of archiving do.
  await log.locator(".session-header").getByRole("button", { name: "Archive agent", exact: true }).click();
  await waitFor(() => dialog.getAttribute("data-beat"), (b) => b === "confirm:archive", "the box's question");
  assert.equal(await log.count(), 0, "the question takes the conversation's place");
  assert.ok(!posts.some((p) => p.path.endsWith("/archive")), "nothing archived before its answer");
  await page.context().close();
});

test("a subagent's conversation opens in the whole conversation's place, and Escape goes back to its agent's", async () => {
  const { page } = await open({ timelines: { "a-api-0": [{ kind: "assistant", text: "Dispatched two helpers.", messageId: "r1" }] } });
  await pick(page, "a-api-0");
  const dialog = box(page);
  await dialog.waitFor();
  await page.keyboard.press("h");
  const log = dialog.locator(".wc-log");
  await log.locator(".session-header .subagents-anchor button").first().click();
  await page.screenshot({ path: "/tmp/world-chat-subagents.png" });
  const menu = await log.locator(".subagents-menu").boundingBox(), head = await log.locator(".session-header").boundingBox();
  assert.ok(menu && head && menu.y >= head.y, "the header's menu opens downward, inside the conversation");
  await log.locator(".subagents-menu").getByRole("menuitem", { name: /Subtask 1/ }).click();
  await log.locator(".subagent-session").waitFor();
  assert.equal(await log.locator(".world-session").count(), 0, "the subagent's conversation takes the agent's place");
  await dialog.focus();
  await page.keyboard.press("Escape");
  await log.locator(".world-session").waitFor();
  assert.equal(await log.locator(".subagent-session").count(), 0);
  await page.context().close();
});

test("/clear in the whole conversation archives the robot and starts an empty conversation in its place; its first message opens the new robot's", async () => {
  let agents: any[] = [...dungeon.agents];
  const { page, posts } = await open({
    agents: () => agents,
    timelines: {
      "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done.", messageId: "r1" }],
      "a-new": [{ kind: "user", text: "Now the changelog", messageId: "n1" }],
    },
    answer: (path) => {
      if (path === "/api/agents/a-api-1/archive") agents = agents.filter((a) => a.id !== "a-api-1");
      if (path === "/api/dispatch") {
        const like = (dungeon.agents as any[]).find((a) => a.id === "a-api-1");
        agents = [...agents, { ...like, id: "a-new", shortId: "a-new", name: "changelog agent", status: "running" }];
        return { agentId: "a-new" };
      }
      return undefined;
    },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  await page.keyboard.press("h");
  const field = dialog.locator(".wc-log #world-composer");
  await field.click();
  const place = (await dialog.boundingBox())!;
  await field.fill("/clear");
  await page.locator(".autocomplete").getByText(/clear/).first().waitFor();
  await page.keyboard.press("Enter");
  const archive = await posted(posts, "/api/agents/a-api-1/archive");
  assert.equal(archive.body.confirm, true);
  assert.ok(!posts.some((p) => p.path === "/api/agents/a-api-1/send"), "/clear is never sent to the agent");
  // An empty conversation where the cleared one stood, in its workspace, its message box ready.
  const fresh = page.getByRole("dialog", { name: "New conversation" });
  await fresh.waitFor();
  await dialog.waitFor({ state: "detached" });
  const stood = (await fresh.boundingBox())!;
  assert.ok(Math.abs(stood.x - place.x) < 4 && Math.abs(stood.width - place.width) < 4 && Math.abs(stood.height - place.height) < 40, `it stands where the conversation stood: ${JSON.stringify(stood)} vs ${JSON.stringify(place)}`);
  await waitFor(() => fresh.locator("textarea").first().evaluate((el) => el === document.activeElement), Boolean, "its message box has the keyboard");
  await page.screenshot({ path: "/tmp/world-chat-clear.png" });
  await page.keyboard.type("Now the changelog");
  await page.keyboard.press("Enter");
  const dispatch = await posted(posts, "/api/dispatch");
  assert.equal(dispatch.body.prompt, "Now the changelog");
  assert.equal(dispatch.body.workspaceId ?? dispatch.body.workspace, "wks_api");
  // The new robot's own conversation opens there, whole.
  const next = page.getByRole("dialog", { name: "Conversation with changelog agent" });
  await next.waitFor();
  await next.locator(".wc-log .world-session").getByText("Now the changelog").first().waitFor();
  await fresh.waitFor({ state: "detached" });
  await page.context().close();
});

test("Archive… asks in the box: Esc keeps the robot, its answer archives it; its workspace is offered too", async () => {
  const { page, posts } = await open({
    timelines: { "a-api-1": [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done.", messageId: "r1" }] },
  });
  await pick(page, "a-api-1");
  const dialog = box(page);
  await dialog.waitFor();
  await readToChoices(page);
  // Chosen without moving the pointer (a choice under it is marked, as in any menu).
  await page.mouse.move(0, 0);
  await choices(page).getByRole("menuitem", { name: /Archive…/ }).dispatchEvent("click");
  await dialog.getByText(/Archive api agent 2\? It leaves the board/).waitFor();
  const menu = choices(page);
  await menu.getByRole("menuitem", { name: /Archive the workspace…/ }).waitFor();
  // The safe answer is marked first, so a stray Enter keeps it.
  assert.equal(await menu.locator(".wc-choice.current").getAttribute("data-choice"), "keep");
  await dialog.focus();
  await page.keyboard.press("Escape");
  await menu.getByRole("menuitem", { name: /Reply…/ }).waitFor();
  assert.ok(dialog, "the box stays open");
  assert.ok(!posts.some((p) => p.path.endsWith("/archive")), "nothing archived");
  // The workspace's own confirming dialog, over the box, which stays.
  await choices(page).getByRole("menuitem", { name: /Archive…/ }).click();
  await choices(page).getByRole("menuitem", { name: /Archive the workspace…/ }).click();
  const confirmWorkspace = page.getByRole("dialog", { name: "Archive this workspace?" });
  await confirmWorkspace.waitFor();
  await confirmWorkspace.getByRole("button", { name: "Close archive dialog" }).click();
  await confirmWorkspace.waitFor({ state: "detached" });
  assert.equal(await dialog.count(), 1, "the box is still open");
  // Archiving the agent itself.
  await choices(page).getByRole("menuitem", { name: /Archive…/ }).click();
  await choices(page).getByRole("menuitem", { name: /Archive api agent 2/ }).click();
  const archive = await posted(posts, "/api/agents/a-api-1/archive");
  assert.equal(archive.body.confirm, true);
});

test("the board's right-click menu talks to a robot, asks before archiving it, and archives or dispatches into a workspace", async () => {
  const { page, posts } = await open({ talkOnPick: false });
  const surface = page.locator(".native-map-surface");
  // The world reports the robot under the pointer as its hover; a right-click opens its menu there.
  await swift(page, { type: "hover", id: key("a-api-1"), x: 300, y: 250, bottom: 290 });
  await surface.click({ button: "right", position: { x: 300, y: 260 } });
  const menu = page.getByRole("menu", { name: "api agent 2" });
  await menu.waitFor();
  assert.equal(await page.locator(".atlas-world-tip").count(), 0, "the hover card gives way to the menu");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-item")), "talk", "the menu has the keyboard");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  // Archive… opens its dialogue box with the question.
  await swift(page, { type: "hover", id: key("a-api-1"), x: 300, y: 250, bottom: 290 });
  await surface.click({ button: "right", position: { x: 300, y: 260 } });
  await menu.getByRole("menuitem", { name: /Archive…/ }).click();
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.getByText(/Archive api agent 2\?/).waitFor();
  await page.keyboard.press("Escape");
  await choices(page).getByRole("menuitem", { name: /Reply…/ }).waitFor();
  // Leaving and coming back doesn't ask again.
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.keyboard.press("t");
  await dialog.waitFor();
  assert.equal(await dialog.getByText(/Archive api agent 2\?/).count(), 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // A workspace's alcove: archive (the app's confirming dialog) or dispatch into it.
  await swift(page, { type: "hover", id: key("wks_api"), x: 500, y: 250, bottom: 300 });
  await surface.click({ button: "right", position: { x: 500, y: 260 } });
  const wsMenu = page.getByRole("menu", { name: "api" });
  await wsMenu.getByRole("menuitem", { name: /Archive the workspace…/ }).click();
  const confirmWorkspace = page.getByRole("dialog", { name: "Archive this workspace?" });
  await confirmWorkspace.waitFor();
  await confirmWorkspace.getByRole("button", { name: "Archive workspace" }).click();
  await posted(posts, "/api/workspaces/wks_api/archive");
  await swift(page, { type: "hover", id: key("wks_web"), x: 500, y: 250, bottom: 300 });
  await surface.click({ button: "right", position: { x: 500, y: 260 } });
  await page.getByRole("menu", { name: "web" }).getByRole("menuitem", { name: /Dispatch an agent here/ }).click();
  await page.getByRole("dialog", { name: "Dispatch an agent" }).waitFor();
});

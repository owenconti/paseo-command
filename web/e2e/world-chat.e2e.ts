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
};
async function open(options: Options = {}): Promise<{ page: Page; posts: Post[] }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  if (!options.motion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((talkOnPick) => {
    localStorage.setItem("paseo-command:atlas:style", JSON.stringify("dungeon"));
    if (talkOnPick === false) localStorage.setItem("paseo-command:world:talkOnPick", "false");
    const host = { arts: [] as string[], talks: [] as unknown[], keys: [] as string[], selected: null as string | null };
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
          },
        },
      },
    };
  }, options.talkOnPick ?? true);
  const posts: Post[] = [];
  await mockApi(page, {
    agents: () => dungeon.agents.map((a) => options.names?.[a.id] ? { ...a, name: options.names[a.id] } : a),
    permissions: () => dungeon.permissions,
    hosts: () => dungeon.hosts,
    projects: () => dungeon.projects,
    workspaces: () => dungeon.workspaces,
    detail: (id: string) => {
      const row = (dungeon.agents as unknown as { id: string; status: string }[]).find((a) => a.id === id);
      return detailOf(id, row?.status ?? "idle", options.details?.[id] ?? {});
    },
    timeline: (id: string) => ({ items: options.timelines?.[id] ?? [] }),
    accept: (path: string, body: any) => {
      posts.push({ path, body });
      return true;
    },
    lists: {
      hoststats: DUNGEON_STATS,
      github: DASHBOARD_PRS,
      linear: DASHBOARD_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: false }, error: null },
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

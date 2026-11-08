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
import { DUNGEON_STATS, VILLAGE_ISSUES, VILLAGE_PRS, dungeon } from "./fleets";

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
};
async function open(options: Options = {}): Promise<{ page: Page; posts: Post[] }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  if (!options.motion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((talkOnPick) => {
    localStorage.setItem("paseo-command:atlas:style", JSON.stringify("dungeon"));
    if (talkOnPick === false) localStorage.setItem("paseo-command:world:talkOnPick", "false");
    const host = { arts: [] as string[], talks: [] as unknown[], selected: null as string | null };
    (window as any).__native = host;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") {
              host.arts.push(m.scene);
              setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            }
            if (m.type === "select") host.selected = m.id;
            if (m.type === "talk") host.talks.push({ id: m.id, inset: m.inset });
          },
        },
      },
    };
  }, options.talkOnPick ?? true);
  const posts: Post[] = [];
  await mockApi(page, {
    agents: () => dungeon.agents,
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
      github: VILLAGE_PRS,
      linear: VILLAGE_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: false }, error: null },
    },
  } as any);
  await page.goto(app.url);
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && !!i.agents?.length, "the board", 30000);
  return { page, posts };
}
const inspect = (page: Page) => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any);
const native = (page: Page) => page.evaluate(() => (window as any).__native as { talks: { id: string | null; inset: number }[]; selected: string | null });
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
  for (const label of ["Reply…", "Open the full chat", "Leave"]) await menu.getByRole("menuitem", { name: new RegExp(label) }).waitFor();
  // ← goes back a page, already typed.
  await dialog.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await choices(page).count(), 0);
  await page.keyboard.press("End");
  await choices(page).waitFor();
  // R: the reply field; Enter sends.
  await page.keyboard.press("r");
  const field = dialog.getByRole("textbox", { name: /Your reply to/ });
  await field.waitFor();
  await field.fill("Open it, thanks");
  await page.keyboard.press("Enter");
  const send = await posted(posts, "/api/agents/a-api-1/send");
  assert.equal(send.body.prompt, "Open it, thanks");
  assert.ok(send.body.messageId, "sent with a message id");
  await field.waitFor({ state: "detached" });
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
  const { page, posts } = await open({
    timelines: {
      "a-api-2": [
        { kind: "user", text: "Run the tests", messageId: "u1" },
        { kind: "tool", name: "Bash", status: "running", summary: "npm test", detail: "npm test" },
      ],
    },
  });
  await pick(page, "a-api-2");
  const dialog = box(page);
  await dialog.waitFor();
  await dialog.locator(".wc-page").getByText(/is working/).waitFor();
  await dialog.locator(".wc-caption").getByText("You said: Run the tests").waitFor();
  await choices(page).getByRole("menuitem", { name: /Interrupt/ }).waitFor();
  await choices(page).getByRole("menuitem", { name: /Send a follow-up/ }).click();
  const field = dialog.getByRole("textbox", { name: /Your reply to/ });
  await field.fill("Also run the e2e suite");
  await page.keyboard.press("Enter");
  await waitFor(
    () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("queue")).map((k) => localStorage.getItem(k) ?? "").join("\n")),
    (all) => all.includes("Also run the e2e suite"),
    "the follow-up queued",
  );
  assert.equal(posts.filter((p) => p.path.endsWith("/send")).length, 0, "nothing sent while it works");
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
  await dialog.getByText("Enter to finish").waitFor();
  assert.equal(await page.evaluate(() => CSS.highlights.has("world-chat-untyped")), true, "the untyped rest is hidden");
  await page.keyboard.press("Enter");
  await dialog.getByText("Enter to finish").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => CSS.highlights.has("world-chat-untyped")), false);
});

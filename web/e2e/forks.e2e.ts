/**
 * Reply forks: highlight parts of an agent's reply, ask about them in a
 * short side conversation (a helper agent), and send its conclusion back.
 * Every /api request is answered in the browser; no request reaches the app
 * server or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import {
  agentRow,
  detailOf,
  launch,
  mockApi,
  newContext,
  sleep,
  startApp,
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

const FIRST = "Some tools are already Rust. Each bundle lives in two places.";
const SECOND = "I didn't trace the GitHub CI workflows step by step.";
const CONCLUSION =
  "From a side conversation about:\n> Each bundle lives in two places.\n\nTwo checks call build:*.";

type Fork = Record<string, any>;
/** What `read` finds, once it finds something. */
async function waitFor<T>(read: () => T | undefined, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("Timed out waiting");
    await sleep(100);
  }
}
function world(
  opts: { running?: boolean; supported?: boolean; waiting?: boolean; startOnConclude?: boolean } = {},
) {
  const posts: { path: string; body: any }[] = [];
  const forks: Fork[] = [];
  const filler = Array.from({ length: 30 }, (_, i) => [
    { kind: "user", text: `Earlier question ${i}` },
    { kind: "assistant", text: `Earlier answer ${i}. `.repeat(8), messageId: `old${i}` },
  ]).flat();
  const main = [
    ...filler,
    { kind: "user", text: "Inventory", messageId: "u1" },
    { kind: "assistant", text: FIRST, messageId: "r1" },
    { kind: "user", text: "More", messageId: "u2" },
    { kind: "assistant", text: SECOND, messageId: "r2" },
  ];
  let status = opts.running ? "running" : "idle";
  const fleet = {
    agents: () => [agentRow("a1", status, "Forking agent")],
    detail: (id: string) =>
      id === "h1"
        ? detailOf("h1", "idle", {
            PendingPermissions: opts.waiting
              ? [{ id: "p1", name: "Bash", kind: "tool", title: "Run ls", input: {} }]
              : [],
          })
        : detailOf(id, status),
    timeline: (id: string) => ({
      items:
        id === "h1"
          ? [
              {
                kind: "user",
                text: "This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:\n\n> Each bundle lives in two places.\n\nTheir question: Why two places?",
              },
              { kind: "assistant", text: "Fork answer about bundles." },
              { kind: "user", text: "And the CI?" },
            ]
          : main,
    }),
    routes: (_id: string, sub: string) =>
      sub === "forks"
        ? {
            supported: opts.supported ?? true,
            forks: forks.map((f) => ({ ...f, waiting: Boolean(opts.waiting) })),
          }
        : undefined,
    accept: (path: string, body: any) => {
      posts.push({ path, body });
      if (path === "/api/agents/a1/forks") {
        const fork = {
          id: `fork_${forks.length + 1}`,
          host: null,
          agentId: "a1",
          helperId: "h1",
          boundary: body.boundary,
          quotes: body.quotes,
          question: body.question,
          colour: forks.length,
          createdAt: new Date().toISOString(),
        };
        forks.push(fork);
        return fork;
      }
      const m = /^\/api\/forks\/([^/]+)\/(\w+)$/.exec(path);
      if (m) {
        const fork = forks.find((f) => f.id === m[1])!;
        if (m[2] === "conclude") {
          if (!opts.startOnConclude) return { text: CONCLUSION };
          // The main agent starts a turn while the fork writes its conclusion.
          status = "running";
          return sleep(1000).then(() => ({ text: CONCLUSION }));
        }
        if (m[2] === "close") fork.closedAt = new Date().toISOString();
        if (m[2] === "reopen") delete fork.closedAt;
        if (m[2] === "sent") fork.sentBackAt = new Date().toISOString();
        return fork;
      }
      if (path === "/api/agents/a1/send" || path === "/api/agents/h1/send") return true;
      return false;
    },
  };
  return { fleet, posts, forks };
}

async function open(w: ReturnType<typeof world>, panelWidth?: number) {
  const context = await newContext(browser);
  if (panelWidth)
    await context.addInitScript((width) => {
      localStorage.setItem(
        "paseo-command:unity-sidebar",
        JSON.stringify({ width, mode: "compact", collapsed: false, side: "left" }),
      );
    }, panelWidth);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, w.fleet as never);
  await page.goto(`${app.url}?agent=a1`);
  await page.locator(".msg.assistant", { hasText: SECOND }).waitFor();
  return { page, errors, close: () => context.close() };
}

/** Select `text` inside a reply, as a reader's drag would. */
async function select(page: Page, text: string) {
  await page.evaluate((t) => {
    for (const el of document.querySelectorAll(".session .msg.assistant")) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const i = (n as Text).data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
    }
    throw new Error(`no reply text ${t}`);
  }, text);
}
const pill = (page: Page) => page.getByRole("toolbar", { name: "Ask about the selection" });
const pane = (page: Page) => page.getByRole("region", { name: "Fork" });

/** Ask in the fork's chat input, as in any conversation. */
async function ask(page: Page, question: string) {
  const input = pane(page).getByRole("textbox", { name: "Question for the fork" });
  await input.fill(question);
  await input.press("Enter");
}

test("select text in a reply shows the pill; Ask then a question creates a fork", async () => {
  const w = world();
  const { page, errors, close } = await open(w);
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  await pane(page).getByText("Each bundle lives in two places.").waitFor();
  await ask(page, "Why two places?");
  const create = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/forks"));
  assert.equal(create.body.question, "Why two places?");
  assert.deepEqual(create.body.boundary, { messageId: "r1" });
  assert.equal(create.body.quotes.length, 1);
  assert.equal(create.body.quotes[0].text, "Each bundle lives in two places.");
  assert.equal(create.body.quotes[0].messageId, "r1");
  assert.equal(
    FIRST.slice(create.body.quotes[0].start, create.body.quotes[0].end),
    "Each bundle lives in two places.",
  );
  await pane(page).getByText("Fork answer about bundles.").waitFor();
  assert.deepEqual(errors, []);
  await close();
});

test("+ Add collects two pieces from different replies into one fork", async () => {
  const w = world();
  const { page, close } = await open(w);
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Add to question" }).click();
  await select(page, "GitHub CI workflows");
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  await ask(page, "Do these interact?");
  const create = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/forks"));
  assert.deepEqual(
    create.body.quotes.map((q: { text: string }) => q.text),
    ["Each bundle lives in two places.", "GitHub CI workflows"],
  );
  // Cut after the newer of the two replies.
  assert.deepEqual(create.body.boundary, { messageId: "r2" });
  await close();
});

test("+ Add shows collected pieces as chips, removable, without covering the conversation", async () => {
  const w = world();
  const { page, close } = await open(w);
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Add to question" }).click();
  const tray = page.getByRole("region", { name: "Collected pieces" });
  await tray.getByText("Each bundle lives in two places.").waitFor();
  assert.equal(await pane(page).count(), 0);
  await select(page, "GitHub CI workflows");
  await pill(page).getByRole("button", { name: "Add to question" }).click();
  await tray.getByText("GitHub CI workflows").waitFor();
  await tray.getByRole("button", { name: /Remove “Each bundle/ }).click();
  await tray.getByText("Each bundle lives in two places.").waitFor({ state: "detached" });
  await tray.getByRole("button", { name: "Ask about these" }).click();
  await ask(page, "What about CI?");
  const create = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/forks"));
  assert.deepEqual(
    create.body.quotes.map((q: { text: string }) => q.text),
    ["GitHub CI workflows"],
  );
  assert.equal(await tray.count(), 0);
  await close();
});

test("no pill on a live reply", async () => {
  const w = world({ running: true });
  const { page, close } = await open(w);
  await select(page, "GitHub CI workflows");
  await sleep(400);
  assert.equal(await pill(page).count(), 0);
  // A settled reply above it still offers one.
  await select(page, "Each bundle lives in two places.");
  await pill(page).waitFor();
  await close();
});

test("narrow panel: the fork takes over; Back to main returns to the same place", async () => {
  const w = world();
  const { page, close } = await open(w);
  const reply = page.locator(".msg.assistant", { hasText: "Earlier answer 12." });
  // Where the reply stands in the conversation's view.
  const place = () =>
    reply.evaluate((el) => {
      const view = el.closest(".timeline")!;
      return Math.round(el.getBoundingClientRect().top - view.getBoundingClientRect().top);
    });
  await sleep(500);
  await reply.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(300);
  const before = await place();
  await select(page, "Earlier answer 12.");
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  const p = pane(page);
  await p.waitFor();
  assert.equal(await p.getAttribute("data-layout"), "over");
  await p.getByRole("button", { name: "Back to main" }).click();
  await p.waitFor({ state: "hidden" });
  assert.ok(Math.abs((await place()) - before) <= 2, `${await place()} vs ${before}`);
  await close();
});

test("wide panel (≥720px): the pane sits beside the conversation", async () => {
  const w = world();
  const { page, close } = await open(w, 960);
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  const p = pane(page);
  await p.waitFor();
  assert.equal(await p.getAttribute("data-layout"), "side");
  const paneBox = (await p.boundingBox())!;
  const timelineBox = (await page.locator(".session > .timeline").boundingBox())!;
  assert.ok(paneBox.x >= timelineBox.x + timelineBox.width - 1, "pane right of the timeline");
  assert.ok(await page.getByText(SECOND).isVisible());
  await close();
});

async function forked(w: ReturnType<typeof world>) {
  const opened = await open(w);
  await select(opened.page, "Each bundle lives in two places.");
  await pill(opened.page).getByRole("button", { name: "Ask", exact: true }).click();
  await ask(opened.page, "Why two places?");
  await pane(opened.page).getByText("Fork answer about bundles.").waitFor();
  return opened;
}

test("the fork's question and replies use the standard chat input", async () => {
  const w = world();
  const { page, close } = await open(w);
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  const question = pane(page).locator(".composer2 textarea");
  assert.equal(await question.getAttribute("aria-label"), "Question for the fork");
  // Its own input: the main conversation's keeps the shortcuts' id.
  assert.notEqual(await question.getAttribute("id"), "composer");
  await ask(page, "Why two places?");
  await pane(page).getByText("Fork answer about bundles.").waitFor();
  // The prompt that started it isn't repeated: the pane's header asks it.
  assert.equal(await pane(page).getByText(/short side conversation/).count(), 0);
  await pane(page).locator(".msg.user", { hasText: "And the CI?" }).waitFor();
  const reply = pane(page).locator(".composer2 textarea");
  assert.equal(await reply.getAttribute("aria-label"), "Reply in fork");
  await reply.fill("And the CI?");
  await reply.press("Enter");
  const sent = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/h1/send"));
  assert.equal(sent.body.prompt, "And the CI?");
  await close();
});

test("send back while idle sends to the main agent", async () => {
  const w = world();
  const { page, close } = await forked(w);
  await pane(page).getByRole("button", { name: "Send back" }).click();
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, CONCLUSION);
  await waitFor(() => w.posts.find((p) => p.path === "/api/forks/fork_1/sent"));
  await pane(page).getByText(/^Sent back/).waitFor();
  await close();
});

test("send back queues while running", async () => {
  const w = world({ running: true });
  const { page, close } = await forked(w);
  await pane(page).getByRole("button", { name: "Send back" }).click();
  await waitFor(() => w.posts.find((p) => p.path === "/api/forks/fork_1/sent"));
  assert.equal(w.posts.filter((p) => p.path === "/api/agents/a1/send").length, 0);
  const queued = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.includes("queue"))
      .map((k) => localStorage.getItem(k) ?? "")
      .join("\n"),
  );
  assert.match(queued, /Two checks call build/);
  await close();
});

test("send back never interrupts: a turn started meanwhile gets it queued", async () => {
  const w = world({ startOnConclude: true });
  const { page, close } = await forked(w);
  await pane(page).getByRole("button", { name: "Send back" }).click();
  await waitFor(() => w.posts.find((p) => p.path === "/api/forks/fork_1/sent"));
  await sleep(500);
  assert.equal(w.posts.filter((p) => p.path === "/api/agents/a1/send").length, 0);
  const queued = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.includes("queue"))
      .map((k) => localStorage.getItem(k) ?? "")
      .join("\n"),
  );
  assert.match(queued, /Two checks call build/);
  await close();
});

test("close leaves a marker; clicking it reopens the fork", async () => {
  const w = world();
  const { page, close } = await forked(w);
  await pane(page).getByRole("button", { name: "Close fork" }).click();
  await waitFor(() => w.posts.find((p) => p.path === "/api/forks/fork_1/close"));
  await pane(page).waitFor({ state: "hidden" });
  const marker = page.getByRole("button", { name: /Fork: Why two places\?/ });
  await marker.click();
  await waitFor(() => w.posts.find((p) => p.path === "/api/forks/fork_1/reopen"));
  await pane(page).getByText("Fork answer about bundles.").waitFor();
  await close();
});

test("marker reads waiting while the helper has a pending permission", async () => {
  const w = world({ waiting: true });
  const { page, close } = await forked(w);
  await pane(page).getByRole("button", { name: "Close fork" }).click();
  await page.getByRole("button", { name: /Fork: Why two places\?.*waiting/ }).waitFor();
  await close();
});

test("unsupported host disables Ask", async () => {
  const w = world({ supported: false });
  const { page, close } = await open(w);
  await select(page, "Each bundle lives in two places.");
  const ask = pill(page).getByRole("button", { name: "Ask", exact: true });
  await ask.waitFor();
  assert.equal(await ask.isDisabled(), true);
  assert.equal(await ask.getAttribute("title"), "Forks aren't supported on this host.");
  // Answering needs no fork.
  assert.equal(
    await pill(page).getByRole("button", { name: "Answer in my message" }).isDisabled(),
    false,
  );
  await close();
});

test("Answer quotes questions into the message, each with its own answer, without a fork", async () => {
  const w = world();
  const { page, errors, close } = await open(w);
  const answerIt = async (text: string) => {
    await select(page, text);
    await pill(page).getByRole("button", { name: "Answer in my message" }).click();
    // Its answer field takes the focus.
    await page.waitForFunction(
      (t) => document.activeElement?.getAttribute("aria-label") === `Answer to “${t}”`,
      text,
    );
  };
  await answerIt("Each bundle lives in two places.");
  const first = page.getByRole("textbox", { name: "Answer to “Each bundle lives in two places.”" });
  await first.fill("Keep one.");
  await answerIt("GitHub CI workflows");
  await answerIt("Some tools are already Rust.");
  const list = page.getByRole("list", { name: "Questions to answer" });
  await list.getByRole("button", { name: /Remove “GitHub CI/ }).click();
  await list.getByText("GitHub CI workflows").waitFor({ state: "detached" });
  // Left unanswered: dropped from the message.
  await page.locator("#composer").fill("Thanks.");
  // A refresh keeps the questions and answers.
  await page.reload();
  await page.getByRole("textbox", { name: "Answer to “Each bundle lives in two places.”" }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Answer to “Each bundle lives in two places.”" }).inputValue(),
    "Keep one.",
  );
  await page.locator("#composer").press("Enter");
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, "> Each bundle lives in two places.\nKeep one.\n\nThanks.");
  await page.getByRole("list", { name: "Questions to answer" }).waitFor({ state: "detached" });
  assert.equal(w.posts.filter((p) => p.path === "/api/agents/a1/forks").length, 0);
  assert.equal(await pane(page).count(), 0);
  assert.deepEqual(errors, []);
  await close();
});

const paragraph = (page: Page, text: string) =>
  page.locator(".session .msg.assistant p", { hasText: text });

test("click a paragraph in a reply: the pill takes it whole, to answer or to fork", async () => {
  const w = world();
  const { page, errors, close } = await open(w);
  await paragraph(page, FIRST).click();
  await pill(page).getByRole("button", { name: "Answer in my message" }).click();
  await page.getByRole("textbox", { name: `Answer to “${FIRST.slice(0, 60)}”` }).waitFor();
  assert.equal(await pill(page).count(), 0);
  await paragraph(page, FIRST).click();
  await pill(page).getByRole("button", { name: "Ask", exact: true }).click();
  await ask(page, "Why?");
  const create = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/forks"));
  assert.equal(create.body.quotes.length, 1);
  assert.equal(create.body.quotes[0].text, FIRST);
  assert.equal(create.body.quotes[0].messageId, "r1");
  assert.deepEqual(errors, []);
  await close();
});

test("a picked block's pill goes with Escape or a click elsewhere; none on a live reply", async () => {
  const w = world({ running: true });
  const { page, close } = await open(w);
  await paragraph(page, FIRST).click();
  await pill(page).waitFor();
  await page.keyboard.press("Escape");
  await pill(page).waitFor({ state: "detached" });
  await paragraph(page, FIRST).click();
  await pill(page).waitFor();
  await page.locator(".msg.user", { hasText: "More" }).click();
  await pill(page).waitFor({ state: "detached" });
  await paragraph(page, SECOND).click();
  await sleep(300);
  assert.equal(await pill(page).count(), 0);
  // Dragging over part of a block still picks just that part.
  await select(page, "Each bundle lives in two places.");
  await pill(page).getByRole("button", { name: "Answer in my message" }).click();
  await page.getByRole("textbox", { name: "Answer to “Each bundle lives in two places.”" }).waitFor();
  await close();
});

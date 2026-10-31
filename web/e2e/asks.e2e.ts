/**
 * Questions in a reply: what a decision model found the agent's last reply
 * asks (server/asks.ts, answered here) offered above the composer, with
 * quick replies, and agents whose reply waits on you listed as needing you.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { agentRow, detailOf, launch, mockApi, newContext, sleep, startApp } from "./harness";

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

const CACHE = "Should the cache be per-host or global?";
const V1 = "Keep the old /v1 endpoint for now?";
const REPLY = `I've updated the cache layer. ${CACHE} ${V1}`;

type Q = { text: string; kind: string; options?: string[]; answers?: string[] };
function world(questions: Q[], waiting = true, extra: object = {}) {
  const posts: { path: string; body: any }[] = [];
  const fleet = {
    lists: { settings: { integrations: { typesafe: true } } },
    agents: () => [agentRow("a1", "idle", "Asking agent")],
    detail: (id: string) => detailOf(id, "idle"),
    timeline: () => ({
      items: [
        { kind: "user", text: "Cache it", messageId: "u1" },
        { kind: "assistant", text: REPLY, messageId: "r1" },
      ],
    }),
    accept: (path: string, body: any) => {
      posts.push({ path, body });
      if (path === "/api/agents/a1/asks")
        return { messageId: "r1", waiting, questions, pending: false, ...extra };
      if (path === "/api/agents/a1/send") return true;
      return false;
    },
  };
  return { fleet, posts };
}
async function open(w: ReturnType<typeof world>, query = "?agent=a1") {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, w.fleet as never);
  await page.goto(`${app.url}${query}`);
  return { page, errors, close: () => context.close() };
}
async function waitFor<T>(read: () => T | undefined, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("Timed out waiting");
    await sleep(100);
  }
}
const strip = (page: import("playwright").Page) =>
  page.getByRole("region", { name: "Questions in this reply" });

test("a reply's only question: a quick reply sends at once", async () => {
  const w = world([{ text: V1, kind: "yes_no" }]);
  const { page, errors, close } = await open(w);
  await strip(page).getByText(V1).waitFor();
  await strip(page).getByRole("button", { name: "No", exact: true }).click();
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, `> ${V1}\nNo`);
  assert.deepEqual(errors, []);
  await close();
});

test("several questions: Answer all, quick replies fill each answer, Send sends the pairs", async () => {
  const w = world([
    { text: CACHE, kind: "pick", options: ["per-host", "global"] },
    { text: V1, kind: "yes_no" },
  ]);
  const { page, close } = await open(w);
  await strip(page).getByRole("button", { name: "Answer all" }).click();
  await strip(page).waitFor({ state: "detached" });
  const list = page.getByRole("list", { name: "Questions to answer" });
  const cache = list.getByRole("listitem").filter({ hasText: CACHE });
  await cache.getByRole("button", { name: "per-host", exact: true }).click();
  assert.equal(await cache.getByRole("textbox").inputValue(), "per-host");
  // Nothing sent yet: there's more than one question.
  assert.equal(w.posts.filter((p) => p.path === "/api/agents/a1/send").length, 0);
  await list.getByRole("listitem").filter({ hasText: V1 }).getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#composer").press("Enter");
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, `> ${CACHE}\nper-host\n\n> ${V1}\nYes`);
  await close();
});

test("dismissed questions stay dismissed for that reply", async () => {
  const w = world([{ text: V1, kind: "yes_no" }]);
  const { page, close } = await open(w);
  await strip(page).getByRole("button", { name: "Dismiss these questions" }).click();
  await strip(page).waitFor({ state: "detached" });
  await page.reload();
  await page.locator("#composer").waitFor();
  await sleep(800);
  assert.equal(await strip(page).count(), 0);
  await close();
});

test("an agent whose reply waits on you is listed as waiting on you", async () => {
  const w = world([{ text: V1, kind: "yes_no" }]);
  const { page, close } = await open(w, "?tab=Agents");
  await page.getByText("waiting on you").first().waitFor();
  await close();
  // Listed with what needs you.
  const needing = await open(w, "?tab=Agents&filter=attention");
  await needing.page.getByText("waiting on you").first().waitFor();
  await needing.close();
});

test("a reply that waits on nothing isn't listed so", async () => {
  const w = world([], false);
  const { page, close } = await open(w, "?tab=Agents");
  await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/asks"));
  await sleep(500);
  assert.equal(await page.getByText("waiting on you").count(), 0);
  await close();
});

const highlighted = (page: import("playwright").Page) =>
  page.evaluate(() => {
    const h = (CSS as any).highlights?.get("ask-source");
    return h ? [...h].map((r: Range) => r.toString().replace(/\s+/g, " ")) : [];
  });

test("hovering the questions marks where they came from in the reply", async () => {
  const w = world([
    { text: CACHE, kind: "pick", options: ["per-host", "global"] },
    { text: V1, kind: "yes_no" },
  ]);
  const { page, errors, close } = await open(w);
  await strip(page).getByText(V1).waitFor();
  await strip(page).locator("header").hover();
  assert.deepEqual(await highlighted(page), [CACHE, V1]);
  await strip(page).getByRole("listitem").filter({ hasText: V1 }).hover();
  assert.deepEqual(await highlighted(page), [V1]);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.locator("#composer").hover();
  assert.deepEqual(await highlighted(page), []);
  assert.deepEqual(errors, []);
  await close();
});

test("an open question offers drafted answers, sent at once when it's the only one", async () => {
  const w = world([{ text: CACHE, kind: "open", answers: ["Per host, please.", "Keep it global."] }]);
  const { page, close } = await open(w);
  await strip(page).getByRole("button", { name: "Keep it global." }).click();
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, `> ${CACHE}\nKeep it global.`);
  await close();
});

test("while answers are drafted, the open question says so", async () => {
  const w = world([{ text: CACHE, kind: "open" }], true, { answering: true });
  const { page, close } = await open(w);
  await strip(page).getByText("Drafting answers…").waitFor();
  await close();
});

test("a suggested reply sends in one click", async () => {
  const w = world([], true, { suggestion: "Okay, I've merged PR #3." });
  const { page, close } = await open(w);
  await page.getByRole("region", { name: "Suggested reply" }).getByRole("button", { name: "Okay, I've merged PR #3." }).click();
  const send = await waitFor(() => w.posts.find((p) => p.path === "/api/agents/a1/send"));
  assert.equal(send.body.prompt, "Okay, I've merged PR #3.");
  await close();
});

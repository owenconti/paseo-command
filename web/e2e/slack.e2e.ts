/**
 * The Slack tab (the macOS app's mode bar shows it in the map's place):
 * conversations, rich messages, a thread and its reply, sending Markdown,
 * search, and New agent launched from a message. The page's Slack requests run
 * the real server route over the fake Slack (`slackFake.ts`); every other /api
 * request is answered in the browser. Nothing reaches a daemon or Slack.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { FAKE_IDS } from "../server/slack/fake";
import { PNG, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { mockSlack } from "./slackFake";

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

const showSlack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "slack" } })));

test("Slack shows conversations and threads, sends Markdown and replies, searches, and launches New agent", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    projects: () => [{ projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" }],
    lists: {
      settings: { integrations: { slack: true } },
      presets: { presets: [], error: null },
    },
  });
  const slack = await mockSlack(page);
  // Private images are fetched by the server with the token; here, any image.
  await page.route("**/api/slack/image**", (route) => route.fulfill({ body: PNG, contentType: "image/png" }));
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showSlack(page);
    const view = page.locator(".slack-view");
    const sidebar = view.locator(".slack-sidebar");
    await sidebar.locator(`[data-conversation="${FAKE_IDS.general}"]`).waitFor();
    const nav = (await sidebar.textContent()) ?? "";
    for (const name of ["general", "random", "Sam"]) assert.ok(nav.includes(name), `the sidebar lists ${name}`);

    // #general: rich text, a bot's section, an image and a thread parent.
    await sidebar.locator(`[data-conversation="${FAKE_IDS.general}"]`).click();
    const messages = view.locator(".slack-conversation");
    const parent = messages.locator(`.slack-message[data-ts="${FAKE_IDS.ts.parent}"]`);
    await parent.waitFor();
    assert.equal(await parent.locator("b, strong", { hasText: "Friday" }).count(), 1, "bold from rich text");
    await messages.locator(".slack-message", { hasText: "Build passed" }).waitFor();
    await messages.locator(".slack-image").first().waitFor();

    // Send Markdown to the channel: Slack gets it as markdown_text.
    const box = messages.getByRole("textbox", { name: "Message #general" });
    await box.fill("Hello **world**");
    await box.press("Enter");
    await waitFor(
      () => Promise.resolve(slack.calls.filter((c) => c.method === "chat.postMessage")),
      (posts) => posts.length === 1,
      "the post",
    );
    const post = slack.calls.find((c) => c.method === "chat.postMessage")!;
    assert.equal(post.params.channel, FAKE_IDS.general);
    assert.equal(post.params.markdown_text, "Hello **world**");
    await messages.locator(".slack-message", { hasText: "Hello" }).last().waitFor();

    // The thread opens with its replies; a reply goes to it.
    await parent.locator(".slack-thread-link").click();
    const thread = view.locator(".slack-thread");
    await thread.locator(".slack-message", { hasText: "Agreed" }).waitFor();
    const reply = thread.getByRole("textbox", { name: "Reply…" });
    await reply.fill("On it");
    await reply.press("Enter");
    await waitFor(
      () => Promise.resolve(slack.calls.filter((c) => c.method === "chat.postMessage")),
      (posts) => posts.length === 2,
      "the reply",
    );
    const replied = slack.calls.filter((c) => c.method === "chat.postMessage")[1];
    assert.equal(replied.params.thread_ts, FAKE_IDS.ts.parent);
    await thread.locator(".slack-message", { hasText: "On it" }).waitFor();

    // Search all messages.
    await thread.getByRole("button", { name: /Close the thread|Back to the conversation/ }).click();
    await sidebar.getByRole("button", { name: "Search Slack" }).click();
    await page.keyboard.type("lunch");
    await view.locator(".slack-hit", { hasText: "lunch?" }).waitFor();
    assert.ok(slack.calls.some((c) => c.method === "search.messages"));

    // Launch agent from a message: New agent in the panel, quoting it.
    await page.keyboard.press("Escape");
    await sidebar.locator(`[data-conversation="${FAKE_IDS.dm}"]`).click();
    const dm = messages.locator(".slack-message", { hasText: "are you there?" });
    await dm.hover();
    await dm.getByRole("button", { name: "Launch agent" }).click();
    const form = page.locator(".new-agent");
    await form.locator(".new-agent-issue", { hasText: "Slack" }).waitFor();
  } finally {
    slack.restore();
    await context.close();
  }
});

/**
 * Conversation only (`chatView.ts`): the conversation header's button hides the agent's thinking and tool calls in
 * every conversation, keeping what was said, and stays so after a reload; ⌘K switches it too.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { agentRow, detailOf, launch, mockApi, newContext, startApp } from "./harness";

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

test("conversation only hides thinking and tool calls, keeping what was said", async () => {
  const fleet = {
    agents: () => [agentRow("a1", "idle", "Lead agent")],
    detail: (id: string) => detailOf(id, "idle"),
    timeline: () => ({
      items: [
        { kind: "user", text: "Tidy the scheduler", messageId: "u1" },
        { kind: "reasoning", text: "Look at routes/console.php first." },
        { kind: "tool", name: "Search", status: "completed", summary: "cronMonitor", detail: "" },
        { kind: "assistant", text: "The scheduler change is committed.", messageId: "r1" },
      ],
    }),
  };
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, fleet as never);
  await page.goto(`${app.url}?agent=a1`);
  const timeline = page.locator(".timeline-body");
  await timeline.getByText("The scheduler change is committed.").waitFor();
  assert.equal(await timeline.locator(".activity").count(), 1);

  const button = page.getByRole("button", { name: "Show only the conversation" });
  assert.equal(await button.getAttribute("aria-pressed"), "false");
  await button.click();
  await timeline.locator(".activity").waitFor({ state: "detached" });
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  await timeline.getByText("Tidy the scheduler").waitFor();
  await timeline.getByText("The scheduler change is committed.").waitFor();

  // Kept across a reload.
  await page.reload();
  await timeline.getByText("The scheduler change is committed.").waitFor();
  assert.equal(await timeline.locator(".activity").count(), 0);

  // ⌘K shows them again.
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("show thinking");
  await palette.getByRole("option", { name: /Show thinking and tool calls in conversations/ }).waitFor();
  await page.keyboard.press("Enter");
  await timeline.locator(".activity").waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

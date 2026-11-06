/**
 * An agent's question card (PermissionCard.tsx) folds away to its head line
 * and opens again, by its head or ⌘K. Every /api request is answered in the
 * browser.
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

const QUESTION = "Which of the proposed speedups should I implement?";
const permission = {
  id: "perm-q1",
  name: "AskUserQuestion",
  description: "",
  kind: "question",
  questions: [
    {
      question: QUESTION,
      header: "Scope",
      options: [{ label: "Groups 1 + 2" }, { label: "Group 1 only" }],
      multiSelect: false,
      allowOther: true,
      allowEmpty: false,
    },
  ],
};

test("the question card collapses and expands", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, {
    agents: () => [agentRow("a1", "running", "Asking agent")],
    permissions: () => [{ ...permission, agentId: "a1" }],
    detail: (id: string) => detailOf(id, "running", { PendingPermissions: [permission] }),
    timeline: () => ({ items: [] }),
  } as never);
  await page.goto(`${app.url}?agent=a1`);
  const card = page.locator(".session-footer .question-card");
  const head = card.locator(".question-card-head");
  const option = card.getByRole("radio", { name: "Group 1 only" });
  await option.waitFor();
  assert.equal(await head.getAttribute("aria-expanded"), "true");

  await head.click();
  await option.waitFor({ state: "detached" });
  assert.equal(await head.getAttribute("aria-expanded"), "false");
  assert.equal(await card.locator(".question-card-summary").textContent(), QUESTION);
  assert.equal(await card.getByRole("button", { name: /Submit/ }).count(), 0);
  if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT });

  await head.click();
  await option.waitFor();

  // ⌘K folds it too.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("collapse or expand the agent");
  await page.keyboard.press("Enter");
  await option.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await context.close();
});

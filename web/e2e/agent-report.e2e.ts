/**
 * Another agent reporting in (an `agent_message` result): its Atlas robot and
 * a quote of what it said, its name opening its conversation.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import {
  agentRow,
  detailOf,
  launch,
  mockApi,
  newContext,
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

test("an agent's report shows its robot and quotes its reply", async () => {
  const fleet = {
    agents: () => [
      agentRow("a1", "idle", "Lead agent"),
      { ...agentRow("b2", "idle", "Release spike"), provider: "codex/gpt-5.5" },
    ],
    detail: (id: string) => detailOf(id, "idle"),
    timeline: (id: string) => ({
      items:
        id === "a1"
          ? [
              { kind: "user", text: "Check the spike", messageId: "u1" },
              {
                kind: "tool",
                name: "agent_message",
                status: "completed",
                summary: "",
                detail:
                  "Agent b2 (Release spike) finished.\n\nServer: srv_x\n\n<agent-response>\nPR CI is running on the merged head. I'll report the result when the watch finishes.\n</agent-response>",
              },
              {
                kind: "assistant",
                text: "The spike is waiting on CI.",
                messageId: "r1",
              },
            ]
          : [],
    }),
  };
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, fleet as never);
  await page.goto(`${app.url}?agent=a1`);
  const report = page.locator(".agent-report");
  await report
    .getByText("PR CI is running on the merged head.", { exact: false })
    .waitFor();
  await report.locator(".agent-report-robot img").waitFor();
  if (process.env.AGENT_REPORT_SHOT)
    await report.screenshot({ path: process.env.AGENT_REPORT_SHOT });
  await report.getByRole("button", { name: "Release spike" }).click();
  await page.waitForURL(/agent=b2/);
  assert.deepEqual(errors, []);
  await context.close();
});

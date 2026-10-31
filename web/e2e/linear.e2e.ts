/**
 * The Linear tab (the macOS app's mode bar shows it in the map's place): your
 * assigned issues, one's details, and New agent launched from it. Every /api
 * request is answered in the browser; none reaches a daemon or Linear.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { PNG, launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const row = (key: string, title: string, state: [string, string, string], priority = 0) => ({
  key,
  title,
  url: `https://linear.app/acme/issue/${key}`,
  state: { name: state[0], type: state[1], color: state[2] },
  priority,
  priorityLabel: ["No priority", "Urgent", "High", "Medium", "Low"][priority],
  team: "ENG",
  labels: [],
  branchName: `owen/${key.toLowerCase()}-work`,
  updatedAt: "2026-10-29T10:00:00.000Z",
});
const ISSUES = [
  row("ENG-7", "Tidy the docs", ["Todo", "unstarted", "#e2e2e2"]),
  row("ENG-12", "Fix the login page", ["In Progress", "started", "#f2c94c"], 2),
];

test("Linear lists your issues, shows one, and launches New agent from it", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    lists: { settings: { integrations: { linear: true } }, presets: { presets: [{ name: "Plan it", prompt: "Plan {{issue}}." }], error: null } },
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  const imageAsked: string[] = [];
  await page.route("**/api/linear/image**", (route) => {
    imageAsked.push(new URL(route.request().url()).searchParams.get("url")!);
    return route.fulfill({ body: PNG, contentType: "image/png" });
  });
  await page.route("**/api/linear/issues**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/linear/issues")
      return route.fulfill({ json: { available: true, viewer: "Owen", issues: ISSUES } });
    const key = path.split("/").pop();
    const issue = ISSUES.find((i) => i.key === key);
    return route.fulfill({
      json: {
        available: true,
        issue: issue && {
          ...issue,
          description: `About **${key}**.\n\n![shot.png](https://uploads.linear.app/a/b/shot.png)`,
          createdAt: "2026-10-01T00:00:00.000Z",
          links: [],
          comments: [{ author: "Sam", body: "Seen it too.", createdAt: "2026-10-02T00:00:00.000Z" }],
        },
      },
    });
  });
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor();
  // The app's mode bar switches to Linear.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })),
  );
  const view = page.locator(".linear-view");
  await view.waitFor();
  // Started work first; the first issue is shown at once.
  assert.deepEqual(
    await view.locator(".linear-group h3").allInnerTexts(),
    ["In Progress\n1", "Todo\n1"],
  );
  await view.locator(".linear-issue h1", { hasText: "Fix the login page" }).waitFor();
  await view.locator(".linear-comment", { hasText: "Seen it too." }).waitFor();
  // An image uploaded to Linear loads through the app server, which holds the key.
  await view.locator(".linear-description img").waitFor();
  assert.ok(imageAsked.some((u) => u === "https://uploads.linear.app/a/b/shot.png"));
  // Another, by keyboard.
  await view.locator('.linear-row[data-key="ENG-12"]').focus();
  await page.keyboard.press("ArrowDown");
  await view.locator(".linear-issue h1", { hasText: "Tidy the docs" }).waitFor();
  // The search narrows the list.
  await view.getByLabel("Search your issues").fill("login");
  await waitFor(() => view.locator(".linear-row").count(), (n) => n === 1, "one match");
  await view.getByLabel("Search your issues").fill("");

  // Launch agent: New agent in the panel, on the issue's branch, its first message the issue.
  await view.getByRole("button", { name: "Launch agent" }).click();
  const form = page.locator(".new-agent");
  await form.locator(".new-agent-issue", { hasText: "ENG-7" }).waitFor();
  assert.equal(await form.locator("select[name=target]").inputValue(), "p:prj_atlas");
  assert.equal(await form.getByRole("radio", { name: "Worktree" }).getAttribute("aria-checked"), "true");
  assert.equal(await form.locator('input[aria-description^="The new branch"]').inputValue(), "owen/eng-7-work");
  const composer = form.locator("#composer");
  await waitFor(() => composer.inputValue(), (v) => v.includes("Linear issue ENG-7: Tidy the docs"), "the issue prompt");
  assert.match(await composer.inputValue(), /About \*\*ENG-7\*\*\./);
  // A preset takes the issue too.
  await form.getByRole("button", { name: "Plan it" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
  assert.equal(dispatched[0].projectId, "prj_atlas");
  assert.equal(dispatched[0].branch, "owen/eng-7-work");
  assert.match(dispatched[0].prompt, /^Plan ENG-7 \(Tidy the docs\)\.\n\nLinear issue ENG-7: Tidy the docs\nhttps:\/\/linear\.app\/acme\/issue\/ENG-7\n\nAbout \*\*ENG-7\*\*\.\n\n!\[shot\.png\]/);

  // The list's edge resizes it; ⌘S hides and shows it, as in Conquer.
  const list = view.locator(".linear-list");
  const before = (await list.boundingBox())!.width;
  const edge = (await view.locator(".linear-resize").boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 100);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 100, { steps: 4 });
  await page.mouse.up();
  assert.ok(Math.abs((await list.boundingBox())!.width - (before + 80)) <= 2);
  await page.keyboard.press("Meta+s");
  await waitFor(() => list.isVisible(), (v) => !v, "the list to hide");
  await view.getByRole("button", { name: "Show the issue list" }).click();
  await waitFor(() => list.isVisible(), (v) => v, "the list to show");

  // Back to the map: the view goes.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "command" } })),
  );
  await waitFor(() => view.count(), (n) => n === 0, "the Linear view to close");
  await context.close();
});

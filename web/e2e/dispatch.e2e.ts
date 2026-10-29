/**
 * Starting an agent from the New agent view's composer, with pasted and
 * dropped images and /skills. Every /api request is answered in the browser;
 * none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import {
  PNG,
  launch,
  mockApi,
  newContext,
  startApp,
  waitFor,
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

test("images pasted or dropped into the mission are sent with the dispatch", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  // The New agent view: its composer's first message starts the agent.
  const mission = page.locator(".new-agent #composer");
  await mission.fill("Fix what the screenshots show");
  const png = PNG.toString("base64");
  // A pasted screenshot, then one dropped onto the dialog.
  await mission.evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const paste = new DataTransfer();
    paste.items.add(new File([bytes], "", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }),
    );
    const drop = new DataTransfer();
    drop.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
  }, png);
  const thumbs = page.locator(".new-agent .thumb");
  await waitFor(() => thumbs.count(), (n) => n === 2, "two image thumbnails");
  // One can be removed before dispatching.
  await page.locator(".new-agent .thumb .remove").first().click();
  await waitFor(() => thumbs.count(), (n) => n === 1, "one image thumbnail");
  await page.locator(".new-agent").getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
  assert.equal(dispatched[0].prompt, "Fix what the screenshots show");
  assert.deepEqual(dispatched[0].images, [{ data: png, mimeType: "image/png" }]);
  await context.close();
});

test("a new agent's composer offers the folder's /skills before it exists", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const asked: string[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
  });
  await page.route("**/api/providers/claude/models**", (route) =>
    route.fulfill({ json: [{ id: "opus", model: "Opus" }] }),
  );
  // The draft's commands, for the chosen folder and the provider's model.
  await page.route("**/api/drafts/commands?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      json: {
        error: null,
        commands: [
          { name: "review-code", description: "Review the branch", argumentHint: "", kind: "skill" },
          { name: "plan", description: "Plan a change", argumentHint: "", kind: "skill" },
        ],
      },
    });
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const mission = page.locator(".new-agent #composer");
  await mission.pressSequentially("/rev");
  const option = page.locator(".new-agent .autocomplete [role=option]");
  await waitFor(() => option.count(), (n) => n === 1, "the matching skill");
  await mission.press("Enter");
  assert.equal(await mission.inputValue(), "/review-code ");
  const url = new URL(asked[0]!);
  assert.equal(url.searchParams.get("cwd"), "/work/atlas");
  assert.equal(url.searchParams.get("provider"), "claude");
  assert.equal(url.searchParams.get("model"), "opus");
  await context.close();
});

test("Local runs in the checkout; Worktree names a new branch itself", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  const send = async (text: string) => {
    await page.goto(app.url);
    await page.locator("body").press("d");
    await page.locator(".new-agent #composer").fill(text);
    return page.locator(".new-agent");
  };
  // Local is the default: no branch is sent.
  let view = await send("In the checkout");
  assert.equal(await view.getByRole("radio", { name: "Local" }).getAttribute("aria-checked"), "true");
  await view.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the local dispatch");
  assert.equal(dispatched[0].branch, undefined);
  assert.equal(dispatched[0].projectId, "prj_atlas");
  // Worktree with nothing typed: a generated branch, and the choice is kept.
  view = await send("In a worktree");
  await view.getByRole("radio", { name: "Worktree" }).click();
  const suggested = await view.getByLabel(/^Branch/).getAttribute("placeholder");
  await view.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 2, "the worktree dispatch");
  assert.match(dispatched[1].branch, /^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  assert.equal(dispatched[1].branch, suggested);
  // The choice is saved once the dispatch is answered.
  await waitFor(
    () => page.evaluate(() => localStorage.getItem("paseo-command:dispatch") ?? ""),
    (raw) => raw.includes('"isolation":"worktree"'),
    "the remembered Worktree choice",
  );
  view = await send("Kept");
  assert.equal(await view.getByRole("radio", { name: "Worktree" }).getAttribute("aria-checked"), "true");
  await context.close();
});

test("a preset launches at once on a pull request's worktree", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  const searched: string[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    lists: {
      presets: {
        presets: [
          { name: "Review PR", prompt: "Review {{pr}} and list the risks." },
          { name: "Tidy", prompt: "Tidy the README." },
        ],
        error: null,
      },
    },
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  await page.route("**/api/drafts/prs?**", (route) => {
    searched.push(new URL(route.request().url()).searchParams.get("q")!);
    return route.fulfill({
      json: {
        error: null,
        prs: [
          {
            number: 42,
            title: "Add the review flag",
            url: "https://github.com/acme/atlas/pull/42",
            state: "open",
            head: "review-flag",
          },
        ],
      },
    });
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const view = page.locator(".new-agent");
  const review = view.getByRole("button", { name: "Review PR" });
  // It names the pull request, so it waits for one.
  await waitFor(() => review.isDisabled(), (d) => d, "the review preset waiting");
  await view.getByRole("radio", { name: "Worktree" }).click();
  // A pasted URL is searched by its number.
  const field = view.getByLabel(/^Pull request/);
  await field.fill("https://github.com/acme/atlas/pull/42");
  const option = view.locator(".pr-picker-list [role=option]");
  await waitFor(() => option.count(), (n) => n === 1, "the matching pull request");
  assert.equal(searched.at(-1), "42");
  await field.press("Enter");
  await waitFor(() => view.locator(".pr-chosen").count(), (n) => n === 1, "the chosen pull request");
  // Its branch replaces the new branch's fields.
  assert.equal(await view.getByLabel(/^Branch/).count(), 0);
  await review.click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
  assert.equal(
    dispatched[0].prompt,
    "Review #42 (https://github.com/acme/atlas/pull/42) and list the risks.",
  );
  assert.equal(dispatched[0].pr, 42);
  assert.equal(dispatched[0].prHead, "review-flag");
  assert.equal(dispatched[0].branch, undefined);
  await context.close();
});

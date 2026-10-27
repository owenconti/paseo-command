/**
 * Dispatching an agent with pasted and dropped images. Every /api request is
 * answered in the browser; none reaches a daemon.
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
  const mission = page.getByRole("textbox", { name: "Mission" });
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
  const thumbs = page.locator(".dispatch-dialog .thumb");
  await waitFor(() => thumbs.count(), (n) => n === 2, "two image thumbnails");
  // One can be removed before dispatching.
  await page.locator(".dispatch-dialog .thumb .remove").first().click();
  await waitFor(() => thumbs.count(), (n) => n === 1, "one image thumbnail");
  await page.locator(".dispatch-dialog button[type=submit]").click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
  assert.equal(dispatched[0].prompt, "Fix what the screenshots show");
  assert.deepEqual(dispatched[0].images, [{ data: png, mimeType: "image/png" }]);
  await context.close();
});

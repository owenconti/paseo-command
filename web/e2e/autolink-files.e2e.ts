/**
 * Paths to the workspace's files link themselves in an agent's conversation
 * (src/autolink.ts): in its replies (prose and inline code that is exactly a
 * path) and your messages, checked against the workspace's file list; code
 * blocks, links and missing paths stay plain. In the macOS app a click shows
 * the Files tab with the file as a kept tab, scrolled to its line and marked;
 * a browser says the tab is the app's. Every /api request is answered in the
 * browser; nothing reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { FileRead } from "../src/files/types";
import { small } from "./fleets";
import { appEvent, detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const REPORT = "docs/reports/resource-reference-approaches.md";
// Long enough that only part of it is drawn: the link scrolls to a line far down.
const LONG = Array.from({ length: 3000 }, (_, i) => (i === 2699 ? "const needle = true;" : `const line${i} = ${i};`)).join("\n");
const READS: Record<string, FileRead> = {
  [REPORT]: { path: REPORT, size: 12, text: "# Approaches\n" },
  "src/long.ts": { path: "src/long.ts", size: LONG.length, text: LONG },
  "src/app.ts": { path: "src/app.ts", size: 20, text: "export const a = 1;\n" },
};
const REPLY = [
  `The report is at \`${REPORT}\`.`,
  "",
  "The flag is set in /work/atlas/a/src/long.ts:2700, and src/missing.ts was never written.",
  "",
  "```",
  "src/app.ts",
  "```",
].join("\n");

async function setUp(page: Page, inApp: boolean) {
  if (inApp)
    await page.addInitScript(`
      window.sentToApp = [];
      window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
    `);
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => small.permissions,
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { settings: { integrations: { github: false, linear: false, typesafe: false } } },
    detail: (id: string) => detailOf(id, "idle"),
    timeline: () => ({
      items: [
        { kind: "user", text: "Look at src/app.ts and `src/long.ts`, not `npm test src/app.ts`.", messageId: "u1" },
        { kind: "assistant", text: REPLY, messageId: "r1" },
      ],
    }),
  } as never);
  let listAsks = 0;
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const name = u.pathname.replace("/api/files/", "");
    if (q.workspace !== "wks_a") return route.fulfill({ status: 400, json: { error: "Unknown workspace" } });
    if (name === "all") {
      listAsks++;
      return route.fulfill({ json: { files: [REPORT, "src/app.ts", "src/long.ts"], capped: false } });
    }
    if (name === "tree") return route.fulfill({ json: { dir: q.dir ?? "", entries: [] } });
    if (name === "read") return READS[q.path!] ? route.fulfill({ json: READS[q.path!] }) : route.fulfill({ status: 400, json: { error: "gone" } });
    if (name === "changed") return route.fulfill({ json: { files: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  return { listAsks: () => listAsks };
}

const fileLinks = (page: Page, selector: string) =>
  page.locator(`${selector} a.file-link`).evaluateAll((as) =>
    as.map((a) => [a.textContent, a.getAttribute("data-file-path"), a.getAttribute("data-file-line"), a.getAttribute("title"), !!a.querySelector("code")]),
  );

test("file paths in the conversation link, and open in the Files tab at their line", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { listAsks } = await setUp(page, true);
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    const reply = page.locator(".msg.assistant");
    await reply.locator("a.file-link").first().waitFor();
    assert.deepEqual(await fileLinks(page, ".msg.assistant"), [
      [REPORT, REPORT, null, "Open in Files", true],
      ["/work/atlas/a/src/long.ts:2700", "src/long.ts", "2700", "Open in Files", false],
    ]);
    // The missing path and the code block stay plain; the text reads as written.
    assert.equal(await reply.locator("pre a").count(), 0);
    assert.equal(
      (await reply.locator(".md > p").allInnerTexts()).join(" "),
      REPLY.split("\n\n").slice(0, 2).join(" ").replace(/`/g, ""),
    );
    assert.deepEqual(await fileLinks(page, ".msg.user"), [
      ["src/app.ts", "src/app.ts", null, "Open in Files", false],
      ["src/long.ts", "src/long.ts", null, "Open in Files", false],
    ]);
    await page.screenshot({ path: "/tmp/autolink-files-chat.png" });

    // A click: the Files tab asked for, and the file opens there as a kept tab at its line.
    const menus = () =>
      page.evaluate(() => (window as unknown as { sentToApp: { type: string; action?: string }[] }).sentToApp.filter((m) => m.type === "menu" && m.action === "files").length);
    await reply.getByRole("link", { name: "/work/atlas/a/src/long.ts:2700" }).click();
    await waitFor(menus, (n) => n === 1, "the Files tab asked for");
    assert.equal(new URL(page.url()).hash, "", "the page stays where it is");
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    const active = view.locator(".fv-tab.active");
    await active.filter({ hasText: "long.ts" }).waitFor();
    assert.doesNotMatch((await active.getAttribute("class")) ?? "", /preview/, "a kept tab");
    // Line 2700 is drawn, in view, and marked.
    await waitFor(
      () =>
        page.evaluate(() => {
          const scroller = document.querySelector(".files-view .gd-scroll");
          const root = document.querySelector(".files-view diffs-container")?.shadowRoot;
          const line = root?.querySelector<HTMLElement>('[data-line="2700"][data-line-type]');
          if (!scroller || !line) return false;
          const a = scroller.getBoundingClientRect();
          const b = line.getBoundingClientRect();
          return b.top >= a.top && b.bottom <= a.bottom && line.textContent!.includes("needle");
        }),
      (shown) => shown,
      "line 2700 in view",
    );
    const marked = await page.evaluate(() => {
      const h = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights?.get("gd-find");
      return h?.size ?? -1;
    });
    assert.equal(marked, 1, "the line is marked");
    await page.screenshot({ path: "/tmp/autolink-files-open.png" });

    // While Files shows, the chat's other link opens there at once, kept beside it.
    await reply.getByRole("link", { name: REPORT }).click();
    await active.filter({ hasText: "resource-reference-approaches.md" }).waitFor();
    assert.deepEqual(await view.locator(".fv-tab .fv-tab-name").allTextContents(), ["long.ts", "resource-reference-approaches.md"]);
    assert.equal(listAsks(), 1, "the file list is asked once, shared with the Files page");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("in a browser a file link says the Files tab is the macOS app's", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page, false);
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    const link = page.locator(".msg.assistant a.file-link").first();
    await link.click();
    await page.locator(".toast[role=status]", { hasText: "The Files tab, where files open, is in the macOS app." }).waitFor();
    assert.equal(new URL(page.url()).hash, "");
  } finally {
    await context.close();
  }
});

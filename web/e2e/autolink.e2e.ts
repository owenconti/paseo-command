/**
 * Linear keys of the workspace's teams and PR numbers link themselves in an
 * agent's conversation (src/autolink.ts), its replies and your messages
 * alike; code and other KEY-123 shapes stay plain. In the macOS app a click
 * hands the address to the app, as other chat links do.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { small } from "./fleets";
import { detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const REPLY = [
  "The comment on DE-7338 says a new issue will cover the capability work… DE-7413 has no comment at all. So I put both into DE-7829.",
  "",
  "Lucas's comment on DE-7338 also links PR #7054, and getpaseo/paseo#12 has the fix. UTF-8 and ISO-8601 stay as they are, as does step #3.",
  "",
  "Run `git log DE-1 #2` first.",
].join("\n");

test("Linear keys and PR numbers in the conversation link themselves, and open through the app", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  const workspaces = small.workspaces.map((w) => (w.workspaceId === "wks_a" ? { ...w, repo: "https://github.com/acme/atlas" } : w));
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => small.permissions,
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => workspaces,
    lists: { settings: { integrations: { github: true, linear: true, typesafe: false } } },
    detail: (id: string) => detailOf(id, "idle"),
    timeline: () => ({
      items: [
        { kind: "user", text: "What happened to DE-7338 and #7050? Not `DE-9`.", messageId: "u1" },
        { kind: "assistant", text: REPLY, messageId: "r1" },
      ],
    }),
  } as never);
  let teamAsks = 0;
  await page.route("**/api/linear/teams", (route) => {
    teamAsks++;
    return route.fulfill({ json: { urlKey: "acme", teams: ["DE", "ENG"] } });
  });
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    const reply = page.locator(".msg.assistant");
    await reply.locator('a[href="https://linear.app/acme/issue/DE-7829"]').waitFor();
    const links = await reply.locator("a").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
    assert.deepEqual(links, [
      ["DE-7338", "https://linear.app/acme/issue/DE-7338"],
      ["DE-7413", "https://linear.app/acme/issue/DE-7413"],
      ["DE-7829", "https://linear.app/acme/issue/DE-7829"],
      ["DE-7338", "https://linear.app/acme/issue/DE-7338"],
      ["PR #7054", "https://github.com/acme/atlas/pull/7054"],
      ["getpaseo/paseo#12", "https://github.com/getpaseo/paseo/pull/12"],
    ]);
    // The text reads (and copies) as written.
    assert.equal(
      (await reply.innerText()).replace(/\s+/g, " ").trim(),
      REPLY.replace(/`/g, "").replace(/\s+/g, " ").trim(),
    );
    // Your own message too, its code aside.
    const mine = page.locator(".msg.user");
    const own = await mine.locator("a").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
    assert.deepEqual(own, [
      ["DE-7338", "https://linear.app/acme/issue/DE-7338"],
      ["#7050", "https://github.com/acme/atlas/pull/7050"],
    ]);
    await page.screenshot({ path: "/tmp/autolink-chat.png" });

    // A click goes to the app as a link (it opens Linear's app, else Conquer; PRs in the GitHub tab).
    const sent = () => page.evaluate(() => (window as unknown as { sentToApp: { type: string; url?: string }[] }).sentToApp);
    await reply.getByRole("link", { name: "PR #7054" }).click();
    await waitFor(sent, (m) => m.some((x) => x.type === "openLink" && x.url === "https://github.com/acme/atlas/pull/7054"), "the PR's address sent");
    await reply.getByRole("link", { name: "DE-7829" }).click();
    await waitFor(sent, (m) => m.some((x) => x.type === "openLink" && x.url === "https://linear.app/acme/issue/DE-7829"), "the issue's address sent");
    assert.equal(teamAsks, 1, "the teams are asked once");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

/**
 * The top bar's usage breakdown: accounts with usage first, then those Paseo couldn't read, each saying why (a
 * login another tool saved that expired, or one the provider refused), and accounts sharing a name told apart.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { launch, mockApi, newContext, startApp } from "./harness";
import { small } from "./fleets";
import { OVERLAYS } from "../src/overlays";

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

const expired = { kind: "expired", expiresAt: "2026-05-26T12:00:00.000Z", refreshedBy: "opencode" };
const refused = { kind: "rejected", status: 401 };
const weekly = (usedPct: number) => ({
  status: "available",
  windows: [{ id: "weekly", label: "Weekly", usedPct, resetsAt: "2026-11-25T14:43:01.000Z" }],
});
const USAGE = [
  {
    id: "codex:a",
    sourceId: "codex",
    sourceLabel: "Codex",
    account: { label: "owen@work.example" },
    report: { status: "unavailable", problem: expired },
    loginErrors: [{ harness: "OpenCode", report: { status: "unavailable", problem: expired } }],
  },
  {
    id: "cursor:a",
    sourceId: "cursor",
    sourceLabel: "Cursor",
    account: {},
    report: { status: "unavailable", problem: refused },
    loginErrors: [{ harness: "Cursor", report: { status: "unavailable", problem: refused } }],
  },
  { id: "codex:b", sourceId: "codex", sourceLabel: "Codex", account: { label: "me@home.example" }, report: weekly(18) },
  { id: "codex:c", sourceId: "codex", sourceLabel: "Codex", account: { label: "owen@side.example" }, report: weekly(71) },
];

test("the usage breakdown lists readable accounts first and says why the others aren't", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, {
    agents: () => small.agents,
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { usage: USAGE },
  } as never);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Usage breakdown" }).hover();
  const panel = page.getByRole("region", { name: "Usage breakdown" });
  await panel.waitFor();
  const accounts = await panel.locator(".usage-account").evaluateAll((els) =>
    els.map((el) => ({
      name: el.querySelector(".usage-account-name")?.textContent,
      why: el.querySelector(".usage-unavailable")?.textContent ?? null,
    })),
  );
  assert.deepEqual(
    accounts.map((a) => a.name),
    ["Codexme", "Codexowen@side.example", "Codexowen@work.example", "Cursor"],
  );
  assert.match(accounts[2].why ?? "", /the login saved by OpenCode expired on May 26, 2026\. Sign in again there/);
  assert.match(accounts[3].why ?? "", /Cursor refused the login saved by Cursor \(401\)/);
  // The macOS app cuts the popover out of the terminal and browser laid over the page.
  assert.equal(await panel.evaluate((el, selector) => el.matches(selector), OVERLAYS), true);
  assert.deepEqual(errors, []);
  await context.close();
});

/**
 * Pool boxes (src/pool.ts): New agent's "New pool box" claims one and starts
 * the agent on it once it's online; the Hosts tab releases a claimed box after
 * confirming. Every /api request is answered in the browser; no script,
 * daemon or Sprite is reached.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const settings = {
  linearWorkspace: "",
  integrations: { linear: false, github: false, typesafe: false, pool: true },
  error: null,
};
const status = (job: unknown = null) => ({
  enabled: true,
  problem: "",
  settings: { dir: "~/boxes" },
  checkout: "/srv/app",
  boxes: [
    { id: "pool-1", label: "pool-1", status: "claimed" },
    { id: "pool-2", label: "pool-2", status: "idle" },
  ],
  job,
});
const hosts = [
  { serverId: "srv_local", label: "Studio", status: "online", local: true, state: "online" },
  { serverId: "srv_pool1", label: "pool-1", status: "online", local: false, state: "online" },
];

test("New pool box claims a box, shows its progress, then opens the agent it started", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const claims: any[] = [];
  const lists: Record<string, unknown> = { settings, pool: status() };
  const job = { id: "pj1", kind: "claim", phase: "claiming", steps: [] as string[], startedAt: 1 };
  await mockApi(page, {
    agents: () => [],
    hosts: () => hosts,
    lists,
    accept: (path, body) => {
      if (path !== "/api/pool/claim") return false;
      claims.push(body);
      lists.pool = status({ ...job, steps: ["Claiming pool-2 (paseo-pool-2)", "Wake sprite"], pool: "pool-2" });
      return { job };
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const hostField = page.locator(".new-agent select[name=host]");
  await waitFor(
    () => hostField.locator("option[value='pool:new']").textContent(),
    (t) => t === "New pool box · 1 idle",
    "the New pool box choice",
  );
  await hostField.selectOption("pool:new");
  // Its place is the box's checkout, with Local or a new worktree.
  assert.equal(await page.locator(".new-agent select[name=target]").inputValue(), "pool:new");
  assert.match((await page.locator(".new-agent .form-hint").textContent()) ?? "", /Claims an idle pool box.*\/srv\/app/);
  await page.locator(".new-agent").getByRole("radio", { name: "Worktree" }).click();
  await page.locator(".new-agent input[placeholder]").first().fill("fix-login");
  await page.locator(".new-agent #composer").fill("Fix the flaky login test");
  await page.locator(".new-agent").getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(claims.length), (n) => n === 1, "the claim");
  assert.equal(claims[0].prompt, "Fix the flaky login test");
  assert.equal(claims[0].provider, "claude");
  assert.equal(claims[0].branch, "fix-login");
  assert.equal(claims[0].host, undefined);
  assert.equal(claims[0].projectId, undefined);
  // The claim's progress shows in the form while it runs.
  const progress = page.locator(".new-agent .new-agent-pool");
  await waitFor(() => progress.textContent(), (t) => !!t?.includes("Claiming pool-2…") && t.includes("Wake sprite"), "the claim's progress");
  // Once it's done, the agent it started opens and the notice says where.
  lists.pool = status({ ...job, pool: "pool-2", phase: "done", agentId: "a-pool", host: "srv_pool2", steps: [] });
  await waitFor(() => page.locator(".new-agent").count(), (n) => n === 0, "New agent to close");
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Agent started on pool-2"), "the notice");
  await context.close();
});

test("a claimed pool box's host is released from the Hosts tab after confirming", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const released: any[] = [];
  const lists: Record<string, unknown> = { settings, pool: status() };
  await mockApi(page, {
    agents: () => [],
    hosts: () => hosts,
    lists,
    accept: (path, body) => {
      if (path !== "/api/pool/release") return false;
      released.push(body);
      const job = { id: "pj2", kind: "release", phase: "releasing", pool: "pool-1", steps: [], startedAt: 1 };
      lists.pool = status(job);
      return { job };
    },
  });
  await page.goto(app.url);
  await page.getByRole("tab", { name: /Hosts/ }).click();
  const release = page.getByRole("button", { name: "Release pool box pool-1" });
  await release.waitFor();
  // Only the claimed box's host has it.
  assert.equal(await page.getByRole("button", { name: /Release pool box/ }).count(), 1);
  await release.click();
  const dialog = page.getByRole("dialog", { name: "Release pool-1?" });
  await dialog.waitFor();
  // Esc keeps it.
  await page.keyboard.press("Escape");
  await waitFor(() => dialog.count(), (n) => n === 0, "the dialog to close");
  assert.equal(released.length, 0);
  await release.click();
  await dialog.getByRole("button", { name: "Release pool-1" }).click();
  await waitFor(() => Promise.resolve(released.length), (n) => n === 1, "the release");
  assert.deepEqual(released[0], { pool: "pool-1" });
  await waitFor(() => page.locator(".host-entry").filter({ hasText: "pool-1" }).textContent(), (t) => !!t?.includes("Releasing…"), "the row to say it's releasing");
  lists.pool = status({ id: "pj2", kind: "release", phase: "done", pool: "pool-1", steps: [], startedAt: 1 });
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Released pool-1"), "the notice");
  await context.close();
});

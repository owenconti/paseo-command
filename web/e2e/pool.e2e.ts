/**
 * Pool boxes (src/pool.ts): New agent's "New pool box" claims one and starts
 * the agent on it once it's online; a claimed box's host head in the crew releases it after confirming, and the
 * crew's Pool boxes section says every box's state. Every /api request is answered in the browser; no script,
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

test("a claimed pool box's host is released from its head in the crew after confirming", async () => {
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
  // Its host has no workspaces, but a claimed box's stays on the map so it can be released.
  const heads = page.locator(".crew-host[data-host]");
  const release = heads.getByRole("button", { name: "Release pool box pool-1" });
  await release.waitFor();
  // Only the claimed box's host has it.
  assert.equal(await heads.getByRole("button", { name: /Release pool box/ }).count(), 1);
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
  await waitFor(() => page.locator(".crew-host[data-host]").filter({ hasText: "pool-1" }).textContent(), (t) => !!t?.includes("Releasing…"), "its head to say it's releasing");
  lists.pool = status({ id: "pj2", kind: "release", phase: "done", pool: "pool-1", steps: [], startedAt: 1 });
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Released pool-1"), "the notice");
  await context.close();
});

test("the crew's Pool boxes section says each box's state, releases a claimed one and shows its host", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const released: any[] = [];
  const boxes = [
    { id: "pool-1", label: "pool-1", status: "claimed", claimedAt: new Date(Date.now() - 2 * 3600_000).toISOString() },
    { id: "pool-2", label: "pool-2", status: "idle" },
    { id: "pool-3", label: "pool-3", status: "provisioning" },
    { id: "pool-4", label: "pool-4", status: "failed" },
    { id: "pool-5", label: "pool-5", status: "claimed" },
  ];
  const lists: Record<string, unknown> = { settings, pool: { ...status(), boxes } };
  await mockApi(page, {
    agents: () => [],
    hosts: () => [...hosts, { serverId: "srv_pool5", label: "pool-5", status: "offline", local: false, state: "offline" }],
    lists,
    accept: (path, body) => {
      if (path !== "/api/pool/release") return false;
      released.push(body);
      const job = { id: "pj9", kind: "release", phase: "releasing", pool: "pool-1", steps: ["Restore checkpoint"], startedAt: 1 };
      lists.pool = { ...status(job), boxes };
      return { job };
    },
  });
  await page.goto(app.url);
  const section = page.getByRole("region", { name: "Pool boxes" });
  await section.waitFor();
  const box = (id: string) => section.locator(`.crew-pool-box[data-box="${id}"]`);
  const read = async (id: string) => ({ tone: await box(id).getAttribute("data-tone"), text: (await box(id).textContent())?.replace(/\s+/g, " ").trim() });
  assert.equal((await section.locator(".crew-pool-count").textContent())?.trim(), "2 claimed · 1 idle");
  assert.deepEqual(await read("pool-1"), { tone: "claimed", text: "pool-1ClaimedOnline · no agents · claimed 2h agoRelease" });
  assert.equal((await read("pool-2")).tone, "idle");
  assert.match((await read("pool-2")).text!, /Idle.*Asleep, ready for a new agent/);
  assert.match((await read("pool-3")).text!, /Provisioning/);
  assert.equal((await read("pool-4")).tone, "bad");
  assert.deepEqual((await read("pool-5")).tone, "warn");
  assert.match((await read("pool-5")).text!, /Claimed · offline.*Its host isn't reachable/);
  // Release only on claimed boxes.
  assert.equal(await section.getByRole("button", { name: /Release pool box/ }).count(), 2);
  // A claimed box's name shows its host's head.
  await section.getByRole("button", { name: "pool-1", exact: true }).click();
  await waitFor(() => page.evaluate(() => document.activeElement?.closest(".crew-host[data-host]")?.textContent ?? ""), (t) => t.includes("pool-1"), "its host's head to take focus");
  // Releasing from the section confirms, then says it's releasing.
  await box("pool-1").getByRole("button", { name: "Release pool box pool-1" }).click();
  await page.getByRole("dialog", { name: "Release pool-1?" }).getByRole("button", { name: "Release pool-1" }).click();
  await waitFor(() => Promise.resolve(released.length), (n) => n === 1, "the release");
  await waitFor(() => read("pool-1"), (r) => r.tone === "busy" && !!r.text?.includes("Releasing…") && !!r.text?.includes("Restore checkpoint"), "the box to say it's releasing");
  // Folding it keeps it folded.
  await section.getByRole("button", { name: "Pool boxes" }).click();
  await waitFor(() => section.locator(".crew-pool-box").count(), (n) => n === 0, "the section to fold");
  await context.close();
});

test("leaving New agent mid-claim keeps the claim; a failed claim puts the message back", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const lists: Record<string, unknown> = { settings, pool: status() };
  const job = { id: "pj3", kind: "claim", phase: "claiming", pool: "pool-2", steps: ["Wake sprite"], startedAt: 1 };
  await mockApi(page, {
    agents: () => [],
    hosts: () => hosts,
    lists,
    accept: (path) => {
      if (path !== "/api/pool/claim") return false;
      lists.pool = status(job);
      return { job };
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const form = page.locator(".new-agent");
  await waitFor(() => form.locator("select[name=host] option[value='pool:new']").count(), (n) => n === 1, "the pool choice");
  await form.locator("select[name=host]").selectOption("pool:new");
  await form.locator("#composer").fill("Run the e2e suite on the box");
  await form.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => form.locator(".new-agent-pool").count(), (n) => n === 1, "the claim's progress");
  // Leave while it runs, then come back: the claim shows again.
  await form.getByRole("button", { name: "Fleet" }).click();
  await waitFor(() => page.locator(".new-agent").count(), (n) => n === 0, "New agent to close");
  await page.locator("body").press("d");
  await waitFor(() => form.locator(".new-agent-pool").textContent(), (t) => !!t?.includes("Claiming pool-2…"), "the claim again");
  assert.equal(await form.locator("select[name=host]").inputValue(), "pool:new");
  // It fails: the message is back in the box, and the error says so.
  lists.pool = status({ ...job, phase: "failed", error: "no idle pool boxes" });
  await waitFor(() => form.locator("[role=alert]").textContent(), (t) => !!t?.includes("Your message is back below"), "the error");
  await waitFor(() => form.locator("#composer").inputValue(), (v) => v === "Run the e2e suite on the box", "the message back");
  await context.close();
});

/** A fleet with workspaces on pool-1 (and one on macmini), archived from their heads in the crew. */
async function archiveScene(opts: {
  checkout?: unknown;
  remaining?: { workspaces: number; agents: number };
  box?: boolean;
}) {
  const context = await newContext(browser);
  const page = await context.newPage();
  const posts: { path: string; body: any }[] = [];
  const lists: Record<string, unknown> = { settings, pool: status() };
  const box = { id: "pool-1", label: "pool-1", status: "claimed" };
  let workspaces = [
    { workspaceId: "wks_pool", projectId: "prj_app", project: "app", name: "fix-login", isolation: "local", cwd: "/srv/app", branch: "fix-login", host: "srv_pool1" },
    { workspaceId: "wks_mac", projectId: "prj_app", project: "app", name: "docs", isolation: "local", cwd: "/work/app", branch: "docs", host: "srv_macmini" },
  ];
  await mockApi(page, {
    agents: () => [],
    hosts: () => [...hosts, { serverId: "srv_macmini", label: "macmini", status: "online", local: false, state: "online" }],
    projects: () => [
      { projectId: "prj_app", name: "app", kind: "git", path: "/srv/app", host: "srv_pool1" },
      { projectId: "prj_app", name: "app", kind: "git", path: "/work/app", host: "srv_macmini" },
    ],
    workspaces: () => workspaces,
    lists,
    accept: (path, body) => {
      posts.push({ path, body });
      if (path.startsWith("/api/workspaces/") && path.endsWith("/archive")) {
        workspaces = workspaces.filter((w) => !path.includes(w.workspaceId));
        return { ok: true };
      }
      if (path === "/api/pool/before-archive")
        return opts.box === false || body.host !== "srv_pool1" ? { box: null } : { box, checkout: opts.checkout };
      if (path === "/api/pool/after-archive")
        return opts.box === false || body.host !== "srv_pool1"
          ? { box: null }
          : { box, remaining: opts.remaining ?? { workspaces: 0, agents: 0 } };
      if (path === "/api/pool/release") {
        const job = { id: "pj9", kind: "release", phase: "releasing", pool: "pool-1", steps: [], startedAt: 1 };
        lists.pool = status(job);
        return { job };
      }
      return false;
    },
  });
  await page.goto(app.url);
  const archive = async (name: string) => {
    await page.getByRole("button", { name: `Archive workspace ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: "Archive this workspace?" });
    await dialog.getByRole("button", { name: "Archive workspace" }).click();
    await waitFor(() => Promise.resolve(posts.some((p) => p.path.endsWith("/archive"))), (v) => v, "the archive");
  };
  const posted = (path: string) => posts.filter((p) => p.path === path);
  return { context, page, posts, posted, archive };
}
const clean = { known: true, branch: "fix-login", dirty: false, unpushed: 0 };

test("archiving a pool box's last workspace releases the box, its checkout clean", async () => {
  const { context, page, posted, archive } = await archiveScene({ checkout: clean });
  await archive("fix-login");
  // The checkout was read before the archive went out.
  assert.deepEqual(posted("/api/pool/before-archive")[0].body, { host: "srv_pool1", workspace: "wks_pool" });
  await waitFor(() => Promise.resolve(posted("/api/pool/release").length), (n) => n === 1, "the release");
  assert.deepEqual(posted("/api/pool/release")[0].body, { pool: "pool-1", host: "srv_pool1", workspace: "wks_pool" });
  assert.equal(await page.getByRole("dialog", { name: /Release pool-1/ }).count(), 0, "nothing asked");
  await waitFor(() => page.locator(".toast-stack").textContent(), (t) => !!t?.includes("Releasing pool-1: its last workspace was archived"), "the notice");
  // Its host stays in the crew while the box is released, saying so.
  await waitFor(() => page.locator(".crew-host[data-host]").filter({ hasText: "pool-1" }).textContent(), (t) => !!t?.includes("Releasing…"), "its head's state");
  await context.close();
});

test("a pool box with another workspace still active stays claimed", async () => {
  const { context, page, posted, archive } = await archiveScene({ checkout: clean, remaining: { workspaces: 1, agents: 0 } });
  await archive("fix-login");
  await waitFor(() => Promise.resolve(posted("/api/pool/after-archive").length), (n) => n === 1, "the check after");
  await page.waitForTimeout(300);
  assert.equal(posted("/api/pool/release").length, 0);
  assert.equal(await page.getByRole("dialog", { name: /Release pool-1/ }).count(), 0);
  await context.close();
});

test("unpushed work in the checkout asks before releasing; keeping the box claimed releases nothing", async () => {
  const dirty = { known: true, branch: "fix-login", dirty: true, unpushed: 2 };
  const first = await archiveScene({ checkout: dirty });
  await first.archive("fix-login");
  const ask = first.page.getByRole("dialog", { name: "Release pool-1?" });
  await ask.waitFor();
  assert.match(
    (await ask.textContent()) ?? "",
    /Releasing pool-1 discards unpushed changes in fix-login \(uncommitted changes and 2 unpushed commits\)/,
  );
  assert.equal(first.posted("/api/pool/release").length, 0, "not before the answer");
  await ask.getByRole("button", { name: "Keep it" }).click();
  await waitFor(() => first.page.locator(".toast-stack").textContent(), (t) => !!t?.includes("pool-1 stays claimed"), "the notice");
  assert.equal(first.posted("/api/pool/release").length, 0);
  await first.context.close();
  // Confirmed, it's released.
  const second = await archiveScene({ checkout: dirty });
  await second.archive("fix-login");
  const again = second.page.getByRole("dialog", { name: "Release pool-1?" });
  await again.getByRole("button", { name: "Release pool-1" }).click();
  await waitFor(() => Promise.resolve(second.posted("/api/pool/release").length), (n) => n === 1, "the release");
  assert.deepEqual(second.posted("/api/pool/release")[0].body, { pool: "pool-1", host: "srv_pool1", workspace: "wks_pool" });
  await second.context.close();
});

test("archiving a workspace on a host that isn't a pool box releases nothing", async () => {
  const { context, page, posted, archive } = await archiveScene({ checkout: clean });
  await archive("docs");
  await waitFor(() => Promise.resolve(posted("/api/workspaces/wks_mac/archive").length), (n) => n === 1, "the archive");
  await page.waitForTimeout(300);
  assert.equal(posted("/api/pool/after-archive").length, 0, "the server said it isn't a pool box");
  assert.equal(posted("/api/pool/release").length, 0);
  await context.close();
});

/** pool-1 released (asleep: its host offline) beside an offline ordinary host. */
const asleep = [
  { serverId: "srv_local", label: "Studio", status: "online", local: true, state: "online" },
  { serverId: "srv_pool1", label: "pool-1", status: "offline", local: false, state: "offline", error: "Cannot reach host" },
  { serverId: "srv_macmini", label: "macmini", status: "offline", local: false, state: "offline" },
];
const idleStatus = (job: unknown = null) => ({
  ...status(job),
  boxes: [{ id: "pool-1", label: "pool-1", status: "idle" }],
});

async function wakeScene(outcome: "done" | "failed") {
  const context = await newContext(browser);
  const page = await context.newPage();
  const posts: { path: string; body: any }[] = [];
  const lists: Record<string, unknown> = { settings, pool: idleStatus() };
  const job = { id: "pjw", kind: "claim", phase: "claiming", pool: "pool-1", wake: true, steps: ["Wake sprite"], startedAt: 1 };
  await mockApi(page, {
    agents: () => [],
    hosts: () => asleep,
    lists,
    accept: (path, body) => {
      posts.push({ path, body });
      if (path !== "/api/pool/claim") return false;
      lists.pool = idleStatus(job);
      setTimeout(() => {
        lists.pool = idleStatus(
          outcome === "done"
            ? { ...job, phase: "done", agentId: "a-woken", host: "srv_pool1" }
            : { ...job, phase: "failed", error: "pool-1 was claimed but its Paseo host didn't come online within 90 s." },
        );
      }, 1500);
      return { job };
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  return { context, page, posts, form: page.locator(".new-agent") };
}

test("an asleep pool host can be picked: sending wakes it by name, then starts the agent", async () => {
  const { context, page, posts, form } = await wakeScene("done");
  const pool1 = form.locator("select[name=host] option[value=srv_pool1]");
  await waitFor(() => pool1.textContent(), (t) => t === "pool-1 · asleep, will wake", "the asleep pool host");
  assert.equal(await pool1.getAttribute("disabled"), null);
  // An ordinary host that's offline stays disabled.
  const mac = form.locator("select[name=host] option[value=srv_macmini]");
  assert.equal(await mac.getAttribute("disabled"), "");
  assert.match((await mac.textContent()) ?? "", /^macmini · offline/);
  await form.locator("select[name=host]").selectOption("srv_pool1");
  assert.match((await form.locator(".form-hint").textContent()) ?? "", /pool-1 is asleep: sending wakes it \(claim\.sh pool-1\).*\/srv\/app/);
  await form.locator("#composer").fill("Say what diagonal is");
  await form.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(posts.filter((p) => p.path === "/api/pool/claim").length), (n) => n === 1, "the wake");
  const claim = posts.find((p) => p.path === "/api/pool/claim")!.body;
  assert.equal(claim.pool, "pool-1");
  assert.equal(claim.host, undefined, "the box is named, not its (asleep) host");
  await waitFor(() => form.locator(".new-agent-pool").textContent(), (t) => !!t?.includes("Waking pool-1…"), "the progress");
  await waitFor(() => page.locator(".new-agent").count(), (n) => n === 0, "the agent to open");
  await waitFor(() => page.locator(".toast-stack").textContent(), (t) => !!t?.includes("Agent started on pool-1"), "the notice");
  assert.equal(posts.filter((p) => p.path === "/api/dispatch").length, 0, "dispatched by the server, after the wake");
  await context.close();
});

test("a wake that fails says why and starts nothing", async () => {
  const { context, posts, form } = await wakeScene("failed");
  await waitFor(() => form.locator("select[name=host] option[value=srv_pool1]").textContent(), (t) => t === "pool-1 · asleep, will wake", "the asleep pool host");
  await form.locator("select[name=host]").selectOption("srv_pool1");
  await form.locator("#composer").fill("Say what diagonal is");
  await form.getByRole("button", { name: "Send message" }).click();
  await waitFor(
    () => form.locator("[role=alert]").textContent(),
    (t) => !!t?.includes("Couldn't start the agent on pool-1: pool-1 was claimed but its Paseo host didn't come online within 90 s."),
    "the error",
  );
  // The message is back to try again.
  await waitFor(() => form.locator("#composer").inputValue(), (v) => v === "Say what diagonal is", "the message back");
  assert.equal(posts.filter((p) => p.path === "/api/dispatch").length, 0);
  await context.close();
});

/**
 * A claim New agent sent, then left: the claim is the server's, so the page only follows it. Its status lists
 * the claim (`jobs`), which the agent list shows as a pending row until its agent shows, or with why it failed.
 */
async function claimThenLeave(opts: { reload?: boolean } = {}) {
  const context = await newContext(browser);
  const page = await context.newPage();
  const posts: { path: string; body: any }[] = [];
  const job = {
    id: "pj9",
    kind: "claim",
    phase: "claiming",
    pool: "pool-2",
    steps: ["Wake sprite"],
    startedAt: 1,
    title: "Say hello from the box",
    where: "the checkout",
  };
  let agents: any[] = [];
  const lists: Record<string, unknown> = { settings, pool: status() };
  const setJob = (j: Record<string, unknown> | null) => (lists.pool = { ...status(j), jobs: j ? [j] : [] });
  await mockApi(page, {
    agents: () => agents,
    hosts: () => hosts,
    lists,
    accept: (path, body) => {
      posts.push({ path, body });
      if (path === "/api/pool/claim") {
        setJob(job);
        return { job };
      }
      if (path === "/api/pool/dismiss") {
        setJob(null);
        return { job: { ...job, dismissed: true } };
      }
      return false;
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const form = page.locator(".new-agent");
  await waitFor(() => form.locator("select[name=host] option[value='pool:new']").count(), (n) => n === 1, "the pool choice");
  await form.locator("select[name=host]").selectOption("pool:new");
  await form.locator("#composer").fill("Say hello from the box");
  await form.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => form.locator(".new-agent-pool").count(), (n) => n === 1, "the claim's progress");
  // Leave mid-claim (or reload the page, as the app's restart does).
  if (opts.reload) await page.reload();
  else await form.getByRole("button", { name: "Fleet" }).click();
  await waitFor(() => page.locator(".new-agent").count(), (n) => n === 0, "New agent to close");
  const row = page.locator(".pool-claims .pool-claim");
  return { context, page, posts, job, setJob, row, form, setAgents: (a: any[]) => (agents = a) };
}

test("leaving New agent mid-claim: the claim shows in the agent list at once and its agent still lands", async () => {
  const { context, page, job, setJob, row, setAgents } = await claimThenLeave();
  await waitFor(() => row.textContent(), (t) => !!t?.includes("Say hello from the box") && t.includes("Claiming pool-2…"), "the pending row");
  // The server goes on without New agent: waiting for the host, then starting the agent.
  setJob({ ...job, phase: "waiting" });
  await waitFor(() => row.textContent(), (t) => !!t?.includes("Waiting for pool-2 to come online…"), "the row following the claim");
  setJob({ ...job, phase: "dispatching", host: "srv_pool2" });
  await waitFor(() => row.textContent(), (t) => !!t?.includes("Starting the agent on pool-2…"), "the row starting the agent");
  setJob({ ...job, phase: "done", agentId: "a-box", host: "srv_pool2", endedAt: Date.now() });
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Agent started on pool-2"), "the notice");
  // Until the fleet lists the agent the row stays; then it gives way to the agent's own row.
  assert.equal(await row.count(), 1);
  setAgents([
    { id: "a-box", shortId: "a-box", name: "Say hello from the box", provider: "claude", status: "running", cwd: "/srv/app", created: "2026-11-13T22:00:00Z", host: "srv_pool1" },
  ]);
  await waitFor(() => row.count(), (n) => n === 0, "the pending row to give way");
  await context.close();
});

test("a claim that fails after New agent was left says why in the agent list and when New agent reopens", async () => {
  const { context, page, posts, job, setJob, row, form } = await claimThenLeave();
  await waitFor(() => row.count(), (n) => n === 1, "the pending row");
  setJob({
    ...job,
    phase: "failed",
    host: "srv_pool2",
    endedAt: Date.now(),
    error: "pool-2 is claimed and online, but its daemon refused the agent: GitHub CLI authentication failed",
  });
  await waitFor(() => row.locator("[role=alert]").textContent(), (t) => !!t?.includes("GitHub CLI authentication failed"), "the row's error");
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Couldn't start the agent on pool-2"), "the notice");
  // New agent, opened from the row, says it too, the message back in its box.
  await row.locator(".pool-claim-main").click();
  await waitFor(() => form.locator("[role=alert]").textContent(), (t) => !!t?.includes("GitHub CLI authentication failed") && t.includes("Your message is back below"), "New agent's error");
  await waitFor(() => form.locator("#composer").inputValue(), (v) => v === "Say hello from the box", "the message back");
  // Dismissed, it leaves the list.
  await form.getByRole("button", { name: "Fleet" }).click();
  await row.getByRole("button", { name: "Dismiss the failed claim of pool-2" }).click();
  await waitFor(() => row.count(), (n) => n === 0, "the row to go");
  assert.deepEqual(posts.find((p) => p.path === "/api/pool/dismiss")?.body, { id: "pj9" });
  await context.close();
});

test("after a reload mid-claim, the agent list and New agent show the claim still running, then its end", async () => {
  const { context, page, job, setJob, row, form } = await claimThenLeave({ reload: true });
  await waitFor(() => row.textContent(), (t) => !!t?.includes("Claiming pool-2…") && t.includes("Wake sprite"), "the pending row after the reload");
  await row.locator(".pool-claim-main").click();
  await waitFor(() => form.locator(".new-agent-pool").textContent(), (t) => !!t?.includes("Claiming pool-2…"), "New agent showing the claim");
  // This page started it (before the reload), so its end is still told.
  setJob({ ...job, phase: "done", agentId: "a-box", host: "srv_pool2", endedAt: Date.now() });
  await waitFor(() => page.locator(".toast").textContent(), (t) => !!t?.includes("Agent started on pool-2"), "the notice");
  await context.close();
});

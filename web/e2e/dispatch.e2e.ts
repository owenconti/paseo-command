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

test("a typed PR number or URL is dispatched without selecting a search result", async () => {
  for (const input of ["42", "#42", "https://github.com/acme/atlas/pull/42"]) {
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
    // Checkout by number must work even if suggestions aren't available.
    await page.route("**/api/drafts/prs?**", (route) =>
      route.fulfill({ json: { prs: [], error: "Search unavailable" } }),
    );
    await page.goto(app.url);
    await page.locator("body").press("d");
    const view = page.locator(".new-agent");
    await view.getByRole("radio", { name: "Worktree" }).click();
    await view.getByLabel(/^Pull request/).fill(input);
    // Move straight to the mission: no Enter or search-result click.
    await view.locator("#composer").fill("Review this pull request");
    await view.getByRole("button", { name: "Send message" }).click();
    await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the PR dispatch");
    assert.equal(dispatched[0].pr, 42, input);
    assert.equal(dispatched[0].branch, undefined, input);
    assert.equal(dispatched[0].base, undefined, input);
    await context.close();
  }
});

test("a typed PR enables presets, clears cleanly, and resets when leaving Worktree mode", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    lists: { presets: { presets: [{ name: "Review PR", prompt: "Review {{pr}}." }], error: null } },
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  await page.route("**/api/drafts/prs?**", (route) =>
    route.fulfill({ json: { prs: [], error: null } }),
  );
  await page.goto(app.url);
  await page.locator("body").press("d");
  const view = page.locator(".new-agent");
  const review = view.getByRole("button", { name: "Review PR" });
  await view.getByRole("radio", { name: "Worktree" }).click();
  const field = view.getByLabel(/^Pull request/);
  await field.fill("42");
  assert.equal(await review.isEnabled(), true);
  assert.equal(await view.getByLabel(/^Branch/).count(), 0);
  await field.fill("");
  assert.equal(await review.isDisabled(), true);
  await view.getByLabel(/^Branch/).waitFor();
  await field.fill("42");
  await view.getByRole("radio", { name: "Local" }).click();
  await view.getByRole("radio", { name: "Worktree" }).click();
  assert.equal(await field.inputValue(), "");
  assert.equal(await review.isDisabled(), true);
  await field.fill("57");
  await review.click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the preset dispatch");
  assert.equal(dispatched[0].pr, 57);
  assert.equal(dispatched[0].prompt, "Review #57.");
  assert.equal(dispatched[0].branch, undefined);
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

test("presets are added in their editor and offered in New agent", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const saved: any[] = [];
  // settings.json, as the server would read it.
  const file: { presets: unknown[]; error: null } = { presets: [], error: null };
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
    lists: { presets: file },
    accept: (path, body) => {
      if (path !== "/api/presets") return false;
      saved.push(body);
      file.presets = body.presets;
      return file;
    },
  });
  await page.goto(app.url);
  await page.locator("body").press("d");
  const view = page.locator(".new-agent");
  await view.getByRole("button", { name: "Add a preset prompt" }).click();
  const dialog = page.getByRole("dialog", { name: "Preset prompts" });
  await dialog.getByRole("button", { name: "Add preset" }).click();
  await dialog.getByLabel("Prompt").fill("Tidy the README.");
  await dialog.getByLabel("Name").fill("Tidy");
  await dialog.getByRole("button", { name: "Save" }).click();
  await waitFor(() => dialog.count(), (n) => n === 0, "the editor closing");
  assert.deepEqual(saved, [{ presets: [{ name: "Tidy", prompt: "Tidy the README." }] }]);
  await view.getByRole("button", { name: "Tidy" }).waitFor();
  // Settings opens the same editor, with the saved preset; Esc drops edits.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('.settings-nav-item[data-section="new-agent"]').click();
  await page.locator(".presets-setting:not(.profiles-setting)").getByRole("button", { name: "Edit presets…" }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Name").inputValue(), "Tidy");
  await dialog.getByLabel("Name").fill("Changed");
  await page.keyboard.press("Escape");
  await waitFor(() => dialog.count(), (n) => n === 0, "the editor closing on Esc");
  assert.equal(saved.length, 1);
  await view.getByRole("button", { name: "Tidy" }).waitFor();
  await context.close();
});

test("a Paseo agent profile in the provider picker sets the agent's settings", async () => {
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
  await page.route("**/api/profiles**", (route) =>
    route.fulfill({
      json: [
        {
          id: "agent_profile_ship",
          name: "Shipper",
          provider: "claude",
          model: "opus",
          mode: "bypassPermissions",
          thinking: "high",
          features: { fast_mode: true },
          notes: "When invoking /ship-issue",
        },
      ],
    }),
  );
  await page.route("**/api/providers/claude/models**", (route) =>
    route.fulfill({
      json: [
        { id: "sonnet", model: "Sonnet", thinkingOptionIds: ["low", "high"] },
        { id: "opus", model: "Opus", thinkingOptionIds: ["low", "high"] },
      ],
    }),
  );
  // What the pickers show, not their options.
  const shown = () =>
    view.locator(".agent-controls .control > span").allInnerTexts().then((t) => t.join(" "));
  const open = async () => {
    await page.goto(app.url);
    await page.locator("body").press("d");
    return page.locator(".new-agent");
  };
  let view = await open();
  const picker = view.getByLabel("Provider or profile");
  await waitFor(() => picker.count(), (n) => n === 1, "the profile picker");
  await picker.selectOption("profile:agent_profile_ship");
  await waitFor(
    shown,
    (t) => /Shipper/.test(t) && /Opus/.test(t) && /high/.test(t) && /Bypass/.test(t),
    "the profile's settings",
  );
  await view.locator("#composer").fill("Ship it");
  await view.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
  assert.equal(dispatched[0].provider, "claude");
  assert.equal(dispatched[0].model, "opus");
  assert.equal(dispatched[0].thinking, "high");
  assert.equal(dispatched[0].mode, "bypassPermissions");
  assert.deepEqual(dispatched[0].features, { fast_mode: true });
  // The profile is chosen again next time; changing a setting leaves it.
  await waitFor(
    () => page.evaluate(() => localStorage.getItem("paseo-command:dispatch") ?? ""),
    (raw) => raw.includes('"profile":"agent_profile_ship"'),
    "the remembered profile choice",
  );
  view = await open();
  await waitFor(
    shown,
    (t) => /Shipper/.test(t),
    "the remembered profile",
  );
  await view.getByLabel("Model").selectOption("sonnet");
  await waitFor(
    shown,
    (t) => !/Shipper/.test(t) && /Claude/.test(t),
    "the provider's plain settings",
  );
  await view.locator("#composer").fill("Plain");
  await view.getByRole("button", { name: "Send message" }).click();
  await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 2, "the second dispatch");
  assert.equal(dispatched[1].model, "sonnet");
  assert.equal(dispatched[1].features, undefined);
  await context.close();
});

test("the provider picker opens the profiles' editor, whose save the picker shows", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
  });
  let profiles = [
    {
      id: "agent_profile_ship",
      name: "Shipper",
      provider: "claude",
      model: "opus",
      mode: "bypassPermissions",
      thinking: "high",
      features: {},
      notes: "",
    },
  ];
  const saved: any[] = [];
  await page.route("**/api/profiles**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      saved.push(body);
      profiles = body.profiles.map((p: any, i: number) => ({ id: p.id ?? `agent_profile_new${i}`, ...p }));
      return route.fulfill({ json: profiles });
    }
    if (url.pathname.endsWith("/editor"))
      return route.fulfill({ json: { supported: true, profiles } });
    if (url.pathname.endsWith("/features"))
      return route.fulfill({
        json: [{ id: "fast_mode", type: "toggle", label: "Fast mode", value: false }],
      });
    return route.fulfill({ json: profiles });
  });
  await page.route("**/api/providers/claude/models**", (route) =>
    route.fulfill({
      json: [{ id: "opus", model: "Opus", thinkingOptionIds: ["low", "high"] }],
    }),
  );
  await page.goto(app.url);
  await page.locator("body").press("d");
  const view = page.locator(".new-agent");
  const picker = view.getByLabel("Provider or profile");
  await waitFor(() => picker.count(), (n) => n === 1, "the profile picker");
  await picker.selectOption("edit-profiles");
  const dialog = page.getByRole("dialog", { name: "Agent profiles" });
  await dialog.waitFor();
  const name = dialog.getByLabel("Name");
  await waitFor(() => name.inputValue(), (v) => v === "Shipper", "the profile");
  await name.fill("Fast shipper");
  await dialog.getByRole("switch", { name: "Fast mode" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await waitFor(() => dialog.count(), (n) => n === 0, "the editor closing");
  assert.deepEqual(saved, [
    {
      base: ["agent_profile_ship"],
      profiles: [
        {
          id: "agent_profile_ship",
          name: "Fast shipper",
          provider: "claude",
          model: "opus",
          mode: "bypassPermissions",
          thinking: "high",
          features: { fast_mode: true },
          notes: "",
        },
      ],
    },
  ]);
  await waitFor(
    () => picker.locator("option").allInnerTexts().then((t) => t.join("|")),
    (t) => t.includes("Fast shipper"),
    "the saved profile in the picker",
  );
  // ⌘K offers the editor too.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("agent profiles");
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await waitFor(() => dialog.count(), (n) => n === 0, "the editor closing on Esc");
  await context.close();
});

/**
 * The panel header's gear holds the app's settings: interface sounds, the
 * lofi radio, desktop notifications and the Linear workspace. Every /api
 * request is answered in the browser; none reaches a daemon, and the radio
 * stream is answered empty.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import {
  agentRow,
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

test("the gear opens every setting, and the radio's choice is kept", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.route("https://lofi.stream.laut.fm/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto(app.url);
  const header = page.locator(".panel-tools");
  assert.equal(await header.getByRole("button").count(), 1);
  await header.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  for (const label of [
    "Interface sounds",
    "Lofi radio",
    "Desktop notifications",
    "Linear",
    "TypeSafe",
  ])
    await dialog.getByText(label, { exact: true }).waitFor();
  const radio = dialog.getByRole("switch", { name: /Lofi radio/ });
  assert.equal(await radio.isChecked(), false);
  assert.equal(
    await dialog.getByRole("slider", { name: "Lofi radio volume" }).isDisabled(),
    true,
  );
  await radio.focus();
  await radio.press("Space");
  assert.equal(await radio.isChecked(), true);
  if (process.env.SHOT)
    (await page.waitForTimeout(300),
      await page.screenshot({ path: process.env.SHOT }));
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("paseo-command:music")!),
    ),
    { enabled: true, volume: 0.4 },
  );
  await radio.uncheck();
  await context.close();
});

test("API keys live under their integrations and can be saved, replaced and removed without readback", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const file = { linearWorkspace: "acme", integrations: { linear: true, typesafe: true }, error: null };
  const secretStatus = { configured: { linearApiKey: false, typesafeApiKey: false }, error: null };
  const values: Record<string, string> = {};
  const writes: any[] = [];
  await mockApi(page, {
    agents: () => [], projects: () => [],
    lists: { settings: file, secrets: secretStatus },
    accept: (path, body) => {
      if (path === "/api/secrets") {
        writes.push(body);
        if (body.value === null) delete values[body.name];
        else values[body.name] = body.value;
        secretStatus.configured.linearApiKey = !!values.linearApiKey;
        secretStatus.configured.typesafeApiKey = !!values.typesafeApiKey;
        return secretStatus;
      }
      if (path === "/api/settings") { file.linearWorkspace = body.linearWorkspace; return file; }
      return false;
    },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const linear = dialog.getByRole("region", { name: "Linear integration", exact: true });
  const typesafe = dialog.getByRole("region", { name: "TypeSafe integration", exact: true });
  const key = linear.getByLabel("Linear API key", { exact: true });
  await waitFor(() => key.isEnabled(), (v) => v, "key status to load");
  assert.equal(await key.getAttribute("type"), "password");
  assert.equal(await linear.getByLabel(/Linear workspace/).inputValue(), "acme");
  assert.equal(await typesafe.getByLabel("TypeSafe API key", { exact: true }).inputValue(), "");
  assert.equal(await dialog.getByRole("checkbox").count(), 0);
  assert.equal(await dialog.getByRole("switch").count() >= 5, true);
  if (process.env.KEY_SHOTS) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      for (const size of [{ width: 1440, height: 1000, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
        await page.setViewportSize(size);
        await dialog.locator(".integration-settings").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.KEY_SHOTS}/keys-${colorScheme}-${size.name}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await key.fill("test-linear-first");
  await linear.getByRole("button", { name: "Save Linear API key", exact: true }).click();
  await linear.getByRole("button", { name: "Replace Linear API key", exact: true }).waitFor();
  assert.equal(await key.count(), 0);
  assert.ok(!(await page.content()).includes("test-linear-first"));
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await linear.getByRole("button", { name: "Replace Linear API key", exact: true }).click();
  assert.equal(await key.inputValue(), "");
  await key.fill("test-discarded-key");
  await linear.getByRole("button", { name: "Cancel replacing Linear API key", exact: true }).click();
  assert.equal(values.linearApiKey, "test-linear-first");
  await linear.getByRole("button", { name: "Replace Linear API key", exact: true }).click();
  assert.equal(await key.inputValue(), "");
  await key.fill("test-linear-replaced");
  await linear.getByRole("button", { name: "Save Linear API key", exact: true }).click();
  await linear.getByRole("button", { name: "Remove Linear API key", exact: true }).waitFor();
  await typesafe.getByLabel("TypeSafe API key", { exact: true }).fill("test-typesafe-saved");
  await typesafe.getByRole("button", { name: "Save TypeSafe API key", exact: true }).click();
  await typesafe.getByRole("button", { name: "Replace TypeSafe API key", exact: true }).waitFor();
  await linear.getByRole("button", { name: "Remove Linear API key", exact: true }).click();
  await key.waitFor();
  assert.equal(await key.inputValue(), "");
  assert.equal(values.linearApiKey, undefined);
  assert.equal(values.typesafeApiKey, "test-typesafe-saved");
  assert.deepEqual(writes, [
    { name: "linearApiKey", value: "test-linear-first" },
    { name: "linearApiKey", value: "test-linear-replaced" },
    { name: "typesafeApiKey", value: "test-typesafe-saved" },
    { name: "linearApiKey", value: null },
  ]);
  assert.ok(!(await page.content()).includes("test-typesafe-saved"));
  assert.deepEqual(file.integrations, { linear: true, typesafe: true });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Manage TypeSafe API key");
  await palette.getByRole("option", { name: /^Manage TypeSafe API key/ }).click();
  await waitFor(() => typesafe.getByRole("button", { name: "Replace TypeSafe API key", exact: true }).evaluate((el) => document.activeElement === el), (v) => v, "the key control to receive focus");
  await context.close();
});

test("an API key save failure keeps the draft available for retry", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], projects: () => [], lists: { settings: { integrations: { linear: true }, error: null } } });
  await page.route("**/api/secrets", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 400, json: { error: "Couldn't save the API key. Check secrets.json." } })
    : route.fulfill({ json: { configured: { linearApiKey: false, typesafeApiKey: false }, error: null } }));
  await page.goto(app.url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const linear = page.getByRole("region", { name: "Linear integration", exact: true });
  const key = linear.getByLabel("Linear API key", { exact: true });
  await key.fill("test-retry-key");
  await linear.getByRole("button", { name: "Save Linear API key", exact: true }).click();
  await linear.getByRole("alert").waitFor();
  assert.equal(await key.inputValue(), "test-retry-key");
  assert.equal(await linear.getByRole("button", { name: "Save Linear API key", exact: true }).isEnabled(), true);
  await context.close();
});

test("the Linear workspace is kept in settings.json, moved there from this browser", async () => {
  const context = await newContext(browser);
  // An older version kept it in the browser.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(
        "paseo-command:linear-workspace",
        JSON.stringify("acme"),
      );
      sessionStorage.setItem("seeded", "1");
    }
  });
  const page = await context.newPage();
  const file = {
    linearWorkspace: "",
    integrations: { linear: true, typesafe: false },
    error: null,
  };
  const saved: unknown[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [],
    lists: { settings: file },
    accept: (path, body) => {
      if (path !== "/api/settings") return false;
      saved.push(body);
      file.linearWorkspace = body.linearWorkspace;
      return file;
    },
  });
  await page.goto(app.url);
  await waitFor(
    () => Promise.resolve(saved.length),
    (n) => n === 1,
    "the move to settings.json",
  );
  assert.deepEqual(saved, [{ linearWorkspace: "acme" }]);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("paseo-command:linear-workspace"),
    ),
    null,
  );
  await page.getByRole("button", { name: "Settings" }).click();
  const field = page.getByRole("dialog", { name: "Settings" }).getByLabel(/Linear workspace/);
  assert.equal(await field.inputValue(), "acme");
  // A change is saved to the file, and read back from it after a reload.
  await field.fill("https://linear.app/umbrella/team");
  await field.press("Enter");
  await waitFor(
    () => Promise.resolve(saved.length),
    (n) => n === 2,
    "the change",
  );
  assert.deepEqual(saved[1], { linearWorkspace: "umbrella" });
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  assert.equal(
    await page.getByRole("dialog", { name: "Settings" }).getByLabel(/Linear workspace/).inputValue(),
    "umbrella",
  );
  assert.equal(saved.length, 2);
  await context.close();
});

test("integrations opt in explicitly, persist, and stop their controls after opt-out", async () => {
  const context = await newContext(browser);
  await context.addInitScript(`(() => {
    window.__integrationMessages = [];
    window.webkit = { messageHandlers: {
      paseoWorld: { postMessage(message) {
        if (message.type === "integrations") window.__integrationMessages.push(message);
        if (message.type === "art") setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
      } },
    } };
  })()`);
  const page = await context.newPage();
  const file = {
    linearWorkspace: "",
    integrations: { linear: false, typesafe: false },
    error: null,
  };
  const writes: any[] = [];
  let asks = 0;
  await mockApi(page, {
    agents: () => [agentRow("a1", "idle", "Optional agent")],
    projects: () => [],
    lists: { settings: file },
    accept: (path, body) => {
      if (path === "/api/settings") {
        writes.push(body);
        Object.assign(file.integrations, body.integrations);
        return file;
      }
      if (path === "/api/agents/a1/asks") {
        asks++;
        return { waiting: false, questions: [], pending: false };
      }
      return false;
    },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const linear = dialog.getByRole("switch", { name: /^Linear / });
  const typesafe = dialog.getByRole("switch", { name: /^TypeSafe / });
  await waitFor(
    () => linear.isEnabled(),
    (v) => v,
    "settings to load",
  );
  assert.equal(await linear.isChecked(), false);
  assert.equal(await typesafe.isChecked(), false);
  assert.equal(asks, 0);
  assert.equal(await dialog.getByLabel(/Linear workspace/).count(), 0);
  if (process.env.SHOT_DIR) {
    await page.screenshot({
      path: `${process.env.SHOT_DIR}/settings-desktop.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${process.env.SHOT_DIR}/settings-mobile.png`,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await linear.check();
  await dialog.getByLabel(/Linear workspace/).waitFor();
  await typesafe.check();
  await waitFor(
    () => Promise.resolve(asks),
    (n) => n > 0,
    "TypeSafe opt-in",
  );
  assert.deepEqual(writes, [
    { integrations: { linear: true } },
    { integrations: { typesafe: true } },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await waitFor(
    () => linear.isChecked(),
    (v) => v,
    "persisted opt-ins",
  );
  assert.equal(await typesafe.isChecked(), true);
  await linear.uncheck();
  await waitFor(
    () => dialog.getByLabel(/Linear workspace/).count(),
    (n) => n === 0,
    "Linear controls to hide",
  );
  await typesafe.uncheck();
  await waitFor(() => typesafe.isEnabled(), (v) => v, "opt-out to save");
  assert.deepEqual(file.integrations, {
    linear: false,
    typesafe: false,
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor();
  assert.equal(await palette.getByRole("option", { name: "Show your Linear issues", exact: true }).count(), 0);
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await search.fill("Enable Linear");
  await palette.getByRole("option", { name: /^Enable Linear/ }).click();
  await dialog.getByLabel(/Linear workspace/).waitFor();
  assert.equal(file.integrations.linear, true);
  await context.close();
});

test("a failed opt-in stays off and reports why it could not be saved", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.route("**/api/settings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 400,
          json: { error: "settings.json can't be read." },
        })
      : route.fulfill({ json: { integrations: {}, error: null } }),
  );
  await page.goto(app.url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const linear = dialog.getByRole("switch", { name: /^Linear / });
  await linear.click();
  await dialog.getByRole("alert").waitFor();
  assert.match(
    await dialog.getByRole("alert").innerText(),
    /settings.json can't be read/,
  );
  assert.equal(await linear.isChecked(), false);
  await context.close();
});

test("Slack's setup offers its app manifest: opened in Slack filled in, or copied", async () => {
  const context = await newContext(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  // What the page opens: kept here instead of a new window.
  await page.addInitScript(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await mockApi(page, {
    agents: () => [],
    projects: () => [],
    lists: {
      settings: { integrations: { slack: true }, error: null },
      secrets: { configured: { slackUserToken: false, slackAppToken: false }, error: null },
    },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const slack = page.getByRole("dialog", { name: "Settings" }).getByRole("region", { name: "Slack integration", exact: true });
  await slack.getByText("Set up a Slack app").click();
  await slack.getByRole("button", { name: "Create the app in Slack" }).click();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  assert.equal(opened.length, 1);
  const url = new URL(opened[0]);
  assert.equal(url.origin + url.pathname, "https://api.slack.com/apps");
  const manifest = JSON.parse(url.searchParams.get("manifest_json")!);
  assert.equal(manifest.settings.socket_mode_enabled, true);
  for (const scope of ["chat:write", "im:write", "search:read", "files:write"])
    assert.ok(manifest.oauth_config.scopes.user.includes(scope), scope);

  await slack.getByRole("button", { name: "Copy manifest" }).click();
  await slack.getByRole("button", { name: "Copied" }).waitFor();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.deepEqual(copied, manifest);
  await context.close();
});

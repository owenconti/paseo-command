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
    "Apple Music",
  ])
    await dialog.getByText(label, { exact: true }).waitFor();
  const radio = dialog.getByRole("checkbox", { name: /Lofi radio/ });
  assert.equal(await radio.isChecked(), false);
  assert.equal(
    await dialog.getByRole("slider", { name: "Lofi radio volume" }).isDisabled(),
    true,
  );
  await radio.check();
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
    integrations: { linear: true, typesafe: false, appleMusic: false },
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
      paseoMusic: { postMessage(message) {
        window.__integrationMessages.push({ ...message, channel: "music" });
        if (message.type === "watch" && message.on)
          window.dispatchEvent(new CustomEvent("paseo:music", { detail: { state: "closed" } }));
      } },
    } };
  })()`);
  const page = await context.newPage();
  const file = {
    linearWorkspace: "",
    integrations: { linear: false, typesafe: false, appleMusic: false },
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
  const linear = dialog.getByRole("checkbox", { name: /^Linear / });
  const typesafe = dialog.getByRole("checkbox", { name: /^TypeSafe / });
  const music = dialog.getByRole("checkbox", { name: /^Apple Music / });
  await waitFor(
    () => linear.isEnabled(),
    (v) => v,
    "settings to load",
  );
  assert.equal(await linear.isChecked(), false);
  assert.equal(await typesafe.isChecked(), false);
  assert.equal(await music.isChecked(), false);
  assert.equal(asks, 0);
  assert.equal(await dialog.getByLabel(/Linear workspace/).count(), 0);
  assert.equal(
    await page
      .getByRole("region", { name: "Apple Music", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() =>
      (window as any).__integrationMessages.some(
        (m: any) => m.channel === "music" && m.type === "watch" && m.on,
      ),
    ),
    false,
  );
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
  await music.check();
  await page
    .getByRole("region", { name: "Apple Music", exact: true })
    .waitFor();
  assert.deepEqual(writes, [
    { integrations: { linear: true } },
    { integrations: { typesafe: true } },
    { integrations: { appleMusic: true } },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await waitFor(
    () => music.isChecked(),
    (v) => v,
    "persisted opt-ins",
  );
  assert.equal(await linear.isChecked(), true);
  assert.equal(await typesafe.isChecked(), true);
  await music.uncheck();
  await waitFor(
    () =>
      page.getByRole("region", { name: "Apple Music", exact: true }).count(),
    (n) => n === 0,
    "Music to stop",
  );
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
    appleMusic: false,
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor();
  assert.equal(await palette.getByRole("option", { name: "Show your Linear issues", exact: true }).count(), 0);
  assert.equal(await palette.getByRole("option", { name: "Play or pause Apple Music", exact: true }).count(), 0);
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
  const linear = dialog.getByRole("checkbox", { name: /^Linear / });
  await linear.click();
  await dialog.getByRole("alert").waitFor();
  assert.match(
    await dialog.getByRole("alert").innerText(),
    /settings.json can't be read/,
  );
  assert.equal(await linear.isChecked(), false);
  await context.close();
});

/**
 * The panel header's gear holds the app's settings: interface sounds, the
 * lofi radio, desktop notifications and the Linear workspace. Every /api
 * request is answered in the browser; none reaches a daemon, and the radio
 * stream is answered empty.
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
    "Linear workspace",
  ])
    await dialog.getByText(label, { exact: true }).waitFor();
  const radio = dialog.getByRole("checkbox", { name: /Lofi radio/ });
  assert.equal(await radio.isChecked(), false);
  assert.equal(
    await dialog.getByRole("slider", { name: "Lofi radio volume" }).isDisabled(),
    true,
  );
  await radio.check();
  if (process.env.SHOT) await page.waitForTimeout(300), await page.screenshot({ path: process.env.SHOT });
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:music")!)),
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
      localStorage.setItem("paseo-command:linear-workspace", JSON.stringify("acme"));
      sessionStorage.setItem("seeded", "1");
    }
  });
  const page = await context.newPage();
  const file: { linearWorkspace: string; error: null } = { linearWorkspace: "", error: null };
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
  await waitFor(() => Promise.resolve(saved.length), (n) => n === 1, "the move to settings.json");
  assert.deepEqual(saved, [{ linearWorkspace: "acme" }]);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("paseo-command:linear-workspace")),
    null,
  );
  await page.getByRole("button", { name: "Settings" }).click();
  const field = page.getByRole("dialog", { name: "Settings" }).getByLabel(/Linear workspace/);
  assert.equal(await field.inputValue(), "acme");
  // A change is saved to the file, and read back from it after a reload.
  await field.fill("https://linear.app/umbrella/team");
  await field.press("Enter");
  await waitFor(() => Promise.resolve(saved.length), (n) => n === 2, "the change");
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

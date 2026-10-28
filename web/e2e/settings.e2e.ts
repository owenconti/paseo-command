/**
 * The panel header's gear holds the app's settings: interface sounds, the
 * lofi radio, desktop notifications and the Linear workspace. Every /api
 * request is answered in the browser; none reaches a daemon, and the radio
 * stream is answered empty.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { launch, mockApi, newContext, startApp } from "./harness";

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

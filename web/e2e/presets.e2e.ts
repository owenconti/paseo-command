/**
 * Preset prompts in a conversation already started: offered in the message
 * box's / menu and in ⌘K, each putting its prompt (with `{{pr}}` as the
 * workspace's pull request) in the message box to edit and send, and as
 * buttons in the bar above the message box, each sending at once.
 * Every /api request is answered in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { small } from "./fleets";

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

const PR_URL = "https://github.com/acme/atlas/pull/13";

async function open(agent = "a-done") {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const sent: any[] = [];
  // Finisher (a-done) works in Labels, whose pull request Paseo names.
  const workspaces = small.workspaces.map((w) =>
    w.workspaceId === "wks_b"
      ? { ...w, pr: { number: 13, title: "Fix the shoreline", state: "open", url: PR_URL } }
      : w,
  );
  await mockApi(page, {
    agents: () => small.agents,
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => workspaces,
    lists: {
      presets: {
        presets: [
          { name: "Review PR", prompt: "Review {{pr}} for regressions." },
          { name: "Tidy", prompt: "Tidy the README." },
        ],
        error: null,
      },
    },
    detail: (id: string) => detailOf(id, "idle"),
    accept: (path, body) => {
      if (path !== `/api/agents/${agent}/send`) return false;
      sent.push(body);
      return true;
    },
  } as never);
  await page.goto(`${app.url}?agent=${agent}`);
  const composer = page.locator("#composer");
  await composer.waitFor();
  return { page, composer, errors, sent, close: () => context.close() };
}

test("the / menu offers presets, and one fills the message box with the workspace's PR", async () => {
  const { page, composer, errors, sent, close } = await open();
  await composer.click();
  await composer.pressSequentially("/rev");
  const menu = page.getByRole("listbox", { name: "Commands, skills and presets" });
  const option = menu.getByRole("option", { name: /Review PR/ });
  await option.waitFor();
  assert.equal(await option.locator("em").textContent(), "preset");
  await page.keyboard.press("Enter");
  assert.equal(await composer.inputValue(), `Review #13 (${PR_URL}) for regressions.`);
  // It waits to be sent: edit it, then Enter.
  await page.keyboard.type(" Be brief.");
  await page.keyboard.press("Enter");
  const body = await waitFor(() => Promise.resolve(sent[0]), (b) => !!b, "the send");
  assert.equal(body.prompt, `Review #13 (${PR_URL}) for regressions. Be brief.`);
  assert.deepEqual(errors, []);
  await close();
});

test("⌘K's preset goes after what's drafted, and the message box takes the keyboard", async () => {
  const { page, composer, errors, close } = await open();
  await composer.fill("First this.");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Meta+k");
  await palette.getByRole("combobox", { name: "Search commands" }).fill("preset tidy");
  await palette.getByRole("option", { name: /Use the preset “Tidy”/ }).waitFor();
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await waitFor(() => composer.inputValue(), (v) => v === "First this.\n\nTidy the README.", "the preset in the box");
  await waitFor(() => composer.evaluate((el) => el === document.activeElement), (f) => f, "the box focused");
  assert.deepEqual(errors, []);
  await close();
});

test("the preset bar above the message box sends at once, leaving the draft", async () => {
  const { page, composer, errors, sent, close } = await open();
  await composer.fill("My own draft");
  const tray = page.getByRole("group", { name: "Preset prompts" });
  if (process.env.SHOT) await page.waitForTimeout(400), await page.locator(".session-footer").screenshot({ path: process.env.SHOT });
  await tray.getByRole("button", { name: "Review PR" }).click();
  const body = await waitFor(() => Promise.resolve(sent[0]), (b) => !!b, "the send");
  assert.equal(body.prompt, `Review #13 (${PR_URL}) for regressions.`);
  assert.equal(await composer.inputValue(), "My own draft");
  assert.deepEqual(errors, []);
  await close();
});

test("a preset naming {{pr}} waits where the workspace has no pull request", async () => {
  const { page, close } = await open("a-idle");
  const tray = page.getByRole("group", { name: "Preset prompts" });
  assert.equal(await tray.getByRole("button", { name: "Review PR" }).isDisabled(), true);
  assert.equal(await tray.getByRole("button", { name: "Tidy" }).isDisabled(), false);
  await close();
});

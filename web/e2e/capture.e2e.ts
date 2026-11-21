/**
 * Screen captures: the macOS app's send panel (`capture.html?id=`, mocked app: what it posts is kept) sends a
 * capture to an agent, or asks the app's window for New agent on a project, which opens with the capture's text and
 * contact sheet as its first message. Every /api request is answered in the browser; nothing reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { small } from "./fleets";
import { appEvent, launch, mockApi, newContext, solidPng, startApp, waitFor } from "./harness";

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

const ID = "cap-20261120-181341";
const SHEET = solidPng(160, 100);
const manifest = { id: ID, created: "2026-11-20T18:13:41Z", duration: 33, app: "Safari", width: 2560, height: 1662, frames: [{ n: 1 }, { n: 2 }], strokes: 1, clicks: 1 };
const FLEET = {
  agents: () => small.agents,
  permissions: () => [],
  hosts: () => small.hosts,
  projects: () => small.projects,
  workspaces: () => small.workspaces,
};
type Posted = { type: string; height?: number; newAgent?: { projectId: string; host?: string }; message?: string; open?: string };

async function panel(page: Page) {
  await page.addInitScript(`
    window.posted = [];
    window.webkit = { messageHandlers: { paseoCapture: { postMessage: (m) => window.posted.push(JSON.parse(JSON.stringify(m))) } } };
  `);
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  await mockApi(page, {
    ...FLEET,
    accept: (path: string, body: unknown) => {
      if (path !== `/api/captures/${ID}/send`) return false;
      sent.push({ path, body: body as Record<string, unknown> });
      return { ok: true };
    },
  } as never);
  await page.route(`**/api/captures/${ID}`, (route) => route.fulfill({ json: manifest }));
  await page.route(`**/api/captures/${ID}/sheet`, (route) => route.fulfill({ body: SHEET, contentType: "image/png" }));
  await page.goto(`${app.url}capture.html?id=${ID}`);
  await page.locator(".cap-target").first().waitFor();
  return sent;
}
const posted = (page: Page) => page.evaluate(() => (window as unknown as { posted: Posted[] }).posted);

test("the send panel sends the capture, with your message, to the agent chosen", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent = await panel(page);
  try {
    assert.match(await page.locator(".cap-meta").innerText(), /0:33 · Safari · 2 frames · 1 mark/);
    // It says how tall it is, for the app's panel.
    assert.ok((await posted(page)).some((m) => m.type === "size" && (m.height ?? 0) > 200));
    // The message box, the app's own composer, has the keyboard first.
    const composer = page.locator("#capture-composer");
    await page.waitForFunction(() => document.activeElement?.id === "capture-composer");
    await page.keyboard.type("The labels overlap here");
    assert.equal(await composer.inputValue(), "The labels overlap here");
    // Agents, then a new agent in each project.
    const titles = await page.locator(".cap-target-title").allInnerTexts();
    assert.ok(titles.includes("Idler") && titles.includes("Runner"), titles.join(", "));
    assert.ok(titles.at(-1)?.startsWith("New agent in "), titles.join(", "));
    // The search narrows; ↓ chooses; ⌘↩ sends from anywhere in the panel.
    await page.locator(".cap-search").fill("runn");
    assert.deepEqual(await page.locator(".cap-target-title").allInnerTexts(), ["Runner"]);
    assert.match(await page.locator(".cap-hint").innerText(), /joins its current turn/);
    // ⌘↩ from outside the composer sends what it holds.
    await page.locator(".cap-search").press("Meta+Enter");
    await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "the capture sent");
    assert.deepEqual(sent[0].body, { agent: "a-running", message: "The labels overlap here", behavior: "steer" });
    await page.locator(".cap-sent").waitFor();
    assert.match(await page.locator(".cap-sent").innerText(), /Sent to Runner/);
    await page.getByRole("button", { name: "Open the conversation" }).click();
    assert.ok((await posted(page)).some((m) => m.type === "app" && m.open === "a-running"));
  } finally {
    await context.close();
  }
});

test("a project in the send panel asks the app's window for New agent there; Esc closes", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent = await panel(page);
  try {
    await page.locator("#capture-composer").fill("Start on this");
    await page.locator(".cap-search").fill("new agent atlas");
    await page.locator(".cap-search").press("Enter");
    const ask = await waitFor(() => posted(page), (p) => p.some((m) => m.type === "app"), "the ask");
    assert.deepEqual(ask.find((m) => m.type === "app"), { type: "app", newAgent: { projectId: "prj_atlas" }, message: "Start on this" });
    assert.equal(sent.length, 0);
    await page.keyboard.press("Escape");
    assert.ok((await posted(page)).some((m) => m.type === "close"));
  } finally {
    await context.close();
  }
});

test("the app's window opens New agent on the project with the capture as its first message", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: Record<string, unknown>[] = [];
  await mockApi(page, {
    ...FLEET,
    accept: (path: string, body: unknown) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body as Record<string, unknown>);
      return { agentId: "a-new" };
    },
  } as never);
  const asked: string[] = [];
  await page.route(`**/api/captures/${ID}/draft?**`, (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({
      json: { prompt: "Start on this\n\n[Screen capture 0:33 · Safari · /captures/x]", image: { name: "contact-sheet.png", data: SHEET.toString("base64"), mimeType: "image/png" } },
    });
  });
  try {
    await page.goto(app.url);
    await page.locator(".crew-board").waitFor();
    await appEvent(page, "paseo:capture", { capture: ID, newAgent: { projectId: "prj_atlas" }, message: "Start on this" });
    const mission = page.locator(".new-agent #composer");
    await mission.waitFor();
    assert.equal(asked[0], "?message=Start+on+this");
    assert.match(await mission.inputValue(), /^Start on this\n\n\[Screen capture 0:33 · Safari/);
    await waitFor(() => page.locator(".new-agent .thumb").count(), (n) => n === 1, "the contact sheet attached");
    await page.locator(".new-agent").getByRole("button", { name: "Send message" }).click();
    await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
    assert.match(String(dispatched[0].prompt), /^Start on this/);
    assert.deepEqual(dispatched[0].images, [{ data: SHEET.toString("base64"), mimeType: "image/png" }]);
  } finally {
    await context.close();
  }
});

test("the panel's composer offers the chosen target's /skills, and Enter sends with a pasted image", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent = await panel(page);
  const asked: string[] = [];
  await page.route("**/api/drafts/commands?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ json: { error: null, commands: [{ name: "review-code", description: "Review the branch", argumentHint: "", kind: "skill" }] } });
  });
  try {
    await page.locator(".cap-search").fill("idler");
    const composer = page.locator("#capture-composer");
    await composer.click();
    await composer.pressSequentially("/rev");
    const option = page.locator(".cap .autocomplete [role=option]");
    await waitFor(() => option.count(), (n) => n === 1, "the matching skill");
    await composer.press("Enter");
    assert.equal(await composer.inputValue(), "/review-code ");
    const url = new URL(asked.at(-1)!);
    assert.equal(url.searchParams.get("cwd"), "/work/atlas/a", "the chosen agent's folder");
    // The composer places the caret after the skill on the next frame (faster typing than a person's would race it).
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await composer.pressSequentially("the header");
    // A pasted screenshot joins the contact sheet.
    await composer.evaluate((el, data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const paste = new DataTransfer();
      paste.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }));
    }, SHEET.toString("base64"));
    await waitFor(() => page.locator(".cap .thumb").count(), (n) => n === 1, "the pasted image");
    await composer.press("Enter");
    await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "sent from the composer");
    assert.equal(sent[0].body.agent, "a-idle");
    assert.equal(sent[0].body.message, "/review-code the header");
    assert.deepEqual(sent[0].body.images, [{ data: SHEET.toString("base64"), mimeType: "image/png" }]);
    await page.locator(".cap-sent").waitFor();
  } finally {
    await context.close();
  }
});

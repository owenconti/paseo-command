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

/** What the panel asked to have tidied, since the last `panel`. */
let tidyAsks: Record<string, unknown>[] = [];
async function panel(page: Page, shown: Record<string, unknown> = manifest, tidied: string | null = null) {
  await page.addInitScript(`
    window.posted = [];
    window.webkit = { messageHandlers: { paseoCapture: { postMessage: (m) => window.posted.push(JSON.parse(JSON.stringify(m))) } } };
  `);
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  tidyAsks = [];
  await mockApi(page, {
    ...FLEET,
    accept: (path: string, body: unknown) => {
      if (path === `/api/captures/${ID}/tidy`) {
        tidyAsks.push(body as Record<string, unknown>);
        return tidied === null ? false : { text: tidied };
      }
      if (path !== `/api/captures/${ID}/send`) return false;
      sent.push({ path, body: body as Record<string, unknown> });
      return { ok: true };
    },
  } as never);
  await page.route(`**/api/captures/${ID}`, (route) => route.fulfill({ json: shown }));
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

test("what you said shows under the sheet, and is left out when switched off", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent = await panel(page, {
    ...manifest,
    voice: true,
    transcript: [
      { t: 2, end: 3.5, text: "Make this button blue." },
      { t: 64, end: 66, text: "And move that menu over here." },
    ],
  });
  try {
    assert.match(await page.locator(".cap-meta").innerText(), /with your voice/);
    const speech = page.getByRole("region", { name: "What you said" });
    assert.deepEqual(await speech.locator("li").allInnerTexts(), ["0:02\nMake this button blue.", "1:04\nAnd move that menu over here."]);
    await page.screenshot({ path: "/tmp/capture-panel-voice.png" });
    // On by default: the send says nothing of it (the server adds it).
    await page.locator(".cap-search").fill("idler");
    await page.locator(".cap-search").press("Enter");
    await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "sent with what was said");
    assert.equal(sent[0].body.transcript, undefined);
    await context.close();
    // Switched off: the send, and New agent's ask, leave it out.
    const again = await newContext(browser);
    const second = await again.newPage();
    const sent2 = await panel(second, { ...manifest, voice: true, transcript: [{ t: 2, end: 3, text: "Hi." }] });
    await second.getByRole("checkbox", { name: "Send the timed transcript too" }).uncheck();
    await second.locator(".cap-search").fill("idler");
    await second.locator(".cap-search").press("Enter");
    await waitFor(() => Promise.resolve(sent2.length), (n) => n === 1, "sent without it");
    assert.equal(sent2[0].body.transcript, false);
    await again.close();
    const third = await newContext(browser);
    const page3 = await third.newPage();
    await panel(page3, { ...manifest, voice: true, transcript: [{ t: 2, end: 3, text: "Hi." }] });
    await page3.getByRole("checkbox", { name: "Send the timed transcript too" }).uncheck();
    await page3.locator(".cap-search").fill("new agent atlas");
    await page3.locator(".cap-search").press("Enter");
    const ask = await waitFor(() => posted(page3), (p) => p.some((m) => m.type === "app"), "the ask");
    assert.equal((ask.find((m) => m.type === "app") as Record<string, unknown>).transcript, false);
    await third.close();
  } finally {
    await context.close().catch(() => {});
  }
});

test("what you said is tidied into the message box once, and the timed transcript then stays out unless asked", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const voiced = {
    ...manifest,
    voice: true,
    transcript: [
      { t: 1, end: 1.5, text: "Hello?" },
      { t: 6, end: 9, text: "What is this, uh, can we change that to say no tabs yet?" },
    ],
  };
  const sent = await panel(page, voiced, "Can we change that to say “No tabs yet”?");
  try {
    const composer = page.locator("#capture-composer");
    await waitFor(() => composer.inputValue(), (v) => v === "Can we change that to say “No tabs yet”?", "the tidied message in the box");
    // Asked in the chosen agent's workspace.
    assert.deepEqual(tidyAsks, [{ agent: "a-running" }]);
    await page.getByText("Tidied into your message").waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "Send the timed transcript too" }).isChecked(), false);
    await page.screenshot({ path: "/tmp/capture-panel-tidied.png" });
    // Edited and sent: the message as it is now, without the timed transcript.
    await composer.press("End");
    await page.keyboard.type(" Thanks.");
    await page.locator(".cap-search").fill("idler");
    await page.locator(".cap-search").press("Enter");
    await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "sent");
    assert.deepEqual(sent[0].body, { agent: "a-idle", message: "Can we change that to say “No tabs yet”? Thanks.", transcript: false });
    // Opened again (the same capture): never asked or put in twice.
    const again = await context.newPage();
    await panel(again, voiced, "SHOULD NOT APPEAR");
    await again.waitForTimeout(300);
    assert.equal(tidyAsks.length, 0);
    assert.ok(!(await again.locator("#capture-composer").inputValue()).includes("SHOULD NOT APPEAR"));
  } finally {
    await context.close();
  }
});

test("a voice without a transcript says why", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await panel(page, { ...manifest, voice: true, transcript: [], transcriptNote: "Nothing was said" });
  try {
    await page.getByText("Your voice is in the video, without a transcript: Nothing was said.").waitFor();
    assert.equal(await page.getByRole("region", { name: "What you said" }).count(), 0);
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
    // With its model: without one the daemon lists no skills for a folder.
    assert.equal(url.searchParams.get("provider"), "claude");
    assert.equal(url.searchParams.get("model"), "opus");
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

test("a project in the panel asks for its folder's /skills with the provider's first model", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await panel(page);
  const asked: string[] = [];
  await page.route("**/api/providers/claude/models**", (route) => route.fulfill({ json: [{ id: "claude-opus-5-5", model: "Opus 5.5" }, { id: "claude-opus-5", model: "Opus 5" }] }));
  await page.route("**/api/drafts/commands?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ json: { error: null, commands: [{ name: "prep", description: "Prepare", argumentHint: "", kind: "skill" }] } });
  });
  try {
    await page.locator(".cap-search").fill("new agent atlas");
    const composer = page.locator("#capture-composer");
    await composer.click();
    await composer.pressSequentially("/pre");
    await waitFor(() => page.locator(".cap .autocomplete [role=option]").count(), (n) => n === 1, "the project's skill");
    const url = new URL(asked.at(-1)!);
    assert.equal(url.searchParams.get("cwd"), "/work/atlas");
    assert.equal(url.searchParams.get("model"), "claude-opus-5-5");
  } finally {
    await context.close();
  }
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { small } from "./fleets";
import {
  detailOf,
  launch,
  mockApi,
  newContext,
  startApp,
  waitFor,
} from "./harness";

let app: Awaited<ReturnType<typeof startApp>>, browser: Browser;
before(async () => {
  [app, browser] = await Promise.all([startApp(), launch()]);
});
after(async () => {
  await browser?.close();
  await app?.stop();
  assert.deepEqual(app?.apiHits ?? [], []);
});
const GRAPH = [
  "flowchart TD",
  'A["Module save<br/>turn changes into files"] --> B{"Head still matches?"}',
  'B -- yes --> C["Build candidate"]',
  'B -- no --> D["409: nothing written"]',
  'C --> E["Deploy"]',
].join("\n");
const fence = (source: string) => "```mermaid\n" + source + "\n```";
async function open(text: string, running = false) {
  const context = await newContext(browser),
    page = await context.newPage();
  let reply = text;
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    detail: (id: string) => detailOf(id, running ? "running" : "idle"),
    timeline: () => ({
      items: [{ kind: "assistant", id: "r1", messageId: "r1", text: reply }],
    }),
  } as never);
  await page.goto(`${app.url}?agent=${running ? "a-running" : "a-idle"}`);
  await page.locator(".msg.assistant").waitFor();
  return {
    page,
    errors,
    requests,
    setReply: (text: string) => {
      reply = text;
    },
  };
}
async function svg(page: Page, n = 0) {
  return page
    .locator(".mermaid-block .mermaid-image")
    .nth(n)
    .evaluate(async (el: HTMLImageElement) => (await fetch(el.src)).text());
}

test("Mermaid charts render, keep source/copy controls, zoom and expand with keyboard focus", async () => {
  const { page, errors } = await open(
    fence(GRAPH) +
      "\n\n" +
      fence("sequenceDiagram\nClient->>Server: Save\nServer-->>Client: Saved"),
  );
  const block = page.locator(".mermaid-block").first(),
    image = block.getByAltText("Mermaid diagram");
  await image.waitFor();
  await waitFor(
    () =>
      image.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    Boolean,
    "the SVG image decoded",
  );
  const output = await svg(page);
  const labels = await image.evaluate(async (el: HTMLImageElement) => {
    const xml = new DOMParser().parseFromString(
      await (await fetch(el.src)).text(),
      "image/svg+xml",
    );
    return [...xml.querySelectorAll("tspan")]
      .map((e) => e.textContent)
      .join(" ")
      .replace(/\s+/g, " ");
  });
  assert.match(labels, /Build candidate/);
  assert.match(labels, /Module save/);
  assert.doesNotMatch(
    output,
    /<foreignObject/i,
    "text labels work inside an isolated SVG image",
  );
  await block.getByRole("button", { name: "Source", exact: true }).click();
  assert.equal(await block.locator(".mermaid-source").innerText(), GRAPH);
  await block.getByRole("button", { name: "Copy Mermaid source" }).click();
  await block.getByRole("button", { name: "Copied", exact: true }).waitFor();
  await block.getByRole("button", { name: "Diagram", exact: true }).click();
  const width = (await image.boundingBox())!.width;
  await block
    .getByRole("button", { name: "Zoom in on Mermaid diagram" })
    .click();
  assert.ok((await image.boundingBox())!.width > width);
  await block
    .getByRole("button", { name: "Reset Mermaid diagram zoom" })
    .click();
  assert.ok(Math.abs((await image.boundingBox())!.width - width) < 2);
  const expand = block.getByRole("button", { name: "Expand Mermaid diagram" });
  await expand.click();
  const dialog = page.getByRole("dialog", { name: "Expanded Mermaid diagram" });
  await dialog.waitFor();
  await dialog
    .getByRole("button", { name: "Close expanded diagram" })
    .waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Close expanded diagram" })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await waitFor(
    () => expand.evaluate((e) => e === document.activeElement),
    Boolean,
    "focus returns to expand",
  );
  // The palette targets the diagram interacted with, rather than copying some other reply's source.
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Show Mermaid source");
  await palette.getByRole("option", { name: /Show Mermaid source/ }).click();
  await block.locator(".mermaid-source").waitFor();
  await block.getByRole("button", { name: "Diagram", exact: true }).click();
  // Theme changes regenerate the SVG, including when several diagram types coexist.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await waitFor(
    () => svg(page),
    (s) => s.includes("#e2e9f2"),
    "dark chart text",
  );
  await page.screenshot({ path: "/tmp/chat-mermaid-dark.png" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await waitFor(
    () => svg(page),
    (s) => s.includes("#29394e"),
    "light chart text",
  );
  const second = page.locator(".mermaid-block").nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.getByAltText("Mermaid diagram").waitFor();
  assert.match(await svg(page, 1), /Saved/);
  await page.screenshot({ path: "/tmp/chat-mermaid-light.png" });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("incomplete streamed fences wait, then render once closed; ordinary code stays code", async () => {
  const { page, errors, requests, setReply } = await open(
    "```ts\nconst count = 1;\n```",
    true,
  );
  await page.locator(".md-code pre").waitFor();
  assert.equal(
    requests.some((url) => /\/\.vite\/deps\/mermaid\.js/.test(url)),
    false,
    "ordinary chat does not load the chart engine",
  );
  setReply("```mermaid\nflowchart TD\nA[");
  await page
    .getByText("The diagram will appear when this code block finishes.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".mermaid-image").count(), 0);
  setReply(fence("flowchart TD\nA[Ready] --> B[Done]"));
  await page.getByAltText("Mermaid diagram").waitFor();
  assert.match(await svg(page), /Done/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("bad diagrams fall back to source, recover on updates, and cannot enable Mermaid click scripts", async () => {
  const { page, errors, setReply } = await open(
    fence("flowchart TD\nA[unclosed"),
  );
  await page.getByText(/This diagram couldn't be rendered/).waitFor();
  assert.match(
    await page.locator(".mermaid-source").innerText(),
    /A\[unclosed/,
  );
  setReply(
    fence(
      '%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart TD\nA[Safe] --> B[Done]\nclick A "javascript:window.diagramExecuted=true"',
    ),
  );
  await page.getByAltText("Mermaid diagram").waitFor();
  const markup = await svg(page);
  assert.doesNotMatch(markup, /javascript:|onclick=|<script|<foreignObject/i);
  assert.equal(
    await page.evaluate(() => (window as any).diagramExecuted),
    undefined,
  );
  assert.equal(
    await page.locator('body > div[id^="dpaseo-mermaid"]').count(),
    0,
    "temporary Mermaid DOM is cleaned up",
  );
  assert.deepEqual(errors, []);
  await page.context().close();
});

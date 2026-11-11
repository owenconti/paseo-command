import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { small } from "./fleets";
import {
  detailOf,
  launch,
  mockApi,
  newContext,
  startApp,
  waitFor,
} from "./harness";

/** Visual replies: an agent's fenced `html-render` block drawn as a sandboxed page in the chat. */
let app: Awaited<ReturnType<typeof startApp>>, browser: Browser;
before(async () => {
  [app, browser] = await Promise.all([startApp(), launch()]);
});
after(async () => {
  await browser?.close();
  await app?.stop();
  assert.deepEqual(app?.apiHits ?? [], []);
});
const fence = (html: string) => "```html-render\n" + html + "\n```";
const PAGE = `<!doctype html>
<html><head><title>Build times</title>
<style>.bar{height:300px;background:var(--chart-1);border-radius:var(--radius)}</style></head>
<body><h1 id="heading">Build times</h1><div class="bar"></div>
<p id="probe">waiting</p><p id="parent">waiting</p><p id="store">waiting</p>
<a id="link" href="https://example.test/docs">Docs</a>
<script>
  fetch("${"APP"}/api/agents").then(() => "reached", () => "blocked").then((r) => (document.getElementById("probe").textContent = r));
  try { document.getElementById("parent").textContent = String(window.parent.document.title); } catch (e) { document.getElementById("parent").textContent = "apart"; }
  try { localStorage.setItem("a", "b"); document.getElementById("store").textContent = "stored"; } catch (e) { document.getElementById("store").textContent = "no storage"; }
</script></body></html>`;

async function open(text: string, running = false, items?: unknown[]) {
  const context = await newContext(browser),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    detail: (id: string) => detailOf(id, running ? "running" : "idle"),
    timeline: () => ({
      items: items ?? [{ kind: "assistant", id: "r1", messageId: "r1", text }],
    }),
  } as never);
  await page.goto(`${app.url}?agent=${running ? "a-running" : "a-idle"}`);
  await page.locator(".msg.assistant").first().waitFor();
  return { page, errors };
}

test("an html-render block shows as a themed page in a frame kept apart from the app", async () => {
  const { page, errors } = await open(
    fence(PAGE.replace("APP", app.url.replace(/\/$/, ""))) + "\n\nThe slowest step is the bundle.",
  );
  const block = page.locator(".visual-block"),
    frameEl = block.locator("iframe"),
    frame = block.frameLocator("iframe");
  await frame.locator("#heading").waitFor();
  // No banner over the page: it is named for assistive tech, and its controls show on hover.
  assert.equal(await block.locator(".mermaid-toolbar").count(), 0);
  assert.equal(await block.getAttribute("aria-label"), "Visual reply: Build times");
  // Sandboxed without the app's origin; only https and inline resources.
  const sandbox = (await frameEl.getAttribute("sandbox")) ?? "";
  assert.match(sandbox, /allow-scripts/);
  assert.doesNotMatch(sandbox, /allow-same-origin|allow-top-navigation|allow-forms/);
  await waitFor(() => frame.locator("#probe").innerText(), (t) => t !== "waiting", "the page's request settled");
  assert.equal(await frame.locator("#probe").innerText(), "blocked");
  assert.equal(await frame.locator("#parent").innerText(), "apart");
  assert.equal(await frame.locator("#store").innerText(), "no storage");
  // The app's theme reaches the page as CSS variables.
  const colours = await frame.locator("html").evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.getPropertyValue("--background"), bar: getComputedStyle(document.querySelector(".bar")!).backgroundColor };
  });
  const panel = await block.evaluate((el) => getComputedStyle(el).getPropertyValue("--panel").trim());
  assert.equal(colours.background.trim(), panel);
  assert.notEqual(colours.bar, "rgba(0, 0, 0, 0)");
  // The frame fits its page: no inner scrolling.
  await waitFor(
    async () => (await frameEl.boundingBox())!.height,
    (h) => h > 330,
    "the frame grew to its page",
  );
  const fit = await frame.locator("html").evaluate((el) => el.scrollHeight - el.clientHeight);
  assert.ok(fit <= 1, `page fits its frame (${fit})`);
  // Links leave for a new tab, never the frame.
  assert.equal(await frame.locator("#link").evaluate((a: HTMLAnchorElement) => (a.click(), a.target)), "");
  // HTML and back, from the corner's buttons.
  await block.hover();
  await block.getByRole("button", { name: "Show the page’s HTML" }).click();
  assert.match(await block.locator(".mermaid-source").innerText(), /<title>Build times<\/title>/);
  await block.getByRole("button", { name: "Show the page", exact: true }).click();
  await frame.locator("#heading").waitFor();
  // Zoom (⌘K) lays the page out narrower and draws it larger.
  const width = await frame.locator("html").evaluate((el) => el.clientWidth);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Zoom in on the visual reply");
  await page.getByRole("option", { name: /Zoom in on the visual reply/ }).click();
  await waitFor(
    () => frame.locator("html").evaluate((el) => el.clientWidth),
    (w) => w < width,
    "zoomed in",
  );
  // Full screen, closed with Esc; the palette names its actions.
  await block.getByRole("button", { name: "Expand visual reply" }).click();
  const dialog = page.getByRole("dialog", { name: "Visual reply: Build times" });
  await dialog.frameLocator("iframe").locator("#heading").waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await block.hover();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("visual reply");
  await page.getByRole("option", { name: /Expand the visual reply/ }).waitFor();
  await page.getByRole("option", { name: /Show the visual reply’s HTML/ }).waitFor();
  await page.keyboard.press("Escape");
  // The written reply stays ordinary Markdown beside it.
  assert.match(await page.locator(".msg.assistant").innerText(), /The slowest step is the bundle\./);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("a page still streaming in waits for its closing fence, and an html block stays code", async () => {
  const { page } = await open("```html-render\n<!doctype html>\n<p id='x'>Half", true);
  const block = page.locator(".visual-block");
  await block.locator(".mermaid-status").waitFor();
  assert.match(await block.locator(".mermaid-status").innerText(), /will appear when this code block finishes/);
  assert.equal(await block.locator("iframe").count(), 0);
  await page.context().close();

  const plain = await open("```html\n<!doctype html>\n<p>Sample</p>\n```");
  await plain.page.locator(".md-code").waitFor();
  assert.equal(await plain.page.locator(".visual-block").count(), 0);
  await plain.page.context().close();
});

test("a page that navigates itself away is stopped", async () => {
  const { page } = await open(
    fence(`<!doctype html><p id="here">Here</p><script>setTimeout(() => { location.href = "https://example.test/away"; }, 300);</script>`),
  );
  await page.route("https://example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p id='elsewhere'>Elsewhere</p>" }),
  );
  const block = page.locator(".visual-block");
  await block.locator(".visual-left").waitFor();
  assert.match(await block.locator(".visual-left").innerText(), /tried to go to another address/);
  assert.equal(await block.locator("iframe").count(), 0);
  await page.context().close();
});

test("a page published with the html_render tool is read from its host and drawn in the tool call's place", async () => {
  const ID = "9ae04a72a56db06b5729ed41";
  const { page, errors } = await open("", false, [
    { kind: "tool", id: "t1", name: "Read", status: "completed", summary: "data.csv", detail: "" },
    { kind: "tool", id: "t2", name: "mcp__paseo__html_render", status: "completed", summary: "Build times", detail: "", visual: { page: ID, title: "Build times" } },
    { kind: "assistant", id: "r1", messageId: "r1", text: "Tests are the slowest step." },
  ]);
  const asked: string[] = [];
  let fail = true;
  await page.route("**/api/visual**", (route) => {
    asked.push(new URL(route.request().url()).search);
    if (fail) return route.fulfill({ status: 502, json: { error: "The host took too long to answer." } });
    return route.fulfill({
      json: { id: ID, title: "Build times", html: `<!doctype html><title>Other</title><h1 id="heading">Published</h1><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">` },
    });
  });
  await page.reload();
  const block = page.locator(".visual-block");
  // A read that fails says so, and can be asked again.
  await block.locator(".visual-left").waitFor();
  assert.match(await block.locator(".visual-left").innerText(), /couldn’t be shown: The host took too long to answer\./);
  fail = false;
  await block.getByRole("button", { name: "Try again" }).click();
  await block.frameLocator("iframe").locator("#heading").waitFor();
  assert.deepEqual([...new Set(asked)], [`?id=${ID}`]);
  // Named by the tool call, not the page's own <title>; the same frame as a fenced page's.
  assert.equal(await block.getAttribute("aria-label"), "Visual reply: Build times");
  assert.doesNotMatch((await block.locator("iframe").getAttribute("sandbox")) ?? "", /allow-same-origin/);
  // It isn't also listed among the steps.
  assert.equal(await page.locator(".step.tool").count(), 1);
  assert.match(await page.locator(".msg.assistant").last().innerText(), /Tests are the slowest step\./);
  assert.deepEqual(errors, []);
  await page.context().close();
});

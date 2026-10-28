/**
 * Adding a project from the Projects tab: browse the host's folders, then
 * register one, make a new one or clone a GitHub repo there; the new
 * project's first agent is drafted next. Every /api request is answered in
 * the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
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

/** A small folder tree under /home/me, answered as `GET /api/folders` does. */
const TREE: Record<string, string[]> = {
  "/": ["home"],
  "/home": ["me"],
  "/home/me": ["code", "notes"],
  "/home/me/code": ["atlas", "rocket"],
  "/home/me/code/atlas": [],
  "/home/me/code/rocket": [],
  "/home/me/notes": [],
};
async function folders(page: Page, asked: string[] = []) {
  await page.route("**/api/folders?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const path = url.searchParams.get("path") || "/home/me";
    const names = TREE[path];
    if (!names)
      return route.fulfill({ status: 400, json: { error: "ENOENT" } });
    return route.fulfill({
      json: {
        path,
        parent: path === "/" ? null : path.replace(/\/[^/]+$/, "") || "/",
        home: "/home/me",
        folders: names.map((name) => ({
          name,
          path: `${path === "/" ? "" : path}/${name}`,
        })),
      },
    });
  });
}

async function open(page: Page, accept: (path: string, body: any) => any) {
  const projects: any[] = [
    { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/home/me/code/atlas" },
  ];
  await mockApi(page, {
    agents: () => [],
    projects: () => projects,
    accept: (path, body) => {
      const r = accept(path, body);
      if (r?.projectId)
        projects.push({ projectId: r.projectId, name: r.name, kind: "git", path: r.path });
      return r;
    },
  });
  await folders(page);
  await page.goto(`${app.url}?tab=Projects`);
  await page.getByRole("button", { name: "Add project" }).click();
  const panel = page.locator(".add-project");
  await panel.getByRole("button", { name: "code", exact: true }).waitFor();
  return panel;
}

test("an existing folder is browsed to and added, then its first agent drafted", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent: any[] = [];
  const panel = await open(page, (path, body) => {
    if (path !== "/api/projects/add") return false;
    sent.push(body);
    return { projectId: "prj_rocket", name: "rocket", path: body.path };
  });
  // Home first, then into code: atlas is already a project.
  await panel.getByRole("button", { name: "code", exact: true }).click();
  await panel.getByRole("button", { name: "rocket", exact: true }).waitFor();
  assert.equal(
    await panel.locator(".folder-row", { hasText: "atlas" }).locator(".badge").textContent(),
    "project",
  );
  // A registered folder can't be added again.
  await panel.locator(".folder-row", { hasText: "atlas" }).click();
  await panel.locator(".form-hint", { hasText: "already a project" }).waitFor();
  assert.ok(await panel.getByRole("button", { name: "Add project" }).isDisabled());
  // Back up by the breadcrumb, into rocket, and add it.
  await panel.locator(".folder-crumbs").getByRole("button", { name: "code" }).click();
  await panel.getByRole("button", { name: "rocket", exact: true }).click();
  await panel.locator(".form-hint code", { hasText: "/home/me/code/rocket" }).waitFor();
  await panel.getByRole("button", { name: "Add project" }).click();
  await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "the add");
  assert.deepEqual(sent[0], { path: "/home/me/code/rocket" });
  // The New agent view opens on the new project.
  const where = page.locator(".new-agent select[name=target]");
  await waitFor(() => where.inputValue(), (v) => v === "p:prj_rocket", "the new project chosen");
  await context.close();
});

test("a new folder is made in the open folder", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent: any[] = [];
  const panel = await open(page, (path, body) => {
    if (path !== "/api/projects/create-folder") return false;
    sent.push(body);
    return { projectId: "prj_fresh", name: "fresh", path: `${body.parent}/${body.name}` };
  });
  await panel.getByRole("radio", { name: "New folder" }).click();
  await panel.getByRole("button", { name: "code", exact: true }).click();
  await panel.getByRole("button", { name: "rocket", exact: true }).waitFor();
  const create = panel.getByRole("button", { name: "Create & add" });
  assert.ok(await create.isDisabled());
  await panel.locator("input[name=folder-name]").fill("fresh");
  await panel.locator(".form-hint code", { hasText: "/home/me/code/fresh" }).waitFor();
  await create.click();
  await waitFor(() => Promise.resolve(sent.length), (n) => n === 1, "the create");
  assert.deepEqual(sent[0], { parent: "/home/me/code", name: "fresh" });
  await page.locator(".new-agent").waitFor();
  await context.close();
});

test("a GitHub repo is cloned into the open folder; a failure is shown", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const sent: any[] = [];
  let fail = true;
  const panel = await open(page, (path, body) => {
    if (path !== "/api/projects/clone") return false;
    sent.push(body);
    if (fail) {
      fail = false;
      return false; // refused: answered 403 with an error
    }
    return { projectId: "prj_rocket2", name: "rocket", path: `${body.parent}/rocket` };
  });
  await panel.getByRole("radio", { name: "Clone from GitHub" }).click();
  await panel.locator("input[name=repo]").fill("https://github.com/acme/rocket.git");
  await panel.locator(".form-hint code", { hasText: "/home/me/rocket" }).waitFor();
  await panel.getByRole("button", { name: "Clone & add" }).click();
  await panel.locator("[role=alert]").waitFor();
  // Still in the form, and it can be tried again.
  await panel.getByRole("button", { name: "Clone & add" }).click();
  await waitFor(() => Promise.resolve(sent.length), (n) => n === 2, "the retry");
  assert.deepEqual(sent[1], {
    parent: "/home/me",
    repo: "https://github.com/acme/rocket.git",
  });
  await page.locator(".new-agent").waitFor();
  await context.close();
});

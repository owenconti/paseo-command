/**
 * Captures the landing page's product shots (web/landing/shots/) from the real
 * app against an illustrative fixture fleet. Every /api request is answered in
 * the browser; none reaches a daemon. Run: npx tsx e2e/landing-shots.ts
 */
import { fileURLToPath } from "node:url";
import { agentRow, launch, mockApi, newContext, sleep, startApp, waitFor } from "./harness";

const OUT = fileURLToPath(new URL("../landing/shots/", import.meta.url));
const MINI = "srv_macmini";
const hosts = [
  { serverId: "srv_local", label: "Studio", status: "online", local: true, state: "online" },
  { serverId: MINI, label: "macmini", status: "online", local: false, state: "online" },
];
const projects = [
  { projectId: "prj_storefront", name: "storefront", kind: "git", path: "/work/storefront" },
  { projectId: "prj_api", name: "billing-api", kind: "git", path: "/work/billing-api" },
  { projectId: "prj_docs", name: "docs", kind: "git", path: "/work/docs" },
  { projectId: "prj_infra", name: "infra", kind: "git", path: "/srv/infra", host: MINI },
];
const ws = (id: string, projectId: string, name: string, host?: string) => ({
  workspaceId: id,
  projectId,
  project: projectId.slice(4),
  name,
  isolation: "local",
  cwd: `/work/${projectId.slice(4)}/${id}`,
  branch: "main",
  ...(host ? { host } : {}),
});
const workspaces = [
  ws("wks_cart", "prj_storefront", "Checkout flow"),
  ws("wks_search", "prj_storefront", "Search filters"),
  ws("wks_img", "prj_storefront", "Image pipeline"),
  ws("wks_inv", "prj_api", "Invoices"),
  ws("wks_hooks", "prj_api", "Webhooks"),
  ws("wks_guides", "prj_docs", "Guides"),
  ws("wks_deploy", "prj_infra", "Deploy", MINI),
  ws("wks_metrics", "prj_infra", "Metrics", MINI),
];
const CODEX = { provider: "codex/gpt-6.1-sol" };
const agent = (id: string, status: string, name: string, workspaceId: string, extra = {}) => ({
  ...agentRow(id, status, name),
  workspaceId,
  cwd: workspaces.find((w) => w.workspaceId === workspaceId)!.cwd,
  ...extra,
});
const agents = [
  agent("a1", "running", "Cart totals", "wks_cart"),
  agent("a2", "running", "Coupon rules", "wks_cart", CODEX),
  agent("a3", "idle", "Address form", "wks_cart"),
  agent("a4", "idle", "Facet counts", "wks_search", { unread: true }),
  agent("a5", "running", "Thumbnails", "wks_img", CODEX),
  agent("a6", "idle", "Invoice PDFs", "wks_inv"),
  agent("a7", "running", "Retry queue", "wks_hooks"),
  agent("a8", "error", "Signature check", "wks_hooks", CODEX),
  agent("a9", "idle", "Quickstart", "wks_guides", { unread: true }),
  agent("a10", "running", "Terraform plan", "wks_deploy", { host: MINI }),
  agent("a11", "idle", "Alert rules", "wks_metrics", { host: MINI, ...CODEX }),
];
const permissions = [
  { id: "p1", agentId: "a6", name: "Bash", description: "npm run migrate" },
  { id: "p2", agentId: "a11", name: "AskUserQuestion", description: "Which channel?", kind: "question" },
];

const app = await startApp();
const browser = await launch();
try {
  for (const world of ["atlas", "galaxy"]) {
    const context = await newContext(browser);
    await context.addInitScript(
      (w) => localStorage.setItem("paseo-command:phaser-world-kind", JSON.stringify(w)),
      world,
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await mockApi(page, {
      agents: () => agents,
      permissions: () => permissions,
      hosts: () => hosts,
      projects: () => projects,
      workspaces: () => workspaces,
    });
    await page.goto(app.url);
    await waitFor(
      () => page.evaluate(() => (window as any).paseoWorld?.inspect?.()?.agents?.length),
      (n) => n === agents.length,
      `the ${world} world to draw every agent`,
      60000,
    );
    await page.getByRole("tab", { name: /^Agents/ }).click().catch(() => {});
    await sleep(2500);
    await page.screenshot({ path: `${OUT}${world}.jpg`, quality: 86 });
    if (world === "atlas")
      await page.screenshot({
        path: `${OUT}atlas-island.jpg`,
        quality: 86,
        clip: { x: 470, y: 180, width: 640, height: 660 },
      });
    await context.close();
  }
} finally {
  await browser.close();
  await app.stop();
}

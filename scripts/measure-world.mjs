#!/usr/bin/env node
/**
 * Measures a headed Chrome's renderer and GPU process CPU for a world,
 * idle and while panning/zooming, against the mocked fleets in
 * web/e2e/fleets.ts. A Chrome window opens (not headless), so its process
 * model matches what a user sees; nothing here reaches a daemon.
 *
 *   npm run app:measure -- --path / --fleet large [--seconds-idle 30 --seconds-pan 10]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockApi, newContext, startApp } from "../web/e2e/harness.ts";
import { large, small } from "../web/e2e/fleets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPORT = join(ROOT, "docs/superpowers/measurements/dom-atlas.md");
// This script lives outside web/, so Node's ESM resolver won't walk into
// web/node_modules for a bare "playwright" import (as app-server.mjs
// already works around for "vite"): load it from there directly.
const { chromium } = await import(
  new URL("../web/node_modules/playwright/index.mjs", import.meta.url)
);

function parseArgs(argv) {
  const args = { path: "/", fleet: "small", secondsIdle: 30, secondsPan: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") args.path = argv[++i];
    else if (a === "--fleet") args.fleet = argv[++i];
    else if (a === "--seconds-idle") args.secondsIdle = Number(argv[++i]);
    else if (a === "--seconds-pan") args.secondsPan = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.fleet !== "small" && args.fleet !== "large")
    throw new Error(`--fleet must be small or large, got ${args.fleet}`);
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pids of Chrome's current renderer and GPU processes, from the
 * browser's own CDP `SystemInfo.getProcessInfo` (type: "renderer" / "GPU").
 * `browser.process()` isn't available in this Playwright version, and
 * walking `ps`'s pid/ppid tree from a root pid is unreliable on macOS
 * (Chrome's helper processes don't always chain back to it that way); CDP
 * reports the pids Chrome itself tracks, directly and exactly.
 */
async function processIds(cdp) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const byType = (type) => processInfo.filter((p) => p.type === type).map((p) => p.id);
  return { renderer: byType("renderer"), gpu: byType("GPU") };
}

/** `ps`'s instantaneous %CPU for each pid in `pids` (0 for one it can't see,
 * e.g. between a respawn and this sample). */
function cpuOf(pids) {
  if (!pids.length) return 0;
  const out = execFileSync("ps", ["-o", "pid=,%cpu=", "-p", pids.join(",")], {
    encoding: "utf8",
  });
  const byPid = new Map(
    out
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\s+([\d.]+)\s*$/))
      .filter((m) => m !== null)
      .map((m) => [Number(m[1]), Number(m[2])]),
  );
  return pids.reduce((total, pid) => total + (byPid.get(pid) ?? 0), 0);
}

/** Chrome's renderer and GPU process CPU% right now (summed if there are
 * several of either, as there usually are more than one renderer). */
async function sampleCpu(cdp) {
  const { renderer, gpu } = await processIds(cdp);
  return { renderer: cpuOf(renderer), gpu: cpuOf(gpu) };
}

/**
 * Samples CPU every second for `seconds`, running `drive` (if given)
 * alongside the sampling, and returns the average renderer/GPU CPU% over
 * the run.
 */
async function measure(cdp, seconds, drive) {
  const samples = [];
  const end = Date.now() + seconds * 1000;
  const sampler = (async () => {
    while (Date.now() < end) {
      samples.push(await sampleCpu(cdp));
      await sleep(1000);
    }
  })();
  await Promise.all([sampler, drive ? drive(seconds * 1000) : Promise.resolve()]);
  const avg = (key) => samples.reduce((total, s) => total + s[key], 0) / (samples.length || 1);
  return { renderer: avg("renderer"), gpu: avg("gpu") };
}

/** Drags 600px back and forth and wheels in and out, continuously, for `ms`. */
async function pan(page, ms) {
  const end = Date.now() + ms;
  const cx = 720;
  const cy = 450;
  while (Date.now() < end) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 600, cy, { steps: 15 });
    await page.mouse.move(cx, cy, { steps: 15 });
    await page.mouse.up();
    await page.mouse.wheel(0, -240);
    await page.mouse.wheel(0, 240);
  }
}

function appendReport(row) {
  mkdirSync(dirname(REPORT), { recursive: true });
  if (!existsSync(REPORT))
    writeFileSync(
      REPORT,
      "# DOM Atlas CPU/GPU measurements\n\n" +
        "## Phaser baseline\n\n" +
        "path | fleet | idle renderer% | idle gpu% | pan renderer% | pan gpu%\n" +
        "--- | --- | --- | --- | --- | ---\n",
    );
  appendFileSync(REPORT, `${row}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fleet = args.fleet === "large" ? large : small;
  const app = await startApp();
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    await mockApi(page, {
      agents: () => fleet.agents,
      permissions: () => fleet.permissions,
      hosts: () => fleet.hosts,
      projects: () => fleet.projects,
      workspaces: () => fleet.workspaces,
    });
    const url = new URL(args.path, app.url).toString();
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.paseoWorld?.inspect?.()), undefined, {
      timeout: 30000,
    });

    const cdp = await browser.newBrowserCDPSession();

    console.log(`Measuring the ${args.fleet} fleet at ${url}`);
    console.log(`Idle for ${args.secondsIdle}s...`);
    const idle = await measure(cdp, args.secondsIdle);
    console.log(`  renderer ${idle.renderer.toFixed(1)}%  gpu ${idle.gpu.toFixed(1)}%`);
    console.log(`Panning and zooming for ${args.secondsPan}s...`);
    const panned = await measure(cdp, args.secondsPan, (ms) => pan(page, ms));
    console.log(`  renderer ${panned.renderer.toFixed(1)}%  gpu ${panned.gpu.toFixed(1)}%`);

    const row = [
      args.path,
      args.fleet,
      idle.renderer.toFixed(1),
      idle.gpu.toFixed(1),
      panned.renderer.toFixed(1),
      panned.gpu.toFixed(1),
    ].join(" | ");
    console.log(row);
    appendReport(row);
  } finally {
    await browser.close();
    await app.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

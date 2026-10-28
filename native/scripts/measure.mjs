#!/usr/bin/env node
/**
 * Measures the native app's CPU and GPU cost with the SpriteKit Atlas on a
 * mocked fleet (`native:mock`; nothing reaches a daemon). The method follows
 * `scripts/measure-world.mjs` on `dom-atlas`: after a settle period, each
 * phase's CPU is the processes' cumulative CPU time (`ps -o time=`) over the
 * phase's wall time, so load spikes and `ps`'s decaying %cpu don't leak in.
 *
 * Processes: the app (SpriteKit renders in it), WebKit's web content and GPU
 * processes for its page, and WindowServer (shared by the whole screen, so
 * read against the baseline). GPU: the Apple GPU's "Device Utilization %"
 * from `ioreg`, sampled each second, system-wide; a baseline phase with the
 * app closed shows what the rest of the machine adds.
 *
 * The app runs as a background accessory (`--background`), so it never takes
 * focus. Its window must still be on screen and visible for the numbers to
 * mean anything: off the active Space, macOS stops SpriteKit's display link
 * and WebKit throttles the page (check the "SpriteKit fps", "page rAF/s" and
 * "window visible" columns before trusting a row).
 *
 *   node native/scripts/measure.mjs [--fleet large] [--rounds 3] [--settle 20] [--idle 30] [--pan 10]
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP = join(ROOT, "native/build/Paseo Command.app");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const fleet = option("fleet", "large");
const rounds = Number(option("rounds", "3"));
const settle = Number(option("settle", "20"));
const idle = Number(option("idle", "30"));
const pan = Number(option("pan", "10"));
const port = Number(option("port", "4339"));
const report = option("report", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = join(tmpdir(), "paseo-native-measure.json");
const base = info.replace(/\.json$/, "");

function cpuTimes(pids) {
  const out = new Map();
  if (!pids.length) return out;
  let text = "";
  try {
    text = execFileSync("ps", ["-o", "pid=,time=", "-p", pids.join(",")], { encoding: "utf8" });
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/);
    if (m) out.set(Number(m[1]), Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]));
  }
  return out;
}
const windowServer = Number(execFileSync("pgrep", ["-x", "WindowServer"], { encoding: "utf8" }).trim().split("\n")[0]);
function gpuUtilization() {
  try {
    const text = execFileSync("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"], { encoding: "utf8" });
    const m = text.match(/"Device Utilization %"=(\d+)/);
    return m ? Number(m[1]) : NaN;
  } catch {
    return NaN;
  }
}
/** Each process's share of one core over a phase, and the GPU's mean utilization. */
async function phase(pids, seconds, during) {
  const all = [...Object.values(pids), windowServer];
  const before = cpuTimes(all);
  const start = performance.now();
  const samples = [];
  const sampler = setInterval(() => samples.push(gpuUtilization()), 1000);
  if (during) during();
  await sleep(seconds * 1000);
  clearInterval(sampler);
  const after = cpuTimes(all);
  const wall = (performance.now() - start) / 1000;
  const share = (pid) => (pid && before.has(pid) && after.has(pid) ? (100 * (after.get(pid) - before.get(pid))) / wall : NaN);
  const result = { windowServer: share(windowServer), gpuUtil: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length) };
  for (const [name, pid] of Object.entries(pids)) result[name] = share(pid);
  return result;
}

function evalPage(js) {
  writeFileSync(`${base}.js`, js);
  rmSync(`${base}.out`, { force: true });
  execFileSync("notifyutil", ["-p", "com.paseo.command.native.eval"]);
}
async function readOut(timeout = 5000) {
  for (let t = 0; t < timeout; t += 200) {
    if (existsSync(`${base}.out`)) return readFileSync(`${base}.out`, "utf8");
    await sleep(200);
  }
  return "";
}
async function launch() {
  rmSync(info, { force: true });
  execFileSync("open", ["-g", "-n", APP, "--args", "--url", `http://127.0.0.1:${port}/`, "--background", "--ignore-occlusion", "--size", "1440x900", "--info", info]);
  for (let t = 0; t < 60000; t += 500) {
    await sleep(500);
    if (!existsSync(info)) continue;
    evalPage("return !!window.paseoAtlas?.inspect?.()?.agents?.length");
    if ((await readOut(2000)).trim() === "true") break;
  }
  execFileSync("notifyutil", ["-p", "com.paseo.command.native.info"]);
  await sleep(500);
  return JSON.parse(readFileSync(info, "utf8"));
}
async function quit() {
  execFileSync("notifyutil", ["-p", "com.paseo.command.native.quit"]);
  await sleep(2000);
}
const state = async () => {
  execFileSync("notifyutil", ["-p", "com.paseo.command.native.info"]);
  await sleep(1000);
  return JSON.parse(readFileSync(info, "utf8"));
};

if (!existsSync(APP)) throw new Error("Build the app first: npm run native:build");
const server = spawn(join(ROOT, "web/node_modules/.bin/tsx"), [join(ROOT, "native/scripts/mock-fleet.ts"), "--fleet", fleet, "--port", String(port)], { stdio: "inherit" });
await sleep(3000);
const rows = [];
try {
  for (let round = 1; round <= rounds; round++) {
    // The rest of the machine, with the app closed.
    const quiet = await phase({}, idle);
    rows.push({ round, variant: "baseline (app closed)", idle: quiet, pan: null });
    console.log(JSON.stringify(rows.at(-1)));
    {
      const launched = await launch();
      await sleep(settle * 1000);
      const s0 = await state();
      const idlePhase = await phase(launched.pids, idle);
      const s1 = await state();
      const panPhase = await phase(launched.pids, pan, () => execFileSync("notifyutil", ["-p", "com.paseo.command.native.pan"]));
      const s2 = await state();
      // The page's own frame rate (requestAnimationFrame).
      evalPage("const t0 = performance.now(); let n = 0; await new Promise(r => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return n / 2;");
      const pageFps = Number(await readOut(5000));
      rows.push({
        round,
        variant: "native Atlas (SpriteKit)",
        idle: idlePhase,
        pan: panPhase,
        visible: s0.visible && s1.visible && s2.visible,
        pageFps,
        spriteKitFps: { idle: (s1.framesDrawn - s0.framesDrawn) / idle, pan: (s2.framesDrawn - s1.framesDrawn) / pan },
      });
      console.log(JSON.stringify(rows.at(-1)));
      await quit();
    }
  }
} finally {
  server.kill();
}

const f = (n) => (Number.isFinite(n) ? n.toFixed(1) : "–");
const sum = (p) => (p ? (p.app ?? 0) + (p.webContent ?? 0) + (p.gpu ?? 0) : NaN);
const lines = [
  `### ${new Date().toISOString().slice(0, 16)} · fleet ${fleet} · settle ${settle} s · idle ${idle} s · pan ${pan} s`,
  "",
  "CPU is % of one core (cumulative CPU time over the phase). App = the app process (SpriteKit draws in it); WebContent and WebKit GPU = its page's processes; total = those three. WindowServer and GPU utilization are system-wide.",
  "",
  "round | variant | phase | app | WebContent | WebKit GPU | total | WindowServer | GPU util % | SpriteKit fps | page rAF/s | window visible",
  "--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---",
];
for (const r of rows)
  for (const [name, p] of [["idle", r.idle], ["pan", r.pan]]) {
    if (!p) continue;
    const fps = r.spriteKitFps ? f(r.spriteKitFps[name]) : "–";
    lines.push(
      `${r.round} | ${r.variant} | ${name} | ${f(p.app)} | ${f(p.webContent)} | ${f(p.gpu ?? NaN)} | ${f(sum(p))} | ${f(p.windowServer)} | ${f(p.gpuUtil)} | ${fps} | ${f(r.pageFps ?? NaN)} | ${r.visible ?? "–"}`,
    );
  }
console.log(lines.join("\n"));
if (report) appendFileSync(report, "\n" + lines.join("\n") + "\n");

#!/usr/bin/env node
/** Detached app preview, listening on all network interfaces. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'web');
const runtime = join(tmpdir(), `paseo-command-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`);
const stateFile = `${runtime}.json`;
const logFile = `${runtime}.log`;

/** The newest change to what the server process itself runs: its API code,
 * the Vite config and dependencies, and this launcher. The page's build
 * (web/dist) is read on each request, so a new one needs no restart. */
function sourcesStamp() {
  let newest = 0;
  const visit = (path) => {
    let info;
    try { info = statSync(path); } catch { return; }
    if (info.isDirectory()) {
      for (const name of readdirSync(path)) if (name !== 'node_modules' && !name.includes('.test.')) visit(join(path, name));
    } else newest = Math.max(newest, info.mtimeMs);
  };
  for (const path of [join(web, 'server'), join(web, 'vite.config.ts'), join(web, 'package.json'), join(web, 'package-lock.json'), script]) visit(path);
  return newest;
}
function readState() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; }
}
function isRunning(state) {
  if (!state || !Number.isInteger(state.pid) || state.pid <= 1 || !state.token) return false;
  try {
    process.kill(state.pid, 0);
    const command = execFileSync('ps', ['-p', String(state.pid), '-o', 'command='], { encoding: 'utf8' });
    return command.includes(script) && command.includes(state.token);
  } catch { return false; }
}
function removeState() { try { unlinkSync(stateFile); } catch {} }
function show(state) {
  console.log(`Listening on 0.0.0.0:${state.port}`);
  console.log(`Paseo Command: http://127.0.0.1:${state.port}`);
  const addresses = new Set(Object.values(networkInterfaces()).flat().filter((info) => info && !info.internal && info.family === 'IPv4').map((info) => info.address));
  for (const address of addresses) console.log(`Network: http://${address}:${state.port}`);
  console.log(`PID: ${state.pid}\nLog: ${logFile}`);
}
async function stop(state) {
  if (!isRunning(state)) { removeState(); console.log('Paseo Command is not running under this launcher.'); return; }
  process.kill(state.pid, 'SIGTERM');
  for (let i = 0; i < 100 && isRunning(state); i++) await delay(100);
  if (isRunning(state)) throw new Error(`Process ${state.pid} is still stopping. Check ${logFile}.`);
  removeState();
  console.log('Paseo Command stopped.');
}

async function serve() {
  const settings = JSON.parse(process.argv[3]);
  const { preview } = await import(new URL('../web/node_modules/vite/dist/node/index.js', import.meta.url));
  const server = await preview({ root: web, configFile: join(web, 'vite.config.ts'), preview: { host: '0.0.0.0', port: settings.port, strictPort: true } });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await server.close(); process.exit(0); }
    catch (error) { console.error(error); process.exit(1); }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.httpServer.once('close', () => {
    if (readState()?.token === settings.token) removeState();
  });
  process.send?.({ ready: true });
  process.disconnect?.();
  console.log(`Paseo Command listening on 0.0.0.0:${settings.port}`);
}
async function start(settings) {
  if (!existsSync(join(web, 'dist/index.html'))) throw new Error('No app build found. Run npm run app:build first.');
  const fd = openSync(logFile, 'a', 0o600);
  let child;
  try { child = spawn(process.execPath, [script, '--serve', JSON.stringify(settings)], { cwd: web, detached: true, stdio: ['ignore', fd, fd, 'ipc'], env: process.env }); }
  finally { closeSync(fd); }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Startup timed out. Check ${logFile}.`)); }, 15000);
    const fail = (error) => { clearTimeout(timeout); reject(error); };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Preview exited (${code}). Check ${logFile}; port ${settings.port} may already be in use.`)));
    child.once('message', (message) => { if (message.ready) { clearTimeout(timeout); resolve(); } });
  });
  const state = { ...settings, pid: child.pid, sources: settings.sources };
  try { writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); }
  catch (error) { child.kill('SIGTERM'); throw error; }
  child.unref();
  return state;
}
async function main() {
  const [action = 'start', ...args] = process.argv.slice(2);
  if (action === '--serve') return serve();
  if (args.includes('--help') || action === '--help') {
    console.log('npm run app:start [-- --port 4310]\nnpm run app:restart [-- --port 4310]\nnpm run app:refresh\nnpm run app:stop\nnpm run app:status\n\napp:refresh restarts the server only when its own code changed since it started.\n\nThe app binds to 0.0.0.0 (all network interfaces).\nRun from your own terminal to keep the server independent of agent process cleanup.');
    return;
  }
  if (!['start', 'stop', 'restart', 'refresh', 'status'].includes(action)) throw new Error(`Unknown action: ${action}`);
  const previous = readState();
  if (action === 'stop') return stop(previous);
  if (action === 'status') {
    if (isRunning(previous)) show(previous);
    else { console.log('Paseo Command is not running under this launcher.'); process.exitCode = 1; }
    return;
  }
  let port = previous?.port ?? 4310;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]);
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be between 1024 and 65535.');
  if (action === 'start' && isRunning(previous)) {
    if (previous.port !== port || previous.bind !== '0.0.0.0') throw new Error('The app is already running with different settings. Use npm run app:restart with the desired options.');
    console.log('Already running.'); show(previous); return;
  }
  const sources = sourcesStamp();
  if (action === 'refresh' && isRunning(previous)) {
    if (previous.port === port && previous.sources >= sources) { console.log('Up to date.'); return; }
    console.log('The server changed; restarting it.');
  }
  if (action === 'restart' || action === 'refresh') await stop(previous);
  const settings = { token: randomUUID(), port, bind: '0.0.0.0', sources };
  const state = await start(settings);
  show(state);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

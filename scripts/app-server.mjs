#!/usr/bin/env node
/** Detached local preview. Tailscale remains an explicit, tailnet-only opt-in. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'web');
const runtime = join(tmpdir(), `paseo-command-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`);
const stateFile = `${runtime}.json`;
const logFile = `${runtime}.log`;

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
function tailnetHost(value) {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) throw new Error('Use a hostname without a scheme, path or port for PASEO_COMMAND_TAILNET_HOST.');
  return host;
}
function tailscale(args) {
  const binary = process.env.PASEO_COMMAND_TAILSCALE_BIN || 'tailscale';
  try { return execFileSync(binary, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) {
    if (error.code === 'ENOENT' && !process.env.PASEO_COMMAND_TAILSCALE_BIN && existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale')) {
      try { return execFileSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
      catch (fallback) { error = fallback; }
    }
    throw new Error(`tailscale ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}
function tailnetSettings(port) {
  const status = JSON.parse(tailscale(['status', '--json']));
  if (status.BackendState !== 'Running' || !status.Self?.DNSName) throw new Error('Connect Tailscale on this machine before starting with --tailscale.');
  const host = tailnetHost(status.Self.DNSName);
  const address = `${host}:8443`;
  const target = `http://127.0.0.1:${port}`;
  const config = JSON.parse(tailscale(['serve', 'status', '--json'])) || {};
  if (config.AllowFunnel?.[address]) throw new Error(`Funnel is enabled on ${address}; choose a private Serve endpoint before using --tailscale.`);
  const listener = config.Web?.[address];
  const proxy = listener?.Handlers?.['/']?.Proxy?.replace(/\/$/, '');
  if ((config.TCP?.['8443'] || listener) && proxy !== target) throw new Error('Tailscale port 8443 is already serving something else. Its configuration was left unchanged.');
  return { host, target, url: `https://${address}` };
}
function show(state) {
  console.log(`Paseo Command: http://127.0.0.1:${state.port}`);
  if (state.tailnetUrl) console.log(`Tailnet: ${state.tailnetUrl}`);
  else if (state.host) console.log(`Allowed Tailscale hostname: ${state.host} (configure tailscale serve separately)`);
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
  // All origin checks are loaded after this value is set, including the API.
  if (settings.host) process.env.PASEO_COMMAND_TAILNET_HOST = settings.host;
  else delete process.env.PASEO_COMMAND_TAILNET_HOST;
  const { preview } = await import(new URL('../web/node_modules/vite/dist/node/index.js', import.meta.url));
  const server = await preview({ root: web, configFile: join(web, 'vite.config.ts'), preview: { host: '127.0.0.1', port: settings.port, strictPort: true } });
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
  console.log(`Paseo Command listening on http://127.0.0.1:${settings.port}`);
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
  const state = { ...settings, pid: child.pid };
  try { writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); }
  catch (error) { child.kill('SIGTERM'); throw error; }
  child.unref();
  return state;
}
async function main() {
  const [action = 'start', ...args] = process.argv.slice(2);
  if (action === '--serve') return serve();
  if (args.includes('--help') || action === '--help') {
    console.log('npm run app:start [-- --tailscale] [-- --port 4310]\nnpm run app:restart [-- --tailscale]\nnpm run app:stop\nnpm run app:status\n\n--tailscale enables private Tailscale Serve on HTTPS port 8443.\nRun from your own terminal to keep the server independent of agent process cleanup.');
    return;
  }
  if (!['start', 'stop', 'restart', 'status'].includes(action)) throw new Error(`Unknown action: ${action}`);
  const previous = readState();
  if (action === 'stop') return stop(previous);
  if (action === 'status') {
    if (isRunning(previous)) show(previous);
    else { console.log('Paseo Command is not running under this launcher.'); process.exitCode = 1; }
    return;
  }
  let port = previous?.port ?? 4310;
  let useTailscale = action === 'restart' && previous?.useTailscale === true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tailscale') useTailscale = true;
    else if (args[i] === '--port') port = Number(args[++i]);
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be between 1024 and 65535.');
  // Inspect before touching a running app or changing a Tailscale route.
  const tailnet = useTailscale ? tailnetSettings(port) : null;
  const host = tailnet?.host || (process.env.PASEO_COMMAND_TAILNET_HOST ? tailnetHost(process.env.PASEO_COMMAND_TAILNET_HOST) : action === 'restart' ? previous?.host : undefined);
  if (action === 'start' && isRunning(previous)) {
    if (previous.port !== port || previous.host !== host || previous.useTailscale !== useTailscale) throw new Error('The app is already running with different settings. Use npm run app:restart with the desired options.');
    console.log('Already running.'); show(previous); return;
  }
  if (action === 'restart') await stop(previous);
  const settings = { token: randomUUID(), port, host, useTailscale, ...(tailnet ? { tailnetUrl: tailnet.url } : {}) };
  const state = await start(settings);
  if (tailnet) {
    try { console.log(tailscale(['serve', '--bg', '--https=8443', tailnet.target])); }
    catch (error) { await stop(state); throw error; }
  }
  show(state);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { allowedOrigin } from "./api/http";
import { readSettings, settingsFile } from "./settings";
import { TAILNET, resetTailnet, setTailnet, startTailnet, tailnetOrigin, tailnetStatus } from "./tailnet";

const DNS = "owens-mac.tail1234.ts.net";
const ME = "owen@example.com";
const SITE = `${DNS}:4310`;
const ORIGIN = `https://${SITE}`;
const real = TAILNET.run;
let calls: string[][];
let served: Record<string, unknown>;

function fakeTailscale(options: { owner?: string; state?: string } = {}) {
  calls = [];
  served = {};
  TAILNET.run = async (args) => {
    calls.push(args);
    if (args[0] === "status")
      return JSON.stringify({
        BackendState: options.state ?? "Running",
        Self: { DNSName: `${DNS}.`, UserID: 7 },
        User: { "7": { LoginName: options.owner ?? ME } },
      });
    if (args.join(" ") === "serve status --json") return JSON.stringify(served);
    if (args[0] === "serve" && args.includes("--bg")) {
      served = { TCP: { "4310": { HTTPS: true } }, Web: { [SITE]: { Handlers: { "/": { Proxy: args.at(-1) } } } } };
      return "";
    }
    if (args.join(" ") === "serve --https=4310 off") {
      served = {};
      return "";
    }
    throw new Error(`unexpected tailscale ${args.join(" ")}`);
  };
}

const viaTailscale = (login: string | undefined, host = SITE) => ({
  headers: { host, "x-forwarded-for": "100.64.0.9", ...(login ? { "tailscale-user-login": login } : {}) },
  socket: { remoteAddress: "127.0.0.1" },
});

beforeEach(() => {
  process.env.PASEO_COMMAND_FLAVOR = "release";
  rmSync(settingsFile(), { force: true });
  resetTailnet(4310);
});
afterEach(() => {
  TAILNET.run = real;
  resetTailnet();
  delete process.env.PASEO_COMMAND_FLAVOR;
});

test("only the release app offers access over Tailscale", async () => {
  process.env.PASEO_COMMAND_FLAVOR = "dev";
  fakeTailscale();
  assert.equal(tailnetStatus().available, false);
  await assert.rejects(setTailnet(true), /Only the installed Paseo Command/);
  assert.deepEqual(calls, []);
});

test("on, Tailscale serves the app and only your own login is let in, through it", async () => {
  fakeTailscale();
  // Off: a forwarded request is never taken for a local one.
  assert.equal(allowedOrigin(viaTailscale(ME, "127.0.0.1:4310")), null);
  assert.equal(allowedOrigin(viaTailscale(ME)), null);

  const status = await setTailnet(true);
  assert.deepEqual(status, { available: true, enabled: true, url: ORIGIN, owner: ME });
  assert.deepEqual(calls.at(-1), ["serve", "--bg", "--yes", "--https=4310", "http://127.0.0.1:4310"]);
  assert.deepEqual(readSettings()?.tailnet, { enabled: true });

  assert.equal(allowedOrigin(viaTailscale(ME)), ORIGIN);
  assert.equal(allowedOrigin(viaTailscale("OWEN@example.com")), ORIGIN);
  assert.equal(allowedOrigin(viaTailscale("someone@example.com")), null, "another login");
  assert.equal(allowedOrigin(viaTailscale(undefined)), null, "a tagged device has no login");
  assert.equal(allowedOrigin(viaTailscale(ME, "127.0.0.1:4310")), null, "a forwarded request asking for localhost");
  assert.equal(allowedOrigin(viaTailscale(ME, "evil.example:4310")), null, "another name");
  assert.equal(allowedOrigin({ ...viaTailscale(ME), socket: { remoteAddress: "100.64.0.9" } }), null, "not from Tailscale's proxy");
  // This Mac's own requests are as before.
  assert.equal(allowedOrigin({ headers: { host: "127.0.0.1:4310" }, socket: { remoteAddress: "127.0.0.1" } }), "http://127.0.0.1:4310");

  // Off: Tailscale stops serving it, and nobody is let in.
  await setTailnet(false);
  assert.deepEqual(calls.at(-1), ["serve", "--https=4310", "off"]);
  assert.deepEqual(served, {});
  assert.equal(tailnetOrigin(viaTailscale(ME).headers), null);
  assert.deepEqual(readSettings()?.tailnet, { enabled: false });
});

test("a port another server has on the tailnet is left alone", async () => {
  fakeTailscale();
  served = { TCP: { "4310": { HTTPS: true } }, Web: { [SITE]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } } };
  await assert.rejects(setTailnet(true), /already served by something else/);
  assert.equal(calls.some((c) => c.includes("--bg")), false);
  assert.equal(tailnetStatus().enabled, false);
  assert.match(tailnetStatus().error ?? "", /already served/);
});

test("a tagged Mac or a disconnected Tailscale lets nobody in", async () => {
  fakeTailscale({ owner: "tagged-devices" });
  await assert.rejects(setTailnet(true), /tagged device/);
  fakeTailscale({ state: "Stopped" });
  await assert.rejects(setTailnet(true), /isn't connected/);
  assert.equal(tailnetOrigin(viaTailscale(ME).headers), null);
});

test("left on, it's served again as the app's server starts", async () => {
  fakeTailscale();
  await setTailnet(true);
  resetTailnet();
  served = {};
  await startTailnet(4310);
  assert.equal(tailnetStatus().enabled, true);
  assert.deepEqual(calls.at(-1), ["serve", "--bg", "--yes", "--https=4310", "http://127.0.0.1:4310"]);
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import WebSocket from "ws";
import { fleet, install, serve } from "../fake-daemon";

const { network, local } = fleet();
let server: Awaited<ReturnType<typeof serve>>;
let uninstall: () => void;
before(async () => {
  uninstall = install(network);
  server = await serve();
});
after(async () => {
  await server.close();
  uninstall();
});

test("HTTP rejects rebinding hosts even with a matching Origin or no Origin", async () => {
  const before = local.calls.length;
  for (const origin of [undefined, "http://rebind.example"]) {
    // Node's fetch may replace Host; use an actual raw HTTP Host override.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${server.url}/api/dispatch`, {
        method: "POST",
        headers: {
          host: "rebind.example",
          "content-type": "application/json",
          ...(origin ? { origin } : {}),
        },
      }, response => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ prompt: "This must never reach the daemon" }));
    });
    assert.equal(status, 403);
  }
  assert.equal(local.calls.length, before);
});

test("HTTP rejects cross-origin and cross-site requests but admits local reads", async () => {
  const cases: Record<string, string>[] = [
    { origin: "https://untrusted.example" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const headers of cases) {
    const response = await fetch(`${server.url}/api/settings`, { headers });
    assert.equal(response.status, 403);
    await response.text();
  }
  const response = await fetch(`${server.url}/api/settings`);
  assert.equal(response.status, 200);
  await response.text();
});

test("both WebSocket endpoints reject rebinding hosts before contacting a daemon", async () => {
  const before = local.calls.length;
  for (const path of ["ws", "terminal?id=unused"]) {
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`${server.url.replace("http", "ws")}/api/${path}`, {
        headers: { host: "rebind.example", origin: "http://rebind.example" },
      });
      ws.on("error", reject);
      ws.once("open", () => { ws.terminate(); reject(new Error("Untrusted socket was admitted")); });
      ws.once("unexpected-response", (request, response) => {
        response.resume();
        request.destroy();
        resolve(response.statusCode!);
      });
    });
    assert.equal(status, 403);
  }
  assert.equal(local.calls.length, before);
});

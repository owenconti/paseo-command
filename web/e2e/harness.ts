/**
 * Browser test harness. Starts this app's Vite server on a free port and a
 * fixture image server, and drives Chrome with every /api request answered by
 * the test: nothing reaches the Paseo daemon, and any non-GET is refused.
 */
import { createServer as createHttp, type Server } from "node:http";
import { createServer as createNet } from "node:net";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "playwright";
import { createServer, type ViteDevServer } from "vite";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNet();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export async function startApp(): Promise<{
  url: string;
  stop: () => Promise<void>;
  /** /api requests that reached the server (every one should be mocked). */
  apiHits: string[];
}> {
  const apiHits: string[] = [];
  // Second safety net: the test server's own API can't reach the daemon
  // either. Every CLI call fails, and the SDK needs the CLI to find it.
  process.env.PASEO_COMMAND_CLI = "/usr/bin/false";
  // Nor does it keep PR labels: the labeller would write to a daemon.
  process.env.PASEO_COMMAND_PR_LABELS = "off";
  const server: ViteDevServer = await createServer({
    root: ROOT,
    configFile: `${ROOT}vite.config.ts`,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      hmr: false,
      // Transform the whole app before the first page asks for it, so a cold
      // start cannot time a test out.
      warmup: { clientFiles: ["./src/main.tsx"] },
    },
    plugins: [
      {
        name: "e2e-api-tripwire",
        enforce: "pre",
        configureServer(s) {
          // The browser answers every API request itself; one that gets
          // here anyway is recorded (the suites assert none did) and refused,
          // never handled.
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith("/api/")) return next();
            apiHits.push(`${req.method} ${req.url}`);
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "e2e: the fixture server answers no API requests",
              }),
            );
          });
        },
      },
    ],
  });
  await server.listen();
  await server.warmupRequest("/src/main.tsx");
  let warmupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      server.waitForRequestsIdle(),
      new Promise<void>((resolve) => {
        warmupTimer = setTimeout(resolve, 90000);
      }),
    ]);
  } finally {
    clearTimeout(warmupTimer);
  }
  return {
    url: server.resolvedUrls!.local[0],
    stop: () => server.close(),
    apiHits,
  };
}

export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

/** A real, decodable PNG of one colour. */
export function solidPng(width: number, height: number, rgb = [53, 103, 230]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export const PNG = solidPng(4, 3);
export const BIG_PNG = solidPng(640, 480);
export function bombPng() {
  const b = Buffer.alloc(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.write("IHDR", 12);
  b.writeUInt32BE(100000, 16);
  b.writeUInt32BE(100000, 20);
  return b;
}

export type Hit = {
  path: string;
  cookie: string | null;
  referer: string | null;
  /** Body bytes written before the connection ended. */
  sent: number;
  /** Milliseconds until the connection closed (undefined while open). */
  closedAfter?: number;
  /** Whether the whole body was sent. */
  complete: boolean;
};

/** Image fixtures on another port, recording each request. */
export async function startImages(): Promise<{
  base: string;
  hits: Hit[];
  stop: () => Promise<void>;
}> {
  const hits: Hit[] = [];
  const cors = { "Access-Control-Allow-Origin": "*" };
  const png = { ...cors, "content-type": "image/png" };
  const server: Server = createHttp((req, res) => {
    const path = new URL(req.url || "/", "http://x").pathname;
    const hit: Hit = {
      path,
      cookie: req.headers.cookie ?? null,
      referer: req.headers.referer ?? null,
      sent: 0,
      complete: false,
    };
    hits.push(hit);
    const start = Date.now();
    res.on("close", () => (hit.closedAfter ??= Date.now() - start));
    const send = (status: number, headers: object, body: Buffer | string) => {
      hit.sent = Buffer.byteLength(body);
      hit.complete = true;
      res.writeHead(status, headers as never).end(body);
    };
    if (path.startsWith("/good")) return send(200, png, PNG);
    if (path.startsWith("/delayed")) {
      setTimeout(() => !res.destroyed && send(200, png, BIG_PNG), 1500);
      return;
    }
    if (path === "/nocors.png")
      return send(200, { "content-type": "image/png" }, PNG);
    if (path === "/bomb.png") return send(200, png, bombPng());
    if (path === "/page.png")
      return send(200, png, "<html>not an image</html>");
    if (path === "/redirect.png")
      return send(302, { ...cors, location: "/good-redirected.png" }, "");
    if (path === "/slow-big.png") {
      // Declares 12 MiB and trickles it out: only cancellation stops it early.
      const total = 12 * 1024 * 1024;
      res.writeHead(200, { ...png, "content-length": String(total) });
      const timer = setInterval(() => {
        if (res.destroyed || hit.sent >= total) {
          clearInterval(timer);
          hit.complete = hit.sent >= total;
          return void res.end();
        }
        const chunk = Buffer.alloc(128 * 1024);
        if (!hit.sent) chunk.set(PNG.subarray(0, 33));
        hit.sent += chunk.length;
        res.write(chunk);
      }, 40);
      return;
    }
    send(404, cors, "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    stop: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export type Fleet = {
  agents: () => unknown[];
  /** Agent detail; throw to answer 500 (a daemon outage). */
  detail?: (id: string) => unknown;
  timeline?: (id: string) => unknown;
  permissions?: () => unknown[];
  /** Instead of none: answered over HTTP and pushed alike. */
  projects?: () => unknown[];
  workspaces?: () => unknown[];
  hosts?: () => unknown[];
  /** Delay before refusing a command (to inspect optimistic UI). */
  refuseAfterMs?: number;
  /** Fixture answers for the other list routes (projects, workspaces, hosts…). */
  lists?: Record<string, unknown>;
  /** Answers for an agent's other routes (commands, files, github…);
   *  undefined falls back to the defaults. */
  routes?: (id: string, sub: string, url: URL) => unknown;
  /**
   * Commands this test answers itself (still never reaching the server):
   * return true to answer 200, after recording what it needs.
   */
  accept?: (
    path: string,
    body: any,
  ) => boolean | object | Promise<boolean | object>;
};

const BASIC: Record<string, unknown> = {
  projects: [],
  workspaces: [],
  providers: [
    {
      provider: "claude",
      label: "Claude",
      status: "available",
      defaultMode: "default",
    },
  ],
  status: {
    localDaemon: "running",
    connectedDaemon: "reachable",
    daemonVersion: "test",
    hostname: "test",
  },
  hosts: [],
  usage: [],
  profiles: [],
  releases: { installed: "test", releases: [] },
};

/**
 * A timeline as the API answers it: every row has an id and the daemon's
 * position (`seq`) and version (`last`), which rises whenever the row
 * changes (the browser merges by them), in one epoch, complete for its
 * range. Rows a test gives without them get them by position.
 */
const versions = new Map<string, { json: string; last: number }>();
let version = 0;
function timelineOf(agentId: string, t: any) {
  const items: any[] = Array.isArray(t?.items) ? t.items : [];
  const rows = items.map((item, i) => {
    const key = `${agentId}:${item.id ?? i}`;
    const json = JSON.stringify(item);
    let v = versions.get(key);
    if (!v || v.json !== json)
      versions.set(key, (v = { json, last: ++version }));
    return {
      id: `e2e-${i + 1}`,
      seq: i + 1,
      ...item,
      last: item.last ?? v.last,
    };
  });
  return {
    epoch: "e2e",
    from: 0,
    to: Math.max(version, rows.length),
    hasOlder: false,
    asOf: Math.max(version, rows.length),
    ...t,
    items: rows,
  };
}

/** Answers every /api request for a page from `fleet`; refuses non-GETs. */
export async function mockApi(
  target: Page | BrowserContext,
  fleet: Fleet,
  refused: string[] = [],
) {
  await target.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() !== "GET") {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        // Uploads aren't JSON.
      }
      // A test may hold its answer back (a request whose reply never comes):
      // when the page closes meanwhile, the request is aborted here, so it
      // can't go anywhere else.
      let page: Page | undefined;
      try {
        page = req.frame().page();
      } catch {
        // Not from a page.
      }
      const closed = new Promise<"closed">((resolve) => {
        if (!page || page.isClosed()) return resolve("closed");
        page.once("close", () => resolve("closed"));
      });
      const answer = await Promise.race([
        Promise.resolve(fleet.accept?.(u.pathname, body)),
        closed,
      ]);
      if (answer === "closed") return route.abort().catch(() => {});
      // An object is the answer's body.
      if (answer)
        return route
          .fulfill({ json: answer === true ? {} : answer })
          .catch(() => {});
      refused.push(`${req.method()} ${u.pathname}`);
      if (fleet.refuseAfterMs) await sleep(fleet.refuseAfterMs);
      return route.fulfill({ status: 403, json: { error: "refused by test" } });
    }
    const parts = u.pathname.replace(/^\/api\//, "").split("/");
    if (parts[0] === "agents" && parts.length === 1)
      return route.fulfill({ json: fleet.agents() });
    if (parts[0] === "permissions")
      return route.fulfill({ json: fleet.permissions?.() ?? [] });
    if (parts[0] === "agents") {
      const [, id, sub] = parts;
      if (!sub) {
        if (!fleet.detail)
          return route.fulfill({ status: 404, json: { error: "Not found" } });
        let body: unknown;
        try {
          body = fleet.detail(id);
        } catch {
          return route.fulfill({ status: 500, json: { error: "daemon down" } });
        }
        return route.fulfill({ json: body });
      }
      const custom = fleet.routes?.(id, sub, u);
      if (custom !== undefined) return route.fulfill({ json: custom });
      if (sub === "timeline")
        return route.fulfill({ json: timelineOf(id, fleet.timeline?.(id)) });
      if (sub === "config")
        return route.fulfill({
          json: {
            provider: "claude",
            model: "opus",
            thinking: null,
            mode: null,
            features: [],
          },
        });
      if (sub === "commands") return route.fulfill({ json: [] });
      if (sub === "github")
        return route.fulfill({ json: { items: [], error: null } });
      if (sub === "files") return route.fulfill({ json: { entries: [] } });
      return route.fulfill({ json: [] });
    }
    if (fleet.lists && parts[0] in fleet.lists)
      return route.fulfill({ json: fleet.lists[parts[0]] });
    if (
      parts.length === 1 &&
      (parts[0] === "projects" ||
        parts[0] === "workspaces" ||
        parts[0] === "hosts") &&
      fleet[parts[0]]
    )
      return route.fulfill({ json: fleet[parts[0]]!() });
    if (parts[0] in BASIC) return route.fulfill({ json: BASIC[parts[0]] });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await mockLive(target, fleet);
}

/**
 * The tab's live connection (`/api/ws`, src/live.ts) answered from the same
 * `fleet`: the whole fleet as a reset when it connects, and again whenever
 * what `fleet` answers changes. Sessions aren't pushed here: a watch is
 * answered "not live", so the session reads (and polls) through the routes
 * above, as it does whenever its stream is down.
 *
 * Tests count `fleet.agents()` calls as the tab's observations, so the
 * mock reads the fleet only when it can deliver: every quarter second, while
 * the page reports that its JavaScript runs (a frozen page reads nothing,
 * as a polling one wouldn't).
 */
async function mockLive(target: Page | BrowserContext, fleet: Fleet) {
  // The page reports in while its JavaScript runs (a paused page can't).
  // Context-wide mocks can't tell pages apart, so they always deliver.
  let heard = Date.now();
  const page = "evaluate" in target ? target : undefined;
  if (page) {
    await page.exposeBinding("__e2eAlive", () => {
      heard = Date.now();
    });
    await page.addInitScript(() =>
      setInterval(() => (window as any).__e2eAlive?.(), 200),
    );
  }
  await target.routeWebSocket("**/api/ws", (ws) => {
    const snapshot = () => {
      // Each host's rows in that host's group, as the server pushes them.
      // (Hosts form one group, "", as src/live.ts files them.)
      const local = (rows: unknown, hosts = false) => {
        const groups: Record<string, unknown[]> = hosts
          ? { "": [] }
          : { local: [] };
        for (const row of Array.isArray(rows) ? rows : []) {
          const host = hosts ? "" : (row as { host?: string })?.host || "local";
          (groups[host] ??= []).push(row);
        }
        return groups;
      };
      return JSON.stringify({
        event: "reset",
        data: {
          data: {
            agents: local(fleet.agents()),
            permissions: local(fleet.permissions?.() ?? []),
            projects: local(
              fleet.projects?.() ?? fleet.lists?.projects ?? BASIC.projects,
            ),
            workspaces: local(
              fleet.workspaces?.() ??
                fleet.lists?.workspaces ??
                BASIC.workspaces,
            ),
            hosts: local(
              fleet.hosts?.() ?? fleet.lists?.hosts ?? BASIC.hosts,
              true,
            ),
          },
          revs: {},
          status: fleet.lists?.status ?? BASIC.status,
          statusRev: 0,
        },
      });
    };
    let open = true;
    let sent = "";
    const responsive = () => !page || Date.now() - heard < 600;
    const tick = () => {
      if (!open) return;
      if (responsive()) {
        const next = snapshot();
        if (next !== sent) {
          sent = next;
          try {
            ws.send(next);
          } catch {
            open = false;
          }
        }
      }
      if (open) setTimeout(tick, 250);
    };
    tick();
    ws.onMessage((raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type === "watch")
        ws.send(
          JSON.stringify({
            event: "session",
            data: { sid: msg.sid, event: "state", data: { live: false } },
          }),
        );
    });
    // Stops with the socket, or with its page or context (which can close
    // without the socket being seen to).
    const stop = () => {
      open = false;
    };
    ws.onClose(stop);
    (target as Page).once("close", stop);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until `ok(value)`; throws (with the last value) if it never is, so a
 * wait can't silently pass.
 */
export async function waitFor<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v)) {
    if (Date.now() > end)
      throw new Error(
        `Timed out waiting for ${what}; last: ${JSON.stringify(v)}`,
      );
    await sleep(150);
    v = await read();
  }
  return v;
}

/** Checks that `ok(value)` holds throughout `ms` ("nothing more happens"). */
export async function holds<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  ms: number,
): Promise<T> {
  const end = Date.now() + ms;
  let v = await read();
  for (;;) {
    if (!ok(v))
      throw new Error(`${what} stopped holding: ${JSON.stringify(v)}`);
    if (Date.now() > end) return v;
    await sleep(200);
    v = await read();
  }
}

/**
 * Records notifications instead of showing them. Init scripts are strings:
 * functions compiled by tsx carry helpers that don't exist in the page.
 */
export const STUB_NOTIFICATIONS = `(() => {
  window.__notes = [];
  window.__bodies = [];
  const N = function (title, options) {
    window.__notes.push(title + " [" + ((options && options.tag) || "") + "]");
    window.__bodies.push((options && options.body) || "");
    this.close = () => {};
  };
  N.permission = "granted";
  N.requestPermission = async () => "granted";
  window.Notification = N;
})();`;

export const isoNow = () => new Date().toISOString();

export const agentRow = (
  id: string,
  status: string,
  name = "Fixture agent",
) => ({
  id,
  shortId: id.slice(0, 7),
  name,
  provider: "claude/opus",
  status,
  cwd: `/tmp/${id}`,
  created: "1 minute ago",
});

export const detailOf = (
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  Id: id,
  Name: "Fixture agent",
  Provider: "claude",
  Model: "opus",
  Status: status,
  Mode: "default",
  Cwd: `/tmp/${id}`,
  CreatedAt: isoNow(),
  UpdatedAt: isoNow(),
  LastUserMessageAt: null,
  AttentionTimestamp: null,
  PendingPermissions: [],
  LastUsage: null,
  Worktree: null,
  ...extra,
});

export async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  // Safety net: an /api request no page mocks is aborted here, so nothing a
  // test does can reach the server's real daemon connection.
  await context.route("**/api/**", (route) => route.abort());
  // Likewise the live connection: unless a test answers it, it is closed.
  await context.routeWebSocket("**/api/ws", (ws) => ws.close());
  await context.addInitScript(STUB_NOTIFICATIONS);
  return context;
}

/**
 * A same-origin page that isn't the app (locks and storage are per origin;
 * the app would detect and announce events itself). Vite answers unknown
 * paths with index.html, so the document is supplied here instead.
 */
export async function blankPage(context: BrowserContext, url: string) {
  const page = await context.newPage();
  const blank = `${url}__e2e-blank`;
  await page.route(blank, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>blank</title>",
    }),
  );
  await page.goto(blank);
  return page;
}

export async function openSession(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByText(name).first().click();
  await page.waitForSelector(".msg.assistant, .msg.user");
}

export const notesOf = async (...pages: Page[]) =>
  (
    await Promise.all(
      pages.map((p) =>
        p.isClosed()
          ? Promise.resolve([] as string[])
          : p.evaluate(() => (window as any).__notes as string[]),
      ),
    )
  ).flat();

/**
 * Closes a menu or dialog with Escape. A tooltip showing over it takes the
 * first press (that's all the press does), so this presses until it's gone.
 */
export async function escapeFrom(page: Page, selector: string) {
  for (let i = 0; i < 3 && (await page.locator(selector).count()); i++) {
    await page.keyboard.press("Escape");
    await sleep(50);
  }
}

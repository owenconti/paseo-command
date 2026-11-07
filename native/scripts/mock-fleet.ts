/**
 * Serves the built web app (web/dist) with a mocked Paseo API, for running
 * the native app (or a browser) against the e2e fleets without any daemon:
 * every read is answered from `web/e2e/fleets.ts`, as the e2e harness's
 * `mockApi` answers it, and every mutation is refused. The live socket
 * pushes the whole fleet once, as `mockApi`'s does.
 *
 *   npm run native:mock -- [--fleet small|large|dungeon|village|sparse] [--dungeon] [--village] [--map islands|overworld|dungeon|village] [--port 4331] [--pr-flags]
 *
 * `--pr-flags` labels the first three workspaces with PR status labels, so
 * their flags show. `--probe` labels the first five, and gives each a Probe
 * verdict (one of each state), so each shows a Probe medallion; the
 * second's and fourth's PRs have auto-merge on, so their poles wear its seal.
 * `--village` (or `--fleet village`) serves the Village's concept fleet (one host, four projects,
 * every PR tile, six robots) and opens the map as the Village (`?map=village`).
 * `--dungeon` (or `--fleet dungeon`) serves the Dungeon Board's concept fleet (three hosts with
 * their loads), and the address it prints opens the map as the Dungeon Board (`?map=dungeon`);
 * `--map <style>` prints one that opens another style.
 * `--asking <agent ids>` (comma-joined) answers those idle agents' asks as waiting on you (turn TypeSafe on with
 * `--integrations typesafe` so the page asks), so their robots show "reply waits on you". `--offline <server id>`
 * takes that host offline (its rows stale), as a daemon gone quiet reports.
 * `--stats` gives each host a load for its banner (the first one's disk nearly full).
 * `--integrations github,linear` turns those integrations on in `GET /api/settings`, so the mode
 * bar shows their tabs (their own reads stay unmocked).
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DUNGEON_STATS, SPARSE_ISSUES, SPARSE_PRS, SPARSE_STATS, VILLAGE_ISSUES, VILLAGE_PRS, VILLAGE_STATS, dungeon, large, small, sparse, village } from "../../web/e2e/fleets.ts";
// `ws` lives in web/node_modules, beside the app it serves.
const { WebSocketServer } = createRequire(new URL("../../web/package.json", import.meta.url))("ws") as typeof import("ws");

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const fleetName = args.includes("--dungeon") ? "dungeon" : args.includes("--village") ? "village" : option("fleet", "large");
const fleet = fleetName === "small" ? small : fleetName === "dungeon" ? dungeon : fleetName === "village" ? village : fleetName === "sparse" ? sparse : large;
const port = Number(option("port", "4331"));
const asking = new Set(option("asking", "").split(",").filter(Boolean));
const offline = option("offline", "");
if (offline) {
  for (const h of fleet.hosts) if (h.serverId === offline) Object.assign(h, { status: "offline", state: "offline" });
  for (const a of fleet.agents) if (a.host === offline) a.stale = true;
}
if (args.includes("--pr-flags")) {
  const labels = [["CI running", "Awaiting review"], ["CI green", "Approved"], ["CI failing", "Changes requested"]];
  fleet.workspaces.slice(0, 3).forEach((w, i) => Object.assign(w, { labels: labels[i] }));
}
/** `GET /api/probe`'s answer, keyed `<host>:<workspaceId>`. */
const probe: Record<string, unknown> = {};
if (args.includes("--probe")) {
  const labels = [["CI running", "Awaiting review"], ["CI green", "Approved"], ["CI failing", "Changes requested"], ["Awaiting review"], ["CI green", "Merge conflicts"]];
  const verdicts = [
    { state: "reviewing" },
    { state: "approved", head: "cca82d2baa3f" },
    { state: "findings", findings: 2, head: "7f54043dd247" },
    { state: "stale", reason: "head-changed", head: "9b395ac5aaaa" },
    { state: "failed" },
  ];
  fleet.workspaces.slice(0, 5).forEach((w, i) => {
    Object.assign(w, { labels: labels[i] });
    const row = w as { host?: string; workspaceId: string };
    probe[`${row.host || "local"}:${row.workspaceId}`] = verdicts[i];
    // Auto-merge on the second and fourth PRs.
    if (i === 1 || i === 3)
      Object.assign(w, {
        pr: { number: 100 + i, title: "Mock PR", state: "open", url: `https://github.com/o/r/pull/${100 + i}`, autoMerge: { method: "squash", by: "owen" } },
      });
  });
}
/** `GET /api/hoststats`'s answer, keyed "local" or a host's server id. */
const hostStats: Record<string, unknown> = fleet === dungeon ? { ...DUNGEON_STATS } : fleet === village ? { ...VILLAGE_STATS } : fleet === sparse ? { ...SPARSE_STATS } : {};
/** The Village's dashboard counts (your PRs and Linear issues). */
const dashboard = fleet === village ? { prs: VILLAGE_PRS, issues: VILLAGE_ISSUES } : fleet === sparse ? { prs: SPARSE_PRS, issues: SPARSE_ISSUES } : null;
if (args.includes("--stats")) {
  const keys = ["local", ...(fleet.hosts as { serverId?: string }[]).flatMap((h) => (h.serverId ? [h.serverId] : []))];
  keys.forEach((key, i) => (hostStats[key] = { cpu: 12 + i * 23, memory: 58 + i * 7, disk: i ? 41 : 93 }));
}
const dist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
if (!existsSync(join(dist, "index.html"))) {
  console.error("web/dist is missing: run `npm --prefix web run build` first.");
  process.exit(1);
}

const BASIC: Record<string, unknown> = {
  projects: [],
  workspaces: [],
  providers: [{ provider: "claude", label: "Claude", status: "available", defaultMode: "default" }],
  status: { localDaemon: "running", connectedDaemon: "reachable", daemonVersion: "mock", hostname: "mock" },
  hosts: [],
  usage: [],
};
const lists: Record<string, unknown> = {
  agents: fleet.agents,
  permissions: fleet.permissions,
  projects: fleet.projects,
  workspaces: fleet.workspaces,
  hosts: fleet.hosts,
};
const integrations = option("integrations", fleet === village ? "github,linear" : fleet === sparse ? "github" : "").split(",").filter(Boolean);
if (integrations.length)
  lists.settings = {
    linearWorkspace: "",
    integrations: Object.fromEntries(["linear", "github", "typesafe"].map((name) => [name, integrations.includes(name)])),
    error: null,
  };
/** The map's style the printed address opens (the page keeps it). */
const mapStyle = option("map", fleet === dungeon ? "dungeon" : fleet === village || fleet === sparse ? "village" : "");

/** What `mockApi` answers for a GET. */
function answer(path: string): [number, unknown] {
  const parts = path.replace(/^\/api\//, "").split("/");
  if (parts.length === 1 && parts[0]! in lists) return [200, lists[parts[0]!]];
  if (parts.length === 1 && parts[0] === "probe") return [200, probe];
  if (parts.length === 1 && parts[0] === "hoststats") return [200, hostStats];
  if (path.startsWith("/api/github/q/prCounts")) return [200, dashboard?.prs ?? { state: "off", message: "Enable GitHub in Settings to use GitHub." }];
  if (path.startsWith("/api/linear/issue-counts")) return [200, dashboard?.issues ?? { state: "off", message: "Enable Linear in Settings to see your issues." }];
  if (parts[0] === "agents") {
    const [, , sub] = parts;
    if (!sub) return [404, { error: "Not found" }];
    if (sub === "timeline")
      return [200, { epoch: "mock", from: 0, to: 0, hasOlder: false, asOf: 0, items: [] }];
    if (sub === "config")
      return [200, { provider: "claude", model: "opus", thinking: null, mode: null, features: [] }];
    if (sub === "github") return [200, { items: [], error: null }];
    if (sub === "files") return [200, { entries: [] }];
    return [200, []];
  }
  if (parts[0]! in BASIC) return [200, BASIC[parts[0]!]];
  return [404, { error: "not mocked" }];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("content-type", "application/json");
    // An agent's asks (POST, but a read): waiting on you for the agents named by --asking.
    const asks = /^\/api\/agents\/([^/]+)\/asks$/.exec(url.pathname);
    if (req.method === "POST" && asks) {
      const waiting = asking.has(decodeURIComponent(asks[1]!));
      return res.end(JSON.stringify({ messageId: `m-${asks[1]}`, waiting, questions: waiting ? [{ text: "Shall I open the pull request now?", kind: "yes_no" }] : [], pending: false }));
    }
    if (req.method !== "GET") {
      // Mutations never go anywhere: there is no daemon behind this server.
      console.log(`refused ${req.method} ${url.pathname}`);
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: "refused by the mock fleet" }));
    }
    const [status, body] = answer(url.pathname);
    res.statusCode = status;
    return res.end(JSON.stringify(body));
  }
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});

// The live connection: the whole fleet as one reset, as `mockApi` pushes it.
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/api/ws")) return socket.destroy();
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const group = (rows: unknown[], hosts = false) => {
      const groups: Record<string, unknown[]> = hosts ? { "": [] } : { local: [] };
      for (const row of rows) {
        const host = hosts ? "" : (row as { host?: string }).host || "local";
        (groups[host] ??= []).push(row);
      }
      return groups;
    };
    ws.send(
      JSON.stringify({
        event: "reset",
        data: {
          data: {
            agents: group(fleet.agents),
            permissions: group(fleet.permissions),
            projects: group(fleet.projects),
            workspaces: group(fleet.workspaces),
            hosts: group(fleet.hosts, true),
          },
          revs: {},
          status: BASIC.status,
          statusRev: 0,
        },
      }),
    );
    ws.on("message", (raw) => {
      let msg: { type?: string; sid?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "watch")
        ws.send(JSON.stringify({ event: "session", data: { sid: msg.sid, event: "state", data: { live: false } } }));
    });
  });
});

server.listen(port, "127.0.0.1", () =>
  console.log(`Mock fleet (${fleetName}) at http://127.0.0.1:${port}/${mapStyle ? `?map=${mapStyle}` : ""} — no daemon behind it`),
);

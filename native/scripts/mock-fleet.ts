/**
 * Serves the built web app (web/dist) with a mocked Paseo API, for running
 * the native app (or a browser) against the e2e fleets without any daemon:
 * every read is answered from `web/e2e/fleets.ts`, as the e2e harness's
 * `mockApi` answers it, and every mutation is refused. The live socket
 * pushes the whole fleet once, as `mockApi`'s does.
 *
 *   npm run native:mock -- [--fleet small|large|dungeon|sparse] [--dungeon] [--port 4331] [--pr-flags]
 *
 * `--pr-flags` labels the first three workspaces with PR status labels, so
 * their flags show. `--probe` labels the first five, and gives each a Probe
 * verdict (one of each state), so each shows a Probe medallion; the
 * second's and fourth's PRs have auto-merge on, so their poles wear its seal.
 * `--dungeon` (or `--fleet dungeon`) serves the fleet Crew's tests use (three hosts, every state).
 * `--asking <agent ids>` (comma-joined) answers those idle agents' asks as waiting on you (turn TypeSafe on with
 * `--integrations typesafe` so the page asks), so their robots show "reply waits on you". `--offline <server id>`
 * takes that host offline (its rows stale), as a daemon gone quiet reports.
 * `--integrations github,linear` turns those integrations on in `GET /api/settings`, so the mode
 * bar shows their tabs (their own reads stay unmocked).
 * `--talk` gives every agent a short conversation for its state (a reply, what a working one is doing, a failure)
 * and its pending request in full (an approval, or a question with options), and accepts the dialogue box's and
 * the conversation's sends, answers, interrupts and reads (logged; nothing behind them), for trying Crew's
 * conversations.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { detailOf } from "../../web/e2e/harness.ts";
import { DUNGEON_GITHUB_QUEUES, DUNGEON_LINEAR_INBOX, dungeon, large, small, sparse } from "../../web/e2e/fleets.ts";
// `ws` lives in web/node_modules, beside the app it serves.
const { WebSocketServer } = createRequire(new URL("../../web/package.json", import.meta.url))("ws") as typeof import("ws");

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const fleetName = args.includes("--dungeon") ? "dungeon" : option("fleet", "large");
const fleet = fleetName === "small" ? small : fleetName === "dungeon" ? dungeon : fleetName === "sparse" ? sparse : large;
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
  activity: DUNGEON_LINEAR_INBOX,
  agents: fleet.agents,
  permissions: fleet.permissions,
  projects: fleet.projects,
  workspaces: fleet.workspaces,
  hosts: fleet.hosts,
};
const integrations = option("integrations", fleet === dungeon ? "github,linear" : fleet === sparse ? "github" : "").split(",").filter(Boolean);
if (integrations.length)
  lists.settings = {
    linearWorkspace: "",
    integrations: Object.fromEntries(["linear", "github", "typesafe"].map((name) => [name, integrations.includes(name)])),
    error: null,
  };
/** `--talk`: each agent's conversation and request, by its state, for the dialogue box. */
const talk = args.includes("--talk");
const REPLY = [
  "I went through the failing checks and fixed the two that were real.",
  "",
  "- The date parser now accepts an offset with a colon, so `2026-11-08T10:00+01:00` reads.",
  "- The cache key includes the locale, which is why the French page showed English prices.",
  "",
  "The third failure was a flaky network test; I left it alone and noted it in the PR. Everything else passes locally.",
  "",
  "Shall I push the branch and open the pull request?",
].join("\n");
type Row = { id: string; status: string; host?: string; name: string };
const agentOf = (id: string) => (fleet.agents as Row[]).find((a) => a.id === id);
const requestOf = (id: string) => (fleet.permissions as { id: string; agentId: string; name: string; description: string; kind?: string }[]).find((p) => p.agentId === id);
function talkDetail(id: string) {
  const a = agentOf(id);
  const p = requestOf(id);
  const pending = !p
    ? []
    : p.kind === "question"
      ? [{
          id: p.id, name: p.name, description: "", kind: "question",
          questions: [{
            question: "The events table has two kinds of rows. Which should the dashboard count?",
            header: "Scope",
            options: [{ label: "Both kinds", description: "Signups and upgrades" }, { label: "Signups only" }, { label: "Upgrades only" }],
            multiSelect: false, allowOther: true, allowEmpty: false,
          }],
        }]
      : [{ id: p.id, name: p.name, description: p.description, detail: `${p.description} --access public` }];
  return detailOf(id, a?.status ?? "idle", { Name: a?.name ?? id, PendingPermissions: pending });
}
function talkTimeline(id: string) {
  const a = agentOf(id);
  const items: Record<string, unknown>[] = [{ kind: "user", text: "Fix the failing checks on this branch", messageId: `u-${id}` }];
  if (a && /running/.test(a.status)) items.push({ kind: "tool", name: "Bash", status: "running", summary: "npm test -- --watch=false", detail: "npm test -- --watch=false" });
  else if (!requestOf(id)) items.push({ kind: "assistant", text: REPLY, messageId: `r-${id}` });
  if (a && /error|failed/.test(a.status)) items.push({ kind: "notice", level: "error", text: "Provider error: the model is overloaded. Try again in a minute." });
  return { epoch: "mock", from: 0, to: items.length, hasOlder: false, asOf: items.length, items: items.map((item, i) => ({ id: `m-${i + 1}`, seq: i + 1, last: i + 1, ...item })) };
}

/** What `mockApi` answers for a GET. */
function answer(path: string, query = new URLSearchParams()): [number, unknown] {
  const parts = path.replace(/^\/api\//, "").split("/");
  if (parts.length === 1 && parts[0]! in lists) return [200, lists[parts[0]!]];
  if (parts.length === 1 && parts[0] === "probe") return [200, probe];
  if (path === "/api/github/q/prs") return [200, DUNGEON_GITHUB_QUEUES[query.get("scope") as "review" | "assigned"] ?? {rows:[],total:0,viewer:{login:"me"}}];
  if (parts[0] === "agents") {
    const [, , sub] = parts;
    if (!sub) return talk ? [200, talkDetail(parts[1]!)] : [404, { error: "Not found" }];
    if (sub === "timeline")
      return [200, talk ? talkTimeline(parts[1]!) : { epoch: "mock", from: 0, to: 0, hasOlder: false, asOf: 0, items: [] }];
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
    // `--talk`: the dialogue box's (and panel's) commands are taken and logged; nothing is behind them.
    const command = /^\/api\/agents\/([^/]+)\/(send|respond|allow|deny|cancel|read)$/.exec(url.pathname);
    if (talk && req.method === "POST" && command) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        console.log(`took ${command[2]} for ${decodeURIComponent(command[1]!)}: ${body.slice(0, 300)}`);
        res.end("{}");
      });
      return;
    }
    if (req.method !== "GET") {
      // Mutations never go anywhere: there is no daemon behind this server.
      console.log(`refused ${req.method} ${url.pathname}`);
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: "refused by the mock fleet" }));
    }
    const [status, body] = answer(url.pathname,url.searchParams);
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
  console.log(`Mock fleet (${fleetName}) at http://127.0.0.1:${port}/ — no daemon behind it`),
);

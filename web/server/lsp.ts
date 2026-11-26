/**
 * Language servers for the Files tab, relayed: `GET /api/lsp?workspace=&host=&group=` (upgrade) is one editor's
 * connection to one language server, run beside the workspace on its own host by that host's `language-servers`
 * Paseo plugin (github.com/owenconti/paseo-cc-plugins, `plugins/language-servers`), so remote hosts'
 * workspaces get the same go to definition, usages and diagnostics as this Mac's.
 *
 * The socket's text frames are JSON:
 * - from the server: `{type:"ready", root, server}` once the plugin started it (`root` the workspace's folder there,
 *   which the page makes its URIs from), `{type:"recv", data}` for each LSP message, `{type:"read", id, text|error}`
 *   answering a read, and `{type:"ended", reason}` (the server quit, or isn't to be had: no plugin, none installed for
 *   the language) before it closes.
 * - from the page: `{type:"send", data}` (an LSP message, JSON text) and `{type:"read", id, uri}`, a file outside the
 *   workspace that the language server named (a library's definition), read only, through the plugin.
 *
 * The plugin's RPC answers requests only, so the server's messages are long-polled (`lsp.poll`, waiting up to
 * `LSP.pollMs`); the editor's are sent in order, in batches. Closing the socket stops the language server.
 * Same rules as the app's other sockets: loopback Host, a same-origin Origin, nothing once closing.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { workspaceOf, type Workspace } from "./api/files";
import { allowedOrigin } from "./api/http";
import { admissionClosed } from "./proc";
import { redactText } from "./redact";

export const LSP = {
  path: "/api/lsp",
  plugin: "language-servers",
  /** How long one poll waits for the server's next message (the plugin's most). */
  pollMs: 20_000,
  /** A plugin call that doesn't answer in this long has failed (a poll's wait included). */
  callMs: 45_000,
  /** Polls that fail in a row before the connection is given up. */
  pollFailures: 3,
  /** The editor's messages sent at once, at most (the plugin's `sendBatch`). */
  sendBatch: 200,
  /** One message from the page, at most (the plugin's `messageBytes`). */
  maxPayload: 8 * 1024 * 1024 + 1024,
};

export const SERVER_GROUPS = ["typescript", "php", "python", "go", "rust", "css", "html", "json", "yaml", "lua", "ruby", "swift", "vue"] as const;

type Invoke = (ws: Workspace, method: string, input: unknown) => Promise<unknown>;
/** How the plugin is called; tests replace it with a fake plugin. */
export const LSP_DEPS: { invoke: Invoke } = {
  invoke: (ws, method, input) => ws.client.invokePluginRpc(LSP.plugin, method, input),
};

const within = <T>(value: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The host's language server didn't answer.")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/** Why a plugin call failed, as the page should say it. */
export function lspFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/plugin/i.test(message) && /not (found|installed|running|enabled)|unknown|no such|disabled|isn't|is not/i.test(message))
    return "This host has no language-servers plugin: install it on the host's daemon to get go to definition, usages and errors here.";
  if (/plugins? (are )?disabled|pluginsEnabled/i.test(message)) return "Plugins are off on this host's daemon (pluginsEnabled), so it has no language servers.";
  return redactText(message).slice(0, 400);
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: LSP.maxPayload });

export function lspUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const refuse = (code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    return true;
  };
  if (admissionClosed()) return refuse(503, "Service Unavailable");
  const origin = allowedOrigin(req);
  if (!origin || req.headers.origin !== origin) return refuse(403, "Forbidden");
  const url = new URL(req.url || "/", "http://127.0.0.1");
  sockets.handleUpgrade(req, socket, head, (ws) => void relay(ws, url));
  return true;
}

async function relay(ws: WebSocket, url: URL) {
  let closed = false;
  const say = (frame: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };
  const end = (reason: string) => {
    if (closed) return;
    closed = true;
    say({ type: "ended", reason });
    if (ws.readyState === ws.OPEN) ws.close(1000, "ended");
  };
  ws.on("close", () => {
    closed = true;
  });

  let workspace: Workspace;
  let group: string;
  let session: string;
  // The page's messages until the server has started (it sends `initialize` at once).
  const early: unknown[] = [];
  const onEarly = (raw: unknown) => early.push(raw);
  ws.on("message", onEarly);
  try {
    const params = new URLSearchParams(url.searchParams);
    group = params.get("group") ?? "";
    params.delete("group");
    if (!(SERVER_GROUPS as readonly string[]).includes(group)) throw new Error("Unknown language");
    workspace = await workspaceOf(params, []);
    const started = (await within(LSP_DEPS.invoke(workspace, "lsp.start", { cwd: workspace.cwd, group }), LSP.callMs)) as {
      session?: unknown;
      server?: { name?: unknown };
    };
    if (typeof started?.session !== "string") throw new Error("The host's language server didn't start.");
    session = started.session;
    if (closed) {
      void LSP_DEPS.invoke(workspace, "lsp.stop", { session }).catch(() => {});
      return;
    }
    say({ type: "ready", root: workspace.cwd, server: typeof started.server?.name === "string" ? started.server.name : group });
  } catch (error) {
    return end(lspFailure(error));
  }
  ws.off("message", onEarly);

  // The editor's messages, in order, a batch at a time.
  let queue: string[] = [];
  let sending: Promise<void> | null = null;
  const flush = () => {
    if (sending || !queue.length || closed) return;
    const batch = queue.slice(0, LSP.sendBatch);
    queue = queue.slice(batch.length);
    sending = within(LSP_DEPS.invoke(workspace, "lsp.send", { session, messages: batch }), LSP.callMs).then(
      () => {
        sending = null;
        flush();
      },
      (error) => {
        sending = null;
        end(lspFailure(error));
      },
    );
  };
  const take = (raw: unknown) => {
    let frame: { type?: unknown; data?: unknown; id?: unknown; uri?: unknown };
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (frame.type === "send" && typeof frame.data === "string") {
      queue.push(frame.data);
      flush();
    } else if (frame.type === "read" && typeof frame.uri === "string" && (typeof frame.id === "number" || typeof frame.id === "string")) {
      const id = frame.id;
      within(LSP_DEPS.invoke(workspace, "lsp.read", { session, uri: frame.uri }), LSP.callMs).then(
        (r) => say({ type: "read", id, text: String((r as { text?: unknown })?.text ?? "") }),
        (error) => say({ type: "read", id, error: lspFailure(error) }),
      );
    }
  };
  for (const raw of early) take(raw);
  ws.on("message", take);

  // The server's messages, long-polled until it or the socket ends.
  let after = 0;
  let failures = 0;
  while (!closed) {
    try {
      const r = (await within(LSP_DEPS.invoke(workspace, "lsp.poll", { session, after, waitMs: LSP.pollMs }), LSP.callMs)) as {
        messages?: { seq: number; text: string }[];
        alive?: boolean;
        exit?: { reason?: string; stderr?: string };
      };
      failures = 0;
      for (const m of r.messages ?? []) {
        if (typeof m?.seq !== "number" || m.seq <= after || typeof m.text !== "string") continue;
        after = m.seq;
        say({ type: "recv", data: m.text });
      }
      if (r.alive === false) {
        const why = r.exit?.reason || "The language server quit.";
        const tail = r.exit?.stderr?.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        return end(redactText(tail ? `${why} ${tail}` : why));
      }
    } catch (error) {
      if (closed) break;
      if (++failures >= LSP.pollFailures) return end(lspFailure(error));
      await new Promise((r) => setTimeout(r, 1000 * failures));
    }
  }
  void LSP_DEPS.invoke(workspace, "lsp.stop", { session }).catch(() => {});
}

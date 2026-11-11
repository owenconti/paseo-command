/**
 * The macOS app as a Paseo browser host: the browser attached to each agent on
 * the Dungeon Board (`native/Sources/PaseoCommandNative/BoardBrowser.swift`).
 *
 * Paseo gives agents `browser_*` tools (`browser_new_tab`, `browser_navigate`,
 * `browser_snapshot`, `browser_click`…) when the daemon's browser tools are on,
 * and sends each call to a connected app that registered as a browser host,
 * with the agent's id. While the app's socket (`/api/browser-host`) is open,
 * this registers on every followed host's daemon (the live feeds' clients) and
 * relays: a daemon's request to the app, the app's answer back to that daemon.
 * The app holds the socket open only while Settings → Map has it on, so a
 * browser tab of the page, or the setting off, registers nothing. Nothing is
 * decided here: the app owns the tabs and runs the commands.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { errorMessage } from "./errors";
import { admissionClosed } from "./proc";

/** Every command the protocol names; the app says which of them it runs. */
export const BROWSER_COMMANDS = [
  "list_tabs", "new_tab", "snapshot", "click", "fill", "wait", "type", "keypress", "navigate", "back", "forward",
  "reload", "screenshot", "upload", "select", "hover", "drag", "logs", "evaluate", "scroll", "resize", "close_tab",
] as const;

export const BROWSER_HOST = {
  path: "/api/browser-host",
  /** How the daemon names this host to agents ("… is not supported by the Paseo Command"). */
  hostKind: "Paseo Command",
  /** A full-page screenshot, base64. */
  maxPayload: 64 * 1024 * 1024,
  /** How long a request the app never answered is remembered (the daemon gives up on it sooner). */
  forgetMs: 60000,
};

type Subscription = {
  readonly ready: Promise<unknown>;
  subscribe(observer: { snapshot(value: unknown): void; update(message: unknown): void; error?(error: unknown): void }): () => void;
  release(): Promise<unknown>;
};
/** The part of a daemon client a browser host uses. Older SDKs and daemons lack it. */
export type BrowserHostClient = {
  registerBrowserHost?(registration: { hostKind: string; supportedCommands: string[] }): Subscription;
  sendBrowserAutomationExecuteResponse?(response: unknown): void;
};

export type HostState = { host: string; state: "pending" | "registered" | "refused"; error?: string };
type Registration = HostState & { client: BrowserHostClient; release(): void };

/** Each followed host's connected client, by the feed's key ("local" or a serverId). */
const clients = new Map<string, BrowserHostClient>();
const registrations = new Map<string, Registration>();
/** The app's socket and the commands it runs. */
let app: { ws: WebSocket; commands: string[] } | null = null;
/** Requests sent to the app and not yet answered, by request id. */
const pending = new Map<string, { client: BrowserHostClient; timer: ReturnType<typeof setTimeout> }>();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function tell() {
  if (!app || app.ws.readyState !== app.ws.OPEN) return;
  const hosts: HostState[] = [...registrations.values()].map(({ host, state, error }) => ({ host, state, ...(error ? { error } : {}) }));
  app.ws.send(JSON.stringify({ type: "hosts", hosts }));
}

function answer(client: BrowserHostClient, payload: unknown) {
  try {
    client.sendBrowserAutomationExecuteResponse?.({ type: "browser.automation.execute.response", payload });
  } catch {
    // The daemon's connection went; it has already failed the request.
  }
}
const failure = (requestId: string, code: string, message: string, retryable = false) => ({
  requestId,
  ok: false,
  error: { code, message, retryable },
});

/** A daemon's request, on its way to the app. */
function request(host: string, client: BrowserHostClient, message: unknown) {
  if (!isRecord(message) || message.type !== "browser.automation.execute.request") return;
  const { requestId, command } = message;
  if (typeof requestId !== "string" || !requestId || requestId.length > 400) return;
  if (!isRecord(command) || typeof command.command !== "string")
    return answer(client, failure(requestId, "browser_unknown_error", "The browser request was malformed."));
  if (!app || app.ws.readyState !== app.ws.OPEN)
    return answer(client, failure(requestId, "browser_no_host", "Paseo Command's browser isn't running.", true));
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const held = pending.get(requestId);
  if (held) clearTimeout(held.timer);
  pending.set(requestId, { client, timer: setTimeout(() => pending.delete(requestId), BROWSER_HOST.forgetMs) });
  app.ws.send(
    JSON.stringify({
      type: "request",
      host,
      request: {
        requestId,
        agentId: text(message.agentId),
        cwd: text(message.cwd),
        workspaceId: text(message.workspaceId),
        command: { command: command.command, args: isRecord(command.args) ? command.args : {} },
      },
    }),
  );
}

/** The app's answer, on its way back to the daemon that asked. */
function respond(payload: unknown) {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || typeof payload.ok !== "boolean") return;
  const held = pending.get(payload.requestId);
  if (!held) return;
  pending.delete(payload.requestId);
  clearTimeout(held.timer);
  answer(held.client, payload);
}

function unregister(host: string) {
  const held = registrations.get(host);
  if (!held) return;
  registrations.delete(host);
  held.release();
}

function register(host: string) {
  unregister(host);
  const client = clients.get(host);
  if (!client || !app) return;
  if (typeof client.registerBrowserHost !== "function" || typeof client.sendBrowserAutomationExecuteResponse !== "function") {
    registrations.set(host, { host, client, state: "refused", error: "This daemon's connection has no browser tools.", release() {} });
    return;
  }
  let released = false;
  let subscription: Subscription | undefined;
  let off: (() => void) | undefined;
  const entry: Registration = {
    host,
    client,
    state: "pending",
    release() {
      released = true;
      off?.();
      void subscription?.release().catch(() => {});
    },
  };
  registrations.set(host, entry);
  const settle = (state: Registration["state"], error?: unknown) => {
    if (released || registrations.get(host) !== entry) return;
    entry.state = state;
    entry.error = error === undefined ? undefined : errorMessage(error);
    tell();
  };
  try {
    subscription = client.registerBrowserHost({ hostKind: BROWSER_HOST.hostKind, supportedCommands: app.commands });
    off = subscription.subscribe({
      snapshot: () => settle("registered"),
      update: (message) => {
        if (!released) request(host, client, message);
      },
      error: (error) => settle("refused", error),
    });
    subscription.ready.then(
      () => settle("registered"),
      (error) => settle("refused", error),
    );
  } catch (error) {
    settle("refused", error);
  }
}

/**
 * A feed's client connected (live/hub.ts): the app, if its socket is open, registers on it.
 * Returns what to call when that client goes.
 */
export function attachBrowserHost(host: string, client: BrowserHostClient) {
  clients.set(host, client);
  if (app) {
    register(host);
    tell();
  }
  return () => {
    if (clients.get(host) !== client) return;
    clients.delete(host);
    unregister(host);
    tell();
  };
}

/** The app's socket closed (or another took its place): nothing is registered, and what it owed is failed. */
function leave(ws: WebSocket) {
  if (app?.ws !== ws) return;
  app = null;
  for (const host of [...registrations.keys()]) unregister(host);
  for (const [requestId, held] of pending) {
    clearTimeout(held.timer);
    answer(held.client, failure(requestId, "browser_no_host", "Paseo Command's browser closed before answering.", true));
  }
  pending.clear();
}

function enter(ws: WebSocket, commands: string[]) {
  const previous = app?.ws;
  if (previous && previous !== ws) {
    leave(previous);
    previous.close(1000, "Another browser host connected");
  }
  app = { ws, commands };
  for (const host of clients.keys()) register(host);
  tell();
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: BROWSER_HOST.maxPayload });

/** `GET /api/browser-host` (upgrade): the macOS app's socket. Same rules as the app's other sockets. */
export function browserHostUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, origin: string | null) {
  const refuse = (code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    return true;
  };
  if (admissionClosed()) return refuse(503, "Service Unavailable");
  if (!origin || req.headers.origin !== origin) return refuse(403, "Forbidden");
  sockets.handleUpgrade(req, socket, head, (ws) => {
    ws.on("message", (raw, binary) => {
      if (binary) return;
      let message: unknown;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (message.type === "hello") {
        const known = new Set<string>(BROWSER_COMMANDS);
        const commands = Array.isArray(message.commands)
          ? [...new Set(message.commands.filter((c): c is string => typeof c === "string" && known.has(c)))]
          : [];
        if (!commands.length) return ws.close(1008, "No browser commands");
        enter(ws, commands);
      } else if (message.type === "response" && app?.ws === ws) respond(message.payload);
    });
    ws.on("close", () => leave(ws));
    ws.on("error", () => leave(ws));
  });
  return true;
}

/** How it stands (tests, diagnostics). */
export function browserHostState() {
  return {
    connected: !!app,
    commands: app?.commands ?? [],
    hosts: [...registrations.values()].map(({ host, state, error }) => ({ host, state, error })),
    pending: pending.size,
  };
}

/** The server is closing: the app's socket ends, and with it every registration. */
export function stopBrowserHost() {
  const ws = app?.ws;
  if (!ws) return;
  leave(ws);
  ws.close(1001, "The server is closing");
}

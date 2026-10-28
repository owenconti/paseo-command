/**
 * A workspace's terminals on its daemon, for the macOS app's terminal drawer
 * (`native/Sources/PaseoCommandNative/TerminalDrawer.swift`):
 *
 * - `GET /api/terminals?workspace=<id>[&host=<serverId>]`: the workspace's
 *   folder and its terminals (`{ cwd, terminals: [{ id, name, title }] }`).
 * - `POST /api/terminals/create` `{ workspace, host?, rows?, cols? }`: a new
 *   terminal in that workspace.
 * - `POST /api/terminals/kill` `{ id, host? }`: end one.
 * - `GET /api/terminal?id=<terminalId>[&host=…]` (upgrade): one terminal's
 *   bytes as binary frames, its recent screen first; text frames back are
 *   `{ type: "input", data }` or `{ type: "resize", rows, cols }`.
 *
 * Only a workspace the fleet lists is opened; the folder comes from its row,
 * never from the request.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { admissionClosed } from "../proc";
import { resolveHost, sdk, timed, type Remote } from "./hosts";
import { allowedOrigin } from "./http";
import { aggregate } from "./reads";
import { id } from "./validate";

type Body = Record<string, unknown>;
type TerminalInfo = { id: string; name: string; title?: string };

/** The workspace's row on that host, or an error. */
async function workspaceOf(raw: unknown, host?: Remote) {
  const workspaceId = id(raw);
  const { rows } = await aggregate("workspaces");
  const row = (rows as { workspaceId?: string; host?: string; cwd?: string }[]).find(
    (w) => w.workspaceId === workspaceId && (w.host || "") === (host?.serverId || ""),
  );
  if (!row?.cwd) throw new Error("Unknown workspace");
  return { workspaceId, cwd: row.cwd };
}

const terminalOf = (t: { id: string; name: string; title?: string }): TerminalInfo => ({
  id: t.id,
  name: t.name,
  ...(t.title ? { title: t.title } : {}),
});

export async function listTerminals(url: URL) {
  const host = await resolveHost(url.searchParams.get("host"));
  const { workspaceId, cwd } = await workspaceOf(url.searchParams.get("workspace"), host);
  const client = await sdk(host);
  const r = await timed(client.listTerminals(cwd, undefined, { workspaceId }), undefined, client);
  return { cwd, terminals: (r.terminals ?? []).map(terminalOf) };
}

const size = (body: Body) => {
  const rows = Number(body.rows),
    cols = Number(body.cols);
  return Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0 && rows < 1000 && cols < 1000
    ? { rows, cols }
    : undefined;
};

export async function createTerminal(body: Body) {
  const host = await resolveHost(body.host, "write");
  const { workspaceId, cwd } = await workspaceOf(body.workspace, host);
  const client = await sdk(host);
  const r = await timed(
    client.createTerminal(cwd, undefined, undefined, { workspaceId, size: size(body) }),
    undefined,
    client,
  );
  if (!r.terminal) throw new Error(r.error || "The terminal didn't start");
  return { terminal: terminalOf(r.terminal) };
}

export async function killTerminal(body: Body) {
  const host = await resolveHost(body.host, "write");
  const client = await sdk(host);
  await timed(client.killTerminal(id(body.id)), undefined, client);
  return {};
}

// ── The relay ───────────────────────────────────────────────────────────────
const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

type Cell = {
  char: string;
  fg?: number;
  bg?: number;
  fgMode?: number;
  bgMode?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
};
type Snapshot = { grid: Cell[][]; scrollback: Cell[][]; cursor: { row: number; col: number; hidden?: boolean } };

/** A colour as SGR parameters: mode 1 is the 256-colour palette, 2 is 24-bit, else the 16 basic colours. */
function colour(value: number | undefined, mode: number | undefined, background: boolean): string[] {
  if (value === undefined) return [];
  const base = background ? 48 : 38;
  if (mode === 2) return [`${base}`, "2", `${(value >> 16) & 255}`, `${(value >> 8) & 255}`, `${value & 255}`];
  if (mode === 1 || value > 15) return [`${base}`, "5", `${value}`];
  return [`${(background ? 40 : 30) + (value & 7) + (value > 7 ? 60 : 0)}`];
}

/** A daemon screen snapshot (cells) as the bytes that draw it, for a client
 * that only takes a byte stream. */
export function snapshotBytes(state: Snapshot): Buffer {
  let out = "\x1b[0m\x1b[2J\x1b[3J\x1b[H";
  const lines = [...state.scrollback, ...state.grid];
  lines.forEach((line, i) => {
    let last = "";
    for (const c of line) {
      const sgr = [
        "0",
        ...(c.bold ? ["1"] : []),
        ...(c.dim ? ["2"] : []),
        ...(c.italic ? ["3"] : []),
        ...(c.underline ? ["4"] : []),
        ...(c.inverse ? ["7"] : []),
        ...(c.strikethrough ? ["9"] : []),
        ...colour(c.fg, c.fgMode, false),
        ...colour(c.bg, c.bgMode, true),
      ].join(";");
      if (sgr !== last) out += `\x1b[${sgr}m`;
      last = sgr;
      out += c.char || " ";
    }
    out += "\x1b[0m";
    if (i < lines.length - 1) out += "\r\n";
  });
  out += `\x1b[${state.cursor.row + 1};${state.cursor.col + 1}H`;
  if (state.cursor.hidden) out += "\x1b[?25l";
  return Buffer.from(out, "utf8");
}

/** `GET /api/terminal` (upgrade): see the top of this file. Same rules as the
 * app's other socket: loopback Host, same-origin Origin, nothing once closing. */
export function terminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
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
  const close = (code: number, reason: string) => {
    if (ws.readyState === ws.OPEN) ws.close(code, reason.slice(0, 120));
  };
  let terminalId: string;
  let client: Awaited<ReturnType<typeof sdk>>;
  try {
    terminalId = id(url.searchParams.get("id"));
    client = await sdk(await resolveHost(url.searchParams.get("host")));
  } catch (error) {
    return close(1011, error instanceof Error ? error.message : "Unavailable");
  }
  const send = (bytes: Uint8Array) => ws.readyState === ws.OPEN && ws.send(bytes, { binary: true });
  const observation = client.observeTerminal(
    terminalId,
    (event) => {
      if (event.type === "snapshot") send(snapshotBytes(event.state as Snapshot));
      else send(event.data);
    },
    { restore: { mode: "full-snapshot", scrollbackLines: 5000 } },
  );
  observation.subscribe({
    snapshot: (payload) => {
      const error = (payload as { error?: string | null }).error;
      if (error) close(1011, error);
    },
    update: (message) => {
      if (message.type === "terminal_stream_exit") close(1000, "The terminal ended");
    },
    error: (error) => close(1011, error instanceof Error ? error.message : "The terminal stream failed"),
  });
  ws.on("message", (raw, binary) => {
    if (binary) return;
    let message: { type?: unknown; data?: unknown; rows?: unknown; cols?: unknown };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === "input" && typeof message.data === "string" && message.data.length <= 64 * 1024)
      client.sendTerminalInput(terminalId, { type: "input", data: message.data });
    else if (message.type === "resize") {
      const s = size(message as Body);
      if (s) client.sendTerminalInput(terminalId, { type: "resize", ...s });
    }
  });
  ws.on("close", () => void observation.release().catch(() => {}));
}

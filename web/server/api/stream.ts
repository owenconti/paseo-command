// ── Live feeds and the tab's push channel ──────────────────────────────────
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { configureLive, liveInterval, socketChannel } from "../live";
import { admissionClosed } from "../proc";
import { sessionSource } from "./agents";
import {
  follow,
  followHosts,
  hostChips,
  hostRegistry,
  registryKnown,
  registryNow,
  remotesOf,
  statusView,
} from "./hosts";
import { allowedOrigin } from "./http";
import { terminalUpgrade } from "./terminals";
import { id } from "./validate";

/** Start following every host (idempotent; the first API request does it). */
export function startLive() {
  if (!follow()) return;
  configureLive({
    hosts: () => [
      { key: "local", contact: true },
      ...remotesOf(registryNow()).map((h) => ({
        key: h.serverId,
        serverId: h.serverId,
        label: h.label,
        contact: h.online,
      })),
    ],
    extras: () => ({ hosts: hostChips(registryNow()), status: statusView() }),
  });
  followHosts();
  // Keep the registry confirmed (and the status current) while following;
  // its subscription tells of changes at once, this catches a quiet one.
  liveInterval(() => {
    void hostRegistry(false)
      .then(followHosts)
      .catch(() => {});
  }, 15000);
  void hostRegistry(false).catch(() => {});
}

// Browsers never ping; automatic pongs would be output outside the
// channel's budget, so none are sent.
const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  autoPong: false,
});
/** A request to watch a session, as the tab sends it. */
type WatchMessage = { agentId?: unknown; host?: unknown };
/**
 * `GET /api/ws` (upgrade): the tab's one connection, carrying the fleet and
 * the sessions it watches. Same rules as every route: loopback Host, a
 * same-origin Origin (browsers always send one), and nothing once closing.
 */
export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/terminal") return terminalUpgrade(req, socket, head);
  if (url.pathname !== "/api/ws") return false;
  const refuse = (code: number, text: string) => {
    socket.write(
      `HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
    return true;
  };
  if (admissionClosed()) return refuse(503, "Service Unavailable");
  const origin = allowedOrigin(req);
  if (!origin || req.headers.origin !== origin) return refuse(403, "Forbidden");
  startLive();
  void registryKnown().then(() => {
    if (admissionClosed() || socket.destroyed)
      return refuse(503, "Service Unavailable");
    sockets.handleUpgrade(req, socket, head, (ws) => {
      socketChannel(ws, (msg: WatchMessage) => {
        const agentId = id(msg.agentId);
        const serverId =
          msg.host === undefined || msg.host === null || msg.host === ""
            ? undefined
            : id(msg.host);
        return sessionSource(agentId, serverId);
      });
    });
  });
  return true;
}

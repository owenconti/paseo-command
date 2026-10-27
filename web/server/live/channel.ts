/** Connections to browsers: SSE responses and WebSockets, with bounded output. */
import type { ServerResponse } from "node:http";
import type { WebSocket } from "ws";
import { encode } from "../wire";
import { resendWatch, unwatch, type Watch } from "./sessions";
import { channels, sendFleetReset, stopTimers } from "./stream";
import { LIVE } from "./tuning";

/**
 * One connection to a browser: a WebSocket (the fleet and any sessions) or
 * an SSE response (the fleet, or one session). Output is bounded: past the
 * budget messages are dropped until it drains, and then it gets a fresh
 * reset of everything it follows; past the hard cap it is closed.
 */
export abstract class Channel {
  readonly watches = new Map<string, Watch>();
  congested = false;
  /** Messages were dropped while congested: a reset is owed. */
  owed = false;
  closed = false;
  /** Sending a reset: delivered whole, whatever the budget says. */
  private batching = false;
  private poll?: ReturnType<typeof setInterval>;
  constructor(readonly fleet: boolean) {}
  protected abstract write(text: string): void;
  abstract buffered(): number;
  protected abstract end(): void;
  protected abstract encode(event: string, data: unknown): string;
  /** Sessions are addressed by id on a multiplexed channel. */
  abstract readonly multiplexed: boolean;
  send(event: string, data: unknown) {
    if (this.closed) return false;
    if (this.congested && !this.batching) {
      this.owed = true;
      return false;
    }
    try {
      this.write(this.encode(event, data));
    } catch {
      this.close();
      return false;
    }
    return this.check();
  }
  /**
   * The budget, checked after every write and on every poll while
   * congested, so output from anywhere (a transport's own frames included)
   * can't grow past the hard cap with the channel open.
   */
  check() {
    const size = this.buffered();
    if (size > LIVE.hardBufferedBytes) {
      this.close();
      return false;
    }
    if (size > LIVE.maxBufferedBytes && !this.batching && !this.congested) {
      this.congested = true;
      this.waitForDrain();
    }
    return true;
  }
  protected waitForDrain() {
    this.poll ??= setInterval(() => this.drained(), LIVE.drainPollMs);
    this.poll.unref?.();
  }
  drained() {
    if (this.closed || !this.congested) return;
    if (!this.check() || this.buffered() > LIVE.maxBufferedBytes / 4) return;
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
    this.congested = false;
    if (!this.owed) return;
    this.owed = false;
    // Whatever was dropped is superseded by a reset of everything followed,
    // sent whole: a reset larger than the budget must still arrive, or the
    // channel would only ever be sent resets. Only what comes after it can
    // be dropped (and owe the next one).
    this.batching = true;
    try {
      sendFleetReset(this);
      for (const w of this.watches.values()) resendWatch(w, this);
    } finally {
      this.batching = false;
    }
    this.check();
  }
  heartbeat() {
    if (!this.congested) this.send("ping", {});
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
    channels.delete(this);
    for (const key of [...this.watches.keys()]) unwatch(this, key);
    try {
      this.end();
    } catch {
      // Already gone.
    }
    if (!channels.size) stopTimers();
  }
}

export class SseChannel extends Channel {
  readonly multiplexed = false;
  constructor(
    readonly res: ServerResponse,
    fleet: boolean,
  ) {
    super(fleet);
    res.on("drain", () => this.drained());
  }
  protected encode(event: string, data: unknown) {
    return event === "ping"
      ? `: keep-alive\n\n`
      : `event: ${event}\ndata: ${encode(data)}\n\n`;
  }
  protected write(text: string) {
    this.res.write(text);
  }
  buffered() {
    return this.res.writableLength ?? 0;
  }
  protected waitForDrain() {
    // The response emits `drain`.
  }
  protected end() {
    this.res.end();
    // A client that isn't reading would otherwise hold the socket.
    this.res.destroy();
  }
}

export class WsChannel extends Channel {
  readonly multiplexed = true;
  constructor(readonly ws: WebSocket) {
    super(true);
  }
  protected encode(event: string, data: unknown) {
    return encode({ event, data });
  }
  protected write(text: string) {
    this.ws.send(text);
  }
  buffered() {
    return this.ws.bufferedAmount;
  }
  protected end() {
    this.ws.close(1001, "closing");
    setTimeout(() => this.ws.terminate(), 1000).unref?.();
  }
}

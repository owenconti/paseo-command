import { compareTs, type ShownMessage } from "./store";

export type Row =
  | { kind: "day"; key: string; ts: string }
  | { kind: "new"; key: string }
  | { kind: "message"; key: string; message: ShownMessage; compact: boolean };

/** Messages from one sender within this long run together (one avatar and name). */
const RUN_SECONDS = 5 * 60;

const seconds = (ts: string) => Number(ts.split(".")[0]);
const sender = (m: ShownMessage) => (m.botName ? `bot:${m.botName}` : m.userId ?? "");
const runs = (m: ShownMessage) => !m.subtype || m.subtype === "thread_broadcast" || m.subtype === "bot_message" || m.subtype === "file_share" || m.subtype === "me_message";

/**
 * A conversation's (or thread's) rows, oldest first: a divider for each day,
 * a "New messages" line before the first message from someone else after
 * `unreadFrom` (where you'd read to when it opened), and messages, compact
 * within a sender's run (same sender, same day, within 5 minutes, unbroken
 * by the line). `dayOf` names a ts's local day.
 */
export function messageRows(messages: ShownMessage[], dayOf: (ts: string) => string, unreadFrom?: string, self?: string): Row[] {
  const rows: Row[] = [];
  let lastDay: string | undefined;
  let prev: ShownMessage | undefined;
  let lined = false;
  for (const m of messages) {
    const day = m.pending && prev ? lastDay! : dayOf(m.ts);
    let broken = false;
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day:${day}`, ts: m.ts });
      lastDay = day;
      broken = true;
    }
    if (!lined && unreadFrom && !m.pending && m.userId !== self && compareTs(m.ts, unreadFrom) > 0) {
      rows.push({ kind: "new", key: "new" });
      lined = true;
      broken = true;
    }
    const compact =
      !broken &&
      !!prev &&
      runs(m) &&
      runs(prev) &&
      sender(prev) === sender(m) &&
      (m.pending || prev.pending || seconds(m.ts) - seconds(prev.ts) < RUN_SECONDS);
    rows.push({ kind: "message", key: m.ts, message: m, compact });
    prev = m;
  }
  return rows;
}

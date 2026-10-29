/**
 * `paseo logs` emits a plain-text timeline: tagged lines such as `[User] …`,
 * `[Thought] …` or `[Shell] …`, and untagged lines for assistant prose.
 */
export type Entry =
  | { kind: "user"; text: string; from?: string; messageId?: string }
  | { kind: "assistant"; text: string; messageId?: string; seq?: number }
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      tool: string;
      text: string;
      detail?: string;
      status?: string;
    }
  | { kind: "todo"; text: string; items: { text: string; done: boolean }[] }
  | { kind: "event"; label: string; text: string };

/** Items from the daemon's structured timeline (see server/daemon.ts shapeTimeline). */
export type TimelineItem =
  | {
      kind: "user" | "assistant" | "reasoning";
      id: string;
      text: string;
      messageId?: string;
      /** The row's daemon position and version (history rows carry them). */
      seq?: number;
      last?: number;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: string;
      summary: string;
      detail: string;
    }
  | { kind: "todo"; id: string; items: { text: string; done: boolean }[] }
  | { kind: "notice"; id: string; level: string; text: string };

/**
 * The daemon merges a reply's streamed chunks only while their sequence
 * numbers are contiguous: an update to an earlier row (a background tool or
 * subagent) landing mid-reply leaves the rest in rows of its own, split
 * anywhere, even mid-word. As Paseo's own client does, a reply row directly
 * after another joins it (unless it names a different message), so the
 * reply renders, and its Markdown parses, as one text. A tool call, thought
 * or prompt in between still separates replies.
 */
export function fromTimeline(items: TimelineItem[]): Entry[] {
  const entries: Entry[] = [];
  let reply:
    | { entry: { text: string; seq?: number }; messageId?: string }
    | undefined;
  for (const item of items) {
    if (item.kind === "assistant") {
      // Its position (`last` is the row's version, not where it stands).
      const seq = item.seq;
      if (
        reply &&
        (item.messageId === undefined || item.messageId === reply.messageId)
      ) {
        reply.entry.text += item.text;
        if (seq !== undefined) reply.entry.seq = seq;
        continue;
      }
      const entry: Entry = {
        kind: "assistant",
        text: item.text,
        ...(item.messageId ? { messageId: item.messageId } : {}),
        ...(seq !== undefined ? { seq } : {}),
      };
      entries.push(entry);
      reply = { entry, messageId: item.messageId };
      continue;
    }
    reply = undefined;
    entries.push(entryOf(item));
  }
  return entries;
}

function entryOf(item: TimelineItem): Entry {
  switch (item.kind) {
    case "user":
      return { kind: "user", text: item.text, messageId: item.messageId };
    case "assistant":
      return { kind: "assistant", text: item.text };
    case "reasoning":
      return { kind: "thought", text: item.text };
    case "tool":
      return {
        kind: "tool",
        tool: item.name,
        text: item.summary,
        detail: item.detail,
        status: item.status,
      };
    case "todo":
      return { kind: "todo", text: "", items: item.items };
    default:
      return { kind: "event", label: item.level, text: item.text };
  }
}

const TAG = /^\[([^\]\n]{1,80})\](?: (.*))?$/;
// Notifications injected into the conversation carry their own body.
const EVENTS = new Set(["Agent finished", "Task notification", "System"]);

type Prose = Map<string, number>;

/**
 * Walk one view of the timeline. The full view has tool lines; the text view
 * (`--filter text`) has only prompts, thoughts and replies, so any other
 * bracketed line in it is prose (e.g. `[package]` inside a TOML block).
 */
function scan(lines: string[], view: "full" | "text", prose?: Prose): Entry[] {
  const entries: Entry[] = [];
  let absorbing: Entry | null = null;
  let blank = false;
  const takeProse = (line: string) => {
    const key = line.trim();
    // Fences and rules recur everywhere; they can't identify a reply.
    if (/^[`~\-*_#>|=:.\s]*$/.test(key)) return false;
    const n = prose?.get(key);
    if (!n) return false;
    prose!.set(key, n - 1);
    return true;
  };
  const pushProse = (line: string) => {
    absorbing = null;
    const last = entries[entries.length - 1];
    if (last?.kind === "assistant") last.text += `\n${line}`;
    else if (line.trim()) entries.push({ kind: "assistant", text: line });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const match = TAG.exec(line);
    const tag = match?.[1] || "";
    const rest = match?.[2] || "";
    const known =
      tag === "User" ||
      tag === "Thought" ||
      tag === "Thinking" ||
      /^message received$/i.test(tag) ||
      EVENTS.has(tag);
    if (match && (known || (view === "full" && !takeProse(line)))) {
      absorbing = null;
      blank = false;
      if (tag === "User") absorbing = { kind: "user", text: rest };
      else if (/^message received$/i.test(tag))
        absorbing = { kind: "user", text: "", from: rest };
      else if (tag === "Thought" || tag === "Thinking")
        absorbing = { kind: "thought", text: rest };
      else if (EVENTS.has(tag))
        absorbing = { kind: "event", label: tag, text: rest };
      else entries.push({ kind: "tool", tool: tag, text: rest });
      if (absorbing) entries.push(absorbing);
      continue;
    }
    if (absorbing && "text" in absorbing) {
      const current: Entry = absorbing;
      if (!line.trim()) {
        current.text += "\n";
        blank = true;
        continue;
      }
      // Known reply text always ends a prompt or thought. Thought paragraphs are
      // blank-separated; the reply follows the last one without a blank line.
      const ends =
        (current.kind !== "event" && takeProse(line)) ||
        (current.kind === "thought" && !blank);
      if (ends) {
        pushProse(line);
        continue;
      }
      current.text += `\n${line}`;
      blank = false;
      if (current.kind === "event" && line.trim() === "</agent-response>")
        absorbing = null;
      continue;
    }
    takeProse(line);
    pushProse(line);
  }
  for (const entry of entries)
    if ("text" in entry)
      entry.text = entry.text
        .replace(/^\n+|\n+$/g, "")
        .replace(/\n{3,}/g, "\n\n");
  return entries;
}

export function parseTranscript(
  lines: string[],
  assistant: string[] = [],
): Entry[] {
  // Prompt bodies and replies are both untagged; the text view says which lines are replies.
  const prose: Prose = new Map();
  for (const entry of scan(assistant, "text"))
    if (entry.kind === "assistant")
      for (const line of entry.text.split("\n"))
        if (line.trim())
          prose.set(line.trim(), (prose.get(line.trim()) || 0) + 1);
  return scan(lines, "full", prose);
}

export type Block =
  | {
      kind: "user";
      text: string;
      from?: string;
      messageId?: string;
      key: string;
    }
  | {
      kind: "assistant";
      text: string;
      messageId?: string;
      seq?: number;
      key: string;
    }
  | { kind: "event"; label: string; text: string; key: string }
  | { kind: "todo"; items: { text: string; done: boolean }[]; key: string }
  | { kind: "activity"; steps: Entry[]; key: string };

/** Fold consecutive tool calls and thoughts into one activity block. */
export function toBlocks(entries: Entry[]): Block[] {
  const blocks: Block[] = [];
  // Keys survive the tail window sliding: content plus occurrence, not position.
  const seen = new Map<string, number>();
  entries.forEach((entry) => {
    const sig = `${entry.kind}:${"tool" in entry ? entry.tool : ""}:${entry.text.slice(0, 80)}`;
    const n = (seen.get(sig) || 0) + 1;
    seen.set(sig, n);
    const key = `${sig}#${n}`;
    if (entry.kind === "tool" || entry.kind === "thought") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "activity") last.steps.push(entry);
      else blocks.push({ kind: "activity", steps: [entry], key });
    } else if (entry.kind === "todo")
      blocks.push({ kind: "todo", items: entry.items, key });
    else if (entry.kind === "event")
      blocks.push({ kind: "event", label: entry.label, text: entry.text, key });
    else if (entry.kind === "user")
      blocks.push({
        kind: "user",
        text: entry.text,
        from: entry.from,
        messageId: entry.messageId,
        key,
      });
    else
      blocks.push({
        kind: "assistant",
        text: entry.text,
        ...(entry.messageId ? { messageId: entry.messageId } : {}),
        ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
        key,
      });
  });
  return blocks;
}

export function toolSummary(tool: string, _text: string) {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
  if (mcp) return { name: mcp[2].replaceAll("_", " "), source: mcp[1] };
  return { name: tool, source: "" };
}

/** Pull the inner text out of an `<agent-response>` notification body. */
export function eventBody(text: string) {
  const inner = /<agent-response>\n?([\s\S]*?)\n?<\/agent-response>/.exec(text);
  const head = text.split("\n")[0];
  return {
    head,
    body: inner ? inner[1].trim() : text.split("\n").slice(1).join("\n").trim(),
  };
}

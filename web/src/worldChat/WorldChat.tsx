/**
 * The Dungeon Board's conversation: a dialogue box over the board's foot, as an
 * RPG's, where a picked robot speaks its latest reply page by page (typed out;
 * Enter, Space or a click goes on), then offers what you can say: answer its
 * request or question, a quick reply, your own reply, the full chat, or leave.
 * Only the agent's own words are its speech; everything else (what it is doing,
 * a failure, its state) is narration. Replies are written in the app's own
 * composer (files, /skills, @mentions), and the whole conversation opens upward
 * as its log (H, or scrolling up). The side panel's conversation stays; both
 * follow the same session (the server keeps each viewer's stream).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { STATE_NAMES, STATE_TILE, modelName } from "../../../rendering/src/atlas";
import type { State } from "../../../rendering/src/world";
import { useAgentSession } from "../useAgentSession";
import { onAppCommand } from "../appCommands";
import { Composer } from "../Composer";
import { Timeline } from "../Session";
import { PermissionCard } from "../PermissionCard";
import { useAutolinks } from "../autolinkStore";
import { readStore } from "../api";
import { enqueue, toOutgoing, useQueue } from "../queue";
import { Markdown } from "../Markdown";
import { errorMessage } from "../api";
import { agentName } from "../names";
import { isFailed, isRunning, isWorking, providerName, type Agent, type Mode, type Permission, type Workspace } from "../types";
import type { Asks } from "../asks/types";
import type { WorkSummary } from "../useWorkingOn";
import { answersMessage, quickReplies } from "../composer/answers";
import { isTyping } from "../worldShortcut";
import { modalOpen } from "../focus";
import { openFileLink, openInAppBrowser } from "../Session";
import { exchangeOf, pageReply, type PageRoom } from "./script";
import { ROBOTS_SHEET, ROBOTS_URL, robotFrames, uiFrame } from "./art";
import navigationArt from "./navigation.webp";
import "./world-chat.css";

export type WorldChatProps = {
  agent: Agent;
  workspace?: Workspace;
  asks?: Asks;
  workingOn?: WorkSummary;
  /** The fleet says a request of its waits on you (the request itself comes with its detail). */
  waiting: boolean;
  /** That request is a question. */
  question: boolean;
  unread: boolean;
  /** The daemon is reachable. */
  online: boolean;
  /** A confirming dialog is open: the box keeps still. */
  blocked: boolean;
  onClose: () => void;
  /** Open its conversation in the side panel, its message box focused. */
  onOpenChat: () => void;
  onNotice: (message: string) => void;
  onChanged: () => Promise<void> | void;
  /** How much of the map's foot the box covers (CSS px), so the board frames the robot above it. */
  onInset: (px: number) => void;
  /** The box shows the whole conversation (its log), kept as you step from robot to robot (main's, for ⌘K). */
  log: boolean;
  onLog: (open: boolean) => void;
  /** The previous and next agents (the panel's order, as J/K step), and their names. */
  position: { index: number; total: number; prev: () => void; next: () => void; prevName?: string; nextName?: string };
};

/** A line in the box: the agent's own words, or narration (state, what it does, failures). */
type Line = { who: "agent" | "narrator"; text: string; caption?: string };
type Choice = {
  id: string;
  label: string;
  hint?: string;
  tone?: "allow" | "deny";
  /** A multiple-choice option: whether it is picked. */
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
};
type Entry = "reply" | "answer";
type Beat = {
  /** A new id starts the box over at its first page. */
  id: string;
  pages: Line[];
  choices: Choice[];
  /** Live narration (what it is doing now) shows at once, never typed. */
  live?: boolean;
};

/** Characters a second as the box types; sentences' and clauses' ends pause a moment. Enter, Space or a click
 * shows the rest of the page at once. */
const TYPE_RATE = 150;
const PAUSE_MS: Record<string, number> = { ".": 110, "!": 110, "?": 110, ",": 35, ":": 60, ";": 60 };
/** Ordinary prose, to measure the box's average character by. */
const SAMPLE = "I went through the failing checks and fixed the two that were real, then ran the tests again.";
/** The box's gap above the map's foot (CSS px); keep in step with world-chat.css. */
const FOOT_GAP = 18;
/** The highlight that hides what the box hasn't typed yet (world-chat.css). */
const UNTYPED = "world-chat-untyped";
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function" ? CSS.highlights : undefined);

/** The box's composer's input (the panel's is `composer`, which the page's own shortcuts focus). */
const WORLD_COMPOSER = "world-composer";
/** How far the log's keys scroll it: pixels, a share of its height, or to an end. */
const SCROLL_KEYS: Record<string, number> = {
  ArrowDown: 60,
  ArrowUp: -60,
  PageDown: 0.9,
  PageUp: -0.9,
  " ": 0.9,
  End: Infinity,
  Home: -Infinity,
};
/** The beat while its conversation loads. */
const LOADING = "loading";
/** Layers that close on Escape ahead of the box (main.tsx's innermost-layer check, and the top bar's popovers). */
const OTHER_LAYERS = ".popover-menu, .autocomplete, .lightbox, .inline-confirm, .releases-popover, .usage-popover";
/** Where each agent's conversation was left: its beat and page, so coming back doesn't type it again. */
const kept = new Map<string, { beat: string; page: number; read: number }>();

/** The robot as the board paints it, in its provider's colour: calm idle poses at the board's pace (its state is the
 * glow beneath it). */
function Portrait({ provider, state }: { provider: string; state: State }) {
  const frames = useMemo(() => robotFrames(provider, false), [provider]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (frames.length < 2 || reducedMotion()) return;
    const timer = setInterval(() => setFrame((n) => (n + 1) % frames.length), 2000);
    return () => clearInterval(timer);
  }, [frames]);
  const [medallion, setMedallion] = useState<string>();
  useEffect(() => {
    let live = true;
    uiFrame("medallion").then((url) => live && setMedallion(url), () => {});
    return () => {
      live = false;
    };
  }, []);
  const f = frames[frame % frames.length]!;
  // The robot at half the sheet's size: 88 × 95 CSS px.
  const k = 0.5;
  const tint = STATE_TILE[state] ?? 0x8c88b0;
  return (
    <div
      className={`wc-portrait wc-state-${state}`}
      style={{ "--wc-state": `#${tint.toString(16).padStart(6, "0")}`, ...(medallion ? { "--wc-medallion": `url(${medallion})` } : {}) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="wc-glow" />
      <span
        className="wc-robot"
        style={{
          width: f.w * k,
          height: f.h * k,
          backgroundImage: `url(${ROBOTS_URL})`,
          backgroundSize: `${ROBOTS_SHEET.width * k}px ${ROBOTS_SHEET.height * k}px`,
          backgroundPosition: `${-f.x * k}px ${-f.y * k}px`,
        }}
      />
    </div>
  );
}

/** Collect a page's text nodes, in order, as the box types them. */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement?.closest(".md-code-bar") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * A page of Markdown typed out character by character. The page is laid out whole
 * at once (so nothing moves as it types) and what isn't typed yet is hidden by a
 * CSS highlight. `done` shows it all at once; `onDone` says it has finished.
 */
function TypedPage({ text, narrator, done, onDone, scroller }: {
  text: string;
  narrator: boolean;
  done: boolean;
  onDone: () => void;
  scroller: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const finished = useRef(onDone);
  finished.current = onDone;
  useLayoutEffect(() => {
    const registry = highlights();
    const root = ref.current;
    if (!root) return;
    if (done || !registry || reducedMotion()) {
      registry?.delete(UNTYPED);
      if (!done) finished.current();
      return;
    }
    const nodes = textNodes(root);
    const total = nodes.reduce((n, t) => n + t.data.length, 0);
    if (!total) {
      finished.current();
      return;
    }
    const range = new Range();
    const hide = new Highlight(range);
    registry.set(UNTYPED, hide);
    let shown = 0;
    let node = 0;
    let offset = 0;
    let wait = 0;
    let last = performance.now();
    let frame = 0;
    const place = () => {
      // The untyped rest: from the typed point to the page's end.
      const end = nodes.at(-1)!;
      range.setStart(nodes[node]!, Math.min(offset, nodes[node]!.data.length));
      range.setEnd(end, end.data.length);
    };
    place();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (wait > 0) wait -= dt;
      let budget = wait > 0 ? 0 : (dt / 1000) * TYPE_RATE;
      while (budget >= 1 && shown < total) {
        const t = nodes[node]!;
        const ch = t.data[offset] ?? "";
        offset += 1;
        shown += 1;
        budget -= 1;
        if (offset >= t.data.length && node < nodes.length - 1) {
          node += 1;
          offset = 0;
        }
        if (PAUSE_MS[ch] && /\s|^$/.test(t.data[offset] ?? " ")) {
          wait = PAUSE_MS[ch]!;
          break;
        }
      }
      if (shown >= total) {
        registry.delete(UNTYPED);
        finished.current();
        return;
      }
      place();
      // Keep the typed point in view when a page is taller than the box.
      const box = scroller.current;
      if (box && box.scrollHeight > box.clientHeight) {
        const at = new Range();
        at.setStart(nodes[node]!, Math.min(offset, nodes[node]!.data.length));
        const r = at.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      registry.delete(UNTYPED);
    };
  }, [text, done, scroller]);
  return (
    <div ref={ref} className={`wc-page${narrator ? " wc-narrator" : ""}`}>
      <Markdown text={text} />
    </div>
  );
}

/** Answers to an agent's questions, as its question card sends them (keyed by each header). */
function questionAnswers(p: Permission, picked: Set<number>[], other: string[]) {
  const out: Record<string, string> = {};
  (p.questions ?? []).forEach((q, i) => {
    const labels = [...(picked[i] ?? [])].sort((a, b) => a - b).map((n) => q.options[n]!.label);
    const typed = (other[i] ?? "").trim();
    if (q.allowOther && typed) out[q.header] = q.multiSelect ? [...labels, typed].join(", ") : typed;
    else if (labels.length) out[q.header] = labels.join(", ");
    else if (q.allowEmpty && !q.options.length) out[q.header] = "";
  });
  return out;
}

const quote = (text: string) =>
  text.includes("\n") || text.length > 80 ? `\n\n\`\`\`\n${text.replace(/`{3,}/g, "ʼʼʼ")}\n\`\`\`` : ` \`${text.replace(/`/g, "ʼ")}\``;

export function WorldChat(props: WorldChatProps) {
  const { agent, workspace, asks, workingOn, online, onNotice, onClose, position } = props;
  const name = agentName(agent, workspace?.branch);
  const {
    detail,
    entries,
    source,
    unavailable,
    error,
    earlier,
    loadOlder,
    pending,
    busy,
    running,
    archived,
    command,
    send,
    respond,
    promptHistory,
  } = useAgentSession(agent, {
    onNotice,
    onChanged: props.onChanged,
  });
  // Linear keys, PR numbers and its workspace's files link themselves in its log, as in the panel.
  const autolinks = useAutolinks(workspace);
  // As the panel's: its settings are offered only while it has no turn; its modes from its detail, else last seen.
  const started =
    source === null ||
    entries.length > 0 ||
    pending.length > 0 ||
    earlier.more ||
    Boolean(agent.lastUserMessageAt || detail?.LastUserMessageAt);
  const modes: Mode[] = detail?.AvailableModes || readStore<Mode[]>(`modes:${providerName(agent.provider)}`, []);
  // The whole conversation, opened upward over the board (H, or scrolling up past the page's top).
  const { log, onLog: setLog } = props;
  // Files dropped on the box, for its composer.
  const [drop, setDrop] = useState<{ files: File[]; at: number } | null>(null);
  // Writing: a reply in the composer, or a question's own answer.
  const [entry, setEntry] = useState<Entry | null>(null);
  const [actionsHidden, setActionsHidden] = useState(false);
  const queued = useQueue(agent.id);
  const sent = pending.at(-1)?.text;
  const x = useMemo(() => exchangeOf(entries, sent), [entries, sent]);
  const permission = detail?.PendingPermissions?.[0];
  const offline = Boolean(agent.stale) || !online;
  const working = isWorking(agent) || running;
  // What you say now waits in its queue (as the composer's does): only while it runs itself, not its subagents.
  const queues = running || isRunning(agent.status);
  const state: State = offline
    ? "offline"
    : permission || props.waiting
      ? props.question || permission?.questions?.length
        ? "question"
        : "approval"
      : working
        ? "running"
        : isFailed(agent.status)
          ? "failed"
          : asks?.waiting
            ? "asking"
            : props.unread
              ? "done"
              : "idle";

  // The text area's room, measured, sets how much a page holds.
  const root = useRef<HTMLDivElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  // How far the wheel has gone up past the page's top (enough opens the log).
  const wheelUp = useRef(0);
  const [room, setRoom] = useState<PageRoom>({ perLine: 80, lines: 5 });
  useLayoutEffect(() => {
    const node = root.current;
    // The log lies over the board: the camera keeps the box's own room.
    if (!node || log || typeof ResizeObserver === "undefined") return;
    const measure: (() => void) & { canvas?: HTMLCanvasElement } = () => {
      props.onInset(Math.ceil(node.getBoundingClientRect().height + FOOT_GAP));
      const box = textBox.current;
      if (!box?.clientWidth) return;
      const style = getComputedStyle(box);
      const size = parseFloat(style.fontSize) || 15;
      const line = parseFloat(style.lineHeight) || size * 1.5;
      // Its font's real average character, with a little slack for lines wrapping at words.
      const ctx = (measure.canvas ??= document.createElement("canvas")).getContext("2d");
      let avg = size * 0.5;
      if (ctx) {
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        avg = ctx.measureText(SAMPLE).width / SAMPLE.length || avg;
      }
      const perLine = Math.max(24, Math.floor(box.clientWidth / (avg * 1.08)));
      const lines = Math.max(3, Math.floor((box.clientHeight - 4) / line));
      setRoom((r) => (r.perLine === perLine && r.lines === lines ? r : { perLine, lines }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (textBox.current) observer.observe(textBox.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inset callback is the parent's setter
  }, [log, entry]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // A question's picks and typed answers, by question; reset for each request.
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<Set<number>[]>([]);
  const [other, setOther] = useState<string[]>([]);
  const permissionId = permission?.id ?? "";
  // Progress messages while it works don't reopen actions after a send. A finished reply or a new request can.
  useEffect(() => {
    if (permissionId || (!working && !pending.length && x.reply && !x.earlier)) setActionsHidden(false);
  }, [agent.id, x.reply?.id, x.earlier, permissionId, working, pending.length]);
  useEffect(() => {
    setQi(0);
    setPicked((permission?.questions ?? []).map(() => new Set()));
    setOther((permission?.questions ?? []).map(() => ""));
    // An answer being typed belongs to the request that asked for it.
    setEntry((e) => {
      if (e === "answer") setDraft("");
      return e === "answer" ? null : e;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [permissionId]);
  useEffect(() => {
    setEntry(null);
    setDraft("");
  }, [agent.id]);

  /** Say something to it: sent now, or queued while it works (as the panel's composer does). */
  const say = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return false;
      if (queues) {
        try {
          await enqueue(agent.id, body, []);
          onNotice(`Queued: ${name} gets it when it finishes.`);
          return true;
        } catch (e) {
          onNotice(errorMessage(e));
          return false;
        }
      }
      return send(toOutgoing(body, []));
    },
    [queues, agent.id, name, onNotice, send],
  );
  const reply = useCallback(
    (text: string) => {
      setSending(true);
      void say(text).then((ok) => {
        setSending(false);
        if (ok) {
          setActionsHidden(true);
          setEntry(null);
          setDraft("");
        }
      });
    },
    [say],
  );
  const submitAnswers = (p: Permission, picks: Set<number>[], typed: string[]) =>
    void respond(p, { behavior: "allow", answers: questionAnswers(p, picks, typed) });

  const common = (canReply: boolean): Choice[] => [
    ...(canReply
      ? [
          {
            id: "reply",
            label: working ? "Send a follow-up…" : "Reply…",
            hint: queues ? "It goes when it finishes" : undefined,
            run: () => setEntry("reply"),
          },
        ]
      : []),
    { id: "chat", label: "Open the full chat", hint: "In the side panel", run: props.onOpenChat },
    { id: "leave", label: "Leave", hint: "Esc", run: onClose },
  ];

  const beat: Beat = (() => {
    const replyPages = (text: string, caption?: string): Line[] =>
      pageReply(text, room).map((page, i) => ({ who: "agent", text: page, caption: i === 0 ? caption : undefined }));
    if (offline) {
      const last = x.reply ? replyPages(x.reply.text, "Last known reply") : [];
      return {
        id: `offline:${x.reply?.id ?? ""}`,
        pages: [
          ...last,
          { who: "narrator", text: `*${name}'s host isn't answering, so it can't hear you now.*`, caption: "Offline" },
        ],
        choices: common(false),
      };
    }
    if (permission?.questions?.length) {
      const qs = permission.questions;
      const i = Math.min(qi, qs.length - 1);
      const q = qs[i]!;
      const picks = picked[i] ?? new Set<number>();
      const answered = picks.size > 0 || (q.allowEmpty && !q.options.length);
      const caption = [q.header, qs.length > 1 ? `${i + 1} of ${qs.length}` : "", q.multiSelect ? "Choose any" : ""]
        .filter(Boolean)
        .join(" · ");
      const next = (picks2: Set<number>[], typed: string[]) => {
        if (i < qs.length - 1) setQi(i + 1);
        else submitAnswers(permission, picks2, typed);
      };
      const choose = (n: number) => {
        const all = qs.map((_, j) => new Set(picked[j] ?? []));
        if (q.multiSelect) {
          if (all[i]!.has(n)) all[i]!.delete(n);
          else all[i]!.add(n);
          setPicked(all);
        } else {
          all[i] = new Set([n]);
          const typed = other.map((t, j) => (j === i ? "" : t));
          setPicked(all);
          setOther(typed);
          next(all, typed);
        }
      };
      return {
        id: `question:${permission.id}:${i}`,
        pages: replyPages(q.question || "(no question text)", caption),
        choices: [
          ...q.options.map((o, n) => ({
            id: `option-${n}`,
            label: o.label,
            hint: o.description,
            checked: q.multiSelect ? picks.has(n) : undefined,
            run: () => choose(n),
          })),
          ...(q.allowOther ? [{ id: "other", label: "Something else…", run: () => setEntry("answer") }] : []),
          ...(q.multiSelect || (q.allowEmpty && !q.options.length)
            ? [{ id: "done", label: i < qs.length - 1 ? "Next question" : "Send the answers", disabled: !answered, run: () => next(picked, other) }]
            : []),
          ...(i > 0 ? [{ id: "back", label: "Back to the last question", run: () => setQi(i - 1) }] : []),
          {
            id: "decline",
            label: "Decline to answer",
            hint: "It carries on without",
            tone: "deny" as const,
            run: () => void respond(permission, { behavior: "deny" }),
          },
          ...common(false),
        ],
      };
    }
    if (permission) {
      const pages: Line[] = permission.plan
        ? replyPages(permission.plan, "Proposed plan")
        : [
            {
              who: "narrator",
              caption: "Approval requested",
              text: `*${name} asks to use* **${permission.name}**${
                permission.description && permission.description !== "-" ? quote(permission.description) : "."
              }${
                permission.detail && permission.detail !== permission.description
                  ? quote(permission.detail.length > 600 ? `${permission.detail.slice(0, 600)}…` : permission.detail)
                  : ""
              }`,
            },
          ];
      return {
        id: `permission:${permission.id}`,
        pages,
        choices: [
          ...(permission.actions?.length
            ? permission.actions.map((a) => ({
                id: `action-${a.id}`,
                label: a.label,
                tone: a.behavior,
                run: () => void respond(permission, { behavior: a.behavior, actionId: a.id }),
              }))
            : [
                {
                  id: "allow",
                  label: permission.plan ? "Approve the plan" : "Allow",
                  tone: "allow" as const,
                  run: () => void respond(permission, { behavior: "allow" }),
                },
                {
                  id: "deny",
                  label: permission.plan ? "Reject the plan" : "Deny",
                  tone: "deny" as const,
                  run: () => void respond(permission, { behavior: "deny" }),
                },
              ]),
          ...common(false),
        ],
      };
    }
    if (props.waiting)
      return {
        id: "waiting",
        live: true,
        pages: [{ who: "narrator", text: `*${name} is waiting for you. Its request is on its way…*`, caption: "Needs you" }],
        choices: common(false),
      };
    if (working) {
      const now = workingOn?.sentence || x.doing;
      return {
        id: "working",
        live: true,
        pages: [
          {
            who: "narrator",
            caption: x.asked ? `You said: ${x.asked}` : "Working",
            text: `*${name} is working${now ? ":" : "…"}*${now ? ` ${now}` : ""}`,
          },
        ],
        choices: [
          ...common(true).slice(0, 1),
          ...(running ? [{ id: "interrupt", label: "Interrupt", hint: "Stop its turn", tone: "deny" as const, run: () => void command("cancel", {}, "Agent interrupted") }] : []),
          ...common(true).slice(1),
        ],
      };
    }
    if (pending.length)
      return {
        id: "sent",
        live: true,
        pages: [{ who: "narrator", caption: `You said: ${x.asked ?? ""}`, text: `*Sent. Waiting for ${name} to start…*` }],
        choices: common(false),
      };
    if (x.reply && !x.earlier) {
      const question = asks && !asks.pending && !working ? asks.questions.find((q) => quickReplies(q)?.length) : undefined;
      return {
        id: `reply:${x.reply.id}${x.failure ? ":failed" : ""}`,
        pages: [
          ...replyPages(x.reply.text),
          ...(x.failure ? [{ who: "narrator" as const, caption: "Failed", text: `*The run failed:* ${x.failure}` }] : []),
        ],
        choices: [
          ...(question
            ? (quickReplies(question) ?? []).slice(0, 4).map((answer, n) => ({
                id: `quick-${n}`,
                label: `“${answer}”`,
                hint: n === 0 ? "Answers its question" : undefined,
                run: () => reply(answersMessage([{ id: "q", question: question.text, answer }], "")),
              }))
            : []),
          ...(asks?.suggestion && !asks.pending
            ? [{ id: "suggest", label: `“${asks.suggestion}”`, hint: "You might say", run: () => reply(asks.suggestion!) }]
            : []),
          ...common(true),
        ],
      };
    }
    if (x.failure)
      return {
        id: `failure:${x.failure}`,
        pages: [{ who: "narrator", caption: "Failed", text: `*The run failed:* ${x.failure}` }],
        choices: common(true),
      };
    if (!source && !unavailable && error)
      return {
        id: "error",
        live: true,
        pages: [{ who: "narrator", caption: "Couldn't read it", text: `*Its conversation couldn't be read: ${error}*` }],
        choices: common(false),
      };
    if (!source && !unavailable)
      return { id: LOADING, live: true, pages: [{ who: "narrator", text: "*…*" }], choices: common(false) };
    return {
      id: x.asked ? "unanswered" : "quiet",
      pages: [
        {
          who: "narrator",
          caption: x.asked ? `You said: ${x.asked}` : undefined,
          text: unavailable
            ? `*${unavailable}*`
            : x.asked
              ? `*${name} hasn't answered that.*`
              : `*${name} hasn't said anything yet.*`,
        },
      ],
      choices: common(true),
    };
  })();

  // Paging: where the box is in its beat, and whether the page is fully typed.
  const [place, setPlace] = useState(() => {
    const k = kept.get(agent.id);
    return k ? { beat: k.beat, page: k.page, read: k.read } : { beat: "", page: 0, read: -1 };
  });
  const atBeat = place.beat === beat.id ? place : { beat: beat.id, page: 0, read: -1 };
  // While its conversation loads, the place it was left in waits (the beat it was is coming back).
  useEffect(() => {
    if (beat.id !== LOADING && place.beat !== beat.id) setPlace({ beat: beat.id, page: 0, read: beat.live ? 0 : -1 });
  }, [beat.id, beat.live, place.beat]);
  useEffect(() => {
    if (beat.id !== LOADING) kept.set(agent.id, atBeat);
  }, [agent.id, atBeat, beat.id]);
  const pages = beat.pages.length ? beat.pages : [{ who: "narrator" as const, text: "*…*" }];
  const page = Math.min(atBeat.page, pages.length - 1);
  const typed = beat.live || atBeat.read >= page;
  const last = page >= pages.length - 1;
  const choicesShown = last && typed && !entry && !actionsHidden;
  /** Pages already typed stay typed: `read` is the furthest page typed out. */
  const go = (to: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, to));
    setPlace((p) => ({ beat: beat.id, page: next, read: p.beat === beat.id ? p.read : -1 }));
    textBox.current?.scrollTo({ top: 0 });
  };
  const finishPage = () => setPlace((p) => ({ beat: beat.id, page, read: Math.max(p.beat === beat.id ? p.read : -1, page) }));
  /** Enter, Space or a click: finish the line, else go on to the next page. */
  const advance = () => {
    if (!typed) return finishPage();
    if (!last) return go(page + 1);
    setActionsHidden(false);
  };
  const showActions = () => {
    setLog(false);
    setEntry(null);
    setActionsHidden(false);
    setPlace({ beat: beat.id, page: pages.length - 1, read: pages.length - 1 });
    root.current?.focus({ preventScroll: true });
  };

  // The marked choice, by id: choices that arrive later (its asks judged, Interrupt as it starts) never move the mark.
  const choices = beat.choices;
  const [marked, setMarked] = useState<string>();
  useEffect(() => setMarked(undefined), [beat.id]);
  const cursor = Math.max(0, choices.findIndex((c) => c.id === marked));
  const setCursor = (n: number) => setMarked(choices[n]?.id);
  const pick = (c: Choice | undefined) => {
    if (!c || c.disabled || busy || sending) return;
    c.run();
  };

  // Keys: the box takes them while it or the map has the keyboard (not while typing elsewhere).
  const keyState = { advance, go, page, pages: pages.length, typed, choicesShown: choicesShown && !log, choices, cursor, setCursor, entry, pick, onClose, blocked: props.blocked, log, setLog, position, showActions };
  const live = useRef(keyState);
  live.current = keyState;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = live.current;
      if (s.blocked || modalOpen() || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (isTyping(target)) return;
      // The composer's own menus (send options, attachments) keep their keys.
      if (target?.closest?.(".popover-menu")) return;
      const inBox = !!target && !!root.current?.contains(target);
      // The map's frame (its surface, this box), never the page at large: a key after a click in the panel is the panel's.
      const onMap = !!target?.closest?.(".native-world-frame");
      if (!inBox && !onMap) return;
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const key = e.key;
      const logView = () => root.current?.querySelector<HTMLElement>(".wc-log .timeline");
      if (key === "Escape") {
        // An open popover or menu closes first.
        if (document.querySelector(OTHER_LAYERS)) return;
        take();
        if (s.entry) setEntry(null);
        else if (s.log) s.setLog(false);
        else s.onClose();
      } else if (!e.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        // The previous or next robot (as J/K step), its conversation in the box.
        if (s.position.total < 2) return;
        take();
        if (!e.repeat) (key === "ArrowLeft" ? s.position.prev : s.position.next)();
      } else if (key.toLowerCase() === "h" && !e.shiftKey) {
        take();
        s.setLog(!s.log);
      } else if (s.log) {
        // The log: Enter or R writes in its composer; the arrows and page keys scroll it.
        const view = logView();
        // Its own buttons, links and folds (a request's Allow, Load earlier, a tool's details) keep Enter and Space.
        if ((key === "Enter" || key === " ") && inBox && target !== root.current && target?.closest("button,a[href],summary")) return;
        if (key === "Enter" || key.toLowerCase() === "r") {
          take();
          document.getElementById(WORLD_COMPOSER)?.focus();
        } else if (inBox && view && SCROLL_KEYS[key] !== undefined) {
          take();
          // The reader's own scroll (as a wheel's), so the log doesn't pin itself back to its latest.
          view.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
          const step = SCROLL_KEYS[key]!;
          if (step === Infinity || step === -Infinity) view.scrollTop = step > 0 ? view.scrollHeight : 0;
          else view.scrollBy({ top: Math.abs(step) < 1 ? step * view.clientHeight : step });
        }
      } else if (key === "Enter" || key === " ") {
        // A focused button or link of the box's own does what it says.
        if (inBox && target !== root.current && target?.closest("button,a[href]")) return;
        take();
        // Held down, it finishes the page as it types, never skipping pages.
        if (e.repeat) {
          if (!s.typed) s.advance();
          return;
        }
        if (s.choicesShown) s.pick(s.choices[s.cursor]);
        else s.advance();
      } else if (/^[1-9]$/.test(key) && s.choicesShown) {
        take();
        s.pick(s.choices[Number(key) - 1]);
      } else if ((key === "ArrowDown" || key === "ArrowUp") && inBox) {
        // Never J/K's next robot while the box has the keyboard.
        take();
        const n = s.choices.length;
        if (s.choicesShown && n) s.setCursor((s.cursor + (key === "ArrowDown" ? 1 : n - 1)) % n);
      } else if (key === "End" || key === "PageDown") {
        take();
        s.go(s.pages - 1);
      } else if (key === "Home" && inBox) {
        take();
        s.go(0);
      } else if (key.toLowerCase() === "r" && !s.entry) {
        const replyChoice = s.choices.find((c) => c.id === "reply");
        if (!replyChoice) return;
        take();
        replyChoice.run();
      }
    };
    // Capture: ahead of the map surface's keys (Escape there clears the selection) and the page's own.
    window.addEventListener("keydown", onKey, true);
    const offActions = onAppCommand("world-talk-actions", () => live.current.showActions());
    return () => { window.removeEventListener("keydown", onKey, true); offActions(); };
  }, []);

  // The box has the keyboard as it opens and as it changes speaker, unless you're typing elsewhere.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (isTyping(active) && !root.current?.contains(active)) return;
    root.current?.focus({ preventScroll: true });
  }, [agent.id]);
  useLayoutEffect(() => {
    const node = root.current;
    return () => {
      // Leaving gives the keyboard back to the map (Escape there then clears the selection). A layout cleanup runs
      // while the box is still in the page, so it can still tell it had the keyboard.
      const active = document.activeElement;
      if (node && (node.contains(active) || active === document.body))
        document.querySelector<HTMLElement>(".native-map-surface")?.focus({ preventScroll: true });
    };
  }, []);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (entry === "answer") field.current?.focus();
    else if (entry === "reply") document.getElementById(WORLD_COMPOSER)?.focus();
    // The field gone (sent, or Esc), the box has the keyboard again: by now the page's focus fell to the body.
    else if (root.current && (document.activeElement === document.body || root.current.contains(document.activeElement)))
      root.current.focus({ preventScroll: true });
  }, [entry]);

  useEffect(() => {
    // The log has its own composer: neither of the box's entries stays open under it.
    setEntry((e) => (log || e === "reply" ? null : e));
    if (root.current && (document.activeElement === document.body || root.current.contains(document.activeElement)))
      root.current.focus({ preventScroll: true });
  }, [log]);
  // Dropped files go to the composer as it mounts; then they're spent (its effect has taken them).
  useEffect(() => {
    if (drop) setDrop(null);
  }, [drop]);
  const [panel, setPanel] = useState<string>();
  const [label, setLabel] = useState<string>();
  useEffect(() => {
    let live = true;
    uiFrame("panel").then((url) => live && setPanel(url), () => {});
    uiFrame("label").then((url) => live && setLabel(url), () => {});
    return () => {
      live = false;
    };
  }, []);

  const line = pages[page]!;
  const sendEntry = () => {
    const text = draft.trim();
    if (entry === "answer" && permission?.questions?.length) {
      if (!text) return;
      const qs = permission.questions;
      const i = Math.min(qi, qs.length - 1);
      const typedAll = other.map((t, j) => (j === i ? text : t));
      const picks = picked.map((s, j) => (j === i && !qs[i]!.multiSelect ? new Set<number>() : s));
      setOther(typedAll);
      setPicked(picks);
      setEntry(null);
      setDraft("");
      if (i < qs.length - 1) setQi(i + 1);
      else submitAnswers(permission, picks, typedAll);
      return;
    }
    reply(text);
  };
  const frame = (url: string | undefined) => (url ? ({ "--wc-frame": `url(${url})` } as CSSProperties) : undefined);
  const stateName = state === "running" && !running && agent.subagentsRunning ? "Working · its subagents run" : STATE_NAMES[state];
  const tint = `#${(STATE_TILE[state] ?? 0x8c88b0).toString(16).padStart(6, "0")}`;
  const more = !last;
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

  // The app's own composer, in the box's colours: files and images, /skills, @files, queueing, steer and interrupt.
  const composer = (
    <div
      className="wc-composer"
      onKeyDownCapture={(e) => {
        // Escape leaves the composer for the box (its own menus and suggestions close first).
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        if (root.current?.querySelector(".autocomplete, .popover-menu")) return;
        e.preventDefault();
        e.stopPropagation();
        if (log) root.current?.focus({ preventScroll: true });
        else setEntry(null);
      }}
    >
      <Composer
        key={agent.id}
        agent={agent}
        running={running}
        disabled={offline || archived}
        disabledReason={archived ? "This agent is archived." : "Paseo is offline."}
        started={started}
        modes={modes}
        mode={detail?.Mode}
        onSetMode={(mode) => void command("mode", { mode }, `Mode set to ${modes.find((m) => m.id === mode)?.label || mode}`)}
        onSend={async (message) => {
          const ok = await send(message);
          if (ok) { setActionsHidden(true); setEntry((e) => (e === "reply" ? null : e)); }
          return ok;
        }}
        onQueued={() => { setActionsHidden(true); setEntry((e) => (e === "reply" ? null : e)); }}
        onCancel={async () => {
          await command("cancel", {}, "Agent interrupted");
        }}
        onNotice={onNotice}
        onArchive={() => onNotice("Archive it from its conversation in the side panel (Open the full chat).")}
        onFreshDraft={() => onNotice("Start afresh from its conversation in the side panel (Open the full chat).")}
        promptHistory={promptHistory}
        dropFiles={drop}
        inputId={WORLD_COMPOSER}
        draftScope=":world"
        label={`Message ${name}`}
        placeholder={queues ? `A follow-up for ${name} (it goes when it finishes)…` : `Say something to ${name}…`}
      />
    </div>
  );

  return (
    <div
      ref={root}
      className={`world-chat${log ? " log" : ""}${entry === "reply" ? " replying" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={`Conversation with ${name}`}
      aria-describedby={log ? undefined : "world-chat-line"}
      tabIndex={-1}
      style={frame(panel)}
      data-state={state}
      data-beat={beat.id}
      onDragOver={(e) => {
        if (!hasFiles(e) || offline || archived) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!hasFiles(e) || offline || archived) return;
        e.preventDefault();
        setDrop({ files: [...e.dataTransfer.files], at: Date.now() });
        if (!log) setEntry("reply");
      }}
    >
      <div className="wc-nameplate" style={frame(label)}>
        <span className="wc-name">{name}</span>
      </div>
      <button type="button" className="wc-close" aria-label="Leave the conversation (Esc)" tabIndex={-1} onClick={onClose}>
        ×
      </button>
      {position.total > 1 && (
        <nav className="wc-navigation" aria-label="Agents">
          <button
            type="button"
            className="wc-nav prev"
            style={{ backgroundImage: `url(${navigationArt})` }}
            aria-label={`Previous agent${position.prevName ? `: ${position.prevName}` : ""} (←)`}
            title={`Previous agent${position.prevName ? `: ${position.prevName}` : ""}`}
            onClick={(e) => { e.stopPropagation(); position.prev(); }}
          >
            <span className="sr-only">Previous agent</span>
          </button>
          <button
            type="button"
            className="wc-nav next"
            style={{ backgroundImage: `url(${navigationArt})` }}
            aria-label={`Next agent${position.nextName ? `: ${position.nextName}` : ""} (→)`}
            title={`Next agent${position.nextName ? `: ${position.nextName}` : ""}`}
            onClick={(e) => { e.stopPropagation(); position.next(); }}
          >
            <span className="sr-only">Next agent</span>
          </button>
        </nav>
      )}
      <Portrait provider={agent.provider} state={state} />
      <div className="wc-body">
        <div className="wc-head">
          <button
            type="button"
            className="wc-log-toggle"
            aria-expanded={log}
            aria-label={log ? "Back to the dialogue box (H)" : "Show the whole conversation (H)"}
            onClick={() => setLog(!log)}
          >
            <span>{log ? "Back" : "Conversation"}</span>
            <kbd className="wc-key">H</kbd>
          </button>

          <span className="wc-caption">
            {log
              ? `Conversation${position.total > 1 && position.index >= 0 ? ` · ${position.index + 1} of ${position.total}` : ""}`
              : entry
                ? entry === "answer"
                  ? "Your answer"
                  : queues
                    ? "A follow-up"
                    : "Your reply"
                : line.caption}
          </span>
          <span className="wc-status">
            <span className="wc-dot" style={{ background: tint }} />
            {stateName}
            <span className="wc-model">· {modelName(agent.provider)}</span>
            {queued.length > 0 && <span className="wc-queued">· {queued.length} queued</span>}
          </span>
        </div>
        {log ? (
          <div
            className="wc-log"
            onClickCapture={(e) => {
              if (!openFileLink(e, workspace, onNotice)) openInAppBrowser(e);
            }}
          >
            <Timeline
              key={agent.id}
              entries={entries}
              loading={source === null && !error}
              imageHost={agent.host}
              running={running}
              pending={pending}
              unavailable={unavailable}
              error={error}
              earlier={earlier}
              onEarlier={loadOlder}
              links={autolinks}
            />
            {detail?.PendingPermissions.map((p, i) => (
              <PermissionCard
                imageHost={agent.host}
                key={p.id || i}
                permission={p}
                busy={!!busy}
                onRespond={(decision) => void respond(p, decision)}
              />
            ))}
            {composer}
          </div>
        ) : entry === "reply" ? (
          composer
        ) : (
          <>
            <div
              ref={textBox}
              id="world-chat-line"
              className="wc-text"
              aria-live="polite"
              onClick={(e) => {
                if (openFileLink(e, workspace, onNotice)) return;
                if ((e.target as Element).closest?.("a[href]")) return openInAppBrowser(e);
                if (!entry) advance();
              }}
              onWheel={(e) => {
                // Scrolling up past the page's top opens the whole conversation.
                const box = e.currentTarget;
                if (entry || e.deltaY >= 0 || box.scrollTop > 0) {
                  wheelUp.current = 0;
                  return;
                }
                wheelUp.current += -e.deltaY;
                if (wheelUp.current > 80) {
                  wheelUp.current = 0;
                  setLog(true);
                }
              }}
            >
              {entry === "answer" ? (
                <div className="wc-entry">
                  <textarea
                    ref={field}
                    className="wc-field"
                    rows={3}
                    value={draft}
                    disabled={sending}
                    aria-label="Your answer"
                    placeholder="Your answer…"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEntry(null);
                      } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        sendEntry();
                      }
                    }}
                  />
                  <div className="wc-entry-foot">
                    <span>↩ Answer · ⇧↩ New line · Esc Back</span>
                    <button type="button" className="wc-send" disabled={sending || !draft.trim()} onClick={sendEntry}>
                      Answer
                    </button>
                  </div>
                </div>
              ) : (
                <TypedPage
                  key={`${beat.id}:${page}`}
                  text={line.text}
                  narrator={line.who === "narrator"}
                  done={typed}
                  onDone={finishPage}
                  scroller={textBox}
                />
              )}
            </div>
            {!entry && (
              <div className="wc-foot">
                {last && typed && actionsHidden && <button type="button" className="wc-actions" aria-label="Show conversation actions (Enter)" aria-controls="world-chat-choices" aria-expanded={false} onClick={showActions}>Actions <kbd className="wc-key">⏎</kbd></button>}
                {pages.length > 1 && (
                  <span className="wc-pages">
                    {page + 1} / {pages.length}
                  </span>
                )}
                {typed && more && (
                  <button type="button" className="wc-more" tabIndex={-1} aria-label="Next page (Enter)" onClick={advance}>
                    ▼
                  </button>
                )}
                {!typed && (
                  <button type="button" className="wc-skip" tabIndex={-1} aria-label="Show the whole page (Enter)" onClick={finishPage}>
                    <kbd className="wc-key">⏎</kbd> Skip
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {choicesShown && !log && (
        <Choices
          choices={choices}
          cursor={cursor}
          busy={busy !== null || sending}
          frame={frame(panel)}
          onHover={setCursor}
          onPick={pick}
        />
      )}
    </div>
  );
}

function Choices({ choices, cursor, busy, frame, onHover, onPick }: {
  choices: Choice[];
  cursor: number;
  busy: boolean;
  frame?: CSSProperties;
  onHover: (n: number) => void;
  onPick: (c: Choice) => void;
}): ReactNode {
  return (
    <div className="wc-choices" id="world-chat-choices" role="menu" aria-label="What you can say" style={frame} aria-busy={busy || undefined}>
      {choices.map((c, n) => (
        <button
          key={c.id}
          type="button"
          role={c.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={c.checked}
          tabIndex={-1}
          className={`wc-choice${n === cursor ? " current" : ""}${c.tone ? ` ${c.tone}` : ""}`}
          data-choice={c.id}
          disabled={c.disabled || busy}
          onPointerEnter={() => onHover(n)}
          onClick={() => onPick(c)}
        >
          <span className="wc-cursor" aria-hidden="true">
            ▶
          </span>
          {n < 9 && <kbd className="wc-key">{n + 1}</kbd>}
          {c.checked !== undefined && (
            <span className="wc-check" aria-hidden="true">
              {c.checked ? "☑" : "☐"}
            </span>
          )}
          <span className="wc-label">
            {c.label}
            {c.hint && <small>{c.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

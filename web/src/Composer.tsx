import { soundEvent } from "./soundCues";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { GitPullRequest, ImagePlus, Plus, Upload } from "lucide-react";
import { errorMessage, readStore, removeStore, writeStore } from "./api";
import type { Agent, Mode } from "./types";
import { pastedText } from "./paste";
import { enqueue, toOutgoing, type Queued } from "./queue";
import { Lightbox } from "./Images";
import { modalOpen } from "./focus";
import { AgentControls } from "./composer/AgentControls";
import { AnswerList } from "./composer/AnswerList";
import { AskStrip } from "./composer/AskStrip";
import { answersMessage, quickReplies, type Answer } from "./composer/answers";
import type { Asks } from "./asks/types";
import { AttachmentTray } from "./composer/AttachmentTray";
import { Autocomplete } from "./composer/Autocomplete";
import { GitHubPicker } from "./composer/GitHubPicker";
import { Menu } from "./composer/Menu";
import { QueueList } from "./composer/QueueList";
import { SendControls } from "./composer/SendControls";
import type {
  Attachment,
  Behavior,
  ImageAttachment,
  Outgoing,
} from "./composer/types";
import { useAddFiles, useAttachmentDraft } from "./composer/useAttachments";
import { useAutocomplete, type DraftSource } from "./composer/useAutocomplete";
import { insertAtCaret, uid } from "./composer/util";
import "./composer.css";
import { plainText } from "./ui";

// The composer's pieces live in src/composer/; importers keep using this module.
export type {
  Attachment,
  Behavior,
  ImageAttachment,
  Outgoing,
} from "./composer/types";
export {
  MAX_IMAGE,
  MOD,
  RASTER,
  insertAtCaret,
  readDataUrl,
} from "./composer/util";

/** The composer of an agent not yet started (the New agent view): its first
 * message goes to `onSend`, which creates the agent. */
export type ComposerDraft = {
  /** Where /skills and @files come from, once a folder is chosen. */
  source?: DraftSource;
  host?: string;
  /** Provider, model, thinking and mode pickers, in place of the agent's. */
  controls: ReactNode;
};

// ── Composer ─────────────────────────────────────────────────────────────────
export function Composer({
  activity,
  agent,
  draft,
  running,
  disabled,
  disabledReason,
  started,
  modes,
  mode,
  onSetMode,
  onSend,
  onCancel,
  onNotice,
  onArchive,
  onFreshDraft,
  promptHistory,
  dropFiles,
  answerQuote,
  replyAsks,
  inputId = "composer",
  label = "Message agent...",
  placeholder: hint,
  draftOwner = "dispatch",
}: {
  /** Current-work summary, kept with the sticky input. */
  activity?: ReactNode;
  /** The agent written to; absent for a `draft`. */
  agent?: Agent;
  draft?: ComposerDraft;
  running: boolean;
  disabled: boolean;
  disabledReason?: string;
  /** The conversation has a turn: its settings are shown, not offered. */
  started: boolean;
  modes: Mode[];
  mode?: string;
  onSetMode: (id: string) => void;
  onSend: (message: Outgoing) => Promise<boolean>;
  onCancel: () => Promise<void>;
  onNotice: (message: string) => void;
  onArchive: () => void;
  /** Archive and start a new draft; `keepSettings` carries over the
   *  agent's provider, model, thinking and mode (/clear). */
  onFreshDraft: (keepSettings?: boolean) => void;
  promptHistory: string[];
  /** Files dropped anywhere on the session panel. */
  dropFiles: { files: File[]; at: number } | null;
  /** A question quoted from the agent's reply, to answer in this message. */
  answerQuote?: { text: string; at: number } | null;
  /** What the agent's last reply asks, as a decision model judged it. */
  replyAsks?: Asks;
  /** The input's id: `composer` is the one the shortcuts focus. */
  inputId?: string;
  label?: string;
  placeholder?: string;
  /** Whose draft a `draft` composer keeps (a new agent's by default). */
  draftOwner?: string;
}) {
  // A new agent's draft is kept as the dispatch draft always was.
  const owner = agent ? agent.id : draftOwner;
  const draftKey = `draft:${owner}`;
  const host = agent ? agent.host : draft?.host;
  const [text, setText] = useState(() => readStore(draftKey, ""));
  const [attachments, setAttachments] = useAttachmentDraft(owner);
  const answersKey = `answers:${owner}`;
  const [answers, setAnswers] = useState<Answer[]>(() =>
    readStore<Answer[]>(answersKey, []),
  );
  const [focusAnswer, setFocusAnswer] = useState<string | null>(null);
  // The reply whose detected questions were dismissed.
  const dismissKey = `asks-dismissed:${owner}`;
  const [dismissed, setDismissed] = useState(() => readStore(dismissKey, ""));
  const askedIn =
    replyAsks?.messageId ??
    replyAsks?.questions.map((q) => q.text).join("\n") ??
    "";
  const offered =
    !replyAsks || dismissed === askedIn
      ? []
      : replyAsks.questions.filter(
          (q) => !answers.some((a) => a.question === q.text),
        );
  const addAnswer = (question: string, options?: string[], answer = "") => {
    const id = uid();
    setAnswers((all) => [...all, { id, question, answer, options }]);
    setFocusAnswer(id);
  };
  const [defaultBehavior, setDefaultBehavior] = useState<Behavior>(() =>
    readStore<Behavior>("send-behavior", "queue"),
  );
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<"attach" | "send" | "github" | null>(null);
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  const [caret, setCaret] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const area = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Empty drafts and queues are removed, not stored, for every agent ever opened.
  useEffect(() => {
    if (text) writeStore(draftKey, text);
    else removeStore(draftKey);
  }, [draftKey, text]);
  useEffect(() => {
    if (answers.length) writeStore(answersKey, answers);
    else removeStore(answersKey);
  }, [answersKey, answers]);
  useEffect(() => {
    const question = answerQuote?.text.trim();
    if (!question) return;
    const id = uid();
    setAnswers((all) => [...all, { id, question, answer: "" }]);
    setFocusAnswer(id);
  }, [answerQuote]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  // ── Attachments ──
  const addFiles = useAddFiles(agent?.id, host, onNotice, setAttachments);
  useEffect(() => {
    if (dropFiles?.files.length) void addFiles(dropFiles.files);
  }, [dropFiles, addFiles]);
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    // Attach the files; keep any text unless it only names those files.
    const extra = pastedText(
      files.map((f) => f.name),
      e.clipboardData.getData("text/plain"),
      e.clipboardData.getData("text/uri-list"),
    );
    if (extra) insertAtCaret(e.currentTarget, extra);
    void addFiles(
      files.map((f, i) =>
        f.name ? f : new File([f], `pasted-${i + 1}.png`, { type: f.type }),
      ),
    );
  };
  const removeAttachment = useCallback(
    (id: string) => setAttachments((all) => all.filter((x) => x.id !== id)),
    [setAttachments],
  );

  // ── Autocomplete: /commands and @files at the start of any word ──
  const suggestions = useAutocomplete({
    agentId: agent?.id,
    draft: draft?.source,
    host,
    before: text.slice(0, caret),
    focused,
  });
  const { trigger, open, matches, active, setActive } = suggestions;
  const choose = (index: number) => {
    const m = matches[index];
    if (!m || !trigger) return;
    if ("command" in m && m.command?.kind === "client") {
      setText("");
      if (m.command.name === "archive") onArchive();
      else onFreshDraft(m.command.name === "clear");
      return;
    }
    const insert =
      "command" in m && m.command
        ? `/${m.command.name} `
        : "file" in m && m.file
          ? `@${m.file.path}${m.file.kind === "directory" ? "/" : " "}`
          : "";
    setText(text.slice(0, trigger.start) + insert + text.slice(caret));
    requestAnimationFrame(() => placeCaret(trigger.start + insert.length));
  };
  const placeCaret = (pos: number) => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
    setCaret(pos);
  };

  // ── Sending ──
  const ready = attachments.every(
    (a) => a.kind !== "file" || a.status === "ready",
  );
  const hasContent =
    Boolean(answersMessage(answers, text)) || attachments.length > 0;
  /** Send the draft; `only`, in place of its answers, for a quick reply. */
  const submit = async (how: Behavior = defaultBehavior, only?: Answer[]) => {
    const asked = only ?? answers;
    const value = answersMessage(asked, text);
    if (!(value || attachments.length) || sending || disabled || !ready) return;
    const draftText = text;
    const items = attachments;
    if (running && how === "queue" && agent) {
      // The draft stays until the queue has it saved.
      setSending(true);
      try {
        await enqueue(agent.id, value, items);
        soundEvent("sent");
        setText("");
        setAnswers([]);
        setAttachments([]);
        setHistoryIndex(-1);
      } catch (e) {
        soundEvent("actionFailed");
        onNotice(
          `${errorMessage(e) || "Couldn't queue the message."} Your message is still here.`,
        );
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    setText("");
    setAnswers([]);
    setAttachments([]);
    setHistoryIndex(-1);
    const ok = await onSend(
      toOutgoing(
        value,
        items,
        running ? (how === "queue" ? "steer" : how) : undefined,
      ),
    );
    if (!ok) {
      setText(draftText);
      setAnswers(asked);
      setAttachments(items);
      if (draftText) writeStore(draftKey, draftText);
    }
    setSending(false);
    area.current?.focus();
  };

  /** A quick reply sends at once when it answers the reply's only question
   *  and nothing else is drafted; otherwise it fills that answer. */
  const quick = (question: string, options: string[] | undefined, value: string) => {
    const only =
      replyAsks?.questions.length === 1 &&
      !text.trim() &&
      !attachments.length &&
      answers.every((a) => a.question === question);
    if (only) {
      void submit(defaultBehavior, [{ id: uid(), question, answer: value }]);
      return;
    }
    if (answers.some((a) => a.question === question))
      setAnswers((all) =>
        all.map((a) => (a.question === question ? { ...a, answer: value } : a)),
      );
    else setAnswers((all) => [...all, { id: uid(), question, answer: value, options }]);
  };

  const editQueued = (taken: { item: Queued; attachments: Attachment[] }) => {
    setText((t) => (t.trim() ? `${t}\n${taken.item.text}` : taken.item.text));
    setAttachments((a) => [...a, ...taken.attachments]);
    requestAnimationFrame(() => placeCaret(area.current?.value.length || 0));
  };
  const cancelAgent = async () => {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  };

  // ── Global shortcut: ⌘L focuses the composer ──
  // Not from behind a dialog: it would type into a field the dialog hides
  // (Dispatch gives ⌘L its own meaning).
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "l" && !modalOpen() && !e.defaultPrevented) {
        e.preventDefault();
        area.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /** Escape and the send keys, in the message box or an answer field. */
  const sendKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return true;
    if (e.key === "Escape") {
      (e.target as HTMLElement).blur();
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey)
        void submit(running ? "interrupt" : defaultBehavior);
      else if (e.altKey) void submit(running ? "steer" : defaultBehavior);
      else void submit();
      return true;
    }
    return false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (open && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(
          (i) =>
            (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
            matches.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(Math.min(active, matches.length - 1));
        return;
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      suggestions.dismiss();
      return;
    }
    if (sendKeys(e)) return;
    // Recall earlier prompts from an empty composer.
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      promptHistory.length
    ) {
      const el = e.currentTarget;
      const atEdge =
        e.key === "ArrowUp"
          ? el.selectionStart === 0
          : el.selectionEnd === el.value.length;
      if (!atEdge || (historyIndex < 0 && text.trim())) return;
      const next = historyIndex + (e.key === "ArrowUp" ? 1 : -1);
      if (next < -1 || next >= promptHistory.length) return;
      e.preventDefault();
      setHistoryIndex(next);
      setText(next < 0 ? "" : promptHistory[promptHistory.length - 1 - next]);
    }
  };

  const placeholder = disabled
    ? disabledReason || "This agent can't receive messages right now."
    : answers.length
      ? "Anything else to add"
      : hint || "Message the agent, tag @files, or use /commands and /skills";

  return (
    <div className="composer-shell">
      {agent && (
        <QueueList
          agent={agent}
          running={running}
          disabled={disabled}
          onNotice={onNotice}
          onEdit={editQueued}
        />
      )}
      {activity}
      {offered.length > 0 && (
        <AskStrip
          questions={offered}
          disabled={disabled}
          onAnswer={(q) => addAnswer(q.text, quickReplies(q))}
          onAnswerAll={() => {
            const added = offered.map((q) => ({
              id: uid(),
              question: q.text,
              answer: "",
              options: quickReplies(q),
            }));
            setAnswers((all) => [...all, ...added]);
            setFocusAnswer(added[0].id);
          }}
          onQuick={(q, value) => quick(q.text, quickReplies(q), value)}
          onDismiss={() => {
            setDismissed(askedIn);
            writeStore(dismissKey, askedIn);
          }}
        />
      )}
      <div
        className={`composer2 ${disabled ? "disabled" : ""} ${focused ? "focused" : ""}`}
      >
        <Autocomplete
          agent={agent}
          folder={draft?.source?.cwd}
          suggestions={suggestions}
          onChoose={choose}
        />
        {attachments.length > 0 && (
          <AttachmentTray
            attachments={attachments}
            onOpen={setPreview}
            onRemove={removeAttachment}
          />
        )}
        {answers.length > 0 && (
          <AnswerList
            answers={answers}
            disabled={disabled}
            focusId={focusAnswer}
            onChange={(id, value) =>
              setAnswers((all) =>
                all.map((a) => (a.id === id ? { ...a, answer: value } : a)),
              )
            }
            onRemove={(id) => {
              setAnswers((all) => all.filter((a) => a.id !== id));
              area.current?.focus();
            }}
            onQuick={(a, value) => quick(a.question, a.options, value)}
            onKeyDown={(e) => void sendKeys(e)}
          />
        )}
        <textarea
          {...plainText}
          id={inputId}
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setHistoryIndex(-1);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
        />
        <div className="composer-row">
          <div className="composer-left">
            <span className="menu-anchor">
              <button
                className="tool"
                data-tip="Add attachment"
                aria-label="Add attachment"
                aria-haspopup="menu"
                aria-expanded={menu === "attach" || menu === "github"}
                disabled={disabled}
                onClick={() => setMenu(menu === "attach" ? null : "attach")}
              >
                <Plus size={15} />
              </button>
              {menu === "attach" && (
                <Menu onClose={() => setMenu(null)} label="Add attachment">
                  <button
                    aria-description="Attach PNG, JPEG, GIF or WebP images (or paste or drop them)"
                    role="menuitem"
                    onClick={() => (setMenu(null), imageInput.current?.click())}
                  >
                    <ImagePlus size={14} /> Add image
                  </button>
                  {/* Uploads and GitHub items go to an agent's host: not before it starts. */}
                  {agent && (
                    <button
                      aria-description="Upload any file for the agent to read (up to 50 MB)"
                      role="menuitem"
                      onClick={() => (
                        setMenu(null),
                        fileInput.current?.click()
                      )}
                    >
                      <Upload size={14} /> Upload file
                    </button>
                  )}
                  {agent && (
                    <button
                      aria-description="Search this repository's GitHub issues and pull requests"
                      role="menuitem"
                      onClick={() => setMenu("github")}
                    >
                      <GitPullRequest size={14} /> Add issue or PR
                    </button>
                  )}
                </Menu>
              )}
              {menu === "github" && agent && (
                <GitHubPicker
                  agentId={agent.id}
                  host={host}
                  onClose={() => setMenu(null)}
                  onPick={(item) => {
                    setAttachments((a) =>
                      a.some(
                        (x) => x.kind === "github" && x.item.url === item.url,
                      )
                        ? a
                        : [...a, { kind: "github", id: uid(), item }],
                    );
                    setMenu(null);
                    area.current?.focus();
                  }}
                />
              )}
            </span>
            {agent ? (
              <AgentControls
                agent={agent}
                modes={modes}
                mode={mode}
                onSetMode={onSetMode}
                disabled={disabled}
                readOnly={started}
                onNotice={onNotice}
              />
            ) : (
              draft?.controls
            )}
          </div>
          <div className="composer-right">
            <SendControls
              running={running}
              disabled={disabled}
              sending={sending}
              cancelling={cancelling}
              hasContent={hasContent}
              ready={ready}
              defaultBehavior={defaultBehavior}
              menuOpen={menu === "send"}
              onToggleMenu={() => setMenu(menu === "send" ? null : "send")}
              onCloseMenu={() => setMenu(null)}
              onChooseBehavior={(b) => {
                setDefaultBehavior(b);
                writeStore("send-behavior", b);
                setMenu(null);
              }}
              onSubmit={(how) => void submit(how)}
              onCancel={() => void cancelAgent()}
            />
          </div>
        </div>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files || [])]);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files || [])]);
            e.target.value = "";
          }}
        />
      </div>
      {preview && (
        <Lightbox
          shown={{ url: preview.dataUrl, alt: "", name: preview.name }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type RefObject } from "react";
import { FileText, LoaderCircle, Paperclip, SendHorizontal, X } from "lucide-react";
import { errorMessage, readStore, removeStore, writeStore } from "../api";
import { Avatar, Emoji, sizeText } from "./bits";
import { uploadToSlack } from "./api";
import { applySuggestion, completionAt, draftKey, type Completion } from "./complete";
import { slackStore, useSlack } from "./store";
import type { SlackUploaded } from "./types";

/** A box that grows with what's typed, up to a point. */
function useGrow(box: RefObject<HTMLTextAreaElement | null>, text: string, max = 280) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
  }, [box, text, max]);
}

/**
 * `@` and `:` completion for a text box: the menu above it, and the keys
 * that work it (↑ ↓ move, Enter or Tab takes, Esc closes). `keyDown` answers
 * whether it took the key.
 */
function useCompletion(box: RefObject<HTMLTextAreaElement | null>, text: string, setText: (t: string) => void) {
  const users = useSlack((d) => d.users);
  const custom = useSlack((d) => d.workspace?.emoji);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const completion: Completion | null = closed === text ? null : completionAt(text, caret, users.values(), custom);
  const items = completion?.items ?? [];
  const at = Math.min(active, Math.max(0, items.length - 1));
  // Where the caret goes once the text a pick made is in the box (before any more keys).
  const placeCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = placeCaret.current;
    if (at === null || !box.current) return;
    placeCaret.current = null;
    box.current.setSelectionRange(at, at);
  }, [box, text]);
  const pick = (n: number) => {
    if (!completion) return;
    const next = applySuggestion(text, caret, completion, items[n]);
    placeCaret.current = next.caret;
    setCaret(next.caret);
    setText(next.text);
    setActive(0);
  };
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!completion || items.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      pick(at);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setClosed(text);
      return true;
    }
    return false;
  };
  const track = () => setCaret(box.current?.selectionStart ?? 0);
  const menu =
    completion && items.length > 0 ? (
      <div className="autocomplete slack-autocomplete" role="listbox" aria-label={completion.kind === "user" ? "People" : "Emoji"}>
        <div className="autocomplete-head">{completion.kind === "user" ? "People" : "Emoji"}</div>
        {items.map((item, n) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={n === at}
            className={n === at ? "active" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(n)}
            onClick={() => pick(n)}
          >
            {item.userId ? <Avatar user={users.get(item.userId)} size={18} /> : <Emoji name={item.emoji!} />}
            <b>{item.label}</b>
            {item.detail ? <span>{item.detail}</span> : <span />}
          </button>
        ))}
      </div>
    ) : null;
  return { keyDown, track, menu };
}

type Pending = { key: number; file: File; name: string; progress: number; uploaded?: SlackUploaded; error?: string };
let fileSerial = 0;

/**
 * Slack's message box: Markdown (sent as `markdown_text`), Enter sends and
 * ⇧Enter makes a new line, `@` and `:` complete people and emoji. Files
 * attached, pasted or dropped upload at once (chips show how far) and go
 * with the message, its text their comment. What's typed is kept per
 * conversation (and thread) until it's sent. ↑ in an empty box edits your
 * last message. A message Slack refuses comes back to the box.
 */
export function Composer({
  conversationId,
  threadTs,
  placeholder,
  broadcastTo,
  onEditLast,
  focusRef,
  autoFocus,
}: {
  conversationId: string;
  threadTs?: string;
  placeholder: string;
  /** In a thread: the channel "Also send to" names. */
  broadcastTo?: string;
  onEditLast?: () => void;
  focusRef?: MutableRefObject<(() => void) | null>;
  autoFocus?: boolean;
}) {
  const draft = draftKey(conversationId, threadTs);
  const [text, setTextState] = useState(() => readStore<string>(draft, ""));
  const latest = useRef(text);
  latest.current = text;
  const [files, setFiles] = useState<Pending[]>([]);
  const [broadcast, setBroadcast] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setText = (next: string) => {
    setTextState(next);
    latest.current = next;
    if (next) writeStore(draft, next);
    else removeStore(draft);
  };
  const { keyDown, track, menu } = useCompletion(box, text, setText);
  useGrow(box, text);
  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => box.current?.focus();
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);

  const patchFile = (key: number, patch: Partial<Pending>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const attach = (list: File[]) => {
    for (const file of list) {
      const key = ++fileSerial;
      const name = file.name || "file";
      setFiles((was) => [...was, { key, file, name, progress: 0 }]);
      uploadToSlack(file, name, (progress) => patchFile(key, { progress })).then(
        (uploaded) => patchFile(key, { uploaded, progress: 1 }),
        (e) => patchFile(key, { error: errorMessage(e) || "didn't upload" }),
      );
    }
  };
  const uploading = files.some((f) => !f.uploaded && !f.error);
  const ready = files.filter((f) => f.uploaded);
  const canSend = (!!text.trim() || ready.length > 0) && !uploading;

  const send = async () => {
    if (!canSend) return;
    const body = text.trim();
    const sentFiles = ready;
    const also = broadcast;
    // Gone from the box at once, as in Slack; it shows in the conversation, unsent, until Slack has it.
    setText("");
    setFiles([]);
    setBroadcast(false);
    const ok = sentFiles.length
      ? await slackStore.share({
          conversationId,
          fileIds: sentFiles.map((f) => f.uploaded!.id),
          ...(body ? { markdown: body } : {}),
          ...(threadTs ? { threadTs } : {}),
        })
      : await slackStore.post({ conversationId, markdown: body, ...(threadTs ? { threadTs } : {}), ...(also ? { broadcast: true } : {}) });
    if (ok) return;
    // Refused (the notice says why): back in the box, unless something new is being written.
    if (!latest.current) setText(body);
    setFiles((now) => (now.length ? now : sentFiles));
    setBroadcast(also);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (keyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "ArrowUp" && !text && onEditLast && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      onEditLast();
    }
  };
  const filesOf = (list: DataTransfer | null) => [...(list?.files ?? [])];

  return (
    <div
      className="slack-composer"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const list = filesOf(e.dataTransfer);
        if (!list.length) return;
        e.preventDefault();
        attach(list);
      }}
    >
      {menu}
      {files.length > 0 && (
        <ul className="slack-chips" aria-label="Files to send">
          {files.map((f) => (
            <li key={f.key} className={`slack-chip${f.error ? " failed" : ""}`} data-tip={f.error ? `Didn’t upload: ${f.error}` : undefined}>
              {f.uploaded || f.error ? <FileText size={13} aria-hidden="true" /> : <LoaderCircle size={13} className="spinning" aria-hidden="true" />}
              <span className="slack-chip-name">{f.name}</span>
              <span className="slack-chip-meta">
                {f.error ? "Failed" : f.uploaded ? sizeText(f.file.size) : `${Math.round(f.progress * 100)}%`}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((list) => list.filter((x) => x.key !== f.key))}
              >
                <X size={11} aria-hidden="true" />
              </button>
              {!f.uploaded && !f.error && <span className="slack-chip-bar" style={{ width: `${Math.round(f.progress * 100)}%` }} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={box}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        rows={1}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          track();
        }}
        onSelect={track}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const list = filesOf(e.clipboardData);
          if (!list.length) return;
          e.preventDefault();
          attach(list);
        }}
      />
      <div className="slack-composer-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Attach files"
          data-tip="Attach files (or paste or drop them)"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={14} aria-hidden="true" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Files to attach"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            attach(list);
          }}
        />
        {broadcastTo && (
          <label className="slack-broadcast">
            <input type="checkbox" checked={broadcast} disabled={files.length > 0} onChange={(e) => setBroadcast(e.target.checked)} />
            Also send to {broadcastTo}
          </label>
        )}
        <span className="slack-composer-hint" aria-hidden="true">
          {uploading ? "Uploading…" : "↩ to send · ⇧↩ new line"}
        </span>
        <button type="button" className="icon-btn slack-send" aria-label="Send" data-tip="Send (↩)" disabled={!canSend} onClick={() => void send()}>
          <SendHorizontal size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Editing a message in place: Enter saves, ⇧Enter makes a new line, Esc cancels. */
export function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (markdown: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  const { keyDown, track, menu } = useCompletion(box, text, setText);
  useGrow(box, text, 360);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => {
    const body = text.trim();
    if (!body) return;
    if (body === initial.trim()) onCancel();
    else onSave(body);
  };
  return (
    <div className="slack-composer slack-edit">
      {menu}
      <textarea
        ref={box}
        aria-label="Edit message"
        value={text}
        rows={1}
        onChange={(e) => {
          setText(e.target.value);
          track();
        }}
        onSelect={track}
        onKeyDown={(e) => {
          if (keyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="slack-composer-bar">
        <span className="slack-composer-hint" aria-hidden="true">
          Esc to cancel · ↩ to save
        </span>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!text.trim()} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

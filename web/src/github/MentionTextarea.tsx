/**
 * A GitHub comment's textarea with @-mentions (`mentions.ts`): typing `@` and a few letters lists the people of the
 * repository named by `MentionRepo` (its organization's members, `GET /api/github/q/mentions?repo=`, read only once a
 * mention starts), beneath the caret. ↑/↓ pick, Enter or Tab put `@login ` in, Esc closes it (and only it); a click
 * puts one in too. Without a repository (a workspace's Changes comments) it is a plain textarea.
 */
import { createContext, forwardRef, useContext, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { isUnavailable, readPath, useGithubRead } from "./api";
import { Avatar } from "./bits";
import { insertMention, mentionAt, rankMentions } from "./mentions";
import type { RepoMentions } from "./types";

/** The repository whose people a comment's @ suggests (the shown pull request's). */
export const MentionRepo = createContext<string | null>(null);

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (text: string) => void;
};

/** Where the caret is in the textarea, in its own coordinates (a mirror of its text up to the caret). */
function caretPoint(area: HTMLTextAreaElement, at: number): { x: number; y: number } {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  for (const p of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "tabSize", "textIndent", "wordSpacing"] as const)
    mirror.style[p] = style[p];
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  mirror.textContent = area.value.slice(0, at);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const point = { x: mark.offsetLeft, y: mark.offsetTop + mark.offsetHeight };
  mirror.remove();
  return { x: point.x - area.scrollLeft, y: point.y - area.scrollTop };
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, onValue, onKeyDown, ...rest }, ref) {
  const repo = useContext(MentionRepo);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => area.current!, []);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  /** The mention Esc closed (its `@`'s place): it stays closed until another starts. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = repo ? mentionAt(value, caret) : null;
  // Asked once a mention starts, and kept for the page's session.
  const [asked, setAsked] = useState(false);
  if (mention && !asked) setAsked(true);
  const people = useGithubRead<RepoMentions>(repo && asked ? readPath("mentions", { repo }) : null);
  const list = people.data && !isUnavailable(people.data) ? people.data.people : [];
  const open = !!mention && mention.start !== dismissed;
  const matches = open ? rankMentions(list, mention!.query) : [];
  const shown = open && (matches.length > 0 || people.loading);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (shown && area.current && mention) setPoint(caretPoint(area.current, mention.start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, mention?.start, value]);
  const pick = Math.min(index, Math.max(0, matches.length - 1));
  const choose = (login: string) => {
    // From the textarea as it is now (a click can come before React has seen the last key).
    const el = area.current;
    const at = el?.selectionStart ?? caret;
    const text = el?.value ?? value;
    const m = mentionAt(text, at);
    if (!m) return;
    const next = insertMention(text, m.start, at, login);
    pendingCaret.current = next.caret;
    onValue(next.text);
    setCaret(next.caret);
    setIndex(0);
  };
  // The caret after a mention goes in: put back as soon as the new text is in the textarea (before any next key).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    const at = pendingCaret.current;
    if (!el || at === null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [value]);
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown && matches.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((pick + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        choose(matches[pick]!.login);
        return;
      }
    }
    if (shown && e.key === "Escape") {
      // Only the list closes: not the comment, nor the panel it's in.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(mention!.start);
      return;
    }
    onKeyDown?.(e);
  };
  const track = () => {
    const at = area.current?.selectionStart ?? 0;
    if (at !== caret) setCaret(at);
  };
  return (
    <div className="gh-mention-field">
      <textarea
        {...rest}
        ref={area}
        value={value}
        aria-autocomplete={repo ? "list" : undefined}
        aria-expanded={repo ? shown : undefined}
        aria-controls={shown ? "gh-mention-list" : undefined}
        aria-activedescendant={shown && matches.length ? `gh-mention-${pick}` : undefined}
        onChange={(e) => {
          onValue(e.target.value);
          setCaret(e.target.selectionStart);
          setIndex(0);
          if (dismissed !== null && mentionAt(e.target.value, e.target.selectionStart)?.start !== dismissed) setDismissed(null);
        }}
        onKeyDown={keys}
        onKeyUp={track}
        onClick={track}
        onSelect={track}
        onBlur={() => setDismissed(mention?.start ?? null)}
        onFocus={() => setDismissed(null)}
      />
      {shown && point && (
        <div
          id="gh-mention-list"
          className="gh-mention-list"
          role="listbox"
          aria-label={people.data && !isUnavailable(people.data) && !people.data.org ? "People of the repository" : "Members of the organization"}
          style={{ left: Math.max(0, point.x), top: point.y + 4 }}
          // Keep the textarea's focus (and caret) while a person is clicked.
          onMouseDown={(e) => e.preventDefault()}
        >
          {!matches.length && <p className="gh-mention-note">Loading people…</p>}
          {matches.map((p, i) => (
            <button
              key={p.login}
              id={`gh-mention-${i}`}
              role="option"
              type="button"
              tabIndex={-1}
              aria-selected={i === pick}
              className={i === pick ? "active" : undefined}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(p.login)}
            >
              <Avatar person={p} size={18} />
              <b>{p.login}</b>
              {p.name && <span>{p.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

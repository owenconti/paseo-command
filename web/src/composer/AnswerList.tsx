/**
 * Questions quoted from the agent's reply, each with its own answer field,
 * above the composer's message box.
 */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { plainText } from "../ui";
import type { Answer } from "./answers";

function AnswerField({
  answer,
  disabled,
  focus,
  onChange,
  onRemove,
  onKeyDown,
}: {
  answer: Answer;
  disabled: boolean;
  focus: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [answer.answer]);
  useLayoutEffect(() => {
    if (focus) area.current?.focus();
  }, [focus]);
  return (
    <li className="answer-item">
      <div className="answer-quote">
        <blockquote title={answer.question}>{answer.question}</blockquote>
        <button
          type="button"
          className="answer-remove"
          aria-label={`Remove “${answer.question.slice(0, 40)}”`}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <textarea
        {...plainText}
        ref={area}
        rows={1}
        value={answer.answer}
        disabled={disabled}
        placeholder="Your answer"
        aria-label={`Answer to “${answer.question.slice(0, 60)}”`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </li>
  );
}

export function AnswerList({
  answers,
  disabled,
  focusId,
  onChange,
  onRemove,
  onKeyDown,
}: {
  answers: Answer[];
  disabled: boolean;
  /** The question just quoted, whose answer takes the focus. */
  focusId: string | null;
  onChange: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <ul className="answer-list" aria-label="Questions to answer">
      {answers.map((a) => (
        <AnswerField
          key={a.id}
          answer={a}
          disabled={disabled}
          focus={a.id === focusId}
          onChange={(v) => onChange(a.id, v)}
          onRemove={() => onRemove(a.id)}
          onKeyDown={onKeyDown}
        />
      ))}
    </ul>
  );
}

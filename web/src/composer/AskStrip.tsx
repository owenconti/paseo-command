/**
 * The questions a decision model found in the agent's last reply, above the
 * composer: each can be answered in this message, or with a quick reply.
 */
import { useEffect } from "react";
import { MessageCircleQuestion, X } from "lucide-react";
import type { ReplyQuestion } from "../asks/types";
import { quickReplies } from "./answers";
import { clearSource, highlightSource } from "../asks/highlight";

export function AskStrip({
  questions,
  messageId,
  answering,
  disabled,
  onAnswer,
  onAnswerAll,
  onQuick,
  onDismiss,
}: {
  questions: ReplyQuestion[];
  /** The reply they came from, marked in the transcript on hover. */
  messageId?: string;
  /** Answers to its open questions are still being drafted. */
  answering?: boolean;
  disabled: boolean;
  onAnswer: (q: ReplyQuestion) => void;
  onAnswerAll: () => void;
  onQuick: (q: ReplyQuestion, value: string) => void;
  onDismiss: () => void;
}) {
  // A mark never outlives the strip that made it.
  useEffect(() => clearSource, []);
  return (
    <section
      className="ask-strip"
      aria-label="Questions in this reply"
      onMouseEnter={() => highlightSource(messageId, questions.map((q) => q.text))}
      onMouseLeave={clearSource}
    >
      <header>
        <MessageCircleQuestion size={13} aria-hidden="true" />
        <span>This reply asks</span>
        {questions.length > 1 && (
          <button
            type="button"
            className="ask-all"
            disabled={disabled}
            onClick={onAnswerAll}
          >
            Answer all
          </button>
        )}
        <button
          type="button"
          className="ask-dismiss"
          aria-label="Dismiss these questions"
          onClick={onDismiss}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </header>
      <ul>
        {questions.map((q) => (
          <li
            key={q.text}
            onMouseEnter={() => highlightSource(messageId, [q.text])}
            onMouseLeave={() => highlightSource(messageId, questions.map((q) => q.text))}
          >
            <button
              type="button"
              className="ask-question"
              title="Answer this in your message"
              disabled={disabled}
              onClick={() => onAnswer(q)}
            >
              {q.text}
            </button>
            {q.kind !== "open" &&
              quickReplies(q)?.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="ask-quick"
                  disabled={disabled}
                  onClick={() => onQuick(q, value)}
                >
                  {value}
                </button>
              ))}
            {q.kind === "open" && (q.answers?.length || answering) && (
              <div className="ask-answers" aria-label="Suggested answers">
                {q.answers?.length ? (
                  q.answers.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="ask-quick"
                      disabled={disabled}
                      onClick={() => onQuick(q, value)}
                    >
                      {value}
                    </button>
                  ))
                ) : (
                  <span className="ask-drafting">Drafting answers…</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

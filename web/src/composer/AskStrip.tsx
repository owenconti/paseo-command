/**
 * The questions a decision model found in the agent's last reply, above the
 * composer: each can be answered in this message, or with a quick reply.
 */
import { MessageCircleQuestion, X } from "lucide-react";
import type { ReplyQuestion } from "../asks/types";
import { quickReplies } from "./answers";

export function AskStrip({
  questions,
  disabled,
  onAnswer,
  onAnswerAll,
  onQuick,
  onDismiss,
}: {
  questions: ReplyQuestion[];
  disabled: boolean;
  onAnswer: (q: ReplyQuestion) => void;
  onAnswerAll: () => void;
  onQuick: (q: ReplyQuestion, value: string) => void;
  onDismiss: () => void;
}) {
  return (
    <section className="ask-strip" aria-label="Questions in this reply">
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
          <li key={q.text}>
            <button
              type="button"
              className="ask-question"
              title="Answer this in your message"
              disabled={disabled}
              onClick={() => onAnswer(q)}
            >
              {q.text}
            </button>
            {quickReplies(q)?.map((value) => (
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
          </li>
        ))}
      </ul>
    </section>
  );
}

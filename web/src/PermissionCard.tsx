import { useState } from "react";
import {
  Check,
  ClipboardList,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldAlert,
  X,
} from "lucide-react";
import { Markdown } from "./Markdown";
import type { Permission } from "./types";
import { plainText } from "./ui";

export type PermissionDecision = {
  behavior: "allow" | "deny";
  answers?: Record<string, string>;
  actionId?: string;
};

/** Mirrors the Paseo app: question forms, custom actions, or plain approve/deny. */
export function PermissionCard({
  permission: p,
  busy,
  onRespond,
  imageHost,
}: {
  permission: Permission;
  busy: boolean;
  /** The agent's host, when remote: its local image files aren't readable here. */
  imageHost?: string;
  onRespond: (decision: PermissionDecision) => void;
}) {
  const questions = p.questions || [];
  const [picked, setPicked] = useState<Set<number>[]>(() =>
    questions.map(() => new Set()),
  );
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const answered = (i: number) =>
    picked[i]?.size > 0 ||
    (questions[i].allowOther && other[i].trim().length > 0) ||
    (questions[i].allowEmpty && questions[i].options.length === 0);
  const complete = questions.every((_, i) => answered(i));
  const answers = () => {
    const out: Record<string, string> = {};
    questions.forEach((q, i) => {
      const labels = [...picked[i]]
        .sort((a, b) => a - b)
        .map((n) => q.options[n].label);
      const typed = other[i].trim();
      if (q.allowOther && typed)
        out[q.header] = q.multiSelect ? [...labels, typed].join(", ") : typed;
      else if (labels.length) out[q.header] = labels.join(", ");
      else if (q.allowEmpty && !q.options.length) out[q.header] = "";
    });
    return out;
  };
  const toggle = (qi: number, oi: number) =>
    setPicked((all) =>
      all.map((set, i) => {
        if (i !== qi) return set;
        const next = new Set(questions[qi].multiSelect ? set : []);
        if (set.has(oi) && questions[qi].multiSelect) next.delete(oi);
        else next.add(oi);
        return next;
      }),
    );

  if (questions.length)
    return (
      <div className="permission question-card">
        <b>
          <MessageCircleQuestion size={14} />
          {questions.length === 1
            ? "The agent has a question"
            : `The agent has ${questions.length} questions`}
        </b>
        {questions.map((q, qi) => (
          <fieldset key={qi} className="question">
            <legend>
              <span className="question-header">{q.header}</span>
              {q.multiSelect && <small>Choose any</small>}
            </legend>
            <p className="question-text">{q.question}</p>
            <div
              className="question-options"
              role={q.multiSelect ? "group" : "radiogroup"}
            >
              {q.options.map((o, oi) => {
                const on = picked[qi]?.has(oi);
                return (
                  <button
                    aria-description={o.description}
                    key={oi}
                    type="button"
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={on}
                    className={on ? "on" : ""}
                    disabled={busy}
                    onClick={() => {
                      toggle(qi, oi);
                      if (!q.multiSelect)
                        setOther((all) =>
                          all.map((v, i) => (i === qi ? "" : v)),
                        );
                    }}
                  >
                    <span className={`tick ${q.multiSelect ? "square" : ""}`}>
                      {on && <Check size={11} />}
                    </span>
                    <span>
                      <b>{o.label}</b>
                      {o.description && <small>{o.description}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
            {q.allowOther && (
              <input
                {...plainText}
                className="question-other"
                value={other[qi]}
                disabled={busy}
                placeholder={
                  q.options.length
                    ? "Other — type your own answer"
                    : "Type your answer"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  setOther((all) => all.map((v, i) => (i === qi ? value : v)));
                  if (value && !q.multiSelect)
                    setPicked((all) =>
                      all.map((set, i) => (i === qi ? new Set() : set)),
                    );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && complete) {
                    e.preventDefault();
                    onRespond({ behavior: "allow", answers: answers() });
                  }
                }}
              />
            )}
          </fieldset>
        ))}
        <div>
          <button
            aria-description={
              complete
                ? "Send your answers to the agent"
                : "Answer every question first"
            }
            className="approve"
            disabled={busy || !complete}
            onClick={() => onRespond({ behavior: "allow", answers: answers() })}
          >
            {busy ? (
              <LoaderCircle size={13} className="spinning" />
            ) : (
              <Check size={13} />
            )}
            Submit {questions.length === 1 ? "answer" : "answers"}
          </button>
          <button
            aria-description="Decline to answer; the agent carries on without"
            disabled={busy}
            onClick={() => onRespond({ behavior: "deny" })}
          >
            <X size={13} />
            Dismiss
          </button>
        </div>
      </div>
    );

  return (
    <div className="permission">
      <b>
        {p.plan ? <ClipboardList size={14} /> : <ShieldAlert size={14} />}
        {p.plan ? "Proposed plan" : "Approval requested"} · {p.name}
      </b>
      {p.description && p.description !== "-" && <p>{p.description}</p>}
      {p.plan && (
        <div className="permission-plan">
          <Markdown text={p.plan} imageHost={imageHost} />
        </div>
      )}
      {p.detail && p.detail !== p.description && (
        <details>
          <summary aria-description="Show or hide the full request">
            Details
          </summary>
          <pre>{p.detail}</pre>
        </details>
      )}
      <div>
        {p.actions?.length ? (
          p.actions.map((a) => (
            <button
              aria-description={`${a.label}: ${a.behavior === "allow" ? "allow" : "deny"} this request`}
              key={a.id}
              className={a.behavior === "allow" ? "approve" : ""}
              disabled={busy || !p.id}
              onClick={() =>
                onRespond({ behavior: a.behavior, actionId: a.id })
              }
            >
              {a.behavior === "allow" ? <Check size={13} /> : <X size={13} />}
              {a.label}
            </button>
          ))
        ) : (
          <>
            <button
              aria-description={
                p.plan
                  ? "Approve the plan; the agent starts on it"
                  : `Allow ${p.name}`
              }
              className="approve"
              disabled={busy || !p.id}
              onClick={() => onRespond({ behavior: "allow" })}
            >
              <Check size={13} />
              {p.plan ? "Approve plan" : "Approve"}
            </button>
            <button
              aria-description={p.plan ? "Reject the plan" : `Deny ${p.name}`}
              disabled={busy || !p.id}
              onClick={() => onRespond({ behavior: "deny" })}
            >
              <X size={13} />
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}

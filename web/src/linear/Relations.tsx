import { useState } from "react";
import { Plus, X } from "lucide-react";
import { IssueRow } from "./IssueList";
import { Picker, type PickerOption } from "./Picker";
import { linearStore, loadIssue, useLinear } from "./store";
import type { LinearIssue, LinearRelation } from "./types";

/** How a relation reads from the open issue's side. */
const RELATION_LABEL: Record<LinearRelation["type"], string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate of",
  duplicate_of: "Duplicated by",
};
const RELATION_ORDER: LinearRelation["type"][] = ["blocked_by", "blocks", "related", "duplicate", "duplicate_of"];
/** The relations one adds from this issue's side, as Linear offers them. */
type Adding = "blocks" | "blocked_by" | "related" | "duplicate";
const ADD_OPTIONS: PickerOption<unknown>[] = [
  { value: "blocks", text: "Blocks" },
  { value: "blocked_by", text: "Blocked by" },
  { value: "related", text: "Related to" },
  { value: "duplicate", text: "Duplicate of" },
];

/** The issueRelationCreate input for `type` between this issue and `other`: Linear keeps "blocked by" as the other's "blocks". */
function relationInput(type: Adding, issue: LinearIssue, other: LinearIssue) {
  return type === "blocked_by"
    ? { issueId: other.id, relatedIssueId: issue.id, type: "blocks" }
    : { issueId: issue.id, relatedIssueId: other.id, type };
}

/**
 * An issue's relations (blocked by, blocks, related, duplicate of, duplicated
 * by), each opening its issue and removable; Add relation picks the kind,
 * then the issue (by key or title, from those the page knows). Linear answers
 * these writes without the relation, so both issues are asked for again after
 * each, to show it on both sides (and learn its id).
 */
export function Relations({
  issue,
  onOpen,
  unavailable,
}: {
  issue: LinearIssue;
  onOpen: (key: string) => void;
  /** Whether a related issue the store lacks won't come (else it's loading). */
  unavailable: (id: string) => boolean;
}) {
  const data = useLinear((d) => d);
  const [adding, setAdding] = useState<null | "type" | Adding>(null);
  const [busy, setBusy] = useState(false);
  const relations = issue.relations ?? [];
  const groups = RELATION_ORDER.map((type) => ({ type, items: relations.filter((r) => r.type === type) })).filter(
    (g) => g.items.length > 0,
  );

  /** Both sides afresh: this one, and the other by key when the page knows it, else by id. */
  const reload = (otherId: string) =>
    Promise.all([
      loadIssue(issue.key),
      loadIssue(data.issues.get(otherId)?.key ?? otherId),
    ]).catch(() => {});
  const add = async (type: Adding, other: LinearIssue) => {
    setBusy(true);
    if (await linearStore.write("issueRelationCreate", relationInput(type, issue, other))) await reload(other.id);
    setBusy(false);
  };
  const remove = async (relation: LinearRelation) => {
    setBusy(true);
    if (await linearStore.write("issueRelationDelete", { id: relation.id })) await reload(relation.issueId);
    setBusy(false);
  };

  const related = new Set(relations.map((r) => r.issueId));
  const candidates: PickerOption<unknown>[] = [...data.issues.values()]
    .filter((i) => i.id !== issue.id && !i.archivedAt && !related.has(i.id))
    .sort(
      (a, b) =>
        Number(b.teamId === issue.teamId) - Number(a.teamId === issue.teamId) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .map((i) => ({ value: i.id, text: `${i.key} ${i.title}` }));

  return (
    <section className="linear-section linear-relations" aria-busy={busy || undefined}>
      <div className="linear-section-head">
        <h3>Relations</h3>
        <span className="menu-anchor">
          <button
            type="button"
            className="ghost-btn"
            aria-haspopup="listbox"
            aria-expanded={adding !== null}
            disabled={busy}
            onClick={(e) => {
              e.currentTarget.focus({ preventScroll: true });
              setAdding(adding ? null : "type");
            }}
          >
            <Plus size={12} aria-hidden="true" />
            Add relation
          </button>
          {adding === "type" && (
            <Picker
              label="Relation"
              options={ADD_OPTIONS}
              value={null}
              onPick={(v) => setAdding(v as Adding)}
              // Picking closes this picker; the issue's opens in its place.
              onClose={() => setAdding((was) => (was === "type" ? null : was))}
            />
          )}
          {adding && adding !== "type" && (
            <Picker
              label="Related issue"
              options={candidates}
              value={null}
              onPick={(v) => {
                const other = data.issues.get(v as string);
                if (other) void add(adding, other);
              }}
              onClose={() => setAdding(null)}
            />
          )}
        </span>
      </div>
      {groups.map((g) => (
        <div key={g.type} className="linear-relation-group">
          <h4>{RELATION_LABEL[g.type]}</h4>
          <div className="linear-related-rows">
            {g.items.map((r) => {
              const other = data.issues.get(r.issueId);
              return (
                <div key={r.id} className="linear-relation-item">
                  {other ? (
                    <IssueRow issue={other} ws={data.workspace} open={false} focusable onOpen={onOpen} showState />
                  ) : (
                    <p className="linear-note">{unavailable(r.issueId) ? "Unavailable" : "Loading…"}</p>
                  )}
                  <button
                    type="button"
                    className="icon-btn linear-relation-remove"
                    aria-label={`Remove the relation to ${other?.key ?? "this issue"}`}
                    data-tip="Remove the relation"
                    disabled={busy}
                    onClick={() => void remove(r)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

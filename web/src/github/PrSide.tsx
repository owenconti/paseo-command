import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleDot, CircleX, MessageSquare, RefreshCw, Settings2, Users, X } from "lucide-react";
import { Picker, type PickerOption } from "../Picker";
import { readPath, useGithubRead } from "./api";
import { Avatar, ChecksIcon, CHECKS_LABEL } from "./bits";
import type { Person, PrCheck, PrDetail, PrReviewer, RepoPeople, RepoTeams, ReviewVerdict, Team } from "./types";

/** The PR side panel's people (reviewers, assignees) and checks: what GitHub's sidebar and merge box show. */

/** People and teams to ask or assign (`add`), or no longer (`remove`), as the picker or a row names them. */
export type PeopleChange = { action: "add" | "remove"; users: Person[]; teams: Team[] };
/** Opens a section's picker (⌘K). */
export type PickerControl = { open(): void };

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: "Approved",
  changes: "Requested changes",
  commented: "Commented",
  dismissed: "Review dismissed",
};
const VERDICT_ICON: Record<ReviewVerdict, typeof CircleCheck> = {
  approved: CircleCheck,
  changes: CircleX,
  commented: MessageSquare,
  dismissed: CircleDashed,
};

const userKey = (login: string) => `user:${login.toLowerCase()}`;
const teamKey = (slug: string) => `team:${slug.toLowerCase()}`;
const keyOf = (r: Pick<PrReviewer, "kind" | "login">) => (r.kind === "team" ? teamKey(r.login) : userKey(r.login));

/** What toggling a multiple picker's values asks: the keys added and the keys removed, as writes. */
type Known = Map<string, Person | Team>;
function changesOf(before: string[], after: string[], known: Known): PeopleChange[] {
  const split = (keys: string[]) => ({
    users: keys.filter((k) => k.startsWith("user:")).map((k) => (known.get(k) as Person | undefined) ?? { login: k.slice(5) }),
    teams: keys.filter((k) => k.startsWith("team:")).map((k) => (known.get(k) as Team | undefined) ?? { slug: k.slice(5), name: k.slice(5) }),
  });
  const added = after.filter((k) => !before.includes(k));
  const removed = before.filter((k) => !after.includes(k));
  return [
    ...(added.length ? [{ action: "add" as const, ...split(added) }] : []),
    ...(removed.length ? [{ action: "remove" as const, ...split(removed) }] : []),
  ];
}

/** You, then the repository's people (recent authors, then its assignable users), and those already chosen whom neither names. */
function personOptions(people: RepoPeople | undefined, chosen: Person[], skip: string | undefined): { options: PickerOption<string>[]; logins: Known } {
  const logins: Known = new Map();
  const options: PickerOption<string>[] = [];
  const add = (p: Person, you = false) => {
    const key = userKey(p.login);
    if (logins.has(key) || (skip && p.login.toLowerCase() === skip.toLowerCase())) return;
    logins.set(key, { login: p.login, ...(p.name ? { name: p.name } : {}), ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) });
    options.push({
      value: key,
      text: you ? "You" : p.login,
      icon: <Avatar person={p} size={16} />,
      ...(you ? { hint: p.login } : p.name ? { hint: p.name } : {}),
      keywords: `${p.login} ${p.name ?? ""}${you ? " me" : ""}`,
    });
  };
  if (people?.viewer) add(people.viewer, true);
  for (const p of chosen) add(p);
  for (const p of people?.people ?? []) add(p);
  return { options, logins };
}

/** The gear that opens a section's picker, and the picker. */
function SectionHead({
  title,
  tip,
  disabled,
  control,
  picker,
}: {
  title: string;
  tip: string;
  disabled?: boolean;
  control?: React.MutableRefObject<PickerControl | null>;
  picker: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (control)
    control.current = disabled
      ? null
      : {
          open: () => {
            button.current?.scrollIntoView({ block: "nearest" });
            button.current?.focus({ preventScroll: true });
            setOpen(true);
          },
        };
  return (
    <h4 className="gh-side-head">
      <span>{title}</span>
      {!disabled && (
        <span className="menu-anchor">
          <button
            ref={button}
            className="icon-btn"
            aria-label={tip}
            data-tip={tip}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={(e) => {
              e.currentTarget.focus({ preventScroll: true });
              setOpen(!open);
            }}
          >
            <Settings2 size={13} aria-hidden="true" />
          </button>
          {open && picker(() => setOpen(false))}
        </span>
      )}
    </h4>
  );
}

/**
 * Reviewers: who's asked (people and teams) and who reviewed, with their
 * latest verdict. The gear's picker (you first, then the repository's people
 * and teams; never the author) requests or removes reviews; a reviewer who
 * isn't asked now can be asked again from their row, a request removed there.
 */
export function Reviewers({
  pr,
  onChange,
  control,
}: {
  pr: PrDetail;
  onChange: (change: PeopleChange) => void;
  control?: React.MutableRefObject<PickerControl | null>;
}) {
  const open = pr.state === "open" || pr.state === "draft";
  const author = pr.author?.login;
  const requested = pr.reviewers.filter((r) => r.requested);
  const ask = (r: PrReviewer, action: "add" | "remove") =>
    onChange({ action, users: r.kind === "user" ? [r] : [], teams: r.kind === "team" ? [{ slug: r.login, name: r.name ?? r.login }] : [] });
  return (
    <>
      <SectionHead
        title="Reviewers"
        tip="Request review…"
        disabled={!open}
        control={control}
        picker={(close) => <ReviewerPicker pr={pr} requested={requested} author={author} onChange={onChange} onClose={close} />}
      />
      {pr.reviewers.length ? (
        <ul className="gh-people" aria-label="Reviewers">
          {pr.reviewers.map((r) => {
            const Verdict = r.verdict ? VERDICT_ICON[r.verdict] : null;
            const label = r.kind === "team" ? (r.name ?? r.login) : r.login;
            const state = [r.verdict ? VERDICT_LABEL[r.verdict] : null, r.requested ? (r.verdict ? "review requested again" : "Awaiting review") : null]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={keyOf(r)} className={r.requested ? "requested" : undefined}>
                {r.kind === "team" ? (
                  <span className="gh-avatar gh-team" style={{ width: 18, height: 18 }} aria-hidden="true">
                    <Users size={11} />
                  </span>
                ) : (
                  <Avatar person={r} size={18} />
                )}
                <span className="gh-person-name" data-tip={r.name && r.kind === "user" ? `${r.name} (${r.login})` : undefined}>
                  {label}
                </span>
                {open && (
                  <span className="gh-person-actions">
                    {r.requested ? (
                      <button className="icon-btn" aria-label={`Remove the review request for ${label}`} data-tip="Remove request" onClick={() => ask(r, "remove")}>
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : (
                      r.kind === "user" && (
                        <button className="icon-btn" aria-label={`Re-request review from ${label}`} data-tip="Re-request review" onClick={() => ask(r, "add")}>
                          <RefreshCw size={12} aria-hidden="true" />
                        </button>
                      )
                    )}
                  </span>
                )}
                <span className={`gh-reviewer-state ${r.verdict ?? "requested"}`} aria-label={state} data-tip={state}>
                  {Verdict && <Verdict size={13} aria-hidden="true" />}
                  {r.requested && <CircleDot size={r.verdict ? 9 : 13} aria-hidden="true" className="gh-awaiting" />}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="gh-hint">{open ? "No reviews yet" : "No reviews"}</p>
      )}
    </>
  );
}

function ReviewerPicker({
  pr,
  requested,
  author,
  onChange,
  onClose,
}: {
  pr: PrDetail;
  requested: PrReviewer[];
  author: string | undefined;
  onChange: (change: PeopleChange) => void;
  onClose: () => void;
}) {
  const people = useGithubRead<RepoPeople>(readPath("people", { repo: pr.repo }));
  const teams = useGithubRead<RepoTeams>(readPath("teams", { repo: pr.repo }));
  const { options, logins } = useMemo(() => {
    // Those who reviewed come first after you, as GitHub suggests them.
    const reviewed = pr.reviewers.filter((r) => r.kind === "user");
    const made = personOptions(people.data, reviewed, author);
    const teamList = [
      ...requested.filter((r) => r.kind === "team").map((r) => ({ slug: r.login, name: r.name ?? r.login })),
      ...(teams.data?.teams ?? []),
    ];
    for (const t of teamList) {
      const key = teamKey(t.slug);
      if (made.logins.has(key)) continue;
      made.logins.set(key, t);
      made.options.push({
        value: key,
        text: t.name,
        icon: (
          <span className="gh-avatar gh-team" style={{ width: 16, height: 16 }} aria-hidden="true">
            <Users size={10} />
          </span>
        ),
        hint: "Team",
        keywords: `${t.slug} team`,
      });
    }
    return made;
  }, [people.data, teams.data, pr.reviewers, requested, author]);
  const chosen = requested.map(keyOf);
  return (
    <Picker
      label="Request a review"
      options={options}
      value={chosen}
      multiple
      note={people.unavailable ?? (people.loading && !people.data ? `Loading ${pr.repo}'s people…` : teams.data?.note)}
      onPick={(value) => changesOf(chosen, value as string[], logins).forEach(onChange)}
      onClose={onClose}
    />
  );
}

/** Assignees: who's assigned, each removable; the gear's picker (you first, then the repository's people) assigns and unassigns. */
export function Assignees({
  pr,
  onChange,
  control,
}: {
  pr: PrDetail;
  onChange: (change: PeopleChange) => void;
  control?: React.MutableRefObject<PickerControl | null>;
}) {
  return (
    <>
      <SectionHead
        title="Assignees"
        tip="Assign…"
        control={control}
        picker={(close) => <AssigneePicker pr={pr} onChange={onChange} onClose={close} />}
      />
      {pr.assignees.length ? (
        <ul className="gh-people" aria-label="Assignees">
          {pr.assignees.map((p) => (
            <li key={p.login}>
              <Avatar person={p} size={18} />
              <span className="gh-person-name" data-tip={p.name ? `${p.name} (${p.login})` : undefined}>
                {p.login}
              </span>
              <span className="gh-person-actions">
                <button className="icon-btn" aria-label={`Unassign ${p.login}`} data-tip="Unassign" onClick={() => onChange({ action: "remove", users: [p], teams: [] })}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gh-hint">No one assigned</p>
      )}
    </>
  );
}

function AssigneePicker({ pr, onChange, onClose }: { pr: PrDetail; onChange: (change: PeopleChange) => void; onClose: () => void }) {
  const people = useGithubRead<RepoPeople>(readPath("people", { repo: pr.repo }));
  const { options, logins } = useMemo(() => personOptions(people.data, pr.assignees, undefined), [people.data, pr.assignees]);
  const chosen = pr.assignees.map((p) => userKey(p.login));
  return (
    <Picker
      label="Assign"
      options={options}
      value={chosen}
      multiple
      note={people.unavailable ?? (people.loading && !people.data ? `Loading ${pr.repo}'s people…` : undefined)}
      onPick={(value) => changesOf(chosen, value as string[], logins).forEach(onChange)}
      onClose={onClose}
    />
  );
}

// ── Checks ───────────────────────────────────────────────────────────────────
/** More passing checks than this fold behind "Show N passing". */
export const PASSING_SHOWN = 5;
const ORDER: Record<PrCheck["state"], number> = { failing: 0, pending: 1, passing: 2, skipped: 3 };

/** "2m 5s", "1h 4m", "12s". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** How long it took, or how long it has been running; nothing when GitHub doesn't say. */
export function checkTime(c: PrCheck, now = Date.now()): string | undefined {
  const start = c.startedAt ? Date.parse(c.startedAt) : NaN;
  const end = c.completedAt ? Date.parse(c.completedAt) : NaN;
  // Running: whole minutes, which the view's minute tick keeps current.
  if (c.state === "pending") return Number.isFinite(start) ? `running for ${now - start < 60_000 ? "under a minute" : span(Math.floor((now - start) / 60_000) * 60_000)}` : undefined;
  if (Number.isFinite(start) && Number.isFinite(end)) return span(end - start);
  return undefined;
}

/** Failing first, then pending, then passing and skipped, each by name. */
export const sortChecks = (checks: PrCheck[]) =>
  [...checks].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

/**
 * Beneath the count, each check run and status, as GitHub's merge box lists
 * them: failing, then pending, then passing (folded behind "Show N passing"
 * when more than five), each with its state, name, workflow or app, how long
 * it took (or has been running) and its details.
 */
export function ChecksSummary({ checks, onOpen }: { checks: PrCheck[]; onOpen: (url: string) => void }) {
  const [unfolded, setUnfolded] = useState(false);
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  const done = sorted.filter((c) => c.state === "passing" || c.state === "skipped");
  const fold = done.length > PASSING_SHOWN && !unfolded;
  const shown = fold ? sorted.filter((c) => c.state === "failing" || c.state === "pending") : sorted;
  const passing = done.filter((c) => c.state === "passing").length;
  const skipped = done.length - passing;
  const foldText = [passing ? `${passing} passing` : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join(", ");
  return (
    <>
      <p className="gh-hint">
        {(["failing", "pending", "passing", "skipped"] as const)
          .map((s) => [s, checks.filter((c) => c.state === s).length] as const)
          .filter(([, n]) => n > 0)
          .map(([s, n]) => `${n} ${s}`)
          .join(" · ")}
      </p>
      <ul className="gh-side-checks" aria-label="Checks">
        {shown.map((c, i) => {
          const time = checkTime(c);
          const sub = [c.source, time].filter(Boolean).join(" · ");
          return (
            <li key={`${c.name}${i}`} className={c.state}>
              <ChecksIcon state={c.state} size={13} />
              <span className="gh-side-check-text">
                {c.url ? (
                  <button className="gh-side-check-name" data-tip={c.summary ? `${c.summary} · Details` : "Details"} onClick={() => onOpen(c.url!)}>
                    {c.name}
                  </button>
                ) : (
                  <span className="gh-side-check-name" data-tip={c.summary}>
                    {c.name}
                  </span>
                )}
                {sub && <small aria-label={`${CHECKS_LABEL[c.state]}${sub ? `, ${sub}` : ""}`}>{sub}</small>}
              </span>
            </li>
          );
        })}
      </ul>
      {done.length > PASSING_SHOWN && (
        <button className="gh-side-fold" aria-expanded={!fold} onClick={() => setUnfolded(!unfolded)}>
          {fold ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          {fold ? `Show ${foldText}` : `Hide ${foldText}`}
        </button>
      )}
    </>
  );
}

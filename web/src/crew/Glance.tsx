/** At a glance, on Crew's head beside its title (`src/glance.ts`, `GET /api/glance`): a readout panel with a cell
 * each for your Linear issues by state (In Progress, In Review, Todo), the pull requests asking your review and
 * assigned to you, and Diagonal's health (its slowest service's time, and a light for each database service: under
 * 1 ms green, under 3 ms yellow, else red). Each count opens a menu of what it counts; an issue opens in Linear (its desktop app in the macOS app), a pull request in the
 * GitHub tab. Asked every minute while Crew shows (and as the window comes back); ⌘K opens each menu (`crew-glance`)
 * and checks again (`crew-glance-refresh`). */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Activity, AlertTriangle, CircleDot, GitPullRequest, RefreshCw, SquareKanban } from "lucide-react";
import { api } from "../api";
import { onAppCommand } from "../appCommands";
import { menuKeys } from "../menuKeys";
import { placeBelow } from "../Picker";
import { macApp, postAppLink, postAppMenu } from "../worldBridge";
import { openGithubPlace } from "../github/place";
import type { Integrations } from "../integrations";
import { GLANCE, healthTone, msText, overallTone, type Glance as GlanceData, type GlancePrList, type Health } from "../glance";

// ── The store: one poll for the page ─────────────────────────────────────────
let current: GlanceData | null = null;
let checking = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let asking: Promise<void> | undefined;

/** Asks for the glance (`fresh`: past the server's caches); a failed ask keeps what shows. */
export function refreshGlance(fresh = false): Promise<void> {
  if (asking && !fresh) return asking;
  checking = true;
  emit();
  const ask: Promise<void> = api<GlanceData>(fresh ? "glance?fresh=1" : "glance")
    .then(
      (g) => {
        if (g && typeof g === "object") current = g;
      },
      () => undefined,
    )
    .finally(() => {
      if (asking === ask) asking = undefined;
      checking = false;
      emit();
    });
  asking = ask;
  return ask;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;
const busy = () => checking;

/** What the glance last said (⌘K's entries), without asking. */
export const useGlanceData = () => useSyncExternalStore(subscribe, snapshot);

/** Polls every `GLANCE.pollMs` while mounted and the page shows, and again as it shows. */
function useGlance(on: boolean) {
  const glance = useSyncExternalStore(subscribe, snapshot);
  const loading = useSyncExternalStore(subscribe, busy);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      clearTimeout(timer);
      if (!document.hidden) void refreshGlance();
      timer = setTimeout(poll, GLANCE.pollMs);
    };
    const shown = () => !document.hidden && poll();
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", shown);
    poll();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", shown);
    };
  }, [on]);
  return { glance, loading };
}

// ── Opening things ───────────────────────────────────────────────────────────
function openUrl(url: string) {
  if (macApp()) postAppLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
function showPrList(scope: "review" | "assigned") {
  if (macApp()) {
    openGithubPlace({ kind: "prs", scope });
    postAppMenu("github");
  } else window.open(`https://github.com/pulls/${scope === "review" ? "review-requested" : "assigned"}`, "_blank", "noopener,noreferrer");
}

/** Which menu ⌘K asks for: a Linear state's (by name), "review", "assigned" or "health". */
export type GlanceMenu = string;

// ── A count and its menu ──────────────────────────────────────────────────────
function Count(props: {
  id: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  label: ReactNode;
  name: string;
  tone?: string;
  menu: ReactNode;
  menuLabel: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shown = props.open === props.id;
  const close = useCallback(
    (focus = false) => {
      props.setOpen(null);
      if (focus) button.current?.focus({ preventScroll: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.setOpen],
  );
  useEffect(() => {
    if (!shown) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [shown, close]);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  return (
    <span className="menu-anchor crew-glance-anchor" ref={anchor}>
      <button
        ref={button}
        className="crew-glance-count"
        data-glance={props.id}
        data-tone={props.tone}
        aria-label={props.name}
        aria-haspopup="menu"
        aria-expanded={shown}
        onClick={() => props.setOpen(shown ? null : props.id)}
      >
        {props.label}
      </button>
      {shown && (
        <div
          ref={place}
          role="menu"
          aria-label={props.menuLabel}
          className="popover-menu linear-row-menu crew-glance-menu"
          onKeyDown={(e) => menuKeys(e, () => close(true))}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[role=menuitem]")) close();
          }}
        >
          {props.menu}
        </div>
      )}
    </span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function prMenu(list: GlancePrList, scope: "review" | "assigned", empty: string) {
  return (
    <>
      {!list.rows.length && <p className="crew-glance-empty">{empty}</p>}
      {list.rows.map((pr) => (
        <button key={pr.id} role="menuitem" tabIndex={-1} onClick={() => openUrl(pr.url)}>
          <GitPullRequest size={13} aria-hidden="true" data-state={pr.state} />
          <span>
            <b>{pr.title}</b>
            <small>
              {pr.repo}#{pr.number}
              {pr.author ? ` · ${pr.author}` : ""}
              {pr.state === "draft" ? " · draft" : ""}
              {pr.checks ? ` · checks ${pr.checks}` : ""}
            </small>
          </span>
        </button>
      ))}
      {list.total > list.rows.length && <p className="crew-glance-empty">{`${list.total - list.rows.length} more`}</p>}
      <hr />
      <button role="menuitem" tabIndex={-1} onClick={() => showPrList(scope)}>
        <GitPullRequest size={13} aria-hidden="true" />
        {macApp() ? "Show them in the GitHub tab" : "Show them on GitHub"}
      </button>
    </>
  );
}

function healthMenu(h: Health, loading: boolean) {
  const checked = new Date(h.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <>
      <p className="crew-glance-note">
        {h.up ? `Answered in ${msText(h.took ?? 0)} at ${checked}` : `Down at ${checked}: ${h.error ?? "no answer"}`}
      </p>
      {h.services.map((s) => (
        <div key={s.name} className="crew-glance-service" data-tone={healthTone(s.ms)}>
          <i aria-hidden="true" />
          <span>{s.name}</span>
          <b>{msText(s.ms)}</b>
        </div>
      ))}
      <hr />
      <button role="menuitem" tabIndex={-1} disabled={loading} onClick={() => void refreshGlance(true)}>
        <RefreshCw size={13} aria-hidden="true" />
        {loading ? "Checking…" : "Check again now"}
      </button>
      <button role="menuitem" tabIndex={-1} onClick={() => openUrl("https://app.go-diagonal.com/health/status")}>
        <CircleDot size={13} aria-hidden="true" />
        Open the status endpoint
      </button>
    </>
  );
}

function Lights({ h }: { h: Health }) {
  return (
    <span className="crew-glance-lights" aria-hidden="true">
      {h.up && h.services.length ? h.services.map((s) => <i key={s.name} data-tone={healthTone(s.ms)} />) : <i data-tone="bad" />}
    </span>
  );
}

export function Glance({ integrations }: { integrations: Integrations }) {
  const on = integrations.linear || integrations.github || integrations.health;
  const { glance, loading } = useGlance(on);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(
    () =>
      onAppCommand("crew-glance", (arg) => {
        if (typeof arg !== "string") return;
        // The menu opens once its count is drawn (the glance may still be coming).
        setOpen(null);
        requestAnimationFrame(() => setOpen(arg));
      }),
    [],
  );
  useEffect(() => onAppCommand("crew-glance-refresh", () => void refreshGlance(true)), []);
  if (!on || !glance) return null;
  const linear = integrations.linear ? glance.linear : undefined;
  const github = integrations.github ? glance.github : undefined;
  const health = integrations.health ? glance.health : undefined;
  if (!linear && !github && !health) return null;
  const menus = { open, setOpen };
  const dot = (color: string) => <i className="crew-glance-dot" style={color ? { background: color } : undefined} aria-hidden="true" />;
  const issueMenu = (g: Extract<NonNullable<GlanceData["linear"]>, { groups: unknown }>["groups"][number]) => (
    <>
      {g.issues.map((i) => (
        <button key={i.id} role="menuitem" tabIndex={-1} onClick={() => openUrl(i.url)}>
          {dot(g.color)}
          <span>
            <b>{i.title}</b>
            <small>{i.key}</small>
          </span>
        </button>
      ))}
      {g.total > g.issues.length && <p className="crew-glance-empty">{`${g.total - g.issues.length} more`}</p>}
    </>
  );
  const groups = linear && "groups" in linear ? linear.groups : null;
  const prs = github && "review" in github ? github : null;
  const linearCount = (g: NonNullable<typeof groups>[number], label: ReactNode) => (
    <Count
      key={g.state}
      {...menus}
      id={`linear:${g.state.toLowerCase()}`}
      tone={g.total ? undefined : "none"}
      name={`${g.state}: ${plural(g.total, "issue")}`}
      menuLabel={`Your issues ${g.state.toLowerCase()}`}
      label={label}
      menu={issueMenu(g)}
    />
  );
  const prCount = (scope: "review" | "assigned", label: ReactNode) => {
    const list = prs![scope];
    return (
      <Count
        key={scope}
        {...menus}
          id={scope}
        tone={!list.total ? "none" : scope === "review" ? "ask" : undefined}
        name={scope === "review" ? `Review requests: ${plural(list.total, "pull request")}` : `Assigned to you: ${plural(list.total, "pull request")}`}
        menuLabel={scope === "review" ? "Pull requests asking your review" : "Pull requests assigned to you"}
        label={label}
        menu={prMenu(list, scope, scope === "review" ? "Nothing asks your review." : "No pull requests are assigned to you.")}
      />
    );
  };
  const healthCount = (label: ReactNode) => (
    <Count
      {...menus}
      id="health"
      tone={overallTone(health!)}
      name={`Diagonal health: ${health!.up ? health!.services.map((s) => `${s.name} ${msText(s.ms)}`).join(", ") : `down: ${health!.error ?? "no answer"}`}`}
      menuLabel="Diagonal's health"
      label={label}
      menu={healthMenu(health!, loading)}
    />
  );
  const failed = (what: string, error: string) => (
    <span className="crew-glance-failed" role="img" aria-label={`${what}: ${error}`} data-tip={`${what}: ${error}`} data-summary="">
      <AlertTriangle size={12} aria-hidden="true" />
      Unavailable
    </span>
  );
  const slowest = health && health.up && health.services.length ? Math.max(...health.services.map((x) => x.ms)) : null;

  return (
    <div className="crew-glance" role="group" aria-label="At a glance">
      {linear && (
        <section className="crew-glance-cell" aria-label="Linear">
          <span className="crew-glance-source">
            <SquareKanban size={13} aria-hidden="true" />
            Linear
          </span>
          <div className="crew-glance-nums">
            {"error" in linear
              ? failed("Linear", linear.error)
              : !groups!.length
                ? <span className="crew-glance-quiet">Nothing open</span>
                : groups!.map((g) => linearCount(g, <><b>{g.total}</b><small>{dot(g.color)}{g.state}</small></>))}
          </div>
        </section>
      )}
      {github && (
        <section className="crew-glance-cell" aria-label="GitHub">
          <span className="crew-glance-source">
            <GitPullRequest size={13} aria-hidden="true" />
            GitHub
          </span>
          <div className="crew-glance-nums">
            {!prs
              ? failed("GitHub", (github as { error: string }).error)
              : [
                  prCount("review", <><b>{prs.review.total}</b><small>To review</small></>),
                  prCount("assigned", <><b>{prs.assigned.total}</b><small>Assigned</small></>),
                ]}
          </div>
        </section>
      )}
      {health && (
        <section className="crew-glance-cell" aria-label="Diagonal">
          <span className="crew-glance-source">
            <Activity size={13} aria-hidden="true" />
            Diagonal
          </span>
          <div className="crew-glance-nums">
            {healthCount(
              <>
                <b>{slowest === null ? "Down" : msText(slowest)}</b>
                <small>
                  <Lights h={health} />
                  {slowest === null ? "no answer" : "slowest"}
                </small>
              </>,
            )}
          </div>
        </section>
      )}
    </div>
  );
}

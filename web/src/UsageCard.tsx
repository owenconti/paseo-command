import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UsageProblem, UsageReport } from "./types";
import { placeText } from "./names";
import { onAppBar, postAppBarState, type BarRect } from "./worldBridge";

type Limit = {
  key: string;
  label: string;
  pct?: number;
  amount?: string;
  reset?: string;
};
const percent = (used: number) => Math.max(0, Math.min(100, used));
const tone = (used: number) => (used > 85 ? "red" : used > 60 ? "amber" : "");
const number = (value: number, unit?: string) =>
  unit === "usd"
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(value)
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ""}`;

const HARNESS: Record<string, string> = { codex: "Codex", opencode: "OpenCode", pi: "Pi", omp: "OMP" };

/** Why Paseo couldn't read an account's usage: the saved login it found, and what went wrong with it. */
export function unavailableWhy(source: UsageReport): string {
  const problem: UsageProblem | undefined = source.report?.problem ?? source.loginErrors?.[0]?.report?.problem;
  const harness =
    source.loginErrors?.[0]?.harness ?? (problem?.refreshedBy ? HARNESS[problem.refreshedBy] ?? problem.refreshedBy : undefined);
  const login = harness ? `The login saved by ${harness}` : "Its saved login";
  if (problem?.kind === "expired") {
    const when = problem.expiresAt && Number.isFinite(Date.parse(problem.expiresAt))
      ? ` on ${new Date(problem.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : "";
    return `Usage unavailable: ${login.charAt(0).toLowerCase()}${login.slice(1)} expired${when}. Sign in again there to see it.`;
  }
  if (problem?.kind === "rejected")
    return `Usage unavailable: ${source.sourceLabel} refused ${login.charAt(0).toLowerCase()}${login.slice(1)}${problem.status ? ` (${problem.status})` : ""}. Sign in again there to see it.`;
  return "Usage unavailable";
}

/**
 * The providers' usage: up to four meters, and the breakdown beside them on
 * hover or click. `hosted`: the macOS app's top bar draws the meters (from
 * `postAppBarState`) and says when its button is hovered or clicked, and where.
 */
export function UsageCard({ reports, hosted = false }: { reports: UsageReport[]; hosted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  /** The app's top bar button, when it opened the breakdown. */
  const [barRect, setBarRect] = useState<BarRect | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const panelId = useId();
  // Accounts are named by the address's first part, unless two share it ("owen" at two companies).
  const localParts = reports.map((r) => r.account?.label?.split("@")[0]);
  const groups = reports.map((source, index) => {
    const report = source.report;
    const limits: Limit[] =
      report?.status === "available"
        ? [
            ...(report.windows ?? [])
              .filter((w) => Number.isFinite(w.usedPct))
              .map((w) => ({
                key: w.id,
                label: w.label,
                pct: w.usedPct,
                reset: w.resetsAt,
              })),
            ...(report.balances ?? []).map((b) => ({
              key: b.id,
              label: b.label,
              pct:
                b.limit && b.limit > 0 && b.used !== undefined
                  ? (b.used / b.limit) * 100
                  : undefined,
              amount:
                b.used !== undefined && b.limit !== undefined
                  ? `${number(b.used, b.unit)} of ${number(b.limit, b.unit)}`
                  : b.remaining !== undefined
                    ? `${number(b.remaining, b.unit)} remaining`
                    : undefined,
              reset: b.resetsAt,
            })),
          ]
        : [];
    return {
      key: source.id,
      label: placeText(source.sourceLabel, "Provider"),
      account: placeText(
        localParts.filter((p) => p && p === localParts[index]).length > 1 ? source.account?.label : localParts[index],
      ),
      limits,
      why: limits.length ? "" : unavailableWhy(source),
    };
  });
  // Accounts with usage first; those that couldn't be read after them.
  groups.sort((a, b) => Number(!a.limits.length) - Number(!b.limits.length));
  const meters = groups
    .flatMap((g) =>
      g.limits.map((limit) => ({ ...limit, key: `${g.key}:${limit.key}` })),
    )
    .filter((limit) => limit.pct !== undefined && Number.isFinite(limit.pct))
    .slice(0, 4);
  const reveal = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const meterKey = meters.map((m) => `${percent(m.pct ?? 0)}:${tone(m.pct ?? 0)}`).join(",");
  useEffect(() => {
    if (!hosted) return;
    postAppBarState({
      usage: reports.length
        ? (meters.length ? meters : [{ pct: 0 }]).map((m) => ({ pct: percent(m.pct ?? 0), tone: tone(m.pct ?? 0) }))
        : [],
    });
    // The meters' values, not their array, decide when the bar is told again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, meterKey, reports.length]);
  const reveal_ = useRef(reveal);
  reveal_.current = reveal;
  const leave_ = useRef(leave);
  leave_.current = leave;
  useEffect(() => {
    if (!hosted) return;
    const offs = [
      onAppBar("usage-enter", (rect) => {
        setBarRect(rect);
        reveal_.current();
      }),
      onAppBar("usage-leave", () => leave_.current()),
      onAppBar("usage", (rect) => {
        setBarRect(rect);
        clearTimeout(closeTimer.current);
        setOpen((value) => !value);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [hosted]);
  useLayoutEffect(() => {
    const a = hosted
      ? barRect && { top: barRect.y, bottom: barRect.y + barRect.height, right: barRect.x + barRect.width }
      : anchor.current?.getBoundingClientRect();
    if (!open || !a || !panel.current) return;
    const p = panel.current.getBoundingClientRect();
    const top =
      a.bottom + 8 + p.height <= innerHeight - 12
        ? a.bottom + 8
        : Math.max(12, a.top - p.height - 8);
    setPosition({
      left: Math.max(
        12,
        Math.min(a.right - p.width, innerWidth - p.width - 12),
      ),
      top,
    });
  }, [open, reports, hosted, barRect]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      if (panel.current?.contains(document.activeElement))
        anchor.current?.focus();
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  return (
    <>
      {!hosted && <button
        ref={anchor}
        className="usage-card"
        aria-label="Usage breakdown"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-description="View usage limits by provider and account"
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") reveal();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") leave();
        }}
        onFocus={(event) => {
          if (
            event.currentTarget.matches(":focus-visible") &&
            !panel.current?.contains(event.relatedTarget as Node)
          )
            reveal();
        }}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget as Node)) leave();
        }}
        onClick={() => {
          clearTimeout(closeTimer.current);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          reveal();
          requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        <span className="usage-bars" aria-hidden="true">
          {(meters.length ? meters : [{ key: "unavailable", pct: 0 }]).map(
            (meter) => (
              <i key={meter.key}>
                <i
                  className={tone(meter.pct ?? 0)}
                  style={{ width: `${percent(meter.pct ?? 0)}%` }}
                />
              </i>
            ),
          )}
        </span>
      </button>}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            className="usage-popover"
            role="region"
            aria-label="Usage breakdown"
            tabIndex={-1}
            style={
              position
                ? { left: position.left, top: position.top }
                : { left: -9999, top: 0, visibility: "hidden" }
            }
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") leave();
            }}
            onBlur={(event) => {
              if (
                !panel.current?.contains(event.relatedTarget as Node) &&
                event.relatedTarget !== anchor.current
              )
                leave();
            }}
          >
            <h3>Usage breakdown</h3>
            {groups.map((group) => (
              <section className="usage-account" key={group.key}>
                <div className="usage-account-name">
                  <strong>{group.label}</strong>
                  {group.account && <span>{group.account}</span>}
                </div>
                {group.limits.length ? (
                  group.limits.map((limit) => (
                    <div className="usage-limit" key={limit.key}>
                      <div className="usage-limit-heading">
                        <span>{placeText(limit.label, "Limit")}</span>
                        {limit.pct !== undefined && (
                          <b>{Math.round(limit.pct)}% used</b>
                        )}
                      </div>
                      {limit.pct !== undefined && (
                        <div
                          className="usage-limit-track"
                          role="progressbar"
                          aria-label={`${group.label} ${group.account} ${limit.label}`}
                          aria-valuenow={percent(limit.pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <i
                            className={tone(limit.pct)}
                            style={{ width: `${percent(limit.pct)}%` }}
                          />
                        </div>
                      )}
                      {limit.amount && <p>{limit.amount}</p>}
                      {limit.reset &&
                        Number.isFinite(Date.parse(limit.reset)) && (
                          <p>
                            Resets{" "}
                            {new Date(limit.reset).toLocaleString(undefined, {
                              weekday: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                    </div>
                  ))
                ) : (
                  <p className="usage-unavailable">{group.why}</p>
                )}
              </section>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UsageReport } from "./types";
import { placeText } from "./names";

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

export function UsageCard({ reports }: { reports: UsageReport[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const panelId = useId();
  const groups = reports.map((source) => {
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
      account: placeText(source.account?.label?.split("@")[0]),
      limits,
    };
  });
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
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
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
  }, [open, reports]);
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
      <button
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
      </button>
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
                  <p className="usage-unavailable">Usage unavailable</p>
                )}
              </section>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

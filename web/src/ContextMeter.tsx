/** A conversation's context window in its header: a ring filling as the window does, "476k / 1M · 48%", amber from 70%
 * and red from 90%; its tooltip says the exact tokens and the last turn's tokens and cost (contextUsage.ts). Where the
 * daemon doesn't report the window, the last turn's cost and output, as the header showed before. */
import { contextOf, contextText, type Usage } from "./contextUsage";

export function ContextMeter({ usage }: { usage: Usage }) {
  const text = contextText(usage);
  if (!text) return null;
  const c = contextOf(usage);
  const r = 5.5, round = 2 * Math.PI * r;
  return (
    <span className="usage-chip context-meter" data-level={c?.level} data-tip={text.tip} data-summary="">
      {c && (
        <svg className="context-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r={r} className="context-ring-track" />
          <circle cx="7" cy="7" r={r} className="context-ring-fill" strokeDasharray={`${round * c.share} ${round}`} transform="rotate(-90 7 7)" />
        </svg>
      )}
      {c && <span className="sr-only">Context </span>}
      {text.label}
    </span>
  );
}

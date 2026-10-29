/** The map's key: what each agent state and colour means on the Atlas. */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  MODEL_COLORS,
  MODEL_FAMILY,
  STATE_NAMES,
  STATE_TILE,
  modelColor,
  modelName,
  type AtlasData,
} from "../../rendering/src/atlas";
import { PR_LABELS, prFlags } from "../../rendering/src/prStatus";
import { PROBE_STATES } from "../../rendering/src/probe";
import { readStore, writeStore } from "./api";

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const GLYPH: Record<string, string> = { failed: "×", approval: "!", question: "?", asking: "…", done: "★" };
const ORDER = ["running", "approval", "question", "asking", "failed", "done", "idle", "offline"] as const;
/** Paseo's label colours, as its app paints them. */
const LABEL_COLOR: Record<(typeof PR_LABELS)[number]["color"], string> = {
  amber: "#f59e0b",
  emerald: "#10b981",
  red: "#ef4444",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  orange: "#f97316",
  pink: "#ec4899",
};
export function WorldLegend({ data }: { data: AtlasData }) {
  const [open, setOpen] = useState(() => readStore<boolean>("world-legend-open", true));
  const toggle = () => {
    writeStore("world-legend-open", !open);
    setOpen(!open);
  };
  // Only the colours actually in the fleet, so the key stays short.
  const colours = new Map<string, number>();
  for (const a of data.agents) {
    const colour = modelColor(a.model);
    colours.set(MODEL_FAMILY[colour] ?? modelName(a.model), MODEL_COLORS[colour]);
  }
  // The PR flags, once any workspace flies one.
  const flags = data.workspaces.some((w) => {
    const f = prFlags(w.labels);
    return !!(f.ci || f.review);
  });
  // Probe's streamers, once any review flag carries one.
  const probe = data.workspaces.some((w) => w.probe && prFlags(w.labels).review);
  return (
    <section className="atlas-world-legend" aria-label="Map legend">
      <button className="legend-toggle" aria-expanded={open} onClick={toggle}>
        Legend {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <div className="legend-body">
          <h3>Agent tile · agent state</h3>
          <ul>
            {ORDER.map((state) => {
              const color = STATE_TILE[state];
              return (
                <li key={state}>
                  <span
                    className={`legend-swatch${color === undefined ? " plain" : ""}`}
                    style={color === undefined ? undefined : { background: css(color) }}
                  >
                    {GLYPH[state] ?? ""}
                  </span>
                  {STATE_NAMES[state]}
                </li>
              );
            })}
          </ul>
          {colours.size > 0 && (
            <>
              <h3>Robot · model</h3>
              <ul>
                {[...colours].map(([name, color]) => (
                  <li key={name}>
                    <span className="legend-dot" style={{ background: css(color) }} />
                    {name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {flags && (
            <>
              <h3>Workspace flag · PR</h3>
              <ul>
                {PR_LABELS.map((l) => (
                  <li key={l.flag}>
                    <span className="legend-swatch" style={{ background: LABEL_COLOR[l.color] }} />
                    {l.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {probe && (
            <>
              <h3>Review flag streamer · Probe</h3>
              <ul>
                {PROBE_STATES.map((p) => (
                  <li key={p.state}>
                    <span className="legend-swatch" style={{ background: css(p.color) }}>
                      {p.glyph}
                    </span>
                    {p.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>Islands are projects · cottages workspaces · robots agents</p>
        </div>
      )}
    </section>
  );
}

/** The map's key: what each agent state and colour means in the world on show. */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  MODEL_COLORS,
  STATE_NAMES,
  STATE_TILE,
  modelColor,
  modelName,
  providerColor,
  providerOf,
  type AtlasData,
  type WorldKind,
} from "../../rendering/src/atlas";
import { readStore, writeStore } from "./api";

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const GLYPH: Record<string, string> = { failed: "×", approval: "!", question: "?", done: "★" };
const ORDER = ["running", "approval", "question", "failed", "done", "idle", "offline"] as const;
const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  openai: "OpenAI",
  gemini: "Gemini",
  copilot: "Copilot",
  opencode: "OpenCode",
  cursor: "Cursor",
};

export function WorldLegend({ kind, data }: { kind: WorldKind; data: AtlasData }) {
  const [open, setOpen] = useState(() => readStore<boolean>("world-legend-open", true));
  const toggle = () => {
    writeStore("world-legend-open", !open);
    setOpen(!open);
  };
  // Only the colours actually in the fleet, so the key stays short.
  const colours = new Map<string, number>();
  for (const a of data.agents)
    if (kind === "galaxy") {
      const p = providerOf(a.model) || "unknown";
      colours.set(PROVIDER_NAMES[p] ?? (p[0]?.toUpperCase() ?? "") + p.slice(1), providerColor(a.model));
    } else colours.set(modelName(a.model), MODEL_COLORS[modelColor(a.model)]);
  const unit = kind === "galaxy" ? "Station" : "Workspace tile";
  return (
    <section className="atlas-world-legend" aria-label="Map legend">
      <button className="legend-toggle" aria-expanded={open} onClick={toggle}>
        Legend {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <div className="legend-body">
          <h3>{unit} · agent state</h3>
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
                  {state === "running" && kind === "galaxy" ? "Working · beaming to its planet" : STATE_NAMES[state]}
                </li>
              );
            })}
          </ul>
          {colours.size > 0 && (
            <>
              <h3>{kind === "galaxy" ? "Satellite · provider" : "Robot · model"}</h3>
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
          <p>
            {kind === "galaxy"
              ? "Planets are projects · stations workspaces · satellites agents"
              : "Islands are projects · cottages workspaces · robots agents"}
          </p>
        </div>
      )}
    </section>
  );
}

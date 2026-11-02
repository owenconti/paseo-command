import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { menuKeys } from "../linear/ListControls";
import { placeBelow } from "../linear/Picker";
import { placeText } from "../names";
import type { PaseoMatch } from "./paseo";

const tipOf = (m: PaseoMatch) =>
  m.agent ? `Open ${placeText(m.agent.title || m.agent.name, "its agent")} in ${m.label}` : `Open ${m.label} (it has no agent)`;

/**
 * Open Paseo agent, in a PR's header: shown only while a Paseo workspace has
 * the PR's branch checked out. It opens that workspace's most recent agent
 * (the workspace without one) on the map; with several, a menu chooses
 * (host · project · workspace).
 */
export function OpenPaseoButton({ matches, onOpen }: { matches: PaseoMatch[]; onOpen: (m: PaseoMatch) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [open, close]);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  const only = matches.length === 1 ? matches[0] : undefined;
  if (!matches.length) return null;
  return (
    <span className="menu-anchor gh-open-paseo" ref={anchor}>
      <button
        ref={button}
        className="secondary"
        {...(only ? { "data-tip": tipOf(only) } : { "aria-haspopup": "menu" as const, "aria-expanded": open, "data-tip": `${matches.length} Paseo workspaces have this branch` })}
        onClick={() => (only ? onOpen(only) : setOpen(!open))}
      >
        <Bot size={13} aria-hidden="true" />
        Open Paseo agent
        {!only && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={placeMenu}
          role="menu"
          aria-label="Open the Paseo agent in"
          className="popover-menu linear-row-menu"
          onKeyDown={(e) =>
            menuKeys(e, () => {
              close();
              button.current?.focus({ preventScroll: true });
            })
          }
        >
          {matches.map((m) => (
            <button
              key={`${m.workspace.host ?? ""}:${m.workspace.workspaceId}`}
              role="menuitem"
              tabIndex={-1}
              data-tip={tipOf(m)}
              onClick={() => {
                close();
                onOpen(m);
              }}
            >
              <Bot size={13} aria-hidden="true" />
              {m.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

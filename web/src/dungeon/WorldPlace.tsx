/** A place on the Dungeon Board (a workspace, a project, Add project): the app's own view of it in the board's
 * gold-framed panel, over the world above the command belt. The board has no side panel, so what the panel
 * showed for a picked workspace or project shows here instead, in the board's colours, as its Dispatch does. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { loadHudArt } from "./art";
import "./world-dispatch.css";
import "./world-place.css";

export function WorldPlace(props: {
  /** What it is: "Workspace", "Project", "Add a project". */
  title: string;
  /** "workspace" | "project" | "add": for its styles and tests. */
  kind: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    let live = true;
    loadHudArt().then((art) => live && setPanel(art.panel), () => {});
    return () => {
      live = false;
    };
  }, []);
  // The keyboard starts in it, so its own keys (a rename, Tab through its buttons) work at once.
  useEffect(() => {
    const id = requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [props.kind]);
  useEffect(() => {
    // Esc closes it, unless something of its own (a rename, a picker, a menu) or a layer above takes it first.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const layered = [
        ...document.querySelectorAll<HTMLElement>('[aria-modal="true"], .popover-menu, .autocomplete, .lightbox, .command-palette'),
      ].some((node) => !node.closest(".world-place") && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
      if (layered || root.current?.querySelector(".popover-menu, .autocomplete")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <section
      ref={root}
      className="world-dispatch world-place"
      data-kind={props.kind}
      role="dialog"
      aria-modal="false"
      aria-labelledby="world-place-title"
      tabIndex={-1}
      style={panel ? ({ "--wd-panel": `url(${panel})` } as CSSProperties) : undefined}
    >
      <header className="wd-head">
        <h2 id="world-place-title">{props.title}</h2>
        <button type="button" className="wd-close" aria-label={`Close the ${props.title.toLowerCase()}`} onClick={props.onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="wd-body wp-body">{props.children}</div>
      <footer className="wd-foot">
        <span>{props.kind === "add" ? "Choose a folder on a host to add it" : "Pick one of its agents to talk to it"}</span>
        <span>Esc · Close</span>
      </footer>
    </section>
  );
}

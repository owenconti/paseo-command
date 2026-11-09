/** The Dungeon Board's Dispatch: the app's New agent form in the board's gold-framed HUD panel, over the world. */
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { X } from "lucide-react";
import { NewAgent } from "../Dispatch";
import { loadHudArt } from "./art";
import "./world-dispatch.css";

type Props = ComponentProps<typeof NewAgent>;

export function WorldDispatch(props: Props) {
  const [art, setArt] = useState<{ panel: string; dispatch: string } | null>(null);
  const root = useRef<HTMLElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let live = true;
    loadHudArt().then((a) => live && setArt(a), () => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    // Start in the message box, as the panel's New agent does once its form is chosen.
    const id = requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>("textarea")?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    // Esc leaves, unless something layered above it (a picker, a menu, a dialog) takes it first.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const layered = [
        ...document.querySelectorAll<HTMLElement>('[aria-modal="true"], .popover-menu, .autocomplete, .lightbox, .command-palette'),
      ].some(
        (node) =>
          !node.closest(".world-dispatch") &&
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== "hidden",
      );
      if (layered) return;
      if (root.current?.querySelector(".popover-menu, .autocomplete")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current.onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <section
      ref={root}
      className="world-dispatch"
      role="dialog"
      aria-modal="false"
      aria-labelledby="world-dispatch-title"
      style={art ? ({ "--wd-panel": `url(${art.panel})`, "--wd-icon": `url(${art.dispatch})` } as CSSProperties) : undefined}
    >
      <header className="wd-head">
        <span className="wd-icon" aria-hidden="true" />
        <h2 id="world-dispatch-title">Dispatch an agent</h2>
        <button type="button" className="wd-close" aria-label="Close the dispatch" onClick={props.onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="wd-body">
        <NewAgent {...props} />
      </div>
      <footer className="wd-foot">
        <span>Write the first message to send the agent out</span>
        <span>Esc · Close</span>
      </footer>
    </section>
  );
}

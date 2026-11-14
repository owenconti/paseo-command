/** What the macOS app hears about the map's place from the page (always mounted, in main.tsx). The page draws Crew
 * there itself (there is no other map): it says that the fleet is in (`loaded`: the splash lifts), which workspace the
 * Terminal tab follows (`workspace`), and where the map's place is in the window (`viewport`: Conquer, the Terminal
 * tab and the Files editors are laid over it, beside the session panel). The pages' look is the Galaxy theme while
 * dark, as it always was with Crew. */
import { useEffect, type RefObject } from "react";
import { setUnityWorldTheme } from "./theme";
import { worldFrame } from "./viewControls";

/** The app's map channel. */
const postNative = (message: Record<string, unknown>) =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.paseoWorld?.postMessage(message);

export type TerminalWorkspace = { id: string; host?: string; name: string };

export function useMapBridge(loaded: boolean, workspace: TerminalWorkspace | undefined, frame: RefObject<HTMLElement | null>) {
  useEffect(() => {
    setUnityWorldTheme("galaxy");
    return () => setUnityWorldTheme(null);
  }, []);
  useEffect(() => {
    if (loaded) postNative({ type: "loaded" });
  }, [loaded]);
  const id = workspace?.id, host = workspace?.host ?? "", name = workspace?.name ?? "";
  useEffect(() => {
    postNative({ type: "workspace", workspace: id ? { id, host, name } : null });
  }, [id, host, name]);
  // The map's place, in CSS px from the page's top left, posted as it resizes or moves (the session panel opening,
  // resizing or changing sides moves it without resizing it: the root's style and `data-panel-side` say so).
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    let last = "";
    const post = () => {
      const r = node.getBoundingClientRect();
      const now = `${r.x},${r.y},${r.width},${r.height}`;
      if (now === last) return;
      last = now;
      postNative({ type: "viewport", x: r.x, y: r.y, width: r.width, height: r.height });
    };
    post();
    const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(post);
    resized?.observe(node);
    const moved = new MutationObserver(post);
    moved.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-panel-side"] });
    const offMoved = worldFrame.subscribe(post);
    addEventListener("resize", post);
    return () => {
      resized?.disconnect();
      moved.disconnect();
      offMoved();
      removeEventListener("resize", post);
    };
  }, [frame]);
}

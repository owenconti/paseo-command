/** What the macOS app hears about the map whichever style shows, from the page (always mounted, in main.tsx):
 * the style (View → Map Style marks it, and asks for one through `map-style-<id>`), and, for a style the page
 * draws itself (Crew), that it does (`pageMap`: the SpriteKit view stays hidden and paused), that the fleet is
 * in (`loaded`: the splash lifts) and which workspace the Terminal tab follows (`workspace`), which a native
 * world says otherwise (NativeWorld.tsx). */
import { useEffect } from "react";
import { MAP_STYLES, pageDrawn, setMapStyle, type MapStyle } from "./mapStyle";
import { onAppCommand } from "./appCommands";
import { setUnityWorldTheme } from "./theme";

/** The app's map channel (the native worlds post on it too, rendering/src/native/bridge.ts). */
const postNative = (message: Record<string, unknown>) =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers?.paseoWorld?.postMessage(message);

export type TerminalWorkspace = { id: string; host?: string; name: string };

export function useMapBridge(style: MapStyle, loaded: boolean, workspace: TerminalWorkspace | undefined) {
  useEffect(() => {
    const offStyles = MAP_STYLES.map((m) => onAppCommand(`map-style-${m.id}`, () => setMapStyle(m.id)));
    return () => offStyles.forEach((off) => off());
  }, []);
  const drawn = pageDrawn(style);
  // The panels' and pages' look (Galaxy, or Light while the system is light), as a native world sets it: for as long
  // as the style is chosen, whatever tab shows (the pages' near-black palette keys on it), not only while Crew shows.
  useEffect(() => {
    if (!drawn) return;
    setUnityWorldTheme("galaxy");
    return () => setUnityWorldTheme(null);
  }, [drawn]);
  useEffect(() => {
    postNative({ type: "mapStyle", style });
  }, [style]);
  useEffect(() => {
    postNative({ type: "pageMap", on: drawn });
  }, [drawn]);
  useEffect(() => {
    if (drawn && loaded) postNative({ type: "loaded" });
  }, [drawn, loaded]);
  const id = workspace?.id, host = workspace?.host ?? "", name = workspace?.name ?? "";
  useEffect(() => {
    if (!drawn) return;
    postNative({ type: "workspace", workspace: id ? { id, host, name } : null });
  }, [drawn, id, host, name]);
}

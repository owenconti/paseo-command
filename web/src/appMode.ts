import { useEffect, useState } from "react";
import { askAppMode, configureAppIntegrations } from "./worldBridge";
import { useIntegrations } from "./integrationSettings";

/** What stands in the map's place in the macOS app (its mode bar's tabs):
 * the map, the Conquer browser, or Linear, which the page draws itself. */
export type AppMode = "command" | "conquer" | "linear";

const MODES: AppMode[] = ["command", "conquer", "linear"];

/** The mode bar's tab, as the app reports it (`paseo:mode`); always the map in a browser. */
export function useAppMode(): AppMode {
  const { integrations, loaded } = useIntegrations();
  useEffect(() => {
    configureAppIntegrations(integrations);
    if (loaded) askAppMode();
  }, [integrations, loaded]);
  const [mode, setMode] = useState<AppMode>("command");
  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent).detail?.mode;
      if (MODES.includes(next)) setMode(next);
    };
    window.addEventListener("paseo:mode", receive);
    // Ask once listening: a page that (re)loads in Linear shows it at once.
    askAppMode();
    return () => window.removeEventListener("paseo:mode", receive);
  }, []);
  return mode === "linear" && !integrations.linear ? "command" : mode;
}

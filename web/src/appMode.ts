import { useEffect, useState } from "react";
import { openAppLink } from "./appLinks";
import { askAppMode, configureAppIntegrations } from "./worldBridge";
import { useIntegrations } from "./integrationSettings";
import { activityEnabled, type Integrations } from "./integrations";

/** What stands in the map's place in the macOS app (its mode bar's tabs):
 * the map, or what the page draws itself: GitHub (pull requests), Activity (GitHub and
 * Linear notifications together) and Settings (the bar's gear, not a tab). (The Linear tab was
 * removed: an old `linear` mode shows the map; so were Files, Terminal and Conquer, your editor and the agent's browser
 * beside its conversation having their places.) */
export type AppMode = "command" | "activity" | "github" | "settings";

/** The tabs in the mode bar's order (`Mode.tabs` in `native/…/ModeBar.swift`). */
const TABS = ["command", "github", "activity"] as const;
/** Every side the app reports, Settings (the gear's) among them. */
const MODES: AppMode[] = [...TABS, "settings"];

/** The page's tabs whose integration is on. */
export const appTabs = (i: Integrations) => ({ github: i.github, activity: activityEnabled(i) });

/** The mode bar's tabs shown, in its order: ⌘` steps through them, ⌘1…⌘3 pick one. */
export function shownModes(i: Integrations): AppMode[] {
  const tabs = appTabs(i);
  return TABS.filter((mode) => mode === "command" || tabs[mode]);
}

/** A tab's ⌘ key, by its place among those shown (macOS app only). */
export const modeKey = (i: Integrations, mode: AppMode): string[] => ["⌘", String(shownModes(i).indexOf(mode) + 1)];

/** The mode bar's tab, as the app reports it (`paseo:mode`); always the map in a browser. */
export function useAppMode(): AppMode {
  const { integrations, loaded } = useIntegrations();
  useEffect(() => {
    configureAppIntegrations(appTabs(integrations));
    if (loaded) askAppMode();
  }, [integrations, loaded]);
  const [mode, setMode] = useState<AppMode>("command");
  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent).detail?.mode;
      if (MODES.includes(next)) setMode(next);
    };
    window.addEventListener("paseo:mode", receive);
    const link = (event: Event) => {
      const url = (event as CustomEvent).detail?.url;
      if (typeof url === "string") openAppLink(url);
    };
    window.addEventListener("paseo:link", link);
    // Ask once listening: a page that (re)loads in GitHub or Activity shows it at once.
    askAppMode();
    return () => {
      window.removeEventListener("paseo:mode", receive);
      window.removeEventListener("paseo:link", link);
    };
  }, []);
  const tabs = appTabs(integrations);
  return mode === "github" || mode === "activity" ? (tabs[mode] ? mode : "command") : mode;
}

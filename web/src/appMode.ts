import { useEffect, useState } from "react";
import { askAppMode, configureAppIntegrations } from "./worldBridge";
import { useIntegrations } from "./integrationSettings";
import { activityEnabled, type Integrations } from "./integrations";

/** What stands in the map's place in the macOS app (its mode bar's tabs):
 * the map, the Conquer browser, or what the page draws itself: Linear, Slack
 * and Activity (GitHub, Linear and Slack notifications together). */
export type AppMode = "command" | "conquer" | "linear" | "slack" | "activity";

const MODES: AppMode[] = ["command", "conquer", "linear", "slack", "activity"];

/** The page's tabs whose integration is on. */
export const appTabs = (i: Integrations) => ({ linear: i.linear, slack: i.slack, activity: activityEnabled(i) });

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
    // Ask once listening: a page that (re)loads in Linear, Slack or Activity shows it at once.
    askAppMode();
    return () => window.removeEventListener("paseo:mode", receive);
  }, []);
  const tabs = appTabs(integrations);
  return mode === "linear" || mode === "slack" || mode === "activity" ? (tabs[mode] ? mode : "command") : mode;
}

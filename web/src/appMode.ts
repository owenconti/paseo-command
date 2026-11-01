import { useEffect, useState } from "react";
import { openAppLink } from "./appLinks";
import { askAppMode, configureAppIntegrations } from "./worldBridge";
import { useIntegrations } from "./integrationSettings";
import { activityEnabled, type Integrations } from "./integrations";

/** What stands in the map's place in the macOS app (its mode bar's tabs):
 * the map, the Conquer browser, or what the page draws itself: Linear, Slack,
 * GitHub (pull requests and the workspace's changes) and Activity (GitHub,
 * Linear and Slack notifications together), and Settings (the bar's gear, not a tab). */
export type AppMode = "command" | "conquer" | "linear" | "slack" | "github" | "activity" | "settings";

const MODES: AppMode[] = ["command", "conquer", "linear", "slack", "github", "activity", "settings"];

/** The page's tabs whose integration is on. */
export const appTabs = (i: Integrations) => ({ linear: i.linear, slack: i.slack, github: i.github, activity: activityEnabled(i) });

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
    // Ask once listening: a page that (re)loads in Linear, Slack, GitHub or Activity shows it at once.
    askAppMode();
    return () => {
      window.removeEventListener("paseo:mode", receive);
      window.removeEventListener("paseo:link", link);
    };
  }, []);
  const tabs = appTabs(integrations);
  return mode === "linear" || mode === "slack" || mode === "github" || mode === "activity" ? (tabs[mode] ? mode : "command") : mode;
}

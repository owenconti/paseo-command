/** Optional integrations require an explicit opt-in, independent of credentials. */
export const INTEGRATIONS = ["linear", "slack", "github", "typesafe"] as const;
export type Integration = (typeof INTEGRATIONS)[number];
export type Integrations = Record<Integration, boolean>;
export const DEFAULT_INTEGRATIONS: Integrations = {
  linear: false,
  slack: false,
  github: false,
  typesafe: false,
};
export function integrationSettings(value: unknown): Integrations {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    linear: raw.linear === true,
    slack: raw.slack === true,
    github: raw.github === true,
    typesafe: raw.typesafe === true,
  };
}
/** Whether the Activity tab has anything to gather: GitHub, Linear or Slack is on. */
export const activityEnabled = (i: Integrations) => i.github || i.linear || i.slack;

/** Optional integrations require an explicit opt-in, independent of credentials. */
export const INTEGRATIONS = ["linear", "github", "typesafe", "pool"] as const;
export type Integration = (typeof INTEGRATIONS)[number];
export type Integrations = Record<Integration, boolean>;
export const DEFAULT_INTEGRATIONS: Integrations = {
  linear: false,
  github: false,
  typesafe: false,
  pool: false,
};
export function integrationSettings(value: unknown): Integrations {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    linear: raw.linear === true,
    github: raw.github === true,
    typesafe: raw.typesafe === true,
    pool: raw.pool === true,
  };
}
/** Whether the Activity tab has anything to gather: GitHub or Linear is on. */
export const activityEnabled = (i: Integrations) => i.github || i.linear;

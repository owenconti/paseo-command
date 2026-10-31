/** Optional integrations require an explicit opt-in, independent of credentials. */
export const INTEGRATIONS = ["linear", "typesafe"] as const;
export type Integration = (typeof INTEGRATIONS)[number];
export type Integrations = Record<Integration, boolean>;
export const DEFAULT_INTEGRATIONS: Integrations = {
  linear: false,
  typesafe: false,
};
export function integrationSettings(value: unknown): Integrations {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    linear: raw.linear === true,
    typesafe: raw.typesafe === true,
  };
}

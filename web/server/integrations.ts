import { integrationSettings, type Integration } from "../src/integrations";
import { readSettings } from "./settings";
import { readSecret, type SecretName } from "./secrets";

export const integrationEnabled = (name: Integration) =>
  integrationSettings(readSettings()?.integrations)[name];

const KEYS = {
  linear: "linearApiKey",
  typesafe: "typesafeApiKey",
  github: "githubToken",
} as const satisfies Record<string, SecretName>;

/** A credential from secrets.json, only while its integration is enabled. */
export const integrationKey = (name: keyof typeof KEYS) =>
  integrationEnabled(name) ? readSecret(KEYS[name]) : undefined;

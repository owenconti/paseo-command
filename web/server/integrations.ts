import { integrationSettings, type Integration } from "../src/integrations";
import { readSettings } from "./settings";
import { readSecret } from "./secrets";

export const integrationEnabled = (name: Integration) =>
  integrationSettings(readSettings()?.integrations)[name];

export const integrationKey = (name: "linear" | "typesafe") =>
  integrationEnabled(name)
    ? readSecret(name === "linear" ? "linearApiKey" : "typesafeApiKey")
    : undefined;

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dataDir } from "./subagentArchive";

export const SECRET_NAMES = ["linearApiKey", "typesafeApiKey", "slackUserToken", "slackAppToken"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export const secretsFile = () => join(dataDir(), "secrets.json");
const UNREADABLE =
  "secrets.json can't be read. Fix the file before saving API keys.";

/** Missing is empty; malformed or unreadable files must never be overwritten. */
function readSecrets(): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(secretsFile(), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : null;
  }
}

/** Only presence is exposed to the page, never keys or masked versions of keys. */
export function secretsStatus() {
  const raw = readSecrets();
  const configured = (name: SecretName) =>
    typeof raw?.[name] === "string" && !!raw[name].trim();
  return {
    configured: Object.fromEntries(SECRET_NAMES.map((name) => [name, configured(name)])) as Record<SecretName, boolean>,
    error: raw ? null : UNREADABLE,
  };
}

/** Set or remove one key, preserving other credentials in an atomic, owner-only file. */
export function saveSecret(body: Record<string, unknown>) {
  if (
    Object.keys(body).some((name) => name !== "name" && name !== "value") ||
    !SECRET_NAMES.includes(body.name as SecretName)
  )
    throw new Error("Invalid API key setting");
  const value = body.value;
  if (
    value !== null &&
    (typeof value !== "string" ||
      !value.trim() ||
      value.length > 8192 ||
      /\s/.test(value.trim()))
  )
    throw new Error("Enter a valid API key");
  const raw = readSecrets();
  if (!raw) throw new Error(UNREADABLE);
  if (value === null) delete raw[body.name as SecretName];
  else raw[body.name as SecretName] = (value as string).trim();
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const file = secretsFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
  return secretsStatus();
}

/** Credentials stay on the server, in the app's data directory. Never read shell keys. */
export function readSecret(name: SecretName): string | undefined {
  const value = readSecrets()?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

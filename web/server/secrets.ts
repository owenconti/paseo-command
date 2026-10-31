import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./subagentArchive";

/** Credentials stay on the server, in the app's data directory. Never read shell keys. */
export function readSecret(
  name: "linearApiKey" | "typesafeApiKey",
): string | undefined {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(dataDir(), "secrets.json"), "utf8"),
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const value = (raw as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

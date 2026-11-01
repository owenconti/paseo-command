/**
 * Managing a host's Paseo agent profiles (its daemon config's `agentProfiles`,
 * Paseo's Settings → Profiles), as the Paseo app does:
 *
 * - `GET /api/profiles/editor?[host=…]`: `{ supported, profiles }`, every
 *   profile as `GET /api/profiles` lists it, and whether the daemon keeps them
 *   (an older one silently drops a written list, so its editor is read only).
 * - `GET /api/profiles/features?provider=…[&model=…][&mode=…][&thinking=…][&host=…]`:
 *   the provider's features (toggles and selects) for those settings.
 * - `POST /api/profiles` `{ profiles, base, host? }`: replace the list with
 *   `profiles` (in order; a row without an `id` is new). `base` names the ids
 *   the editor started from: profiles added elsewhere since stay, after them.
 *   What the editor doesn't show (a profile's icon, colour, other keys, and
 *   non-scalar feature values while its provider is unchanged) is kept.
 *   Answers the saved list.
 */
import { randomBytes } from "node:crypto";
import { remember, scopeOf } from "../fleet";
import { profileRows } from "../rows";
import type { Mark } from "./commands";
import { homeOf } from "./projects";
import { providers } from "./reads";
import { resolveHost, sdk, timed, type Remote } from "./hosts";
import { featureValues, id, option, present, text, type Body } from "./validate";

const MAX_PROFILES = 50;
const MANAGED = [
  "id",
  "name",
  "provider",
  "model",
  "modeId",
  "thinkingOptionId",
  "featureValues",
  "notes",
];
type Raw = Record<string, unknown>;

type Client = Awaited<ReturnType<typeof sdk>>;
const supported = (client: Client) =>
  client.getLastServerInfoMessage?.()?.features?.agentProfiles === true;

async function rawProfiles(client: Client): Promise<Raw[]> {
  const r = await timed(client.getDaemonConfig(), undefined, client);
  const rows: unknown = r?.config?.agentProfiles;
  return Array.isArray(rows)
    ? rows.filter((p): p is Raw => !!p && typeof p === "object")
    : [];
}

/** `GET /api/profiles/editor`. */
export async function profileEditor(host?: Remote) {
  const client = await sdk(host);
  return {
    supported: supported(client),
    profiles: profileRows(await rawProfiles(client)),
  };
}

/** `GET /api/profiles/features`: what the provider offers for a draft. */
export async function profileFeatures(url: URL, host?: Remote) {
  for (const key of url.searchParams.keys())
    if (!["host", "provider", "model", "mode", "thinking"].includes(key))
      throw new Error("Unexpected parameters");
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const provider = option(q("provider"), "provider");
  const model = q("model") && option(q("model"), "model");
  const mode = q("mode") && option(q("mode"), "mode");
  const thinking = q("thinking") && option(q("thinking"), "thinking option");
  return remember(
    `${scopeOf(host?.target)}|profile-features:${provider}|${model ?? ""}|${mode ?? ""}|${thinking ?? ""}`,
    60000,
    async () => {
      const client = await sdk(host);
      // Features don't depend on a folder; the host's home stands in for one.
      const r = await timed(
        client.listProviderFeatures({
          provider,
          cwd: await homeOf(host),
          ...(model ? { model } : {}),
          ...(mode ? { modeId: mode } : {}),
          ...(thinking ? { thinkingOptionId: thinking } : {}),
        }),
        undefined,
        client,
      );
      return Array.isArray(r?.features) ? r.features : [];
    },
  );
}

/** One edited profile, checked field by field. */
function edited(v: unknown, known: Set<string>) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid profile");
  const p = v as Body;
  const name = text(p.name, "profile name", 60);
  const provider = option(p.provider, "provider");
  if (!known.has(provider))
    throw new Error(`“${name}” needs a provider this host has`);
  if (p.notes !== undefined && typeof p.notes !== "string")
    throw new Error("Invalid notes");
  const notes = typeof p.notes === "string" ? p.notes.trim() : "";
  if (notes.length > 2000 || notes.includes("\0"))
    throw new Error("Notes are limited to 2000 characters");
  return {
    id: present(p.id) ? id(p.id) : undefined,
    name,
    provider,
    model: present(p.model) ? option(p.model, "model") : undefined,
    modeId: present(p.mode) ? option(p.mode, "mode") : undefined,
    thinkingOptionId: present(p.thinking)
      ? option(p.thinking, "thinking option")
      : undefined,
    featureValues:
      p.features === undefined ? {} : featureValues(p.features),
    notes: notes || undefined,
  };
}

/** `POST /api/profiles`: save the host's profiles. */
export async function saveProfiles(body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  if (!Array.isArray(body.profiles) || body.profiles.length > MAX_PROFILES)
    throw new Error(`Keep to ${MAX_PROFILES} profiles`);
  if (
    !Array.isArray(body.base) ||
    body.base.length > 200 ||
    !body.base.every((b) => typeof b === "string")
  )
    throw new Error("Invalid base");
  const base = new Set(body.base as string[]);
  const known = new Set((await providers(host)).map((p) => p.provider));
  const rows = body.profiles.map((p) => edited(p, known));
  const names = new Set<string>();
  for (const r of rows) {
    const key = r.name.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`Two profiles are named “${r.name}”`);
    names.add(key);
  }
  const client = await sdk(host);
  if (!supported(client))
    throw new Error("This host's Paseo is too old to save profiles; update it first.");
  const current = await rawProfiles(client);
  const byId = new Map(current.map((p) => [String(p.id), p]));
  const ids = new Set<string>();
  const next: Raw[] = rows.map((r) => {
    const old = r.id ? byId.get(r.id) : undefined;
    // A profile removed elsewhere meanwhile comes back as a new one.
    const profileId = old ? r.id! : `agent_profile_${randomBytes(6).toString("hex")}`;
    if (ids.has(profileId)) throw new Error("A profile is listed twice");
    ids.add(profileId);
    const kept = Object.fromEntries(
      Object.entries(old ?? {}).filter(([k]) => !MANAGED.includes(k)),
    );
    const oldFeatures =
      old?.provider === r.provider &&
      old.featureValues &&
      typeof old.featureValues === "object"
        ? Object.entries(old.featureValues as Raw).filter(
            ([, v]) => !["string", "number", "boolean"].includes(typeof v),
          )
        : [];
    const features = { ...Object.fromEntries(oldFeatures), ...r.featureValues };
    return {
      ...kept,
      id: profileId,
      name: r.name,
      provider: r.provider,
      ...(r.model ? { model: r.model } : {}),
      ...(r.modeId ? { modeId: r.modeId } : {}),
      ...(r.thinkingOptionId ? { thinkingOptionId: r.thinkingOptionId } : {}),
      ...(Object.keys(features).length ? { featureValues: features } : {}),
      ...(r.notes ? { notes: r.notes } : {}),
    };
  });
  // Added elsewhere since the editor opened: not the editor's to delete.
  for (const p of current)
    if (!base.has(String(p.id)) && !ids.has(String(p.id))) next.push(p);
  mark({ host, keys: ["profiles", "profile-features:"] });
  const r = await timed(
    client.patchDaemonConfig({ agentProfiles: next as never }),
    undefined,
    client,
  );
  return profileRows(r?.config?.agentProfiles ?? next);
}

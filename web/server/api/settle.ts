import { invalidate } from "../fleet";
import { settle } from "../live";
import { FANOUT_KEYS, type Changed } from "./commands";
import { hostKey } from "./hosts";

/**
 * Drop what a mutation could have changed, then let the host's feed re-read
 * now, so the answer (and the push that goes out before it) shows the
 * command's effect.
 */
export async function settleChange(changed: Changed | undefined) {
  if (!changed) return;
  const keys =
    typeof changed.keys === "function" ? changed.keys() : changed.keys;
  if (keys.some((k) => FANOUT_KEYS.has(k))) keys.push("rows");
  if (keys.length)
    invalidate(hostKey(changed.host), changed.host?.target, keys);
  await settle(hostKey(changed.host));
}

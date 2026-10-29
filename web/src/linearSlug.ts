/** A Linear workspace's URL slug, typed bare or pasted as a linear.app URL. */
export function linearSlug(input: string): string | null {
  let s = input.trim().toLowerCase();
  const m = /^(?:https?:\/\/)?linear\.app\/([^/?#\s]+)/.exec(s);
  if (m) s = m[1];
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null;
}

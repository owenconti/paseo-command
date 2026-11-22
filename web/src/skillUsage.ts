import { api } from "./api";
import type { Command } from "./composer/types";

/** The skill a message invokes: its `/name` at the start, followed by a space or nothing (as `server/skillUsage.ts`). */
export const skillNameOf = (text: string) => /^\/([A-Za-z0-9][\w:.-]{0,80})(?=\s|$)/.exec(text.trimStart())?.[1];

/**
 * Note a skill you sent from the message box in the app's skill usage record (`POST /api/skill-usage`, the user's
 * ask). `commands`: the agent's skills and commands, once the / menu has read them; a name they don't list (a message
 * that only starts with a path) isn't a skill. Unread, the server asks the agent's list itself (drafts aside).
 * Never in the way of the send: a failure is ignored.
 */
export function noteSkillRun(
  text: string,
  { commands, agent, host, provider, cwd }: {
    commands: Command[] | null;
    agent?: string;
    host?: string;
    provider?: string;
    cwd?: string;
  },
) {
  const skill = skillNameOf(text);
  if (!skill) return;
  const listed = commands?.find((c) => c.name === skill && (c.kind === "skill" || c.kind === "command"));
  if (commands ? !listed : !agent) return;
  void api("skill-usage", {
    skill,
    ...(listed ? { kind: listed.kind } : {}),
    ...(agent ? { agent } : {}),
    ...(host ? { host } : {}),
    ...(provider ? { provider } : {}),
    ...(cwd ? { cwd } : {}),
  }).catch(() => {});
}

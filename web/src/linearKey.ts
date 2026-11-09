import { branchKey, textKey } from "./display";

/** Shared by the issue chip and automatic workspace naming. */
export function linearKey(from: {
  branch?: string | null;
  prTitle?: string | null;
  prBody?: string | null;
  agentTitle?: string | null;
}): string | null {
  return (
    branchKey(from.branch) ??
    textKey(from.prTitle) ??
    textKey(from.prBody) ??
    textKey(from.agentTitle) ??
    null
  );
}

/**
 * Replies the user may obviously want to send next ("Okay, I've merged
 * PR #3."), for a decision model to pick from: it chooses, code writes.
 */

/** A reply the user might send, and when it fits. `{pr}` is filled from
 *  the agent's reply; a reply naming no single PR never offers it. */
export type SuggestionTemplate = { id: string; when: string; text: string };

export const SUGGESTIONS: SuggestionTemplate[] = [
  { id: "merged_pr", text: "Okay, I've merged {pr}.", when: "It says it will carry on once {pr} is merged, or asks the user to merge {pr}." },
  { id: "merged", text: "Okay, I've merged it.", when: "It says it will carry on once a pull request or branch it names by no number is merged, or asks the user to merge it." },
  { id: "done_step", text: "Done, carry on.", when: "It waits for the user to do a manual step themselves (run a command, change a setting, edit a file, click something) before it carries on." },
  { id: "restarted", text: "I've restarted it, carry on.", when: "It waits for the user to restart or relaunch an app, server or tool before it carries on." },
  { id: "logged_in", text: "I've signed in, carry on.", when: "It waits for the user to sign in or authenticate somewhere before it carries on." },
  { id: "added_secret", text: "I've added it, carry on.", when: "It waits for the user to add a key, secret, environment variable or config value themselves before it carries on." },
  { id: "go_ahead", text: "Go ahead.", when: "It proposes one specific next step and stops for the go-ahead before doing it." },
  { id: "plan_ok", text: "The plan looks good, go ahead.", when: "It lays out a plan and waits for the user to approve it before starting." },
  { id: "continue", text: "Continue.", when: "It stopped partway through work it set out to do (a limit, a checkpoint, a long task split up) and needs nothing else to carry on." },
  { id: "commit_push", text: "Looks good, commit and push it.", when: "It reports finished changes that are not yet committed or pushed." },
  { id: "open_pr", text: "Looks good, open a PR.", when: "It reports finished work on a branch that has no pull request yet." },
  { id: "merge_it", text: "Merge it.", when: "It reports a pull request ready to merge (checks passing, approved) and waits for the go-ahead." },
  { id: "fix_checks", text: "Fix the failing checks.", when: "It reports CI checks failing on its pull request without fixing them." },
  { id: "address_review", text: "Address the review comments.", when: "It reports review comments on its pull request that it has not addressed." },
  { id: "fix_it", text: "Please fix that.", when: "It reports a bug, error or failing test it found but did not fix." },
  { id: "run_tests", text: "Run the tests.", when: "It finished changes but says it has not run or verified the tests." },
  { id: "try_again", text: "Try again.", when: "Something failed for a passing reason (network, timeout, rate limit, a flaky test, a service being down) and it stopped." },
];

/** The single pull request a reply names ("PR #3", "pull request #3"), if
 *  it names exactly one. */
export function namedPr(reply: string): string | undefined {
  const numbers = new Set(
    [...reply.matchAll(/\b(?:PR|pull request)\s*#(\d+)\b/gi)].map((m) => m[1]),
  );
  return numbers.size === 1 ? `PR #${[...numbers][0]}` : undefined;
}

/** The templates a reply can fill, with their slots filled. */
export function fillSuggestions(reply: string): SuggestionTemplate[] {
  const pr = namedPr(reply);
  return SUGGESTIONS.flatMap((t) => {
    if (!t.text.includes("{pr}")) return [t];
    if (!pr) return [];
    return [{ ...t, text: t.text.replaceAll("{pr}", pr), when: t.when.replaceAll("{pr}", pr) }];
  });
}

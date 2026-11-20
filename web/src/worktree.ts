/** Diagonal's repositories (its remote on GitHub under Diagonal-HQ): their worktrees carry `bin/worktree`, whose
 * `status` names the worktree's app address (`server/worktreeUrl.ts`). Pure, shared with the server. */
export const isDiagonalRepo = (repo: string | undefined | null) =>
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)Diagonal-HQ\/[\w.-]+?(?:\.git)?\/?$/i.test((repo ?? "").trim());

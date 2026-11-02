# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **Activity: Linear items and links open the issue in the Linear tab.** Linear notifications in the
  Activity feed (seen on pull request notifications about an issue, e.g. "Pull request checks failed" and
  "Pull request commented" on DE-7919) and links to Linear issues in it should open the issue in the Linear tab.
  `web/src/activity/open.ts` handles `open.kind === "linear-issue"`, which `web/server/activity/linear.ts`
  sets only when the group has an `issueKey`; check whether these PR-type notifications lack one (falling back
  to `url`), and whether Linear links in the preview are routed through `parseAppLink`. Workspace: `fix-activity-linear-links`.
- [ ] **GitHub tab: pull requests by repository, with filters and favourites.** The sidebar lists only
  Review requests, Your pull requests and Involving you. Add a Repositories section: each repo with open PRs
  (from the ones you can see), its PRs listed with filters (state, author, review status, draft, CI). Let you
  star repositories and organizations; starred ones show first as favourites, kept in the data directory's
  `settings.json` (as presets are). Reads through `web/server/github/reads.ts` (named, cached, the fake in tests);
  add ⌘K entries, keys and the shortcuts dialog's GitHub group as CLAUDE.md asks. Workspace: `github-prs-by-repo`.

## Done

- [x] **Slack: your own messages show as "Paseo Command" (App).** Our client mislabelled them: Slack posts
  them as you (user token, no `username`), but attaches the app's `bot_profile`, which `messageOf` took as
  `botName`. A message with a person behind it (`user`, not a `bot_message`) now shows that person in every
  route (post, history, threads, search, socket). Commit "Slack: your own messages sent through the app show
  as you, not as the app".

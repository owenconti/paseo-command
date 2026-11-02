# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **GitHub tab: pull requests by repository, with filters and favourites.** The sidebar lists only
  Review requests, Your pull requests and Involving you. Add a Repositories section: each repo with open PRs
  (from the ones you can see), its PRs listed with filters (state, author, review status, draft, CI). Let you
  star repositories and organizations; starred ones show first as favourites, kept in the data directory's
  `settings.json` (as presets are). Reads through `web/server/github/reads.ts` (named, cached, the fake in tests);
  add ⌘K entries, keys and the shortcuts dialog's GitHub group as CLAUDE.md asks. Workspace: `github-prs-by-repo`.
- [ ] **Linear: sub-grouping in lists and boards, as Linear has.** The Display options (`ListControls.tsx`,
  `display.ts`, kept per place) offer Grouping, Ordering and Completed issues. Add Sub-grouping (the same
  properties as Grouping, plus none; never the same as Grouping) and Linear's swap button beside Grouping that
  exchanges the two. In a list, each group holds its sub-groups under their own heads; on a board, sub-groups are
  swimlane rows across the columns, a card dropped into a cell taking both its column's and its row's value
  (`dropChange` in `group.ts`). Views start with their sub-grouping as set in Linear. Workspace: `linear-sub-grouping`.
- [ ] **Slack: a Recent section, and your own channel sections.** The sidebar (`web/src/slack/Sidebar.tsx`,
  `sections.ts`) has Channels and Direct messages. Add Recent at the top: the ~20 most recent conversations,
  threads and group DMs with activity (yours or others'), newest first, each opening its conversation or
  thread. Ideally the sidebar also shows the custom sections you've made in the Slack app. Slack's public Web
  API doesn't expose sidebar sections (the client's `users.channelSections.*` is undocumented and wants a
  browser session token), so check first. If no documented, user-token way exists, don't use the internal one:
  report back, and offer sections made in the app instead (kept in `settings.json`). Workspace: `slack-recent-and-sections`.
- [ ] **Linear: project views, and managing views.** The sidebar's Views (`q/views`) lists only issue views.
  Show Linear's project views too (custom views of projects, with their project filter), each opening a project
  list filtered as the view says (`ProjectList.tsx`), and a project's own views where Linear has them. Add view
  management: create a view from the current place's filters and display (name, icon/colour, description,
  personal or shared with a team or the workspace), edit it (rename, change its filters and display, sharing),
  and delete it after confirming. Use the sidebar's context menu, a Save as view button by the filters, and ⌘K.
  Whitelisted writes in `web/server/linear/writes.ts` (`customViewCreate|Update|Delete`, checked field by field),
  shown at once and rolled back if Linear refuses; tests over the fake. Workspace: `linear-views`.

## Done

- [x] **Activity: Linear items and links open the issue in the Linear tab.** Linear's pull request notifications
  ("Pull request checks failed", "Pull request commented") are `PullRequestNotification`s, with a pull request and no
  issue, so the feed had no issue key and opened their address instead. The notifications read now asks for the pull
  request's branch and title, and the issue key they name (one of the workspace's teams) opens the issue in the Linear
  tab, from Activity and from the Linear tab's Inbox; an item whose address is a Linear issue says "Open in Linear".
  Commit "Activity: Linear pull request notifications open their issue in the Linear tab".
- [x] **Slack: your own messages show as "Paseo Command" (App).** Our client mislabelled them: Slack posts
  them as you (user token, no `username`), but attaches the app's `bot_profile`, which `messageOf` took as
  `botName`. A message with a person behind it (`user`, not a `bot_message`) now shows that person in every
  route (post, history, threads, search, socket). Commit "Slack: your own messages sent through the app show
  as you, not as the app".

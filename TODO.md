# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **Linear: sub-grouping in lists and boards, as Linear has.** The Display options (`ListControls.tsx`,
  `display.ts`, kept per place) offer Grouping, Ordering and Completed issues. Add Sub-grouping (the same
  properties as Grouping, plus none; never the same as Grouping) and Linear's swap button beside Grouping that
  exchanges the two. In a list, each group holds its sub-groups under their own heads; on a board, sub-groups are
  swimlane rows across the columns, a card dropped into a cell taking both its column's and its row's value
  (`dropChange` in `group.ts`). Views start with their sub-grouping as set in Linear. Workspace: `linear-sub-grouping`.

## Done

- [x] **GitHub tab: pull requests by repository, with filters and favourites.** The sidebar gains Repositories
  (`RepoNav.tsx`, `q/repos`: one GraphQL query): favourites first (starred repositories and those of starred
  organizations), then the others with open PRs, grouped by owner and counted. Stars on rows and owner heads, S, + and
  ⌘K star by name (`owner/name` or an organization); kept as `githubStars` in the data directory's `settings.json`
  (`m/star`). A repository's PRs (`q/prs?repo=`, one search) filter by state, author, review, draft and CI, shown as
  Linear's chips and kept per repository; searches keep under GitHub's 30 a minute. ⌘K, keys and the shortcuts dialog
  updated. Commit "GitHub: pull requests by repository, with filters and starred favourites".
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

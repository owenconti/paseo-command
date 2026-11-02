# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **GitHub PR conversation: newest first.** The Conversation tab lists the PR's description, comments,
  reviews and events oldest first, so a long description fills the screen before any recent activity. List the
  timeline in reverse chronological order (newest at the top), the PR's description, as its oldest entry, at
  the bottom; a review's own comments and threads' replies keep their order inside it. The comment box goes at
  the top, above the newest entry. Add a small Newest/Oldest first toggle, remembered (localStorage), with its
  ⌘K entry. Workspace: `github-conversation-newest-first`.
- [ ] **Asks: an either/or question gets its options as quick replies.** An agent's reply ended "Should I push
  the branch and open a PR, or do you want the chamber fixtures deleted first?" The composer's "This reply asks"
  strip (`web/src/composer/AskStrip.tsx`) showed the question with only "Drafting answers…", no options. An
  "A, or B?" question is a pick: Jev (`web/server/asks.ts`, TypeSafe) should judge it as one with its options
  ("Push the branch and open a PR", "Delete the chamber fixtures first"), offered at once as quick replies, without
  waiting on the helper's drafted answers (`askAnswers.ts`). Find why it wasn't: the sentence split
  (`web/src/asks/sentences.ts`, `mayAsk`), the prompt/schema given to Jev, or the strip's handling of a pick.
  Also check "Drafting answers…" can't hang: it ends in answers, or a quiet fallback, within a bounded time.
  Tests over fakes; never call TypeSafe or a real daemon. Workspace: `asks-either-or-options`.
- [ ] **GitHub PR view: manage merge state, close and reopen.** The PR view (`PrView.tsx`) has Review and a
  read-only Merge section ("No conflicts with the base branch."). Make it act as GitHub's merge box, each action
  only where it applies and the token may (`viewerCanUpdate`, `viewerCanMergeAsAdmin`, the repo's allowed methods):
  - Merge: Merge, Squash and merge, or Rebase and merge (a method picker remembering the last per repo, only the
    repo's allowed ones), with editable commit title and message for merge/squash; confirm; delete the branch
    afterwards (offered, remembered). Blocked states say why (checks, reviews required, conflicts, behind).
  - Auto-merge: enable (with method) and disable (GraphQL `enablePullRequestAutoMerge`/`disable…`), shown with who
    turned it on; the merge queue where the repo uses one (add/remove).
  - Ready for review / Convert to draft; Update branch (merge or rebase) when behind.
  - Close pull request (optional comment, sent first; confirm) and, on a closed unmerged PR, Reopen.
  In the Merge section, with the main ones in the header (e.g. a split Merge button and a ⋯ menu beside Review),
  and ⌘K entries for each. Whitelisted writes in `web/server/github/writes.ts` (`m/merge`, `m/autoMerge`,
  `m/ready`, `m/updateBranch`, `m/state`; each field checked), shown at once and rolled back with a notice if GitHub
  refuses; the PR, its lists and counts, the map's PR medallions/auto-merge seal refresh. Tests over the fake;
  never real GitHub. Workspace: `github-pr-merge-state`.
- [ ] **Linear board: cards show through the column heads when scrolled.** On a board (e.g. Current Cycle grouped
  by assignee), scrolling down a column leaves cards visible above and behind the sticky column heads
  ("Cody 1", "Craig 3", …): card text and avatars peek out in the gap between the search field and the heads, and
  under the heads' text. The sticky heads (and swimlane heads, if sub-grouped) need an opaque background matching
  the column, covering the full column width and the gap above them, a z-index above cards, and cards clipped at
  the scroller's top. Check light and dark, list view's sticky group heads too. Add an e2e check (scroll a column,
  no card box intersects the head). Workspace: `fix-linear-board-sticky-heads`.

## Done

- [x] **Flaky e2e tests.** The causes, each fixed: the command palette reopened within its fade-out revived the
  closing dialog with its old query (an app bug, so Linear sub-grouping's quick ⌘K commands typed onto stale text;
  each opening is now a fresh dialog); e2e servers shared Vite's pre-bundled deps in the main checkout's
  `node_modules/.vite` with every worktree and dev server, whose re-bundling deleted chunks loaded on demand (the
  GitHub diff's highlighter languages; each server now has its own cache); the labeller test counted passes in a
  fixed window (now it holds each pass and checks one runs at a time); the forks "narrow panel" test scrolled by
  script, which leaves the view pinned, and measured before it settled; the Linear inbox test waited 30 s each run
  for a badge that was gone; and tests now send `paseo:mode` and other app events only once the app listens.
- [x] **GitHub: comments and PR bodies render as GitHub shows them.** The PR read asks GitHub's `bodyHTML` for the
  description, comments, reviews and line comments in the same query; the page cleans it again with an allowlist
  (`web/src/github/html.ts`) and draws it: tables, camo images, `<details>`, `<kbd>`, alerts, task lists, hidden
  comments gone, links opening as others do, in the pages' look and text size. Markdown is the fallback.
- [x] **Linear: an issue opened from outside the tab gets an issue-focused view.** A Linear issue link clicked
  outside the tab (the chat, Conquer, the header's chip: `paseo:link`), or an Activity item, opens the issue in
  its own place, `{ screen: "issue", issue, from }` (`focusIssue` in `place.ts`): it alone, full width, the sidebar
  marking nothing, as a new history entry after the place you had. Back (⌘[, the arrows, a mouse's back button),
  Esc and the issue's Back return there; a reload comes back to it, `from` standing before it in the history
  (`resume` in `history.ts`). Issue links inside the tab (a description, a comment) open beside the list as a row does.
- [x] **Removed the Slack feature entirely, at the user's request.** Gone: the Slack tab and its mode (`web/src/slack/`,
  the mode bar's tab and View menu item, `paseo:mode` `slack`; ⌘1…⌘6 now number the tabs shown), the server
  (`web/server/slack/`: routes, Socket Mode, events, the unreads queue, uploads, the fake), Activity's Slack source (its
  filter; 1–3 now pick All, GitHub, Linear), Slack link routing (`pageMode`/`routeLink`, `parseAppLink`: Slack links open
  in Conquer as other links do), launching agents from Slack (`DispatchTarget.slack`, presets' `{{slack}}`), Settings →
  Slack (its toggle, tokens, app setup and manifest), its ⌘K entries, shortcuts group, CSS, tests and e2e. `ws` stays (the
  terminal and fleet sockets use it). The user's Slack data is left in place and ignored: `integrations.slack` and
  `slackSections` in `settings.json`, the Slack tokens in `secrets.json` (saving either keeps them; a test checks it) and
  `slack-activity.json`.
- [x] **Page heads never overlap when narrow.** The pages' heads (Linear's lists, Activity, GitHub's lists and Changes,
  Slack's conversation and thread, Settings) share one rule set, `.page-head` in `web/src/styles/pages.css`: the title takes
  what the tools leave and clips, a breadcrumb's earlier parts cut short (…) before the name, and the whole title shows on
  hover while cut (`usePageTitleTip`, `web/src/pageHead.ts`). By the head's own width (container queries, in em) the tools
  drop their words for icons (still named and hinted), then asides and the count go, and only when the title would have
  less than 7em do the tools wrap under it. GitHub's PR back link cuts short instead of wrapping. E2e checks (Linear
  beside an open issue and at the narrowest window, Activity) assert nothing in the head overlaps (`headOverlaps`).
- [x] **Command palette: each entry names the page it's for.** Every entry has a `page` (`web/src/palette.ts`'s `PAGES`:
  Command, Conquer, Activity, Linear, Slack, GitHub, Settings, Terminal, App), shown on its right before any keys in one
  style; found agents, workspaces, projects and hosts add their kind ("Command · Agent"). Among equally good matches the
  page on screen comes first, never ahead of a better match. The type requires a page; the e2e checks every row names one.
- [x] **GitHub diff: resizable file list.** The diff view's file list (`DiffView.tsx`) resizes by its inner edge
  (`ResizeEdge`: drag, ←/→ with ⇧ for bigger steps, double-click restores the default), 160 px at least and leaving the
  diff 420 px; the width is kept in localStorage for every diff (PR and workspace Changes), the list hides when the view
  is too narrow for both, and long names show in full on hover.
- [x] **GitHub PR view: "Open Paseo agent" for the PR's branch.** A PR's header shows Open Paseo agent while a Paseo
  workspace (on any host) has its branch checked out (`web/src/github/paseo.ts`): the PR Paseo names for the workspace,
  else its branch and remote against the PR's head ref and head repository (a fork's for a PR from one). It selects the
  workspace's most recent agent (one working counts as now; the workspace without one) and switches to Command; with
  several, a menu chooses (host · project · workspace). ⌘K "Open the Paseo agent for this pull request", only with a match.

- [x] **GitHub PR view: manage reviewers and assignees, and list the checks.** The PR's side panel (`PrSide.tsx`) shows
  who's asked to review (people and teams) and who reviewed with their verdict, and the assignees, each with avatars; a gear's
  picker (you first, the repository's people and, for reviewers, its teams; never the author) requests or removes reviews and
  assigns or unassigns, a row re-requests or removes (`m/reviewers`, `m/assignees`, `q/teams`), shown at once and rolled back
  with a notice if GitHub refuses; ⌘K "Request review…", "Assign…". Checks lists each run and status beneath the count: failing,
  pending, then passing folded past five, with workflow or app, duration and details.
- [x] **GitHub tab: search repositories, ⌘S sidebar, people filters.** The sidebar's Repositories lists only Favourites (and the
  repository open now), under a search field (⌘K "Find a GitHub repository…") that finds any repository you can see by name,
  `owner/name` or owner (`q/repoSearch`: those known first, then GitHub's search, cached and within the search budget), each to open
  or star. ⌘S hides or shows the sidebar (kept; ⌘K and the shortcuts dialog). A repository's PRs filter by Author, Reviewer and
  Assignee: any of several people from `q/people` (you first, recent authors, assignable users; avatars, searchable), one search
  per person merged; the old author filter becomes you.
- [x] **Mode bar: Activity first of the pages, and ⌘1–7 switch tabs.** The tabs run Command, Conquer, Activity, Linear,
  Slack, GitHub, Settings (those enabled) in the bar, the View menu, ⌘\` stepping, the palette and the shortcuts dialog.
  ⌘1…⌘7 pick the tab in that place among those shown, from anywhere in the window (the window offers them to the View menu
  ahead of its views: the page, the terminal, Conquer's pages); the View menu and tabs' tooltips show them. Conquer's tab keys
  are now ⌥⌘1…⌥⌘8 and ⌥⌘9 (the last).
- [x] **Conquer: filling passwords with 1Password.** Only 1Password's Universal Autofill can work: ⌘\\ is its system hotkey
  (Carbon), which no app or page can take first; Conquer's login fields (iframes' too) are in the accessibility tree, take focus and
  filling, each web area gives its address (`AXURL`), and the window now gives the page's address as `AXDocument` while Conquer shows
  (`AppWindow`), as a browser's does. 1Password matches by site only in browsers on its own list, so in Paseo Command it matches the app
  (link a login to it), and it fills only apps with a real signature: the release app, not the ad hoc Dev app. macOS AutoFill can't
  work for other sites in a third-party WKWebView (only an app's associated domains; the browser entitlement is passkeys only).
  No menu or ⌘K entry. Left for the user to try (an agent can't use the vault): in the release app, once this ships, ⌘\\ on a login
  page in Conquer, then Always Allow linking the login to Paseo Command. Commit "Conquer: 1Password Universal Autofill notes, page address for accessibility".
- [x] **macOS app: a deleted app says so instead of "The file node doesn't exist".** Restart app and the server's
  restart first check the running bundle, its Node and `server.mjs` are still there (`BundleHome.swift`); when not, a
  sheet says this copy was deleted or moved (its old path) and can't restart, names another copy (a dev copy: the main
  checkout's `native/build/Paseo Command Dev.app`, recorded at build time; the release: /Applications, ~/Applications,
  else Launch Services) and offers Open it, Show in Finder and Quit (Not Now from Restart app, whose window still works).
  It never relaunches into the missing bundle. Every dev build had defaulted to port 4321 and the Dev data folder, sharing
  the Dev bundle id with the main checkout's copy, so a workspace build opened without `--url` became the user's Dev app;
  a workspace build now won't run a server on 4321 (`AppFlavor.isWorkspaceBuild`). Commit "macOS app: a deleted copy says so".
- [x] **Linear: project views, and managing views.** The sidebar's Views lists project views too (marked), each opening
  the projects its filter lets through, displayed as Linear sets them (the Projects list gained Filter and Display); a
  project's own views show under its summary. Views are made from what a list shows (Save as view beside the filters,
  ⌘K), edited (name, icon and colour, description, sharing; Save to view takes the filters and display shown) and
  deleted after confirming, from the head, the sidebar's context menu and ⌘K. Whitelisted `customViewCreate|Update|Delete`
  (with the display as view preferences), shown at once and rolled back if Linear refuses; a filter the app can't say
  opens and edits only its name, icon, description and sharing. Commit "Linear: project views, and managing views".
- [x] **Slack: a Recent section, and your own channel sections.** Recent tops the sidebar: the 20 conversations and
  threads you're in with the newest messages, newest first, each opening its conversation or thread (threads read as
  they show). Slack's Web API has no documented method for the sections made in Slack (only the client's undocumented
  `users.channelSections.*`, with a session token, not used), so sections are made in the app: create, rename, reorder,
  delete, move conversations in by menu, drag or ⌘K; kept per workspace in `settings.json`. Commit "Slack: Recent, and
  sidebar sections of your own".
- [x] **Linear: sub-grouping in lists and boards, as Linear has.** Display offers Sub-grouping (none, or any property
  but Grouping's; picking Grouping's swaps or clears it) and ⇅ beside Grouping to swap them; kept per place, displays
  saved before keep none. A list's groups hold sub-groups under their own heads; a board's sub-groups are swimlanes
  across its columns, each folding, a card dropped in a cell taking both values in one write (rolled back if
  refused). Views start with Linear's `issueSubGrouping`. ⌘K sets, clears and swaps it. Commit "Linear: sub-grouping
  in lists and swimlanes on boards".

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

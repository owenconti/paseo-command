# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **GitHub PR view: deslop the buttons and merge box.** The PR header's and side panel's controls are oversized and
  heavy: Review (a big filled gold block), the split "Merge pull request" button, "Open Paseo agent" on its own row,
  the conversation's Newest/Oldest toggle, Comment, and the Merge section's full-width stacked blocks ("Merge pull
  request…", "Enable auto-merge (merge commit)…" wrapping onto two lines). Bring them to the pages' control scale
  (`--lz`, `pages.css`; compare Linear's and Activity's head tools): one compact height for header buttons, one primary
  action at most (filled, modest), others quiet (outline or ghost), short labels ("Squash and merge", "Auto-merge"), no
  wrapping, header actions on one row with Open Paseo agent, and the Merge section as a short list of small buttons or
  links under its status lines rather than full-width slabs. Also check: while "Review required" or checks are pending,
  Merge shouldn't look like the ready primary action unless it's an admin bypass (then say so). Light and dark,
  screenshots before and after; keep e2e passing. Workspace: `github-pr-deslop-buttons`.

## Done

- [x] **GitHub merge box: offers only the merge methods the repository and its base branch's rules allow.** Diagonal-HQ/diagonal
  allows merge commits and squash, but its `main` ruleset's `pull_request` rule allows only squash (`allowed_merge_methods`), which
  the PR read didn't ask; the header named the first, a merge commit. The PR read now asks the base branch's rules (REST
  `rules/branches/:base`, in its cache) and intersects; the button is named by its method, auto-merge and ⌘K offer only those, no
  method or unreadable rules say so, and `m/merge`/`m/autoMerge` refuse others. Commit "GitHub merge box: offer only the methods the base branch's rules allow".
- [x] **Removed the Linear tab, at the user's request; Activity's Linear source and Settings' Linear key stay.** Gone: the
  page (`web/src/linear/`: lists, board, issue detail and editing, comments, attachments, relations, Create issue, views,
  the Inbox page, search, cycles, projects, initiatives), its mode (`paseo:mode` `linear`, the mode bar tab, View menu item;
  ⌘1…⌘5 now), its ⌘K entries, shortcuts group and CSS, the server's Linear-only reads, writes and upload, file and image
  routes, launching an agent from an issue (`DispatchTarget.issue`) and presets' `{{issue}}`, its tests, e2e, fakes and
  the write-check script. Kept: Activity's Linear source (the Inbox read; read, unread and done writes; PR notifications'
  issue keys), the avatar route it uses, Settings' Linear switch, `linearApiKey` and workspace, and the header's issue chip.
  Linear issue and project links (the chat, Conquer, a PR's body, the chip and L, Activity's items, which now carry the
  issue's linear.app address) open in Linear's desktop app when Launch Services names an app for `linear://` (Linear's
  documented deep link: `linear://` and the rest of the address; `LinearLink.swift`, unit-tested), else in Conquer; in a
  browser, a new tab. The GitHub tab's picker and menu keys moved to `web/src/Picker.tsx`, `menuKeys.ts` and
  `styles/pickers.css`. The user's old Linear localStorage and any saved `linear` mode are ignored. Commit "Remove the Linear tab".
- [x] **Linear board: cards show through the column heads when scrolled.** A board column's head had no background of its
  own (the column's showed through) and nothing marked where its cards were cut, so cards scrolled beneath ran flush up
  to the head (in dark, card and column are one colour: only their text, labels and avatars showed). Column heads are
  opaque over their cards, end in a hairline, and a column clips everything to itself; with swimlanes, the sticky heads'
  row is opaque across the scroller's whole width (side padding and gaps), above cards and lane heads, and ends in a
  hairline. A list's group heads aren't sticky and had no fault. E2e: scrolled columns, lanes (and sideways) and a list,
  light and dark, nothing shows through a head and heads are opaque. Commit "Linear board: heads cover the cards scrolled beneath them".
- [x] **GitHub PR view: manage merge state, close and reopen.** The PR view's Merge section is GitHub's merge box: what blocks a
  merge and why, auto-merge (who turned it on) and the merge queue, and each action that applies and the token may: Merge, Squash and
  merge or Rebase and merge (the repository's methods, the last per repository; commit title and message; confirmed; delete the branch
  after, remembered), auto-merge on and off, Merge when ready and Remove from queue, Ready for review and Convert to draft, Update branch
  (merge or rebase), Close (an optional comment first) and Reopen, Delete branch. The header has a split Merge button and ⋯ beside
  Review; ⌘K has each while it applies. Whitelisted writes `m/merge|autoMerge|queue|ready|updateBranch|state|deleteBranch`; the PR,
  its lists and counts and the map's lookups refresh after.
- [x] **Asks: an either/or question gets its options as quick replies.** "Should I push the branch and open a PR, or
  do you want the chamber fixtures deleted first?" got no options: `optionReadings` refused alternatives over six words, so
  the pick fell back to open and waited on drafted answers. Now a clear "A, or B?" question is a pick whatever Jev says, its
  options phrased as replies by `pickOptions` (`sentences.ts`), shown at once; Jev's kind criteria name either/or picks. And
  "Drafting answers…" could hang: the page stopped polling once a reply was judged, while answers were still drafted
  (`useAsks.ts` now polls while `answering`), and the server gives the helper at most `ANSWERS_MS` (90 s).
- [x] **GitHub PR conversation: newest first.** The Conversation tab lists newest first by default: the comment
  box on top, the newest entry under it, the description last (a review's own comments keep their order). A
  Newest first / Oldest first toggle at its head (and ⌘K) switches, one setting for every PR, kept in localStorage;
  Oldest first is as before. A posted comment shows in its place and scrolls into view. Commit "GitHub: a PR's
  conversation newest first".
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

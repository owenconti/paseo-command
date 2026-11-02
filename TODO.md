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
- [ ] **macOS app: a deleted app says so instead of "The file node doesn't exist".** A Dev app launched from
  a worktree that was later archived keeps running from memory; Restart app (and the server's restart when the
  page finds it gone, `ServerManager.swift`) then fails with "The app server didn't start / The file "node"
  doesn't exist". When the running bundle's path no longer exists (or its `Contents/Resources/node/node` or
  `server/server.mjs` is missing), say that this copy of the app was deleted or moved and name where to open
  one, e.g. the main checkout's `native/build/Paseo Command Dev.app` for the dev flavour, `/Applications` for the
  release. Don't relaunch into the missing bundle. Check with a throwaway build (`--info`, `--no-server` or own
  port), never the user's apps. Workspace: `fix-deleted-app-restart`.
- [ ] **Conquer: filling passwords with 1Password.** Conquer is a WKWebView (`Conquer.swift`), so the
  1Password browser extension can't run in it. Make 1Password filling work there, finding out first which
  ways do: 1Password 8's Universal Autofill (⌘\ in any app, through the accessibility tree; check the page's
  fields are exposed and filled, including login forms in iframes), and macOS's AutoFill with 1Password as the
  system's password provider (the key icon on password fields; whether WKWebView in this app offers it, and
  what entitlements or settings it needs). Fix what stops them (e.g. accessibility exposure, focus, key
  handling of ⌘\ by Conquer's commands). Document what works in CLAUDE.md, and add a Conquer menu/⌘K entry
  only if there's a real action to offer. Don't read 1Password's data or store passwords. Check with a
  throwaway build, never the user's apps. Workspace: `conquer-1password`.
- [ ] **Mode bar: Activity first of the pages, and ⌘1–7 switch tabs.** Order the macOS app's mode tabs
  Command, Conquer, Activity, Linear, Slack, GitHub, Settings (those enabled), in the bar (`ModeBar` in
  `Conquer.swift`), the View menu, ⌘\` stepping and the palette. ⌘1…⌘7 jump to the tab in that position
  (counting only the tabs shown), from anywhere in the app, including the page, the terminal and Conquer.
  Conquer's own tab keys move from ⌘1…⌘8/⌘9 to ⌥⌘1…⌥⌘8 (that tab) and ⌥⌘9 (the last). ⌘\` keeps stepping. Make
  sure nothing else in the page still takes ⌘1–7 (e.g. the GitHub tab's 1–4 PR tabs and Activity's 1–4 sources are
  bare keys, which is fine). Update the native menus, ⌘K entries' `keys`, the shortcuts dialog (`ShortcutsButton.tsx`)
  and CLAUDE.md. Workspace: `mode-tab-order-and-keys`.

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

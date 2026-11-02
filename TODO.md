# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

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
- [ ] **GitHub tab: search repositories, ⌘S sidebar, people filters.** Follow-ups to the Repositories section:
  - The sidebar shouldn't list every repository with open PRs all the time ("Others" grouped by owner). Show only
    Favourites there, plus a search field (and ⌘K) that finds any repository you can see by name, `owner/name`
    or org, from GitHub (named, cached, rate-limited read), to open or star it.
  - ⌘S toggles the GitHub tab's sidebar, as in the Linear and Slack tabs (inner edge resizes it, kept in
    localStorage), including in a PR list; add its ⌘K entry and shortcuts-dialog row.
  - A repository's PR list always offers Author, Reviewer and Assignee filters (in place of today's anyone/you
    author filter), each listing the repository's contributors and collaborators (you first, with avatars,
    searchable), any of several people. Read them through a named, cached read. Workspace: `github-repo-search-filters`.
- [ ] **GitHub PR view: manage reviewers and assignees, and list the checks.** In a PR's side panel
  (`PrView.tsx`: Reviewers, Merge, Checks):
  - Reviewers and Assignees are editable: a picker of the repository's collaborators (and teams for reviewers;
    searchable, avatars, you first) to request or remove reviewers, re-request a review, and add or remove
    assignees. Whitelisted writes in `web/server/github/writes.ts` (requested_reviewers, assignees; checked field
    by field), shown at once and rolled back if GitHub refuses; ⌘K entries. Show who's requested, who reviewed
    and their verdict, and the assignees.
  - Checks: beneath the "25 passing" count, list each check run and status (failing, then pending, then passing
    folded behind a toggle when many), with its name, workflow/app, duration and a link to its details, as
    GitHub's merge box does. The Checks tab keeps the full view. Workspace: `github-pr-people-and-checks`.
- [ ] **GitHub PR view: "Open Paseo agent" for the PR's branch.** When a Paseo workspace (on any host) has the
  PR's head branch checked out in the same repository (match the workspace's branch and its project's remote
  against the PR's `owner/name` and head ref, from the world snapshot the app already has), show an "Open Paseo
  agent" button in the PR's header. It selects that workspace's most recent agent in the panel and switches to
  Command (the workspace itself if it has no agent; a chooser if several workspaces match). Without a match,
  offer nothing new (Launch agent on the PR stays as it is). Add its ⌘K entry, shown only when a match exists.
  Workspace: `github-open-paseo-agent`.

## Done

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

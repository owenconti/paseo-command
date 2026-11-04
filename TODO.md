# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

## Done

- [x] **Map: it freezes, still answering input but no longer updating or animating.** Now and then, with no pattern the
  user can see, the Atlas map stops changing: agents' states and new workspaces don't update, and the water and state borders
  stop moving, while panning, hover and clicks still work. Suspects: the on-demand renderer's scheduler (30 fps ambient, full
  rate while handled, paused when nothing moves or hidden) getting stuck paused, e.g. a missed un-pause after occlusion, sleep,
  a mode switch, a display change or a thrown error in the frame loop; the page's world snapshot stream (fleet socket/events)
  dropping without reconnecting, so `NativeWorld.tsx` stops posting to Swift; or the bridge (`rendering/src/native/bridge.ts`)
  throwing and stopping its posts. Read the user's logs read-only (the Dev and release apps' `logs/server.log`, the unified log
  for the app's process), add the diagnostics that would show which (last frame time, last snapshot time, last post, scheduler
  state in `--info` and the log), reproduce in a throwaway build against `fake-server.ts` (sleep/wake, occlusion, long idle,
  mode switches, dropped sockets), and fix the cause so updates and ambient motion always resume; add a watchdog that restarts
  the loop or reconnects if they stall. Native and e2e tests. Workspace: `fix-map-freeze`.
  Done: the logs held nothing (the app's own notes went only to standard error), the machine never slept (caffeinate), and
  the page's world mounts once. Both symptoms with input still working mean Swift's frame loop stopped while
  its input logic ran. SpriteKit's loop is a CVDisplayLink made for the displays there were (the user plugs a display in and
  out several times a day) whose frame callback runs one at a time; a stopped link draws nothing until the view is paused and
  unpaused, and a callback left "in progress" skips every frame for good, mended only by a new SKView. The scheduler also
  trusted a cached visibility. A natural stall wasn't reproduced, so every way is now mended and logged: a watchdog in
  `AtlasView` (a missed visibility change, a paused view or scene, no frame for 3 s: restart the loop, then a fresh view),
  the link restarted on display changes, `logs/native.log`, revisions the page checks against what Swift applied (re-posting),
  a quiet-connection check that reconnects the live socket, and `map`/`page` in `--info`. Tests: `AtlasViewTests.swift`,
  `watch.test.mjs`, `live.test.ts` (unit, not e2e: the bridge runs only in the app).

- [x] **Settings → Terminal: line height is a number field.** Line height is a 1.0–1.6 control; make it a number input
  taking any value the user types (decimals, step 0.05 for the arrows), applied live as now. Only refuse what can't work
  (empty, not a number, zero or negative; and whatever SwiftTerm's `lineSpacing` can't take, said plainly beside the field),
  without clamping to 1.0–1.6 in the page or the app (`TerminalFont.swift`'s clamp widened accordingly). Keep Restore
  defaults. Update tests. Workspace: `terminal-line-height-input`.
  Done: a typed field (spinbutton; ↑/↓ step 0.05) taking any number above 0 up to 100× (SwiftTerm keeps a cell
  within 8,192 pt; 100× at 32 pt stays under it); empty, not a number, 0 or less and over 100 are refused beside it,
  the last good value kept. The app refuses the same, and older builds' kept values still read.

- [x] **Terminal: font settings, and icon (Nerd Font) glyphs that render.** The terminal panel and the Files editor (both
  `TerminalSession` in `TerminalDrawer.swift`, SwiftTerm) use the system monospace font at a size set only by ⌘+/⌘−/⌘0,
  with no line height. Icon glyphs (Nerd Font private-use symbols: file-type icons in nvim's tree and dashboard) show as
  boxed question marks, while Ghostty shows them (Ghostty bundles a Nerd Font symbols fallback; the user's Ghostty config
  sets no font, and Meslo LG Nerd Fonts are installed in ~/Library/Fonts). Add:
  - Settings → Terminal: font family (installed monospaced fonts, searchable; default the current system monospace), size
    (the ⌘+/⌘− value), line height (e.g. 1.0–1.6) and, if SwiftTerm allows, letter spacing; applied live to every
    terminal, the panel's and the Files editor's, kept in the app's preferences (not shared with worktree builds' check
    runs beyond what's unavoidable), with ⌘K "Terminal settings…".
  - Glyph fallback so icons render whatever the main font: a font cascade on the terminal's font (Core Text
    `kCTFontCascadeListAttribute`) ending in a Nerd Font symbols font. Bundle "Symbols Nerd Font Mono" (MIT, as Ghostty
    does; licence in `licenses/` and THIRD_PARTY_NOTICES) registered for the app only (`CTFontManagerRegisterFontsForURL`
    with process scope), plus the system's emoji/symbol fallbacks; check SwiftTerm draws cascaded glyphs (and wide
    icons at one or two cells as Ghostty does). Verify with a test page of Nerd Font code points.
  Tests: native checks for the cascade and settings applying; a throwaway build's `.windowshot` of a terminal printing
  Nerd Font icons. Workspace: `terminal-fonts`.
  Done: the font cascade (bundled Symbols Nerd Font Mono, then Apple Symbols and Apple Color Emoji) and SwiftTerm's glyph
  fallback provider for the symbols font's private-use icons, no SwiftTerm patch; Settings → Terminal (family, size, line height,
  letter spacing as a fixed advance) through `terminalFont` / `paseo:terminal-font`. A one-cell icon stays in its cell (SwiftTerm
  can't spill it into a following space as Ghostty does); wide cells take two.

- [x] **Files: Markdown renders as Markdown, and lines wrap.** The viewer shows `.md` files as code with long lines running
  off the edge. Markdown files open rendered (headings, lists, tables, code blocks highlighted, links: in-repo paths open in
  Files, others as links do; images from the workspace through the Files read route, others blocked unless https), with a
  Preview / Source toggle in the head (kept per file type) and ⌘K entries; ⌘F finds in the rendered text. Source view and
  every other file wrap long lines by default (a Wrap toggle in the head, kept, ⌘K "Wrap lines"), keeping line numbers on
  the first row of each wrapped line and the virtualizer measuring wrapped heights without jumping (as the diff's anchor
  does). Reuse the app's Markdown renderer and the pages' styles. Tests: e2e (rendered headings, toggle, wrap on/off,
  find), units for link resolution. Workspace: `files-markdown-wrap`.
  Done: rendered by default (GFM, highlighted code, HTML from an allowlist), in-repo links and folders open in Files, images
  through a raster-only `files/image` route or https; Preview / Source per type; wrap on by default with the head's toggle.

- [x] **Mode bar: Command, Files, GitHub, Conquer, Activity; Settings becomes a gear.** Reorder the macOS app's mode tabs to
  Command, Files, GitHub, Conquer, Activity (those enabled), in the bar, View menu, ⌘1…⌘5 numbering, ⌘` stepping, the palette and
  the shortcuts dialog. Settings leaves the tabs: a gear `BarButton` in the bar's tools beside the usage meters opens it (as
  ⌘, and ⌘K Settings do), showing it in the map's place as now, with the gear lit while it shows; Esc or the gear again goes
  back to the side before. Keep `Mode.settings` working for old saved modes. Update CLAUDE.md, native tests and e2e. Check
  with a throwaway build's `.windowshot`. Workspace: `mode-bar-order-settings-gear`.
  Esc in the macOS app's Settings goes back too; ⌘6 is no longer the mode bar's.

- [x] **Chat: file paths link to the Files tab.** In an agent's conversation (its replies and your messages, not tool
  output), paths to its workspace's files link themselves ("The report is at `docs/reports/resource-reference-approaches.md`.",
  `src/a.ts:12`, `:12:3`, `#L12`, `#L12-L20`, absolute paths inside the workspace's folder made relative; inline code that is
  exactly a path keeps its code look). Only paths in the workspace's `files/all` list link (one list per workspace, shared
  with the Files page's reads, a Set for lookups); a bare name (`index.ts`) only when one file has it, in prose only with an
  extension; never in code blocks, links or URLs. A click (title "Open in Files") shows the Files tab with the file as a kept
  tab, scrolled to the line and marked (`openFilesFile`, `files-open-at`); in a browser it says the tab is the macOS app's.
  Matcher units and `e2e/autolink-files.e2e.ts`.

- [x] **Activity: notifications marked done come back after a few seconds.** The cause: GitHub's list (`all=true`) keeps
  threads marked done, as read ones, and moves their `updated_at` for activity that doesn't notify you (pushes, checks on a
  pull request you're assigned; DE-8000's had moved eight hours past its mark, still read), so the done-by-`updated_at` rule
  let them back as soon as the minute's cache refreshed. Now a done thread stays out until a genuinely newer event: unread
  again and changed after both GitHub's time for it and when it was marked (and after GitHub's `last_read_at`), and never in
  the two minutes GitHub's list takes to settle (`web/server/activity/marks.ts`; `github-activity.json` keeps both times,
  reading the old file). Marks are set before the write is sent (a read answering meanwhile can't put it back) and undone,
  with the notice, if GitHub refuses; a write forgets the cached list. Linear's rows likewise. Tests over a lagging fake
  GitHub and Linear, and the e2e across polls.

- [x] **Files: open files in an editor of the user's choosing (e.g. nvim) in a terminal.** Settings → Files → "Open files in":
  Built-in viewer (default) or Editor command (`nvim {file}`, `{line}` too; checked: one line, `{file}` needed and unquoted), kept in
  settings.json. With it, in the macOS app, opening a file (tree, ⌘P, a tab, Open in Files) runs the command in a daemon terminal on the
  workspace's host, in its folder, under the login shell (`POST /api/terminals/editor`; the path single-quoted, the line a number; the
  command never from the request), and SwiftTerm draws it exactly over the viewer, following the page's layout (sidebar, panel, window,
  tabs, modes), stepping aside for dialogs, in the app's theme and terminal text size. Each tab keeps its own terminal (alive while the tab
  exists), opening in the editor pins the tab, the View / Editor toggle and ⌘K Open in editor / viewer switch, closing (×, ⌘W, Close other
  tabs) asks once while editors run, and an editor that quits leaves the viewer with Reopen in editor. While it has the keyboard the app keeps
  ⌘1…⌘6, ⇧⌘G, ⇧⌘E, ⌘W, ⌘`, ⌃`, ⌘K (the palette, the keyboard coming back after) and the menu's; everything else is the editor's. The terminal
  panel leaves editor terminals out of its tabs. In a browser the viewer stays, with a note. Tests: command building and quoting (through a
  real sh), the route, the tab model, e2e (`files-editor.e2e.ts`), native embedding checks (frame, keys, close question); checked in a
  workspace build against the fake server. Workspace: `files-editor-terminal`.
- [x] **Files: the show-sidebar button sits out of line with the tab row.** With the sidebar hidden (⌘S), its show button
  was laid absolutely over the page's corner, 12 px from the top, while the tab row (Changes, then the tabs) was only
  padded to leave room for it, so it sat apart from the row. It is now the row's first control, centred on it at the pages'
  control height (26 px × `--lz`), before Changes; the row keeps its height when the sidebar comes back. Without a
  workspace (no row) it stays in the corner. The GitHub tab's was checked (list and PR heads): already centred on its head's
  title row, unchanged. Tests: `e2e/files.e2e.ts` (centred within 1 px, left of Changes, the row's height kept).
  Workspace: `files-sidebar-button`.
- [x] **Move a workspace's Changes from the GitHub tab into the Files page.** Changes (all / committed / uncommitted,
  ahead/behind, the diff with filter, find, pending comments) show in the Files tabs' place, reached by a Changes button
  (with the changed-file count) first in the tabs' row: a view toggle outside the tab model, so ⌘W, ⇧⌘T, ⌃Tab and previews
  stay as they were and it's never closed; kept per workspace; no GitHub needed (Review #N, in the GitHub tab, and Compare on
  GitHub only while it's on). A changed file's dot and Show changes open Changes at the file; each diff file's Open in Files
  opens it. The GitHub tab lost its Workspace section; ⇧⌘G (View → Show Branch Changes, now `branch-changes`), ⌘K, the
  workspace view's Changes and pending comments' Show the changes open Files → Changes; old saved GitHub Changes places
  redirect there. The diff's find started at a file shown from the list that a short diff couldn't scroll to the top (the
  e2e stuck at "2 of 3"): it now starts at the file at the top of the view. Tests: `e2e/changes.e2e.ts` (moved and new),
  files, diff comments, kept state, native menu target. Workspace: `files-changes`.
- [x] **Files: tabs, and ⌘W closes one.** Opened files are tabs above the viewer: a click (tree, filter, ⌘P) opens a preview
  tab (italic, replaced by the next), a double-click or using the file keeps it; drag to reorder, the name with as much of its
  folder as tells clashing names apart, a changed dot and ×, middle-click closes, the row scrolls sideways keeping the shown tab
  in view. ⌘W closes the shown tab while Files shows (the macOS app's View → Close File Tab, offered the menu ahead of the page;
  the window never closes there; none open: nothing; ⌃W too, for a browser), ⇧⌘T reopens, ⌃Tab / ⌃⇧Tab and ⌥⌘→/← step.
  Per workspace in localStorage with each tab's scroll. Conquer keeps its ⌘W, ⇧⌘T and ⌃Tab. ⌘K entries, the shortcuts dialog.
  Tests: the tab model and its storage, e2e, native key routing. Workspace: `files-tabs`.
- [x] **Files: a quick, read-only file explorer for a workspace.** A Files tab (the mode bar's after GitHub, View menu, ⌘1…⌘6,
  ⌘K "Show files", ⇧⌘E app-wide through View → Show Files) for the selected workspace (or agent's), on any host: through its daemon's
  file explorer (`listDirectory`, `readFile`), named, cached routes `GET /api/files/tree|read|all|changed`, paths confined to the
  workspace (refused before the daemon; the daemon refuses symlinks out), 1 MB limit, never writes. A lazy tree with `.gitignore`d
  files and `.git` hidden until asked, changed files dotted, "Filter files…" (fuzzy, as the diff's), ↑/↓/→/←/Enter, a resizable
  sidebar (⌘S), ⌘P quick-open; the file in @pierre/diffs's `File` (its single-file renderer) under its virtualizer, highlighted in
  the diffs' workers, line numbers, ⌘F (the diff's find), Copy path, Show changes (the GitHub tab's Changes at the file); binary,
  image and big files refused politely. Daemon reads take 2–14 ms locally. Tests: server (fake daemon, confinement, gitignore),
  tree units, e2e, native keys. Workspace: `files-explorer`.
- [x] **GitHub PR conversation: the description first, then a Comments section newest first.** Today's newest-first
  order put the PR's description at the bottom. Instead: the description always at the top; then a "Comments" header
  (with the count, e.g. "Comments · 6", and the Newest/Oldest first toggle moved into it); then the comment box; then
  comments and reviews newest first (the toggle still switches them to oldest first, with the box then at the foot).
  A review's own comments and threads' replies keep their order. Posting a comment shows it in place and scrolls to it.
  The head uses the pages' `.page-head` and `.page-btn` set. Commit "GitHub: a PR's description first, then Comments".
- [x] **Chat panel: text 1 pt larger.** The chat panel (`.session`: header, conversation, Markdown, code, tool rows, the
  ask/suggest strips, pending diff comments and the composer) adds `--chat-text` (1 pt) to the app's type tokens, so every
  size keeps its place on the scale: body 13 → 14.33 px in light, 14 → 15.33 px in dark (the themes' `--fs-md-base`),
  small 12 → 13.33 px, code 11.5 → 12.83 px; the px sizes written in its styles add it too. The pages, map, top bar and
  terminal are unchanged. Workspace: `chat-text-larger`.

- [x] **Chat: Linear issue keys and PR numbers link themselves.** In an agent's conversation, its replies (Markdown, a
  remark step over text nodes) and your messages, `web/src/autolink.ts` links Linear keys only of the Linear workspace's teams
  (`GET /api/linear/teams`: its `urlKey` and team keys, from the five-minute workspace read, only while Linear is on with a key;
  UTF-8, ISO-8601, SHA-256 stay plain) to `linear.app/<workspace>/issue/<KEY>`, and `#123`, "PR #123", "pull request (#)123" to
  the workspace's repository (`repoOf` its remote, else its PR's), `owner/repo#123` to that one; never in code, links, URLs,
  paths, "step #3", hex colours or without a repository. Only text is wrapped, so it copies as written; clicks take the app's
  link path (Linear's app, else Conquer; PRs in the GitHub tab). Tests: `autolink.test.ts`, `route.test.ts`, `e2e/autolink.e2e.ts`.
  Workspace: `chat-autolink-issues-prs`.

- [x] **Diff viewer: comments on a local diff become a workspace's pending comments, applied from the chat.** On a workspace's
  Changes diff the gutter's + (or a dragged range) keeps a comment as that workspace's pending comment, in the data directory's
  `diff-comments.json` keyed by host and workspace (never the worktree; never GitHub), shown under its line, editable and
  deletable, re-anchored by its lines' text as the diff changes or else listed as outdated, and counted in the Changes head. The chat
  of an agent in that workspace shows "N pending comments · Apply": its list reviews them (remove, Discard all); Apply sends them as
  one message (`path:line`, the quoted lines, the comment) and marks them applied, kept as history. ⌘K: "Apply pending diff
  comments", "Show pending diff comments". PR diffs' review comments are unchanged. Server, unit and e2e tests.
  Workspace: `local-diff-comments`.
- [x] **Diff viewer: the scroll position jumps after a while.** The cause: every refresh (the Changes view's every 15 s) gave
  @pierre/diffs new, unkeyed diff objects, so each file reset its measured line heights (wrapped lines) to estimates outside the
  virtualizer's anchored pass; measured on a long wrapped diff, each refresh moved the view by whole files. Now the files keep their
  objects while unchanged (`useStableFiles`) and each diff has a `cacheKey` from its text, so nothing is drawn again; and
  `useDiffAnchor` (`web/src/github/diffAnchor.ts`, `overflow-anchor: none` on the scroller) keeps the first line in view in place
  while anything above it changes height (a file that did change, threads), in WebKit and Chromium alike. E2e: unified and split,
  through unchanged and changed refreshes and a height change above the view, and a file-list jump. Workspace: `fix-diff-scroll-jump`.
- [x] **Diff viewer: search file names and file contents.** The diff view's file list has "Filter files…" (T, ⌘K): fuzzy on
  paths, narrowing the tree with the matched characters marked and a count, ↑/↓ and Enter to jump, Esc to clear. ⌘F while a diff
  shows opens Find in the diff: added, removed and unchanged lines of every file from the parsed diff (folded and not-yet-drawn
  ones too), case-insensitive unless asked, optionally a regular expression, marked with the current one apart and counted;
  Enter, ⇧Enter and the strip's arrows step, unfolding the file and scrolling the virtualizer to the line; Esc closes it. ⌘K
  entries and the shortcuts dialog's GitHub group. Workspace: `diff-search`.
- [x] **⇧⌘G opens the current branch's diff in the GitHub tab.** From anywhere in the app (the map, the page, other pages, the
  terminal panel even with the keyboard) it opens the GitHub tab's Changes view for the selected workspace (or the selected agent's):
  View → Show Branch Changes, offered the menu ahead of the views by `AppWindow.performKeyEquivalent` (`AppKeys.swift`), asking the
  page's `github-branch-changes`. While Conquer has the keyboard it stays Conquer's Find Previous. With nothing selected or GitHub off
  it shows a notice; a browser's page takes the key itself (and says the GitHub tab is the macOS app's). In ⌘K's entry's keys and the
  shortcuts dialog's GitHub group. Tests: `native/tests/AppKeysTests.swift`, `web/e2e/github.e2e.ts`.
- [x] **GitHub PR view: deslopped the buttons and merge box.** One shared compact set, `.page-btn` in `pages.css` (26 px × `--lz`,
  quiet outline; `.solid` the one primary; `.page-btn-group` for a split). The header's actions sit on one row with the tabs: Open
  Paseo agent, the diff stat, Review, the split Merge (▾) and ⋯, one height, none wrapping. Merge is filled only once it can merge
  (`mergeLeads`); while a review is required or checks are pending Review is, and an administrator's merge says "(bypass)". The
  Merge section's actions are small quiet buttons with short labels ("Auto-merge…", "Close…"; ⌘K keeps the long ones), the
  Newest/Oldest toggle and Comment are at the same scale, and Files changed, threads and Changes use the set too. An e2e checks one
  height, one row and nothing wrapping at the normal width.
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

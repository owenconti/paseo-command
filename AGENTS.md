# Paseo Command — development

## User requirements

- `main` tracks `origin/main` at `github.com/owenconti/paseo-command`. Push only `main`, there.
  Do not publish elsewhere, stream build-room events, or send this project to phaser.io.
- Do not sign in to Phaser AE, reconnect an online project, reinstall its skill, or start its room streamer.
- The Phaser AE account was disconnected and its installed skill removed at the user’s request.
- The cached Phaser prototype and engine were removed at the user’s request. Do not restore them.
- The current SpriteKit app lives in this checkout. The original app is preserved read only in ignored `archive/legacy-app/` where available. Preserve the inherited React UI.
- Public history was sanitized. Never merge or push branches or tags from the old private repository (`paseo-cc-ui`); review and cherry-pick needed changes onto current `main`. Keep all recovery bundles and local archives private. Use a GitHub noreply commit email and run `npm run public:check -- --history` before pushing.
- When you need to ask the user a question, use the ask-question tool (`AskUserQuestion`) rather than asking in plain text.
- Anything you ask the user to review, such as a plan, description or summary, must be in your visible reply,
  never only in your reasoning: the user does not see your thoughts.

## Checkout and worktrees

- `paseo-command/` is the main checkout on local `main`.
- Use Paseo’s default worktree location: `~/.paseo/worktrees/<project-hash>/<slug>/`.
  Create workspaces through Paseo; do not add a custom worktree folder, helper command,
  placement plugin or root override for this app. Use local `main` as the base.
- `archive/` and `.paseo-command/` contain preserved history/assets and runtime data;
  do not stage them into the app repository.
- `archive/legacy-app/` owns its own historical worktrees in its `worktrees/` folder.
- The old `paseo-cc-phaser-ae` compatibility symlink was removed at the user’s request.
  Use `paseo-command` for all work.
- See `DIRECTORIES.md` for the folder inventory and relocation notes.

## Product and references

Paseo Command visualizes hosts, projects, workspaces and agents from the Paseo daemon.
The React app and official SDK API are in `web/`. The Atlas world is drawn by the macOS app in
`native/` (SpriteKit, under the React app in a WKWebView); its layout and art are in `rendering/`.
The user removed the Phaser renderers (the web Atlas and the Galaxy world): in a plain browser the
panels work and the map area says it is drawn by the macOS app. Do not add further worlds unless asked.
The user’s five supplied top-down illustrations guide the Atlas world: blue water,
parchment hex islands, project landmarks, workspace cottages, and model-colored robots (Claude orange,
ChatGPT/Codex white; other providers keep a stable colour of their own).
The attached illustrations are references, not full-screen backgrounds.
Real state must remain truthful: distinguish running, idle, completed/unread, approval,
question, failure and offline. Test daemon mutations against fake daemons only.
The Atlas uses generated painted sprites; it is not yet finished reference-quality art.

## Command palette

The command palette (⌘K, `web/src/CommandPalette.tsx`) lists what the app can do. Its entries are
`paletteCommands` in `web/src/main.tsx` (the open agent's own in `agentCommands`), ranked by `web/src/palette.ts`.
Whenever you add, rename, remove or change a user-facing action (a button, a key, a menu item, a native
View or Conquer menu command), update its palette entry in the same change: label, `keys`, `keywords`, and the
condition it shows under (only when it would work). Actions owned by a component reach it through
`runAppCommand`/`onAppCommand` (`web/src/appCommands.ts`); native menu items go through
`postNative({ type: "menu", action })`, handled in `WorldWindow.swift`'s `"menu"` case. Keep the keyboard
shortcuts dialog (`web/src/ShortcutsButton.tsx`) in step with any keys you add.

## Completing a feature

Once the requested feature or fix is implemented and validated, commit it (one commit per fix) and merge it into
local `main`. If working directly on `main`, commit the completed feature there. Then push `main` to
`origin` (`git push origin main`; no force push unless the user asks). Do not push other branches.
Preserve unrelated work in the checkout.

Then, from the main checkout on `main`, run the build check:

```sh
npm run app:update   # app:build && app:bundle-server && native:build
```

This builds the web app (`web/dist/`, which a browser preview serves without a restart), bundles the server and
rebuilds the dev flavour `native/build/Paseo Command Dev.app` in place. The user tests changes in that Dev app before
releasing: once a newer build is on disk its mode bar shows "Update ready · Restart app", and the user chooses
**Restart app** in its command palette (⌘K) to load it. Tell the user the Dev app is ready to restart. The installed
release app updates only through Sparkle releases. Never quit, relaunch or open either of the user's apps (the main
checkout's `native/build/Paseo Command Dev.app` is the user's own copy), and do not run `app:restart`. Your check runs
use a build in your own workspace, launched with `--info <file>` (which gives the copy a throwaway data folder) and
either `--no-server` or a `--url` on a port of its own (e.g. `http://127.0.0.1:4322/`), never 4310 or 4321. Run `npm run release` only when the user explicitly asks to cut or publish a release; `npm run release:setup` remains the user's. After pushing, tell the
user a release is pending (ask an agent to cut it, or `npm run release`), naming the user-visible changes since the last one.
If you made a Paseo workspace (worktree) for the work, archive it once its branch is merged into `main` and pushed
(remove any `node_modules` symlinks you added to it first), so finished work leaves no workspace behind on the map.
Report the commit, whether the push succeeded, whether the build succeeded, and that the workspace was archived.

## Commands

- `npm run app:install`: installs `rendering/` and `web/` dependencies.
- `npm run app:dev`: React UI, SDK API and the Atlas world on port 4310, bound to `127.0.0.1`.
- `npm run app:start`: detached preview of the built app and API, bound to `127.0.0.1`;
  run from a human terminal. Access it on this machine at port 4310. Do not expose this unauthenticated API through a proxy or tunnel.
- Port 4310 is the user's installed app's. Agents' browser checks use another port:
  `npm run app:dev -- --port 4311` or `npm run app:start -- --port 4311`.
- `npm run app:stop`, `app:restart`, `app:refresh`, `app:status`: manage that detached preview.
  Restart preserves its port; refresh restarts it only when the server's own code changed. See `RUNNING.md`.
- `npm run app:build`: layout tests, then type-checks and bundles the app to `web/dist/`.
- `npm run app:bundle-server`: esbuild-bundles `web/server/native.ts` into `web/dist-server/server.mjs` (ignored) for the app bundle.
- `npm run app:update`: `app:build`, `app:bundle-server` and `native:build`, after merging to `main` (see above), as a build check.
- `npm run native:test`: the native, bundle and Conquer checks (`native/scripts/test-native.mjs`, `test-bundle.mjs`, `test-conquer.mjs`).
- `npm run release:setup`: once, by the user: checks for a "Developer ID Application" certificate in the login keychain (explains
  making one; installs Apple's intermediate), saves a notarytool login as `paseo-command-notary`, and makes Sparkle EdDSA keys
  (`SUPublicEDKey` goes into `native/Info.plist`). `scripts/signing.mjs` picks the identity (`PASEO_COMMAND_SIGN_IDENTITY` when there are several). `npm run release -- [--bump patch|minor|major] [--notes <file>] [--dry-run]`
  (`scripts/release.mjs`): checks, tests, builds the release app to `native/release/`, signs it with the Developer ID under the hardened
  runtime (entitlements in `native/entitlements/`: JIT for Node), notarizes and staples it, zips it (Sparkle downloads the zip), makes a drag-to-Applications `.dmg`
  (`scripts/dmg.mjs`; signed, notarized and stapled too), writes the Sparkle appcast, commits
  `Release v<version>`, pushes `main` and runs `gh release create`. Releases are notarized, so they open normally. `--unsigned` (with `release:setup -- --unsigned`) makes an
  ad hoc signed, non-notarized release while no Developer ID is available; its notes explain Open Anyway.
- `npm run app:typecheck`: checks React, API and Atlas TypeScript.
- `npm run app:e2e`: browser tests of the Atlas against a mocked fleet (no daemon is reached).
- `npm run native:build`, `native:run [-- --url …]`: the macOS app (`native/`) that draws the Atlas with
  SpriteKit under the React app in a WKWebView, built as the dev flavour "Paseo Command Dev" (`io.github.owenconti.paseo-command.dev`,
  port 4321, no updates, data in `~/Library/Application Support/Paseo Command Dev/`); `sh native/scripts/bundle.sh --release` (done by
  `npm run release`) builds "Paseo Command" (`io.github.owenconti.paseo-command`, port 4310, Sparkle). `native:mock` serves web/dist
  with a mocked fleet. See `native/README.md`. The app is self-contained: `Contents/Resources/node/node`, `server/server.mjs` and `ui/`
  (web/dist). It runs that server itself and the server ends with the app (`ServerManager.swift`). Check runs pass `--no-server`.
  Launch it with `open -g` and `--background` for checks; it must never take the user's focus.
- `npm run render:test`: layout and tile tests.
- `npm run check`: every check, run locally (the repository has no GitHub Actions; do not add any): `public:check -- --history`,
  `secrets:scan` (Gitleaks over all history, skipped with a note when `gitleaks` isn't installed), `app:test`, `app:build`, `native:test`.

The earlier cached Phaser AE prototype, engine, generated build and prototype-only npm commands
were removed at the user’s request.
Local assets belong in the repository and are included through local build tooling.

## Cutting a release

When the user explicitly asks to cut or publish a release, do it without asking them for a version.
Review the commits and diff since the latest published GitHub release and choose the bump:
patch for fixes and maintenance, minor for compatible new features, major for incompatible changes
at 1.0 or later (minor for incompatible changes while at 0.x). Run `npm run release -- --bump <kind> --notes <file>`
with user-facing notes for those changes. The script computes the version from the newer of
`package.json` and the highest published version, and prints it before building. Bare `npm run release`
defaults to the next patch, or keeps a newer version already prepared in `package.json`; with no
published releases it uses the package version. An exact version remains an optional override.
Changing release tooling or completing a feature does not itself authorize publishing a release.
After an explicit release request, the release script handles signing, notarization, commit, push
and GitHub publication; report the published version and release link.

## Structure

- `rendering/src/world.ts`: Atlas vocabulary, axial geometry and the deterministic fleet layout.
- `rendering/src/placement.ts`, `camera.ts`, `outline.ts`, `pick.ts`, `ribbon.ts`: where structures, props,
  flags, banners, tiles and robots stand, and the camera, outline and picking rules (ported to Swift).
- `rendering/src/art.ts`, `terrain.ts`: the sprite frames and the painted sea, landmasses and islands.
- `rendering/src/atlas.ts`: `mountAtlas(parent, handlers)`, the embedding API (null outside the macOS app).
- `rendering/src/sample.ts`: illustrative fleets for the layout tests.
- `web/src/NativeWorld.tsx`: maps the React app's host-qualified world snapshot to the Atlas,
  forwards map picks as selections and draws app selections on the map.
- `web/server/`: inherited official Paseo SDK API, served with the app on loopback only. `native.ts` is the entry the app
  bundle runs (`server.mjs`, env `PASEO_COMMAND_DATA`, `PASEO_NATIVE_OWNER_PID`); `scripts/app-server.mjs` (`app:start`) instead serves a checkout's `web/dist` and API through Vite preview for browser-only work.
- `web/server/releases.ts`: `GET /api/releases`, the GitHub releases and their notes; `web/src/ReleasesButton.tsx` (panel header,
  "What's new" in ⌘K) shows them in place of the old commit list.
- `native/Sources/PaseoCommandNative/ServerManager.swift`: starts the bundled Node server with the user's shell environment
  (`ShellEnvironment.swift`), keeps its log in `<data>/logs/server.log`, restarts it if the page finds it gone and stops only a
  recognised old Paseo Command checkout server on the port, after the user confirms. `OldInstall.swift` (release flavour, only when ServerManager finds an old checkout server on the port): offers to stop it
  (and its `com.paseo-command.serve` launch agent) and, if none exists yet in the data folder, copies `secrets.json`, `games.json`, `forks.json`, `archived-subagents.json` once from the checkout's
  `.paseo-command/`. `LegacyState.swift` migrates the old app's (`local.paseo.command.native`) preferences, WebKit data and HTTPStorages once,
  after offering to quit the old app if it is open (declined or failed copies retry next launch).
  `Updater.swift`: Sparkle (feed `https://github.com/owenconti/paseo-command/releases/latest/download/appcast.xml`); the mode bar shows
  "Update ready · Restart app", and Restart app (⌘K) installs and relaunches at the same page. Check for Updates… (app menu; "Check for
  updates" in ⌘K, shown only when the app's `paseo:update` says `canCheck`) asks Sparkle now; the page asks for that event with an `update` message.
- `web/e2e/`: browser tests with every `/api` request answered in the browser.
- `web/src/Dispatch.tsx` `NewAgent`: a new agent opens in the panel as an empty conversation (host, where and
  branch in a small form) with the usual composer; its first message creates the agent. Its /skills and @files
  come from `GET /api/drafts/commands|files` (`web/server/api/drafts.ts`), as no agent exists yet.
  Its provider picker also lists the host's Paseo agent profiles (`GET /api/profiles`, the daemon config's `agentProfiles`):
  one sets provider, model, thinking and mode, and sends its feature values (`features` in `POST /api/dispatch`) while unchanged.
  In Worktree mode a pull request can be chosen instead of a new branch (`web/src/PrPicker.tsx`: paste a number or URL,
  or search via `GET /api/drafts/prs`); the worktree checks out its branch as the Paseo app does (`pr` in `POST /api/dispatch`).
  Preset prompts from `~/.paseo-command/settings.json` (`{"presets":[{"name","prompt"}]}`, `GET /api/presets`,
  `web/server/presets.ts`; `PASEO_COMMAND_SETTINGS` overrides the path, and an older `settings.json` in the data
  directory is moved there on first read) show as buttons that launch the agent at once; `{{pr}}` names the chosen pull request.
  They are edited in the app (`web/src/PresetsEditor.tsx`, from Settings or New agent; `POST /api/presets` keeps the file's
  other keys and never overwrites an unreadable file); `web/src/presetsStore.ts` shares them across the page.
  Optional integrations (`integrations.linear`, `integrations.typesafe`) default off in that file.
  Integration keys are read only from the data directory's `secrets.json` (`web/server/secrets.ts`), never from environment variables.
  Settings uses toggle switches, with each integration's API-key editor and settings grouped beneath it.
  `GET /api/secrets` returns presence flags only; `POST /api/secrets` saves/replaces/removes a named key,
  preserving other credentials in an atomic owner-only file. Saved values never return to the page.
  The same `settings.json` keeps the Linear workspace (`linearWorkspace`; `GET`/`POST /api/settings`,
  `web/server/settings.ts`), which the page once kept in localStorage and moves into the file on load.
- `rendering/src/native/bridge.ts`: inside the native app, the Atlas world `mountAtlas` returns: it lays out and paints
  with the shared modules (`placement.ts`, `art.ts`, `terrain.ts`) and posts the result to Swift (`native/Sources/`),
  which draws, animates and owns camera, hover and picking under a transparent page.
- `native/Sources/PaseoCommandNative/TerminalDrawer.swift`: the macOS app's terminal panel on the right or docked at the bottom (View → Terminal, ⌃`; Terminal at Bottom or
  the panel's dock button moves it; its inner edge resizes it; ⌘+ / ⌘− / ⌘0 size its text; Maximize Terminal, ⇧⌘↩ or its button, lays it over the
  map only, the page's panels staying in view): tabs for the selected workspace's (or agent's) daemon terminals, drawn by SwiftTerm. Opening the panel
  starts a terminal if the workspace has none; + opens another; a tab's × ends it. Tabs drag onto a pane's edge to split it (`PaneLayout`), or its middle to replace it;
  the unsplit button (View → Unsplit Terminals) or dropping a pane's tab on the tab bar undoes splits.
  It talks to `web/server/api/terminals.ts`: `GET /api/terminals`, `POST /api/terminals/create|kill`, and the
  `/api/terminal` socket relaying a terminal's bytes (screen replay first) and its keys and size.
  `native/scripts/fake-server.ts` runs the real server against a fake daemon (with terminals) for checks.
- `web/src/AddProject.tsx`: the Projects tab's Add project panel. On a chosen host, browse its folders
  (`GET /api/folders`, folder names only) and register the open folder, make a new folder in it, or clone a
  pasted GitHub repo into it (`web/server/api/projects.ts`); New agent then opens on the new project.
  A project is renamed in place (its title, `POST /api/projects/:id/rename`; the pencil on its row or view) and removed
  after confirming (`web/src/RemoveProjectDialog.tsx`, `POST /api/projects/:id/remove`: Paseo archives its workspaces and
  unregisters it; the folder stays). Moving a project's folder isn't offered: the daemon has no call for it.
- `web/server/asks.ts`: what an idle agent's last reply asks of you, judged once per reply by TypeSafe's Jev
  (opt-in `integrations.typesafe` in `settings.json`, with `typesafeApiKey` in the data directory's `secrets.json`): code splits the reply into
  sentences and keeps only questions and requests (`web/src/asks/sentences.ts`, `mayAsk`), Jev judges which ask you, their kind, a pick's options, and whether
  the reply waits on you. `POST /api/agents/:id/asks`, `GET /api/asks` (status). The composer offers the questions
  (`web/src/composer/AskStrip.tsx`) with quick replies; a reply that waits on you is the map's `asking` state
  and counts as needing you.
  In the same request Jev picks an obvious next reply, if one clearly fits (≥ 0.85), from fixed templates in
  `web/src/asks/suggestions.ts` (`{pr}` filled from the reply when it names one PR); never when the reply asks a pick or open
  question. The composer shows it as "You might say" (`web/src/composer/SuggestStrip.tsx`); one click sends it.
  Open questions then get two or three answers drafted by a helper agent on the daemon's metadata model, as the current
  work summary is (`web/server/askAnswers.ts`, `runHelper` in `workingOn.ts`); the strip shows them as quick replies.
  Hovering the strip marks the questions' sentences in the transcript (`web/src/asks/highlight.ts`, CSS Highlight API).
- `web/src/urlState.ts`: the panel's place (selection, subagent, tab, filter, host filter, list toggle) kept in
  the page's query, so a refresh returns there; a new selection pushes history, other changes replace it.
- `web/src/games/`: the panel header's mini games (gamepad button), a floating non-modal window with one game dealt at
  random by the server (`web/server/games.ts`, `/api/games`): no choosing or restarting, the next game only once it ends.
  Progress and each game's best score are kept in the data directory's `games.json`. Games implement `types.tsx`'s
  `GameDef` (plain JSON state) and are listed in `catalog.ts` and `registry.ts`.
- `web/server/probe.ts`: Probe's verdict (Diagonal's `diagonalprobe` review bot) on each workspace's open PR, from one
  read-only `gh api graphql` query per PR (`GET /api/probe`, polled by `web/src/useProbe.ts`): reviewing, approved,
  findings open (with their count), stale (new commits since, or deferred) or failed. The Atlas sets a medallion of its own in the
  workspace's first cell (the one facing its landmark): enamel in the verdict's colour round an original review magnifier,
  with a glyph badge (`rendering/src/probe.ts`, `placeProbes`, `paintProbe`); its hover card
  says the verdict. `native:mock -- --probe` shows each.
- Host load: `web/server/hostStats.ts` (`GET /api/hoststats`, polled by `web/src/useHostStats.ts`) asks each online host's
  daemon for the `host-stats` plugin's `stats.snapshot` (github.com/owenconti/paseo-cc-plugins, installed per daemon) over
  `invokePluginRpc`; a host without it is left out. Its host banner gains a second line, `CPU · MEM · DISK` percents
  (`statParts` in `rendering/src/placement.ts`, `RIBBON_DETAIL` in `ribbon.ts`; 90% and over in red). `native:mock -- --stats` shows it.
- Auto-merge: a PR's `autoMerge` comes from Paseo's GitHub facts (`autoMergeRequest`), else gh's (`web/server/links.ts`).
  While it's on, a teal seal with a merge mark sits on the review medallion's upper-right rim, else the CI one's (`placeSeals`,
  `paintSeal`, `AUTO_MERGE` in `rendering/src/prStatus.ts`); the medallion's hover card says how it merges and who turned it on.
- Conquer (experiment): the COMMAND / CONQUER strip across the macOS app's top (⌘` steps Command → Conquer → Linear; View menu; the tabs light on hover)
  switches the map's place between the map and Conquer, a WebKit browser (`native/Sources/PaseoCommandNative/Conquer.swift`),
  laid exactly over the map (`placeConquer` in `WorldWindow.swift`): the panels and terminal stay, and ⌘B (the page's panel toggle)
  gives it the window's width. The hidden side keeps running. Conquer takes its keys only while it has the keyboard (`hasKeyFocus`),
  so the chat panel keeps ⌘L and the rest.
  Back/forward/reload and the address bar (suggestions from its history, `ConquerExtras.swift`) run along the top of the page
  (`PageBar.swift`). Its sidebar, as in Zen and Arc: pinned tabs and their folders (one level; drag to reorder, pin above New Tab, unpin below it, into and out of folders;
  right-click for Pin, Back to Pinned Page, Replace Pinned URL with Current URL, Move to Folder, Rename, Delete), New Tab, then the other tabs (`ConquerTabs.swift`), each with
  its favicon or a spinner. A closed pinned tab only unloads. Its commands (`ConquerView.commands`, the Conquer menu) take their keys ahead of
  the page: ⌘T, ⇧⌘T reopen, ⌘W, ⌘L, ⌘E or ⌃Tab next tab, ⌘1…⌘8 that tab, ⌘9 the last, ⌘D pin, ⌘[ ⌘], ⌘F ⌘G ⇧⌘G find,
  ⌘+ ⌘− ⌘0 zoom (per site), ⌘P print, ⇧⌘J downloads. App restart is only in the React command palette, without a shortcut. It has its own persistent cookie store,
  optionally seeded after confirmation through Conquer → Import Zen Cookies from Zen Browser's profile (`ZenCookies.swift`): a copy of
  `cookies.sqlite`, default space only, unpartitioned and unexpired; Zen is never written to. Its tabs (`conquerState`), sidebar width, zooms,
  history (`conquer-history.json` in the app's data folder, `~/Library/Application Support/Paseo Command/` for the release) and the mode come back on launch; tabs come back unloaded.
- Linear (the mode bar's third tab, after Command and Conquer; View menu; palette "Show your Linear issues"; all only while Linear is enabled): a Linear client the page
  draws (`web/src/linear/LinearView.tsx`) over the map's frame while the app reports `paseo:mode` `linear` (`useAppMode`, `web/src/appMode.ts`;
  the page asks with a `mode` message). Navigation: its sidebar (`Sidebar.tsx`) is Linear's: My issues (Assigned, Created, Subscribed),
  each team (Triage where on, Active, Backlog, All, and Cycles where it runs them: `Cycles.tsx` lists its current, upcoming and last 120 days' cycles with their progress from `q/cycles`, each opening its issues, the `cycle:` scope, under a header counting what's done), Projects (`ProjectList.tsx`, each opening its issues) and Initiatives
  (`InitiativeList.tsx`). A place's issues (`IssueList.tsx`) show as its Display options say (`display.ts`, `ListControls.tsx`, kept per place in localStorage): a list or a board (a column per group, the team's empty states too; a card dragged to another column takes its status, assignee, priority, project or cycle, `dropChange` in `group.ts`; on a board an issue opens in the list's place), grouped (status by default, assignee, priority, project, cycle or none) and ordered (`arrangeIssues`), with finished issues all, past month or week, or none; Filter (F, ⌘K) narrows them by status, assignee, priority, labels, project or cycle (any of a property's values, every property), shown as chips under the head; the open issue (`IssueDetail.tsx`) shows beside
  the list from 1,100 px, else in its place with Back. The place and open issue are kept in localStorage (`place.ts`).
  Editing: the open issue's properties (`Properties.tsx`: status, priority, assignee, labels, estimate and cycle where the team uses
  them, project, milestone, parent, due date) open a `Picker.tsx` and save at once, as does a row's context menu (status, priority,
  assignee, labels). The title and description are edited in place (`IssueText.tsx`; click the title, or Edit description;
  ⌘K "Rename"/"Edit … description"): Enter saves a title and Esc puts it back, an empty title isn't saved; the description opens
  in the comment composer (Markdown, Preview, ⌘↩ saves, Cancel), kept as a draft until saved, and saving nothing clears it. Comments (`Comments.tsx`): write, edit, reply in threads, react (by Linear shortcode), resolve and delete.
  Create issue (`CreateIssue.tsx`; the sidebar's New issue, C, ⌘K) in the place's team (or project) with its default status, and
  Add sub-issue; relations (`Relations.tsx`: blocks, blocked by, related, duplicate) are added and removed; Subscribe, Archive (Undo in
  a bar at the view's foot) and Delete (after confirming) from the detail or ⌘K. Every write is the user's own action (launching an
  agent changes nothing in Linear): `linearStore.write` (`store.ts`) shows it at once and rolls it back, with a notice, if Linear refuses.
  Keys (`keys.ts`, only while the keyboard is in the view and not typing or in a picker; the page's own J/K/N/D stand down there):
  J/K or ↓/↑ move, Enter or O opens, Esc closes the issue, / searches the list, F filters it, C creates, S P A L M ⇧C open status, priority,
  assignee, labels, project and cycle, I assigns to you, ⌘. and ⌘⇧, copy the branch name and link; each has its ⌘K entry and a
  row in the shortcuts dialog's Linear group. ⌘K also has, only where they work, the open issue's estimate (teams that estimate),
  milestone (a project with milestones), parent, due date and Add relation, Undo archiving (while its bar shows), Search the
  Linear list, and the sidebar's places (`linear-go`, the place as `runAppCommand`'s argument; LinearView reports what's offered
  through `onIssueOpen` and `onViewState`). Everything shows from the page's store (`store.ts`), synced at most every 20 s only
  while the view shows and the page isn't hidden (`keepSynced`: ticks skip while `document.hidden`, and one sync runs as it
  shows again); a scope refused for a while (rate limited) is asked again on the first tick after `retryAt`. A scope loads up
  to 1,000 issues (the list then says it shows the most recently updated). After a complete load, issues the store lists in the
  scope that Linear didn't return (they left it unseen: reassigned, closed, archived) are asked for by id (`q/byId`, 50 to a
  request, 100 at most) and merged where they now belong; those Linear no longer lists, and any past the hundred, leave the
  store (re-asking keeps other lists truthful, which dropping all wouldn't). Sync's reload (`more`) also asks for the open issue
  and its comments. Linear doesn't move `updatedAt` on (un)subscribing, so a subscription changed elsewhere doesn't arrive by
  sync: it shows on the next read of the issue or of Subscribed; a read begun before a write was saved never undoes it. Server (`web/server/linear/`; the page never
  gets the key): Linear is opt-in, so `client.ts` takes the key only through `integrationKey("linear")` (`integrations.linear` in
  `settings.json`, then `linearApiKey` in the data directory's `secrets.json`; the environment is never read). Off, every read and
  write and the image route refuse with "Enable Linear in Settings to see your issues."; on without a key, "Add linearApiKey to
  secrets.json to use Linear." (`LinearError` kind `no-key`; reads answer it as `LinearUnavailable`, which the view shows, writes
  as 503). Saving, replacing or removing the key in Settings (`paseo:secrets`) refreshes the open view: named reads only (`reads.ts`, `GET /api/linear/q/workspace|issues|byId|issue|cycles|sync|status`) and whitelisted writes
  (`writes.ts` `linearWrite`, `POST /api/linear/m/<name>`, each input checked field by field; no passthrough GraphQL, no `@linear/sdk`),
  over `client.ts`, which keeps to the key's hourly budget (2,500 requests, 3,000,000 complexity; reads stand down when it runs low,
  writes still go). Launch agent opens New agent with the issue (`DispatchTarget.issue`): Worktree on Linear's branch name, the
  composer's draft naming the issue; presets take `{{issue}}` and the issue's details (`prompt.ts`). As Conquer's sidebar, the Linear
  sidebar's inner edge resizes it and ⌘S hides or shows it (kept in localStorage). Its text is 2 px over the app's sizes by default; ⌘+ / ⌘− / ⌘0 (anywhere in the page while Linear shows; ⌘K "Bigger/Smaller/Actual Linear text") step it (`linear/textSize.ts`, `--linear-text` on the root, kept in localStorage), and the terminal keeps those keys only while it has the keyboard. Images uploaded to Linear load through
  `GET /api/linear/image?url=` (only `uploads.linear.app`, fetched with the key; `linearImages`). Tests never reach Linear
  (`web/server/test-setup.ts` points the data directory and settings file at a temporary folder): server tests and e2e (`web/e2e/linear.e2e.ts`, the real route) run over the fake
  Linear (`web/server/linear/fake.ts`, `web/e2e/linearFake.ts`; `installFakeLinear` enables Linear in the test settings file and
  writes a fake key to the test `secrets.json`, and `restore()` puts both files back; the e2e mocks `settings.integrations.linear`). `web/scripts/linear-write-check.ts`, run by hand
  (`cd web && PASEO_COMMAND_DATA=<data folder> npx tsx scripts/linear-write-check.ts`, the key read as the app reads it), checks the writes against the real Linear on one issue only: team DE's
  `Paseo Command write check (safe to delete)` (made if absent), putting its edits back.
- Web links clicked in the chat (`.session`, `openInAppBrowser` in `web/src/Session.tsx`, `postAppLink` → the `openLink` message)
  switch to Conquer and open there as a new tab, once its tabs are restored (`whenStarted`).

## Atlas world

The app bundles `rendering/` directly; the bridge paints its art in the page and SpriteKit draws it.
Each project with workspaces is its own island (projects without workspaces are hidden, as are hosts without any; if no host has workspaces, each shows as a bare clearing): a ten-hex
landmark (rows of 3, 4, 3) in the middle, ringed by its workspaces, each touching it. Workspaces are placed
oldest first (then by id; never by their changing titles, so nothing swaps places): bottom, lower-left, lower-right, upper-left, upper-right, then top, a cell apart (later ones stand against
that ring). A workspace is a three-hex light-dirt triangle pointing at the landmark, its cottage larger and centred
across all three, with no plants beside it so its PR medallions stand clear. Each agent is a robot on its own light-tiled hex beside its workspace, growing away from
the landmark, oldest first: straight out, then alternating left and right. Islands are only these built cells:
no empty sand around them (the user removed it). A host's islands share one landmass of grass hex tiles (hexes everywhere) with a hex-edged shore in a generated sea, under the host's
banner (offline hosts are faded and labeled). Each agent's state shows only on its sand hex (fill, border colour, border motion: a light runs round
running borders, states that need you pulse); robots carry no rings or badges. Hosts, projects, workspaces and
agents each have their own hover border colour; hosts are not interactive on the map (no hover, no pick from land or banner). The user asked for water back (rejecting chart paper, and a plain meadow background), with each
host as a landmass; project islands sit on it on earthen banks with soft shadows.
The layout follows the map's aspect ratio: hosts shelf-pack and tall maps stack vertically.
Agents the daemon reports without a workspace wait at a flagged camp, laid out like a workspace.
Each landmark's paving carries props (`props.png`): three seeded pieces of greenery and workshop gear, two lamps
lit while any of the project's agents is running, and a beacon that flares, in the most urgent state's colour,
when one needs approval, has a question or failed. Props keep off the landmark's art, its name and the kerb.
Every item (landmarks, cottages, plaza props, lamps and beacons, robots, PR medallions) casts a soft shadow under a noon sun: centred
beneath it and showing evenly on every side, so it never turns as a robot does. The page paints each frame's `<frame>-shadow`
(`shadowOf`, `SHADOW` in `rendering/src/native/bridge.ts`); structures' come as sprites, and Swift places those of lamps, PR medallions and robots (lighter).
The world is assembled from generated transparent sprite atlases, a terrain texture,
and a strict axial hex grid. It is not a screenshot used as a background.
The sea's glints and cloud shadows drift slowly in 15 Hz steps. The world renders on demand: 30 fps for ambient
motion, full rate while handled, paused when nothing moves or the window is hidden.
The inherited React UI is preserved; its panels follow the system's appearance: the Galaxy theme (as in the user's
reference) when it is dark, the Light theme when it is light (`worldLook` in `web/src/theme.ts`). The terminal panel and Conquer's chrome and pages follow it too
(their tones are `Ink` in `native/Sources/PaseoCommandNative/Textures.swift`).
Five original references may be retained locally in ignored `design/references/atlas-01.webp` through `atlas-05.webp`; they are not redistributed.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.
Architecture uses the original `buildings.png` plus `structures.png`: eight project landmarks
and seven workspace cottages, balanced deterministically across neighbours (`STRUCTURE_SAMPLE` in the tests).

## Confirmed map constraints

Labels stay at fixed world scale. Do not add screen-size compensation.
All structures and scenery consume whole cells on the shared axial grid.
Workspaces use three hexes; project landmarks use ten (rows of 3, 4 and 3); each agent uses one.
One island per project with workspaces.
Center artwork and fit it completely inside its occupied cells. Everything is seen from directly above: PR status shows
as flat enamel medallions (`medallions.png`) in a workspace's two yard cells, set a little beyond each cell's centre
away from the cottage (the user replaced the side-view PR flags, which looked like they were floating).
Selection follows the outer perimeter of the occupied hexes, never a rectangle: a golden rim with a breathing
yellow halo over a warm wash, so the selected entity reads on any surface. Hover and selection
rims are inset within the cells so painted kerbs and banks never clip them; an agent hovers across its whole cell.
Hosts are picked from the Hosts tab only (land and banner are not interactive): the map rings its landmass and the lists narrow to it, the same
host filter as the Hosts tab; any other selection takes the highlight while it lasts.
Project, workspace and agent cells each have a distinct tile style (flagstones, light dirt, light sand
tiles); islands have no empty cells. Minimum zoom fits the land with a one-cell border (plus room for banners and map controls);
panning stays within that extent. The world never sends daemon actions; the React UI owns them.

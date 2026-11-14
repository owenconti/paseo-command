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
The React app and official SDK API are in `web/`; the macOS app (`native/`, the React app in a WKWebView) adds the
top bar, Conquer, the Terminal tab, the Files editors and the agent's browser. The map is Crew (below), which the page
draws itself, in a plain browser too; the other maps (Islands, Overworld, the Dungeon Board) were removed at the user's
request, their art kept in `rendering/` (no code). Do not add further worlds unless asked.
Robots keep model colours (Claude orange, ChatGPT/Codex white; other providers keep a stable colour of their own).
Real state must remain truthful: distinguish running, idle, completed/unread, approval,
question, failure and offline. Test daemon mutations against fake daemons only.

## Command palette

The command palette (⌘K, `web/src/CommandPalette.tsx`) lists what the app can do. Its entries are
`paletteCommands` in `web/src/main.tsx` (the open agent's own in `agentCommands`), ranked by `web/src/palette.ts`.
Every entry has a `page`, the part of Paseo Command it belongs to (`PAGES`): Command (the map, agents, workspaces,
projects, hosts, dispatch), Conquer, Activity, GitHub, Files, Settings (its toggles and editors too), Terminal,
else App (the window, updates, text size, ⌘` stepping, what's new, games). A "Show …" entry for a tab names that tab's page.
The palette shows it on the row's right before any keys; found things add their `kind` ("Command · Agent"). Among equal
matches the page on screen (`shown`) ranks first. Write it `page: "GitHub" as const` (spreads widen strings).
Whenever you add, rename, remove or change a user-facing action (a button, a key, a menu item, a native
View or Conquer menu command), update its palette entry in the same change: label, `page`, `keys`, `keywords`, and the
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

- `npm run app:install`: installs `web/`'s dependencies.
- `npm run app:dev`: React UI (Crew and the pages) and SDK API on port 4310, bound to `127.0.0.1`.
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
  Tests of code using SwiftTerm (`TerminalFontTests.swift`) are compiled with `swiftc` against `native/.build/release`'s SwiftTerm (built first if missing).
- `npm run release:setup`: once, by the user: checks for a "Developer ID Application" certificate in the login keychain (explains
  making one; installs Apple's intermediate), saves a notarytool login as `paseo-command-notary`, and makes Sparkle EdDSA keys
  (`SUPublicEDKey` goes into `native/Info.plist`). `scripts/signing.mjs` picks the identity (`PASEO_COMMAND_SIGN_IDENTITY` when there are several). `npm run release -- [--bump patch|minor|major] [--notes <file>] [--dry-run]`
  (`scripts/release.mjs`): checks, tests, builds the release app to `native/release/`, signs it with the Developer ID under the hardened
  runtime (entitlements in `native/entitlements/`: JIT for Node), notarizes and staples it, zips it (Sparkle downloads the zip), makes a drag-to-Applications `.dmg`
  (`scripts/dmg.mjs`; signed, notarized and stapled too), writes the Sparkle appcast, commits
  `Release v<version>`, pushes `main` and runs `gh release create`. Releases are notarized, so they open normally. `--unsigned` (with `release:setup -- --unsigned`) makes an
  ad hoc signed, non-notarized release while no Developer ID is available; its notes explain Open Anyway.
- `npm run app:typecheck`: checks the React app's and the API's TypeScript.
- `npm run app:e2e`: browser tests of the app against a mocked fleet (no daemon is reached).
- `npm run native:build`, `native:run [-- --url …]`: the macOS app (`native/`), the React app in a WKWebView, built as the dev flavour "Paseo Command Dev" (`io.github.owenconti.paseo-command.dev`,
  port 4321, no updates, data in `~/Library/Application Support/Paseo Command Dev/`); `sh native/scripts/bundle.sh --release` (done by
  `npm run release`) builds "Paseo Command" (`io.github.owenconti.paseo-command`, port 4310, Sparkle). `native:mock` serves web/dist
  with a mocked fleet. See `native/README.md`. The app is self-contained: `Contents/Resources/node/node`, `server/server.mjs` and `ui/`
  (web/dist). It runs that server itself and the server ends with the app (`ServerManager.swift`). Check runs pass `--no-server`.
  Launch it with `open -g` and `--background` for checks; it must never take the user's focus.
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

- `web/src/model/`: the fleet's vocabulary (`fleet.ts`: states, models and robot colours, `AtlasData`), PR flags
  (`prStatus.ts`) and Probe's verdicts (`probe.ts`), shared by Crew, the hover tips and the server.
- `web/src/crew/`: Crew, the map (below). `rendering/`: the old maps' art only (`src/assets/`, `artifacts/`, `ASSETS.md`).
- `web/server/`: inherited official Paseo SDK API, served with the app on loopback only. `native.ts` is the entry the app
  bundle runs (`server.mjs`, env `PASEO_COMMAND_DATA`, `PASEO_NATIVE_OWNER_PID`); `scripts/app-server.mjs` (`app:start`) instead serves a checkout's `web/dist` and API through Vite preview for browser-only work.
- `web/server/releases.ts`: `GET /api/releases`, the GitHub releases and their notes; `web/src/ReleasesButton.tsx` (top bar,
  "What's new" in ⌘K) shows them in place of the old commit list.
- `native/Sources/PaseoCommandNative/ServerManager.swift`: starts the bundled Node server with the user's shell environment
  (`ShellEnvironment.swift`), keeps its log in `<data>/logs/server.log` (the app's own notes in `logs/native.log`), restarts it if the page finds it gone and stops only a
  recognised old Paseo Command checkout server on the port, after the user confirms. `OldInstall.swift` (release flavour, only when ServerManager finds an old checkout server on the port): offers to stop it
  (and its `com.paseo-command.serve` launch agent) and, if none exists yet in the data folder, copies `secrets.json`, `games.json`, `forks.json`, `archived-subagents.json` once from the checkout's
  `.paseo-command/`. `LegacyState.swift` migrates the old app's (`local.paseo.command.native`) preferences, WebKit data and HTTPStorages once,
  after offering to quit the old app if it is open (declined or failed copies retry next launch).
  `Updater.swift`: Sparkle (feed `https://github.com/owenconti/paseo-command/releases/latest/download/appcast.xml`); the mode bar shows
  "Update ready · Restart app", and Restart app (⌘K) installs and relaunches at the same page. Check for Updates… (app menu; "Check for
  updates" in ⌘K, shown only when the app's `paseo:update` says `canCheck`) asks Sparkle now; the page asks for that event with an `update` message.
- `web/e2e/`: browser tests with every `/api` request answered in the browser.
- `web/src/Dispatch.tsx` `NewAgent`: a new agent opens in the panel as an empty conversation (host, where and
  branch in a small form) with the usual composer; its first message creates the agent. Leaving it loses nothing: its
  message is the composer's `draft:dispatch` (images kept in memory), and the form (host, where, Local/Worktree, branch,
  base, pull request, provider, model, thinking, mode or profile) is kept as it changes (`dispatch-form` in localStorage,
  `keptForm`), brought back when New agent next opens without a place of its own (a workspace's or project's Dispatch,
  ⌘K's pool box entry and a cleared agent's settings start where they say), and cleared once it starts an agent. A pool
  box claim under way (`dispatch-pool-job` in `poolStore.ts`, with its message) shows again when New agent reopens; a
  claim that fails puts its message back into an empty draft ("Your message is back below"), and one that worked clears
  the kept form. Its /skills and @files
  come from `GET /api/drafts/commands|files` (`web/server/api/drafts.ts`), as no agent exists yet.
  Its provider picker also lists the host's Paseo agent profiles (`GET /api/profiles`, the daemon config's `agentProfiles`):
  one sets provider, model, thinking and mode, and sends its feature values (`features` in `POST /api/dispatch`) while unchanged.
  The profiles are managed in the app (`web/src/ProfilesEditor.tsx`: the picker's Edit profiles…, Settings, ⌘K "Edit agent profiles…"):
  per host, each one's name, provider, model, thinking, mode, provider features and notes, in order (`web/server/api/profiles.ts`:
  `GET /api/profiles/editor|features`, `POST /api/profiles`, written with the daemon's `patchDaemonConfig`, keeping fields the editor
  doesn't show and profiles added elsewhere meanwhile; read only on a daemon without the `agentProfiles` feature).
  In Worktree mode a pull request can be chosen instead of a new branch (`web/src/PrPicker.tsx`: paste a number or URL,
  or search via `GET /api/drafts/prs`); the worktree checks out its branch as the Paseo app does (`pr` in `POST /api/dispatch`).
  Preset prompts from the data directory's `settings.json`, beside `secrets.json`, so the Dev and release apps keep their own
  (`{"presets":[{"name","prompt"}]}`, `GET /api/presets`, `web/server/presets.ts`, `web/server/settings.ts`; `PASEO_COMMAND_SETTINGS`
  overrides the path) show as buttons that launch the agent at once; `{{pr}}` names the chosen pull request.
  They are edited in the app (`web/src/PresetsEditor.tsx`, from Settings or New agent; `POST /api/presets` keeps the file's
  other keys and never overwrites an unreadable file); `web/src/presetsStore.ts` shares them across the page.
  Optional integrations (`integrations.linear`, `integrations.typesafe`) default off in that file.
  Integration keys are read only from the data directory's `secrets.json` (`web/server/secrets.ts`), never from environment variables.
  Settings is a page in the map's place (`web/src/SettingsPage.tsx`, opened through `settingsStore.ts`), its text the pages': in the macOS app
  the mode bar's gear (`Mode.settings`, no tab: a `BarButton` beside the usage meters, lit while Settings shows; it, Esc and the app menu's Settings… ⌘, go
  back to the side before, the gear and ⌘, opening it again; ⌘` steps on from that side; the palette's Settings asks with `menu` `settings`; a saved
  `settings` mode still shows it), in a browser the page's own state (its bar's gear; Esc or its × closes it). Laid out as the other pages (a resizable sidebar of its
  sections, the chosen one beside it under its heading, kept in localStorage; ↑/↓ step through them; Manage … key opens Integrations): sound and music (a
  volume only while its sound is on), notifications, integrations, New agent (presets, profiles), Files (open files in the viewer or an editor command),
  Terminal (the macOS app's terminal font: family from a searchable `Picker`, size, line height (a typed number: any value above 0 up to 100,
  applied as it parses, ↑/↓ stepping 0.05; what can't work is said beside it and the last good value stays), letter spacing, a preview and Restore defaults; ⌘K
  "Terminal settings…", `openSettings("terminal")`; in a browser it says it's the app's). Rows put what a setting is on the left and
  its switch or button on the right; a switched-on integration shows its state (Ready, needs a key, Live) and its keys and settings in a well beneath it.
  `GET /api/secrets` returns presence flags only; `POST /api/secrets` saves/replaces/removes a named key,
  preserving other credentials in an atomic owner-only file. Saved values never return to the page.
  The same `settings.json` keeps the Linear workspace (`linearWorkspace`; `GET`/`POST /api/settings`,
  `web/server/settings.ts`), which the page once kept in localStorage and moves into the file on load.
- `native/Sources/PaseoCommandNative/TerminalDrawer.swift`: the Terminal tab, the macOS app's only terminals (the Files editor's aside; there is no side or
  bottom terminal panel: the user removed it). The mode bar's tab after Files (`Mode.terminal`; ⌘3 by its place, ⌘` steps through it; View → Terminal
  and View → Show Terminal, ⌃`, from anywhere, which in the tab goes back to the side before it (`toggleTerminal`, its title then Back from Terminal);
  ⌘K "Show terminal" (`terminal-tab`) or, in the tab, "Leave the terminal tab" (`terminal`), page Terminal; ⌃⇧` is no longer a key) shows the selected
  workspace's (or agent's) daemon terminals full size in the map's place, laid as Conquer is (`placeTerminalTab`, over `mapInContent`; ⌘B gives it the
  window's width: the window hands ⌘B to the page while its terminal has the keyboard, `AppKeys.togglesPanel`, `tabTerminalHasKeys`). It owns the
  sessions, tabs, splits, + / × and font: drawn by SwiftTerm; opening the tab starts a terminal if the workspace has none (`enterTerminalTab`); + opens
  another; a tab's × ends it. Tabs drag onto a pane's edge to split it (`PaneLayout`), or its middle to replace it; the unsplit button (View → Unsplit
  Terminals, ⌘K "Unsplit terminals", only in the tab) or dropping a pane's tab on the tab bar undoes splits. Hidden (another tab shows,
  `leaveTerminalTab`) it keeps its tabs, splits and current tab, asks the daemon nothing and starts nothing; each workspace keeps its panes. The old
  panel's saved state (`terminalOpen`, `terminalDock`, `terminalWidth|Height`) is ignored. Editor terminals stay out of it. `--info`'s `terminal` is its
  state and `terminalPlace` where its view is (`map` or `hidden`); hooks `terminal` (⌃`), `terminaltab`, `split`, `unsplit`, `newterminal`, `zoom`, `type`.
  Tests: `native/tests/TerminalTabTests.swift`, `AppKeysTests.swift`.
  Its font, and the Files editor's (`TerminalFont.swift`): `TerminalFontSettings` (family, "" the system monospace; size, the ⌘+/⌘− value;
  line height above 0 up to 100, SwiftTerm's `lineSpacing`, which takes any positive value but keeps a cell within 1…8,192 pt (100× at 32 pt
  stays under it); the app refuses others, and an unusable kept one reads as 1; letter spacing −1…4 pt, a fixed advance on the font, as SwiftTerm sizes cells by "W"),
  kept in the app's preferences (`terminalFontFamily|Size|LineHeight|LetterSpacing`; workspace builds share the Dev app's, so checks restore
  them). `TerminalFonts.font` gives the family a Core Text cascade (`kCTFontCascadeListAttribute`): the bundled Symbols Nerd Font Mono
  (`native/fonts`, Nerd Fonts v3.5.1, MIT, `licenses/nerd-fonts-symbols.txt`; copied to Resources/fonts and registered for the process only),
  then Apple Symbols and Apple Color Emoji, so Nerd Font icons draw whatever the family; SwiftTerm's own glyph fallback
  (`glyphFallbackProvider`, `NerdSymbols`: the symbols font's private-use code points, when the family lacks them) fits them to their cells,
  one for a narrow cell, two for a wide one (SwiftTerm's slot is the cell's width: it can't spill a one-cell icon into a following space as Ghostty does).
  Settings → Terminal sets them through `terminalFont` (`set`), and the app answers it, and ⌘+/⌘−/⌘0, with `paseo:terminal-font`
  (the values, defaults, ranges and, when asked, the installed monospaced families; `web/src/terminalFont.ts`); every open terminal follows at once.
  It talks to `web/server/api/terminals.ts`: `GET /api/terminals`, `POST /api/terminals/create|kill`, and the
  `/api/terminal` socket relaying a terminal's bytes (screen replay first, between `{type:"replay"}` and `{type:"live"}` text frames) and its keys and size.
  Terminal queries (`TerminalQueries.swift`, the Terminal tab's and the Files editor's `TerminalSession`): the daemon's own headless terminal
  already answers DA1, `CSI 5n`/`6n`/`?6n`, `OSC 10/11/12;?` and kitty's `CSI ?u` at the pty, so `TerminalQueryFilter` takes those out
  of the bytes before SwiftTerm sees them (its second answer arrived a round trip late: nvim asks DA1 as it quits and leaves on the
  daemon's, and SwiftTerm's `?65;…c` was typed at the shell's prompt); in a replay it takes out every query (DA2/DA3, DSRs, DECRQM,
  XTVERSION, window reports, OSC 4/10–19/52, XTGETTCAP, DECRQSS too). SwiftTerm answers the rest live, each answer sent as
  `{type:"input", data, reply: <frame>}` (`TerminalAnswers`, matched to the oldest query waiting); it, or the relay, drops one whose
  query came before a shell-integration prompt mark (`OSC 633;A|D`, `133;A|D`: the program finished). `PASEO_TERMINAL_TRACE=<file>`
  makes the relay log each frame both ways, timed, as JSON lines. Tests: `native/tests/TerminalQueriesTests.swift`, `terminals.test.ts`.
  `native/scripts/fake-server.ts` runs the real server against a fake daemon (with terminals) for checks: its terminal replays queries,
  `queries` asks them live, and `nvim` then `:q` asks DA1 and XTVERSION as it quits (the fake echoes ESC as `^[`, so a leaked answer shows).
- `web/src/AddProject.tsx`: the Projects tab's Add project panel. On a chosen host, browse its folders
  (`GET /api/folders`, folder names only) and register the open folder, make a new folder in it, or clone a
  pasted GitHub repo into it (`web/server/api/projects.ts`); New agent then opens on the new project.
  A project is renamed in place (its title, `POST /api/projects/:id/rename`; the pencil on its row or view) and removed
  after confirming (`web/src/RemoveProjectDialog.tsx`, `POST /api/projects/:id/remove`: Paseo archives its workspaces and
  unregisters it; the folder stays). Moving a project's folder isn't offered: the daemon has no call for it.
- Automatic names (`web/server/automaticNames.ts`, observed from live feeds and fallback fleet reads): Linear-linked workspaces
  use `KEY · Issue title`, verified through the enabled Linear integration. `workspace-names.json` in the app's data folder remembers
  assignments per host/workspace so later custom names survive. Agents with no title or a copied opening message get a stable short
  task title from the host's metadata model, written back with `paseo-command.auto-title`; custom titles, helpers and subagents stay alone.
  An unnamed sole-agent worktree gets that task title too. `PASEO_COMMAND_AUTOMATIC_NAMES=off` disables the observer (other test fixtures
  use it; `automaticNames.test.ts` exercises the service with fake clients). Naming never sends a task to a real daemon during tests.
- `web/server/asks.ts`: what an idle agent's last reply asks of you, judged once per reply by TypeSafe's Jev
  (opt-in `integrations.typesafe` in `settings.json`, with `typesafeApiKey` in the data directory's `secrets.json`): code splits the reply into
  sentences and keeps only questions and requests (`web/src/asks/sentences.ts`, `mayAsk`), Jev judges which ask you, their kind, a pick's options, and whether
  the reply waits on you. `POST /api/agents/:id/asks`, `GET /api/asks` (status). The composer offers the questions
  (`web/src/composer/AskStrip.tsx`) with quick replies; a reply that waits on you is the map's `asking` state
  and counts as needing you.
  In the same request Jev picks an obvious next reply, if one clearly fits (≥ 0.85), from fixed templates in
  `web/src/asks/suggestions.ts` (`{pr}` filled from the reply when it names one PR); never when the reply asks a pick or open
  question. The composer shows it as "You might say" (`web/src/composer/SuggestStrip.tsx`); one click sends it.
  A clear "A, or B?" question ("Should I push the branch, or do you want the fixtures deleted first?") is a pick whatever kind
  Jev gives it, its two options phrased as replies by code (`pickOptions` in `sentences.ts`: "Push the branch", "Delete the fixtures
  first"); other picks' options are Jev's choice among code's readings (`optionReadings`), falling back to those. A pick's options show at once.
  Open questions then get two or three answers drafted by a helper agent on the daemon's metadata model, as the current
  work summary is (`web/server/askAnswers.ts`, `runHelper` in `workingOn.ts`); the strip shows them as quick replies.
  "Drafting answers…" ends within `ANSWERS_MS` (90 s): a helper that fails or doesn't finish leaves the question without answers;
  the page (`web/src/useAsks.ts`) keeps polling while `answering`.
  Hovering the strip marks the questions' sentences in the transcript (`web/src/asks/highlight.ts`, CSS Highlight API).
- `web/src/urlState.ts`: what is open (the selection and any subagent) kept in the page's query, so a refresh returns
  there; a new selection pushes history, a subagent's opening or closing replaces it.
- `web/src/games/`: the top bar's mini games (gamepad button, or ⌘⇧B from anywhere, in a field too; plain B is the agent's browser on Crew), a floating non-modal window with one game dealt at
  random by the server (`web/server/games.ts`, `/api/games`): no choosing or restarting, the next game only once it ends.
  Progress and each game's best score are kept in the data directory's `games.json`. Games implement `types.tsx`'s
  `GameDef` (plain JSON state) and are listed in `catalog.ts` and `registry.ts`.
- `web/server/probe.ts`: Probe's verdict (Diagonal's `diagonalprobe` review bot) on each workspace's open PR, from one
  read-only GitHub GraphQL query per PR (`githubApi.ts`, the GitHub token) (`GET /api/probe`, polled by `web/src/useProbe.ts`): reviewing, approved,
  findings open (with their count), stale (new commits since, or deferred) or failed. Crew shows it as a medallion on the
  workspace's head (`web/src/model/probe.ts`, `medalsOf` in `crew/sheets.ts`), its tooltip saying the verdict.
  `native:mock -- --probe` shows each.
- Pool boxes (`web/src/pool.ts`, pure; `web/server/pool.ts`): warm-pool Sprites the user's paseo-boxes scripts on this Mac claim and
  release. Opt-in (`integrations.pool`, Settings → Integrations → Pool boxes), with `pool: {dir}` in `settings.json` (the scripts'
  folder, absolute or `~/…`; no default, so no personal path is in the repository: `web/src/PoolSettings.tsx`). paseo-boxes is the source
  of truth for the rest: the boxes from its `pool-state.json` (each box's id, label, claimed state and `base_domain`; never written), the
  checkout from `BOX_REPO_PATH` in its `config.env` (`envValue`; an absolute path on the box, never `~/…`). `secrets.env` and `private/` are
  never read, and `provision-named.sh` never run. `GET /api/pool` (`web/src/poolStore.ts`, polled every second while a job runs): the boxes,
  the checkout, why it can't work yet, and the job. One job at a time. New agent's Host has
  "New pool box · N idle" (`POOL`, `poolOption` in `Dispatch.tsx`; disabled with why when none is idle): its place is the box's checkout
  (Local, or Worktree with a branch or a pull request's branch), Claude only, no /skills; the first message is `POST /api/pool/claim`, checked first
  (`checkPoolDispatch`), which answers at once and runs `claim.sh --any` (the fast claim, never `--up`: the user's call; the agent can run
  `paseo-box-up`), then waits for the Paseo host labelled as the box to be online (`POOL.onlineMs`), then dispatches into the checkout
  (`poolDispatch` in `commands.ts`, as a directory or worktree workspace, so the daemon needn't have it registered), asked again only while
  nothing was issued. A pool box's host that's offline because the box is asleep (released: the Sprite paused, its daemon down
  until claimed) stays selectable in Host as "pool-N · asleep, will wake" (`wakeable`, `hostOptions`; other offline hosts stay
  disabled, and so does a box being provisioned or failed, `unclaimableWhy`): New agent then works as for a new pool box, but its
  first message names the box (`POST /api/pool/claim {pool}`: `claim.sh pool-N`, "Waking pool-N…"; a box claimed but unreachable is
  claimed again, which claim.sh confirms), then waits up to `POOL.onlineMs` (90 s) after claim.sh exits 0 for the host, then dispatches
  by its serverId. Box states are paseo-boxes' (`idle`, `claimed`, `provisioning`, `failed`); only `idle` counts for "New pool box"
  (`--any` skips the rest). The agent's system prompt gains `poolBoxPrompt`: the box, its checkout, that the app stack is down until it runs
  `paseo-box-up` (`--reseed` for fresh data; `~/PASEO-BOX.md`), the box's tailnet-only URLs, and that releasing discards the box's changes.
  Each box is registered once as Paseo host `pool-N` (by `provision-named.sh`); claims and releases never add or remove hosts, and a
  released box's daemon is down until it's claimed again. (Paseo CLI 0.15.4's `--host` takes an endpoint, not a host label: the app
  dispatches through the SDK by the host's serverId.) The form shows the script's step lines (`progressLine`) and opens the agent when it's done; a notice says how each job
  ended (`onPoolJobEnd` in main). A claimed box's host head in Crew has Release, which confirms (`ReleasePoolDialog.tsx`: the box is
  restored, so its work and agents go) and runs `release.sh pool-N` (`POST /api/pool/release`). Archiving a claimed box's last
  workspace releases it (`web/src/poolArchive.ts`, every workspace archive goes through `archiveWorkspace`): before the archive
  request (the toast shows at once; bounded by `POOL_ARCHIVE.checkMs`, never stopping the archive) `POST /api/pool/before-archive
  {host, workspace}` reads its checkout (`getCheckoutStatus`, `poolCheckoutOf`: uncommitted changes; commits ahead of the upstream,
  else, never pushed, ahead of the base); once archived, `POST /api/pool/after-archive` counts the host's other active workspaces
  and unarchived agents (fresh from its daemon). Anything left: it stays claimed. Nothing left and the checkout clean: released in
  the background (`POST /api/pool/release {pool, host, workspace}`, which checks the host is the box's and idle again); unpushed
  work, or a checkout that couldn't be read: `ReleasePoolDialog` asks first ("Releasing pool-N discards unpushed changes in
  <branch> (…)", `releaseWarning`); Keep it leaves it claimed with a notice. Hosts that aren't a claimed box (`boxOfHost`, by the
  registry's label) answer `{box: null}` and are archived as before. release.sh exits 0 on success or an idle box, 1 on a bad id or
  any error (its `error:` line is shown); the app never runs it without an id. ⌘K: "New agent on a new pool box",
  "Release pool box “pool-N”…" (page Command), only while they'd work. Scripts run without a shell, output redacted, only step and outcome
  lines kept. Tests: `server/pool.test.ts` (fake scripts in a temporary folder; `POOL_DEPS` fakes the host, dispatch, checkout and
  what's left on a host),
  `src/pool.test.ts`, `e2e/pool.e2e.ts`.
- Auto-merge: a PR's `autoMerge` comes from Paseo's GitHub facts (`autoMergeRequest`), else GitHub's API (`web/server/links.ts`, the GitHub token).
  While it's on, Crew's workspace head carries the auto-merge seal (`AUTO_MERGE` in `web/src/model/prStatus.ts`), its tooltip saying how
  it merges and who turned it on.
- Top bar: native, all of it, in the macOS app (`ModeBar` in `Conquer.swift`, its height an empty unified-compact toolbar's, which centres the traffic
  lights): the traffic lights, "PASEO COMMAND" (the bundled Barlow), the mode tabs (Command, Files, Terminal, GitHub, Conquer, Activity, those enabled;
  ⌘1…⌘6 pick the one in that place among those shown, from anywhere in the window: `AppWindow.performKeyEquivalent` offers them to the View menu,
  whose items `numberModes` keys, ahead of the page, the terminal and Conquer's pages, as ⇧⌘G Show Branch Changes (the Files tab's Changes) and ⇧⌘E Show Files are, `AppKeys.swift`), Update ready, and the tools: need you, usage meters, the Settings gear,
  What's new, mini games, keyboard shortcuts and the session panel's side, layout and show/hide (`BarButton`, `UsageMeters`). The page lies below the bar
  (`--app-bar` 0) and draws no bar of its own there (`.app-bar-hosted` in `FloatingPanel.tsx` keeps what the tools open). The page says what the tools show
  (`postAppBarState` → `barState`: attention, usage meters, What's new unseen, the radio connecting, panel side, layout and visibility), and a tool's click
  comes to the page as `paseo:bar` (`onAppBar`) with the button's rectangle in page coordinates, so usage, What's new, games and shortcuts open beneath it.
  In a browser the page keeps its own `.app-bar` (name, tools, gear). The page's other content keeps to `content`, the window below the bar (`--workspace-width`/
  `--workspace-height`, `layoutWorkspace`). The map and page are `command`'s; `content` (Conquer, the Terminal tab, the Files editors) is the window root's, over `command` and
  below the bar, passing other events through (`PassThroughView`): a view after the web view in its own parent stays off screen until the web view is
  hidden and shown again. Check such layout with `.windowshot` (the screen's pixels), not `.snapshot`. Bar controls must be `NSButton`s: the title bar's
  toolbar passes clicks through only to controls. The panel has no header of its own and, hidden (⌘B), takes no width.
- Conquer (experiment): the COMMAND / CONQUER strip across the macOS app's top (⌘` steps Command → Files → Terminal → GitHub → Conquer → Activity, those enabled, and ⌘1…⌘6 pick one; View menu; the tabs light on hover)
  switches the map's place between the map and Conquer, a WebKit browser (`native/Sources/PaseoCommandNative/Conquer.swift`),
  laid exactly over the map (`placeConquer` in `WorldWindow.swift`): the panels stay, and ⌘B (the page's panel toggle)
  gives it the window's width. The hidden side keeps running. Conquer takes its keys only while it has the keyboard (`hasKeyFocus`),
  so the chat panel keeps ⌘L and the rest.
  Back/forward/reload and the address bar (suggestions from its history, `ConquerExtras.swift`) run along the top of the page
  (`PageBar.swift`). Its sidebar, as in Zen and Arc: pinned tabs and their folders (one level; drag to reorder, pin above New Tab, unpin below it, into and out of folders;
  right-click for Pin, Back to Pinned Page, Replace Pinned URL with Current URL, Move to Folder, Rename, Delete), New Tab, then the other tabs (`ConquerTabs.swift`), each with
  its favicon or a spinner. A closed pinned tab only unloads. Its commands (`ConquerView.commands`, the Conquer menu) take their keys ahead of
  the page: ⌘T, ⇧⌘T reopen, ⌘W, ⌘L, ⌘E or ⌃Tab next tab, ⌥⌘1…⌥⌘8 that tab, ⌥⌘9 the last (⌘1…⌘6 stay the mode bar's), ⌘D pin, ⌘[ ⌘], ⌘F ⌘G ⇧⌘G find,
  ⌘R reload (⇧⌘R without cache), ⌘+ ⌘− ⌘0 zoom (per site), ⌘P print, ⇧⌘J downloads. App restart is only in the React command palette, without a shortcut. It has its own persistent cookie store,
  optionally seeded after confirmation through Conquer → Import Zen Cookies from Zen Browser's profile (`ZenCookies.swift`): a copy of
  `cookies.sqlite`, default space only, unpartitioned and unexpired; Zen is never written to. Its tabs (`conquerState`), sidebar width, zooms,
  history (`conquer-history.json` in the app's data folder, `~/Library/Application Support/Paseo Command/` for the release) and the mode come back on launch; tabs come back unloaded.
  Passwords: 1Password fills Conquer's pages only through its Universal Autofill (⌘\\ by default, set in 1Password, with 1Password on under
  Privacy & Security → Accessibility). 1Password registers that key as a system hotkey (Carbon `RegisterEventHotKey`), so it reaches 1Password
  before the app or page sees it (Conquer's commands don't use it); the page's fields, iframes' too, are in the accessibility tree and take focus
  and typing as in Safari (both are WebKit), each web area gives its address (`AXURL`), and the window gives the current page's address as
  its `AXDocument` while Conquer shows (`AppWindow` in `WorldWindow.swift`), as a browser's window does. 1Password matches sites by address only
  in the browsers it knows by bundle id and signature; here it matches Paseo Command as an app (it offers to link a login to the app), and it
  fills only apps with a real code signature: the release app (Developer ID), not the ad hoc signed Dev app. macOS AutoFill (the key icon,
  credential providers such as 1Password's) isn't available for arbitrary sites in a third-party app's WKWebView: Password AutoFill offers
  credentials only for an app's own associated domains, and the browser entitlement (`com.apple.developer.web-browser.public-key-credential`,
  granted by Apple) covers passkeys only. So there's no Conquer menu or ⌘K entry for it.
- Pages: GitHub, Activity, Files and Settings, which the page draws in the map's place, share one look (`web/src/styles/pages.css`): one type scale (the
  app's sizes plus `--page-text`, 2 px by default), one width scale (`--lz`, from `--page-scale`, for columns, rows, controls and icons) and, in dark, one
  neutral near-black palette; each is a sidebar headed by its name beside its content, the same rows and heads. A content head is a
  `.page-head` (`pages.css`) and never overlaps: its title (`.page-crumb` parts, then `.page-head-name`, then `.page-head-count`)
  clips and cuts short earlier parts first, showing whole on hover (`usePageTitleTip`, `web/src/pageHead.ts`); by the head's
  width (container queries) tools drop their `.page-tool-label` words for icons, then `.page-head-aside`s and the count go,
  and the tools wrap under the title only when it would have less than 7em. One text size serves them all
  (`web/src/pageText.ts`, kept in localStorage): ⌘+ / ⌘− / ⌘0 anywhere in the page while one shows, ⌘K "Bigger text", "Smaller text", "Actual text size",
  and the shortcuts dialog's Pages group; the terminal keeps those keys only while it has the keyboard.
  ⌘R refreshes what the shown page shows, as its head's refresh button does, never reloading the web page (`web/src/pageRefresh.ts`:
  the view on screen registers its refresh with `usePageRefresh`; one runs at a time, ⌘R in flight ignored; the button spins): a GitHub PR
  (its read with `fresh=1`, and the diff while Files changed shows) or list (that list only), Files (the tree's folders, the open file, the
  file list and changed files), Files → Changes (the changes), Activity (the feed). Settings has none, nor the map (its fleet is live: ⌘R
  does nothing there). In the macOS app it's View → Refresh Page (`AppKeys.addRefreshPage`), offered the menu ahead of the views while
  GitHub, Files or Activity shows and no terminal has the keyboard (`AppKeys.pageRefreshes`), asking the page's `page-refresh`; a file's
  editor and the Terminal tab keep ⌘R (no ⌘ key reaches a terminal program, as in Terminal.app, so it does nothing there) and Conquer
  keeps Reload Page while it has the keyboard. In a browser the page takes ⌘R only while a refresh is registered, else the browser
  reloads. ⌘K: "Refresh the pull request(s)", "Refresh the files", "Refresh the changes", "Refresh activity" (`page-refresh`, ⌘R); "Refresh
  GitHub" still asks again for everything the tab has read. Their shared controls (toolbar buttons, filter chips, the searchable
  `web/src/Picker.tsx`, row menus; `menuKeys.ts`) are styled in `web/src/styles/pickers.css` (class names `linear-*`, from the removed Linear tab).
- Linear tab: removed at the user's request (the page: lists, board, issue detail and editing, comments, attachments,
  relations, Create issue, views, the Inbox page, search, cycles, projects and initiatives; its mode, mode bar tab, View menu item and
  ⌘K entries, shortcuts group and CSS; its server reads, writes and upload, file and image routes; launching an agent from an issue
  and presets' `{{issue}}`). Don't add it back unless asked. What stays of Linear: Activity's Linear source (below), Settings' Linear
  switch, `linearApiKey` and Linear workspace, the session header's issue chip (`HeaderLinks.tsx`, `GET /api/linear-issue`,
  `linearIssue` in `web/server/links.ts`), and Linear links opening in Linear's desktop app (see links, below). The user's data stays
  as it is, ignored: the old tab's localStorage (`linear:*` places, display, history) and any saved `linear` mode (the map shows).
  Server (`web/server/linear/`; the page never gets the key): Linear is opt-in, so `client.ts` takes the key only through
  `integrationKey("linear")` (`integrations.linear` in `settings.json`, then `linearApiKey` in the data directory's `secrets.json`; the
  environment is never read). Off, every read and write refuses with "Enable Linear in Settings to see your issues."; on without a key,
  "Add linearApiKey to secrets.json to use Linear." (`LinearError` kind `no-key`). `reads.ts`: the workspace's address (`urlKey`), people
  and teams (kept five minutes) and your Inbox (`readNotifications`); `writes.ts` `linearWrite`: only Activity's
  `notificationMarkReadAll|MarkUnreadAll|ArchiveAll`, each input checked field by field (no passthrough GraphQL, no `@linear/sdk`);
  `client.ts` keeps to the key's hourly budget (2,500 requests, 3,000,000 complexity; reads stand down when it runs low, writes still
  go). `route.ts`: only `GET /api/linear/teams` (the workspace's `urlKey` and team keys, for the chat's autolinks; empty while Linear is off, keyless or not answering) and `GET /api/linear/avatar?user=<id>`, a member's avatar (only the address Linear gives for that member: Linear's
  own uploads with the key, other hosts without it; kept an hour, `avatar.ts`). Tests never reach Linear (`web/server/test-setup.ts`
  points the data directory and settings file at a temporary folder): they run over the fake Linear (`web/server/linear/fake.ts`:
  the workspace, the Inbox and its writes; `installFakeLinear` enables Linear in the test settings file and writes a fake key to the
  test `secrets.json`, and `restore()` puts both files back).
- Activity (the mode bar's last tab, after Conquer, while GitHub or Linear is enabled; its tab shows the unread count, the page's
  `activity` message): GitHub and Linear notifications in one feed the page draws (`web/src/activity/ActivityView.tsx`), newest
  first, grouped by day, filtered by source or unread, with the selected one's preview beside it from 1,100 px; the sidebar's and the preview's edges resize them (`web/src/ResizeEdge.tsx`; arrow keys too, double-click restores the default; kept in localStorage). Opening one
  (`open.ts`, by its address) goes where it lives: pull requests in the GitHub tab ("Review in GitHub", through the app's link routing), Linear issues and projects in Linear's desktop app ("Open in Linear"; Conquer without it), other GitHub in Conquer, in a browser a new tab; it's read from then. Keys: J/K move, Enter/O open, U read/unread, ⇧U all shown read, E/⌫ done, ⇧E all shown done (Mark all done; asks first), 1–3 all and the sources; each with
  its ⌘K entry and the shortcuts dialog's Activity group. Server (`web/server/activity/`, `GET /api/activity`, `POST
  /api/activity/m/read|unread|done` with `{keys}`): `github.ts` (opt-in `integrations.github`: `GET /notifications` with the GitHub
  token, unread and the past 14 days, cached a minute; read and done through the API; GitHub can't mark unread, and its list still has threads marked done, as read ones, moving their `updated_at` for activity that doesn't notify you, so those done here are kept in the data directory's `github-activity.json` with GitHub's time for them and when they were marked, and left out across launches until a genuinely newer event), `linear.ts` (the
  Inbox's notifications, one per issue or project, as Linear's Inbox groups them (`web/server/linear/inbox.ts`), not the snoozed, through
  Linear's whitelisted writes; an issue's links to the issue on linear.app, and a pull request notification, which Linear gives no issue,
  to the issue its branch or title names, of the workspace's teams (`issueKeysIn` in `normalize.ts`, `pullRequestIssueKey` in
  `inbox.ts`; the address from the workspace's `urlKey`, else `linearWorkspace`, else another notification's), `feed.ts` (a source that fails says why without hiding the rest),
  `marks.ts` (what's marked, for both sources, since their lists lag behind writes: a write marks its items before it's sent, undoing that if
  refused, and forgets the source's cached list; a done item stays out until it's unread again and changed after both the source's time for it
  and when it was marked (and after GitHub's `last_read_at`), never within `ACTIVITY_MARKS.settleMs` (2 min); read and unread show as marked
  while the lists settle). The page's store
  (`store.ts`) polls every 30 s while the view shows, else every minute in the macOS app for the tab's count; writes show at once, an
  answer to an ask begun before a write settled is dropped, and a refused write puts the item back with a notice.
- Slack: removed at the user's request (the tab, its server, Activity's Slack source, Slack link routing, launching
  agents from Slack, Settings → Slack). Don't add it back unless asked. The user's data stays as it is, ignored: `settings.json`'s
  `integrations.slack` and `slackSections`, `secrets.json`'s `slackUserToken`/`slackAppToken` (saving either file keeps them) and
  `slack-activity.json`.
- GitHub (the mode bar's tab after Files; View menu; palette "Show GitHub"; all only while `integrations.github` is on): pull
  requests the page draws (`web/src/github/GitHubView.tsx`) over the map's frame while the app reports `paseo:mode`
  `github`, as Activity is (a workspace's changes are the Files tab's Changes, below). Its sidebar:
  Pull requests (Review requests, Your pull requests, Involving you, each counted), then Repositories (`RepoNav.tsx`, `GET /api/github/q/repos`:
  one GraphQL query for your, your organizations' and collaborations' repositories, those of PRs involving you and of your favourites, each
  counting its open PRs): only Favourites (starred repositories, and those of starred organizations, whose heads show even with none open),
  and the repository open now (its PRs or one of them) under Open while it isn't one. A search field heads the section (⌘K "Find a GitHub
  repository…", which shows the sidebar first): it finds any repository you can see by name, `owner/name`, an owner's login or a github.com
  address (`GET /api/github/q/repoSearch?q=`, `readRepoSearch` in `reads.ts`: those the tab knows first, involving you then yours as last pushed,
  then GitHub's repository search, asked once typing pauses (300 ms), from two characters, one search taken from the minute's budget and kept a
  minute; over the budget, those known answer with a note), and names the owner typed when GitHub has it; ↓/↑ move through what's found, Enter
  opens the first, Esc clears it. A star on a repository's row, an owner's head or an owner found (S, ⌘K) stars it; stars are the app's own, kept in the data
  directory's `settings.json` as `githubStars` (`web/server/github/stars.ts`, `POST /api/github/m/star`; the file's other keys kept, an
  unreadable file never overwritten). As Conquer's, the sidebar's inner edge resizes it and ⌘S hides or shows it (`github:sidebarHidden`
  in localStorage; ⌘K "Show or hide the GitHub sidebar"; the page takes the key while GitHub shows), whatever shows beside it.
  A repository's PRs (the `repo` place; `GET /api/github/q/prs?repo=&state=&author=&reviewer=&assignee=&review=&draft=&checks=`,
  50 newest) show with filters (`RepoFilters.tsx`, `filters.ts`: Filter (F) and chips under the head): state
  (open by default, closed, merged), author, reviewer and assignee (any of several people, `@me` being you, comma-joined; each offers you first, then
  the repository's recent PR authors, then its assignable users, with avatars, searchable by login or name: `GET /api/github/q/people?repo=`,
  `readPeople`, one GraphQL query of `assignableUsers` and recent PRs' authors, kept five minutes), review (required, approved, changes requested),
  draft or ready, and CI (passing, failing, pending), kept per repository in localStorage (`readRepoFilters` in `place.ts`; the old one-value author
  filter becomes `["@me"]`); ⌘K opens each repository, sets each filter and opens each people filter's picker. GitHub's search can't OR people, so
  each person (and a reviewer's two qualifiers, `review-requested:` and `reviewed-by:`) is one more search (`filterQueries`), asked in one GraphQL
  request and merged, at most 6 together (the picker says so past it; the server refuses more).
  Searches keep under GitHub's 30 a minute (`searchSlot` in `client.ts`, 25 for the tab; over it a cached list answers again).
  A PR (`PrView.tsx`): Conversation (its description always first, then a "Comments · N" head holding the Newest first / Oldest
  first toggle, then the comment box and the comments and reviews newest first, or oldest first as GitHub lists them with the box at
  the foot: the toggle and ⌘K, one setting for every PR, `github:conversationOrder` in localStorage; only the comments move, a review's
  own comments keeping their order; a posted comment shows in its place and scrolls into view), Files changed (the review), Commits, Checks.
  Line comments show in the Conversation as GitHub's do (`conversation.ts`, `conversationOf`; `ThreadView.tsx`): each review holds the threads
  it started (its threads' first comments' `reviewId`), with a Fold / Show N conversations toggle on its head (unfolded by default); a review of
  single comments only (no summary) gives way to its threads, each at its own place ("commented on a line"), as do threads whose review isn't
  among those read; a review of replies only isn't an entry (its replies are in their threads); "Comments · N" counts the entries. A thread:
  its path (a click, or View in Files changed, opens Files changed scrolled to it, its file unfolded and the thread opened and marked:
  `DiffViewHandle.showThread`), its line(s) (`threadLines`: an outdated one's where it was left), Outdated and Resolved badges, a few lines of
  its comment's `diffHunk` drawn by @pierre/diffs unified (`threadHunk`: its range's, else the last 4; `hunk.ts` `tailHunk` counts the header
  again), its comments, Reply (shown at once, taken back with a notice if GitHub refuses) and Resolve / Unresolve (`ThreadBody`, shared with
  the diff's threads). Resolved threads fold ("Show resolved"); ⌘K "Show resolved conversations" / "Fold resolved conversations" and "Fold every
  review's line comments" / "Show every review's line comments" (`github-threads`), only while they apply. The `q/pr` read asks each thread's
  `originalLine`, `originalStartLine`, `subjectType` (on the file), its first comment's `diffHunk` (the server keeps its last 40 lines,
  `HUNK_KEEP`) and each comment's `pullRequestReview { id }`, in the same query; threads are paged by 100 (`THREADS_QUERY`) to `MAX_THREADS`
  (300), `threadsTotal` and a banner saying when there are more, and a thread's 50 comments say how many more GitHub has (`totalComments`).
  Bodies (the description, comments, reviews, line comments and replies) show as GitHub renders them: the `q/pr` read asks each one's
  `bodyHTML` in the same query (images through camo; the Markdown kept beside it as `body`, for editing and the fallback), and
  `Body` (`bits.tsx`) draws it after `sanitizeGithubHtml` (`web/src/github/html.ts`) cleans it again: a DOM-free allowlist, so the
  server's tests run it too (GFM's HTML: tables in a scrolling frame, images only from GitHub's hosts, lazy and fitting the column,
  `<details>`, `<kbd>`, `<sub>`/`<sup>`, task lists, alerts with their icons, highlighting's `pl-*` classes; never scripts, styles,
  handlers, frames, forms, non-web URLs or the app's classes; ids only GitHub's `user-content-`; comments dropped). Its links open as
  others do (a PR in the tab, a Linear issue in Linear's desktop app, others in Conquer; footnotes scroll). Without HTML (over 400 KB, a draft,
  Preview) the Markdown is drawn, hidden comments on lines of their own left out. Styled in `github.css` (`.gh-html`).
  Its header shows Open Paseo agent while a Paseo workspace, on any host, has the PR's branch checked out (`paseo.ts`, `paseoMatches`,
  over the page's fleet: the PR Paseo names for the workspace, else the workspace's branch and remote against the PR's head ref and
  head repository, `headRepo` in `q/pr`, a fork's for a PR from one, never the base's; a workspace Paseo names another PR for doesn't
  match by branch). It selects the workspace's most recent agent (a working one counts as now; listed subagents and archived ones
  aside; the workspace itself without one) and switches to Command (`postAppMenu("command")`); with several, a menu chooses
  (host · project · workspace, `OpenPaseo.tsx`). Without a match nothing shows. ⌘K "Open the Paseo agent for this pull request"
  (one entry per match, each naming its place when there are several), only while one exists.
  Open in agent (beside it, open and draft PRs; ⌘K "Open the pull request in a new agent…", `github-open-in-agent`) opens New agent
  for the PR (`DispatchTarget.pr`, main's `openPrInAgent`, showing Command): Worktree on the PR's head branch (`pr`, `prHead` in the
  dispatch), on the first host with a checkout of its repository (a project's repository is its workspaces' `repo`), else a new pool
  box when the boxes' checkout is that repository (`PoolStatus.repo`, `GITHUB_ORG/GITHUB_REPO` in paseo-boxes' `config.env`); the
  host, an asleep pool box or a new one is chosen there. A checkout known to be another repository is refused ("… is X, not Y").
  The Conversation's side panel (`PrSide.tsx`): Reviewers (people and teams asked, and who reviewed with their latest verdict, avatars;
  never the author) and Assignees, each with a gear opening a picker (the `q/people` read, you first, searchable; reviewers also the
  repository's teams, `GET /api/github/q/teams?repo=`, `readTeams`, REST `repos/:repo/teams`, none when the token can't list them) to
  request or remove reviews and assign or unassign; a row re-requests a reviewer's review or removes a request or an assignee
  (`POST /api/github/m/reviewers` over REST `requested_reviewers`, `m/assignees` over `issues/:n/assignees`, `action` add or remove,
  each login and team slug checked); shown at once, put back with a notice if GitHub refuses (`withReviewers`, `withAssignees`);
  ⌘K "Request review…" (open PRs) and "Assign…". Merge (`MergeBox.tsx`, `merge.ts`), GitHub's merge box: merged by whom, closed, or each
  thing blocking it (draft, conflicts, behind, changes requested, review required, checks failing or pending, else the base branch's rules;
  failing checks that aren't required only warn), auto-merge (its method, who turned it on, when) and the merge queue (position, state), then
  a button for each action that applies (`mergeActions`): only where it applies and the token may, from the `q/pr` read's `merge`
  (`PrMerge`, `mergeOf` in `reads.ts`: `mergeStateStatus`, the allowed methods, `viewerCan…`, `autoMergeRequest`, the queue,
  `deleteBranchOnMerge`, GitHub's default commit text per method). The allowed methods are the repository's (`mergeCommitAllowed`…) that
  the base branch's rules allow too (`readBranchRules`, REST `rules/branches/:base`, one request in the PR read and its cache;
  `ruleMethodsOf`: each `pull_request` rule's `allowed_merge_methods`, intersected, and no merge commit under `required_linear_history`),
  as GitHub's own merge box offers them; when none is allowed, or the rules can't be read, `methodsNote` says so (a blocker, or a warning
  beside the repository's methods), never a default merge. `m/merge` and `m/autoMerge` refuse any other method. The header has the main one
  beside Review (a split button named by its method, "Squash and merge", whose ▾ picks among several, else Merge when ready, Auto-merge,
  Remove from queue, Disable auto-merge, Ready for review, a disabled one saying why, Reopen, Delete branch) and ⋯ listing them
  all, on the tabs' row with Open Paseo agent and the diff stat. Its controls are the pages' `.page-btn` set (`pages.css`: one compact
  height, quiet outlines, `.solid` for the one primary): Merge is filled only once it can merge (`mergeLeads` in `merge.ts`), else Review
  is, and an administrator's merge past unmet requirements says "(bypass)". The Merge section lists the actions as small quiet buttons
  with short labels (`shortActionLabel`; ⋯ and ⌘K keep `actionLabel`'s). Merge and auto-merge confirm in a panel beneath: the allowed methods (the last used per repository while still allowed, else the
  first; `github:mergeMethod` in localStorage), the commit title and message for merge and squash (GitHub's,
  editable), delete the branch after merging (offered where the token may and the repository doesn't already; remembered,
  `github:deleteBranchAfterMerge`), and for an administrator past unmet requirements the reasons and a bypass box; ⌘↩ confirms. Close
  confirms in a panel with an optional comment, posted first. Update branch merges or rebases when behind. Writes (`POST /api/github/m/merge|autoMerge|queue|ready|updateBranch|state|deleteBranch`,
  GraphQL mutations by the PR's node id at the head read, `expectedHeadOid`; `deleteBranch` reads the PR itself and deletes only its head
  branch once merged or closed, where `viewerCanDeleteHeadRef`): ready/draft, auto-merge off, the queue, reopen shown at once and put back
  with a notice if GitHub refuses; a merge, close and update branch wait for GitHub's answer. Afterwards the PR, the lists and counts are
  asked again, and the server forgets its lookups of the PR (`forgetPullRequest` in `links.ts`) and the page its (`resetLinkCache`), so
  the header chip, the map's medallions and auto-merge seal follow as soon as Paseo's or GitHub's facts do. ⌘K has each (`github-merge`,
  a merge and auto-merge once per allowed method), only when it applies. Then Checks: the count, then each check run and status, failing, then pending,
  then passing and skipped (folded behind "Show N passing" past five), with its workflow or app, how long it took (or "running for …")
  and its details opening as links do (Conquer). The diff
  (`DiffView.tsx`): files by directory beside it (its inner edge resizes the list, `ResizeEdge`: drag, ←/→, double-click for the default;
  `github:diffListWidth` in localStorage, one width for every diff; the diff keeps 420 px, the list hiding when there's no room for both;
  full paths on hover; "Filter files…" at its head, T or ⌘K, fuzzy on paths (`fuzzyPath`, `filterFiles` in `diffSearch.ts`), narrows the
  tree to what fits, its directories kept, the matched characters marked and "12 of 49"; ↑/↓ pick (the best fit first), Enter shows it, Esc clears),
  each row counting its file's comments; above it a Files / Comments switch (⇧C, ⌘K "Show the diff’s comments" / "…files", `github-diff-sidebar`,
  `files-diff-sidebar`; kept per diff kind, `github:diffSidebar:pr|changes`, `useDiffSidebar` in `DiffComments.tsx`): Comments (`DiffComments.tsx`,
  pure model `commentList.ts`: `noteGroups`, `shownGroups`, `stepNote`, `plainSnippet`) lists every thread by file in the diff's order, by line (on a PR
  GitHub's threads and your review's drafts, marked Draft; on Changes the pending comments, outdated ones included), each with its line(s), avatar and
  name, the first comment's opening as plain text (two lines), its reply count and state; resolved and outdated ones dimmed behind "Show resolved (N)",
  outdated labelled; with none, "No comments yet" and the gutter's + as the hint. A click shows it in the diff (`showNote`, as the Conversation's
  View in Files changed: the file unfolded, the line drawn through the virtualizer, a resolved thread opened, marked a moment, `gd-flash`); the list
  marks the one in view (`noteInViewOf`: nearest a third down the view; the one just shown kept until the diff is scrolled away) and follows it.
  N / ⇧N step through the shown ones, wrapping (`DiffViewHandle.stepComment`; ⌘K "Next/Previous comment in the diff", `github-next|prev-comment`,
  `files-diff-next|prev-comment`, only while there are some: the views' `comments` count),
  Find in the diff (⌘F while a diff shows, the page taking the key ahead of the browser's; ⌘K "Find in the diff"; `DiffFind.tsx`): a strip over the
  diff searching every file's added, removed and unchanged lines from the parsed diff (`findInDiff`, `shownLines`: folded and not-yet-drawn files
  too; case-insensitive unless Aa, a regular expression with .*; at most 5,000), "3 of 27", Enter / ⇧Enter and its arrows step (wrapping; a new
  search starts at the file in view, a refresh keeps the match), stepping unfolds the file and scrolls the virtualizer until the line is drawn
  (`revealMatch`); the drawn matches are marked in each file's shadow root with the CSS Custom Highlight API (`gd-find`, the current one
  `gd-find-current`, styled through FileDiff's `unsafeCSS`), in a split on their side (an unchanged line on both); Esc closes it and clears them.
  Each file drawn by @pierre/diffs (`FileDiff`, from the parsed file as patch text,
  `patchOf` in `rows.ts`; Shiki highlighting, word-level changes, unified or split, its pierre-dark/-light theme by the app's; highlighted in a pool of web workers, `diffWorkers.tsx`, with `worker: { format: "es" }`
  in `vite.config.ts`, and drawn only where in view, its `Virtualizer` being the diff's scroller; a refresh keeps unchanged files'
  objects (`useStableFiles`) and each diff's `cacheKey` is its text, so nothing is drawn or measured again, and `useDiffAnchor`
  (`diffAnchor.ts`, `overflow-anchor: none`) keeps the first line in view in place while what's above it changes height), big and
  viewed files folded; in a review its gutter utility's + takes a comment (drag across lines for a range):
  into your pending review (`drafts.ts`, localStorage per PR until sent or discarded) or at once (Add single comment); threads sit under
  their lines (its line annotations, slotted, so our components and CSS draw them) with Reply and Resolve; Viewed per file. Review opens Finish your review: a summary and Comment, Approve or Request changes
  (only Comment on your own PR), sent with the drafted comments at the head read.
  On a workspace's Changes diff (the Files tab's, below; `DiffReview.local`: no Viewed, never GitHub) the same + takes a comment as that workspace's pending
  comment (`web/src/github/localComments.ts`: path, side, line or range, the lines' text, the comment, when), kept by the server in the
  data directory's `diff-comments.json` keyed `<host>|<workspace>` (local host ""; `web/server/diffComments.ts`, `GET
  /api/diff-comments?workspace=&host=`, `POST /api/diff-comments` with `action` add|edit|remove|move|apply|discard, written atomically,
  keeping unknown keys and fields; a damaged file is never overwritten), never in the worktree, so git stays clean. They hang under
  their lines, editable and deletable; each refresh re-anchors them (`placeComments`: in place while their lines read the same, else the
  nearest place on their side where they do, the move saved; else outdated, listed above the diff); the head counts them ("3 pending
  comments"). The page shares them through `localCommentsStore.ts`. The chat of an agent in that workspace shows "N pending comments ·
  Apply" above its composer (`web/src/composer/PendingComments.tsx`): its list reviews them (each removable, Discard all, Show the
  changes: the Files tab's Changes, as ⇧⌘G); Apply sends one message through the chat's send (queued while the agent works; `applyMessage`: an instruction, then each
  as `path:line` or `path:a-b`, its lines quoted, the comment), then marks them applied (`appliedAt`, kept as history, hidden from the
  diff and counts). ⌘K (the open agent's, page Command): "Apply pending diff comments (N)", "Show pending diff comments", only while
  there are some (`diff-comments-apply|show`). Places (`place.ts`, kept in localStorage; `openGithubPlace`
  opens one from elsewhere; a remembered or asked-for `{kind: "changes"}` place, the old Changes', goes to the Files tab's Changes instead,
  `redirectChanges`) and PR links: `github.com/<owner>/<name>/pull/<n>` opens in the tab wherever clicked (`prPlaceOf`;
  `WorldWindow.pageMode` matches it). Keys (`GitHubView.tsx`): J/K move (a diff's files), Enter/O open, Esc back, 1–4 PR tabs, R review,
  C comment, V viewed, U unified/split, F file list (a repository's filters), T filter the diff's files, ⌘F find in the diff, ⇧C the diff's Files / Comments, N / ⇧N its next / previous comment, S star the repository; each with its ⌘K entry and the shortcuts dialog's GitHub group.
  ⇧⌘C (`GitHubView.tsx`, a window listener, as ⌘S) copies the shown place's github.com address (`placeLink` in `place.ts`: a PR's
  `…/pull/<n>` on any of its tabs, a repository's list its `…/pulls`; the scope lists have none and leave the key) with the
  "Link copied" notice, through `copyText` (the app's clipboard in the macOS app); not while typing in a field or under a dialog.
  ⌘K "Copy the pull request’s link" / "Copy the repository’s pull requests link" (`github-copy-link`). No app key, menu item or
  Conquer command has ⇧⌘C (Edit → Copy is ⌘C only), so the web view hands it to the page; `AppKeysTests` checks it stays free.
  Credential (GitHub's, for the tab, Activity and every PR lookup; the app never runs gh): a classic personal access token,
  `githubToken` in the data directory's `secrets.json` through `integrationKey("github")` (only while GitHub is on; never the
  environment), with the scopes `repo`, `notifications` and `read:org` (`web/src/githubToken.ts`). Settings → GitHub has its editor and
  "Create a classic token on GitHub" (`GithubTokenSetup.tsx`; ⌘K "Create a classic GitHub token"), which opens GitHub's New token page
  with those scopes ticked; the tab's sidebar names any the token lacks (`missingScopes`, from `X-OAuth-Scopes`). `web/server/githubApi.ts`
  (`githubRest`, `githubText`, `githubPaged`, `githubGraphql`; `GITHUB_API.fetch`, faked by `githubFake.ts`'s `installGithubApi`) makes
  every GitHub call; with GitHub off or no token, PR lookups (`links.ts`, `probe.ts`, `prLabels.ts`) quietly answer unknown.
  Server (`web/server/github/`, over `web/server/githubApi.ts`): named reads (`reads.ts`, `GET
  /api/github/q/viewer|prs|repos|repoSearch|people|teams|pr|diff`, cached 15 s, `fresh=1` past it; `GithubUnavailable` when off, without a token, refused or rate limited) and
  whitelisted writes (`writes.ts`, `POST /api/github/m/comment|review|reply|resolve|viewed|reviewers|assignees|merge|autoMerge|queue|ready|updateBranch|state|deleteBranch|star`, each field checked), over `client.ts`. Tests never reach GitHub: `fake.ts` under server tests (`test-setup.ts` makes `GITHUB_API.fetch` refuse
  otherwise) and `web/e2e/github.e2e.ts` in the browser.
- Files (the mode bar's tab after Command, always shown; View menu, its item and View → Show Files ⇧⌘E offered the menu from anywhere by
  `AppKeys.offeredToMenu`, Conquer having no ⇧⌘E; ⌘K "Show files"; in a browser ⇧⌘E only says the tab is the macOS app's): the selected workspace's
  (or the selected agent's) files, read only, drawn by the page (`web/src/files/FilesView.tsx`, `files.css`, borrowing `github.css`'s sidebar, heads,
  empty states and the diff's find strip and scroller) while the app reports `paseo:mode` `files`. The sidebar is the tree (`tree.ts`, pure: `treeRows`
  over each open folder's listing, read as it opens; `filterRows`; `rankPaths`): directories first, by name; `.gitignore`d entries and `.git` hidden
  until its eye button (or ⌘K) shows them dimmed (`files:showIgnored`); changed files dotted (and their folders). "Filter files…" (T, ⌘K) is fuzzy
  (`fuzzyPath`, as the diff's file filter) over every path, the tree narrowed to what fits with its folders, names marked, "N of M"; ↑/↓ pick, Enter
  opens, Esc clears. In the tree ↑/↓ (J/K), →/← open, close or go in or up, Enter opens; hovering (or the keyboard reaching) a file reads it ahead.
  ⌘P (the page takes it while Files shows; ⌘K "Go to file…") quick-opens any file by name, the recently opened first while nothing's typed. Its inner
  edge resizes the sidebar (`files:sidebarWidth`) and ⌘S hides it (`files:sidebarHidden`). Opened files are tabs above the viewer, as an editor's (`FileTabs` in
  `FilesView.tsx`; the model is pure, `web/src/files/tabs.ts`): a click in the tree, the filter or ⌘P opens a preview tab (italic; the next preview
  takes its place), a double-click (in the tree or on the tab) or using the file (a wheel, click or key in it, find) keeps it; tabs drag to reorder,
  show the name with as much of the folder as tells clashing names apart (`tabLabels`), the changed dot and ×; a middle-click closes; the row scrolls
  sideways and keeps the shown tab in view. ⌘W closes the shown tab while Files shows (none open: nothing): in the macOS app View → Close File Tab
  (`AppKeys.addCloseFileTab`, offered the menu ahead of the views by `AppKeys.offeredToMenu` only while Files shows; the View menu comes before
  Conquer's disabled Close Tab, which elsewhere takes ⌘W and does nothing, as before; the window's Close never has it there) asks the page's
  `files-close-tab`; in a browser ⌘W is the browser's, so ⌃W too. ⇧⌘T reopens the last closed (pinned), ⌃Tab / ⌃⇧Tab and ⌥⌘→ / ⌥⌘← step, wrapping
  (the page takes them; Conquer's are disabled while it hasn't the keyboard). ⌘K: Close the file's tab, Reopen the closed tab, Next tab, Previous
  tab, Close other tabs (`files-close-tab|reopen-tab|next-tab|previous-tab|close-other-tabs`), each only when it applies. Each workspace (host
  and workspace) keeps its open folders, its tabs with each one's scroll (put back when the tab shows), the shown one (`file`), the closed ones and
  recent files (`files:workspaces`, 40 workspaces; `web/src/files/kept.ts`). The file shows in @pierre/diffs's `File` (its single-file renderer) under its `Virtualizer` (only the
  lines in view drawn), highlighted in the diffs' worker pool (`DiffWorkers`) in their themes, with line numbers; ⌘F (`files-find`) finds in it with
  the diff's `FindBar`, marks and `revealMatch` (`findInText` in `diffSearch.ts`: a file's lines are keyed `R<n>` as `File` draws them). Its head
  (`.page-head`, `.page-btn`): the path, size and lines, Changed's badge, Show changes (a changed file: Changes, below, all changes, scrolled
  to the file), Copy path, Find, Reload. Binary files, images and files over 1 MB
  (`FILE_LIMITS`) are refused politely. Asked again every 15 s while shown. Long lines wrap by default (`File`'s `overflow: "wrap"`,
  each line's number on its first row; the virtualizer measures wrapped lines and `useDiffAnchor` keeps the first line in view in place as
  they're drawn): the head's Wrap toggle and ⌘K "Wrap lines" / "Don’t wrap lines" (`files-wrap`, `files:wrap`). Markdown (`.md`, `.markdown`,
  `.mdx` as plain Markdown) opens rendered (`web/src/files/MarkdownPreview.tsx`): react-markdown with GFM, code blocks highlighted as the
  chat's (`CodeBlock` from `Markdown.tsx`), the chat's `.md` look at the pages' sizes in a reading column (`.fv-md` in `files.css`; its code
  blocks wrap with the toggle); HTML in it rebuilt from an allowlist by a rehype step (`markdownHtml.ts`: `<details>`, `<kbd>`, `<br>`,
  aligned `<p>`, `<img>`…, checked attributes only; never scripts, styles, frames, forms, handlers, ids, classes), which also gives headings
  GitHub's anchors (`data-anchor`) and elements their source line (`data-line`, the line in view for the editor). Links and images resolve
  in `web/src/files/markdown.ts` (pure, `markdown.test.ts`): a relative or `/`-rooted path against the file's folder, never out of the
  workspace, opens in Files (a file as a kept tab, at `#L12`/`#L12-L20` in its source or a `#heading` in its preview; a folder in the tree),
  `#heading` scrolls, http(s) and mailto open as links do (a PR in the GitHub tab, a Linear issue in Linear, others in Conquer; a browser
  tab outside the app), any other scheme stays text. Images: the workspace's PNG, JPEG, GIF and WebP through `GET /api/files/image?workspace=&host=&path=`
  (`filesImage` in `web/server/api/files.ts`: by name and first bytes, never SVG, at most `FILES.maxImageBytes` 10 MB, `checkPath`ed, the
  daemon keeping it in the workspace, `nosniff`), https ones through the chat's bounded loader (`loadImage`), each once near the view;
  others a labelled placeholder. The head's Preview / Source toggle is kept per Markdown type (`files:markdownView`, only the types set to
  source), with ⌘K "Show the Markdown source" / "Show the preview" (`files-markdown-source|preview`); a Markdown file opened at a line
  (a chat link, `#L12`) shows its source there until the toggle's used. ⌘F in the preview finds in the rendered text (`findInPieces`:
  across a block's text nodes, never between blocks; a match in a closed `<details>` opens it), marked with the CSS Custom Highlight API
  under the diff's names (their colours in `files.css`, as the page's own). In editor mode the tab's View shows the preview. The page's reads (`web/src/files/api.ts`, a store
  by path) come from `web/server/api/files.ts`, through the workspace's host's daemon (its file explorer: `listDirectory`, `readFile`, so remote
  hosts work; `getCheckoutDiff` for the changed files): `GET /api/files/tree?workspace=&host=&dir=` (entries marked `ignored` by the `.gitignore`s on
  the way down and `.git/info/exclude`, read through the daemon and matched by `web/server/files/gitignore.ts`; global excludes aren't read),
  `GET /api/files/read?…&path=` (text, or `refused`: binary, image, large; a size known from the folder's listing refuses unread),
  `GET /api/files/all` (every file not ignored, walked breadth first, at most 25,000 files and 4,000 folders, `capped`), `GET /api/files/changed`,
  `GET /api/files/image` (above);
  each kept a few seconds (`fresh=1` past it). Paths are relative: absolute, `~`, `..`, `.`, empty segments, backslashes and NULs are refused before
  the daemon is asked (`checkPath`), and the daemon refuses what resolves outside the workspace (symlinks out). It never writes. Tests: `files.test.ts`
  (over the fake daemon's `trees`), `src/files/tree.test.ts`, `src/files/markdown.test.ts`, `src/files/markdownHtml.test.ts`, `e2e/files.e2e.ts`; `native/scripts/fake-server.ts` has a tree and a branch diff for `wks_main`.
  Files in the user's editor (Settings → Files, "Open files in": Built-in viewer, the default, or Editor command, `nvim {file}` by default; `{line}`
  too; kept as `files: {openIn, editorCommand}` in the data directory's `settings.json`, the file's other keys kept, an unreadable file never
  overwritten; `web/src/files/filesSettings.ts`): `web/src/files/editorCommand.ts` (pure, shared) checks the command (`editorCommandProblem`: one line,
  `{file}` needed, only `{file}`/`{line}`, never inside quotes) and builds what runs (`editorLaunch`: `/bin/sh -c 'exec "${SHELL:-/bin/sh}" -l -i -c "$1"'`
  with the command as that argument, so the host's login shell, its PATH, rc files and LSP setup, runs it; the path single-quoted (`shellQuote`), a
  leading `-` made `./-…`, the line a number), so no file name becomes shell syntax. `POST /api/terminals/editor {workspace, host?, path, line?}`
  (`createEditorTerminal` in `web/server/api/terminals.ts`) creates a daemon terminal with that `command`/`args` in the workspace's folder (the
  command from the settings file only, the path checked by `checkPath`); it ends when the editor quits; listed with `editor: true` while the server
  runs, which the Terminal tab leaves out of its tabs. With the command set, in the macOS app, opening a file (tree, ⌘P, a tab, Changes' Open in
  Files) opens it in the editor, which pins the tab; each tab keeps its own terminal (`editor` in the tab, `web/src/files/tabs.ts`, kept in
  `files:workspaces`), alive while the tab exists, the Files page shown or not. The page draws a box in the viewer's place (`EditorSlot` in
  `FilesView.tsx`) and tells the app (`web/src/files/editorBridge.ts`: `editor` with the terminal and the box's frame, sent as it changes, polled
  every 250 ms for moves, `covered` while a dialog is open, `MODAL_EVENT` in `focus.ts`; `editorFocus`; `editorClose`; `editorForget`); the app
  (`EditorOverlay.swift`, SwiftTerm through `TerminalSession`, the Terminal tab's text size and `Ink` tones; `EditorEmbed.swift`: `EditorPlacement`,
  `EditorStage`, its frame through the web view into `content`, as Conquer's, shown only while Files shows; `EditorKeys`;
  `EditorCloseRequest`) lays the terminal over it and gives it the keyboard as it shows or is clicked. Keys there: the app keeps the window's
  (⌘1…⌘6, ⇧⌘G, ⇧⌘E, ⌘W: Close File Tab; not ⌘R, which refreshes nothing there) and the menu's (⌘`, ⌃`, ⌘C/⌘V as the terminal does, the terminal text size); ⌘K opens the page's
  palette (`AppWindow.performKeyEquivalent`, the Terminal tab's terminal too) and the keyboard comes back as it closes; everything else is the
  editor's. Closing tabs whose editors run (×, ⌘W, Close other tabs) asks once (an NSAlert sheet; Cancel keeps them), then ends them on the
  daemon. An editor that quits (`exited`) leaves its tab in the viewer with Reopen in editor; a relay that went (`lost`) is checked against
  `GET /api/terminals`. The head's View / Editor toggle (the macOS app's) shows the viewer over a running editor, or opens the editor at the line
  in view; ⌘K "Open in editor" / "Open in viewer" (page Files, `files-open-editor|viewer`) only when they apply. In a browser the viewer stays,
  with a note. Tests: `src/files/editorCommand.test.ts` (quoting through a real `sh`), `server/api/terminals.test.ts`, `src/files/tabs.test.ts`,
  `e2e/files-editor.e2e.ts`, `native/tests/EditorEmbedTests.swift` (frame following, key routing through `AppWindow`, the close question);
  checks: `editor` in the `--info` state, hooks `editortype`, `editorclose`, `editorcancel`, `editorfocus`, `key` (`CheckKeys`); the fake daemon
  runs a `command` terminal as a fake editor that quits on `:q`.
  Changes (`web/src/files/ChangesView.tsx`, no GitHub needed): the workspace's branch against its base from its host's daemon (`getCheckoutDiff`,
  so remote hosts too; `GET /api/changes?workspace=&host=&mode=all|base|uncommitted`, `web/server/api/changes.ts`, not gated on any
  integration), all changes, committed or uncommitted (`github:changesMode`), with ahead/behind, the diff (`DiffView`: Filter files, ⌘F find,
  unified/split and the file list, one setting with the GitHub tab's `github:layout`/`github:fileList`) and the workspace's pending comments
  (above); asked every 15 s while shown. With GitHub on, Review #N opens its PR in the GitHub tab (Files changed) and Compare on GitHub opens in
  Conquer; off, neither shows. It shows in the tabs' place, reached by the Changes button first in the tabs' row (`.fv-tabbar`, the changed-file
  count from `files/changed`), a view toggle outside the tab model rather than a tab: never closed (⌘W/⌃W close only file tabs, nothing while
  Changes show), not reordered or previewed, there with no file open; a file tab's click, ⌃Tab/⌥⌘→ (back to the shown tab) or ⇧⌘T go back to
  the files; whether it shows is kept per workspace (`changes` in `files:workspaces`). Files and Changes open each other: a changed file's dot in
  the tree (a button) and the head's Show changes open Changes at it (all changes); each diff file's Open in Files (`DiffView`'s `onOpenFile`)
  opens it as a kept tab. In Changes (not typing; the tree keeps its own keys): J/K/↓/↑ the diff's files, T its file filter, U, F, M, ⇧C Files / Comments, N / ⇧N the next / previous comment; ⌘K
  (page Files) has each (`files-diff-next|prev|layout|list|filter|find`, `files-changes-mode`). Opened from elsewhere by `openFilesChanges(path?)`
  (`web/src/files/open.ts`: kept as `files:openChanges` for the page to take as it mounts, and sent as `files-changes`), the caller showing
  the tab (`postAppMenu("files")`): the workspace view's Changes button and ⌘K "Show …'s changes against main" (page Files, the macOS app's) and
  ⇧⌘G from anywhere: in the macOS app View → Show Branch Changes, which `AppWindow.performKeyEquivalent` offers the menu ahead of the page,
  the terminal and Conquer's pages (`AppKeys.swift`) except while Conquer has the keyboard, where it stays Conquer's Find Previous, and which
  asks the page's `branch-changes` (`AppKeys.branchChangesCommand`); in a browser the page takes the key itself and, as with nothing selected,
  only says why. Tests: `e2e/changes.e2e.ts`, `e2e/diff-comments.e2e.ts`.
- Chat Markdown renders fenced `mermaid` blocks (`web/src/mermaid/`), in every conversation (Crew's drawer and the
  session panel). The engine loads near the viewport, with serialized strict-mode renders and each view's
  palette; its SVG is shown as an isolated image. Source/copy, zoom/reset and an expanded focus-trapped view have
  matching context-sensitive palette entries (`mermaidCommands.ts`, `mermaid-diagram` in `appCommands.ts`). An
  incomplete streamed fence waits, and invalid/oversized diagrams keep their source.
  Mermaid stays on the 11.x line for the app's older WebKit support; its KaTeX override keeps the patched trust checks.
  Tests: `web/e2e/mermaid.e2e.ts`.
- Visual replies (`web/src/visual/`, after T3 Code's): an agent answers with a page (a chart, table, diagram, collage, mockup) by
  writing a fenced `html-render` block holding a whole HTML document, first in its reply; the chat (the session panel, both map
  conversation views, a Markdown file's preview) draws it in a sandboxed frame instead of code (`CodeBlock` in `Markdown.tsx` →
  `VisualBlock.tsx`; a plain `html` block stays code). Agents know to because the app's standing system prompt says how
  (`web/server/agentPrompt.ts`, `<paseo_command_visual_replies>`: new agents and forks; agents made elsewhere draw one when asked for an
  `html-render` block). The app has no MCP server of its own to publish through, so the page lives in the reply's text and needs no storage.
  `page.ts` (pure, `page.test.ts`) builds the frame's document (`visualDocument`): first in it, ahead of anything the agent wrote, a
  Content-Security-Policy (`VISUAL_CSP`: inline code and https resources only, so never the loopback API; no frames, forms or `<base>`),
  the theme and a bootstrap script. The frame is `sandbox="allow-scripts"` without `allow-same-origin` (an opaque origin: no parent,
  cookies or storage; in a browser also `allow-popups` so links open a tab). The page gets the app's tokens, as they read where the block
  is drawn, under T3's variable names (`visualTheme`: `--background`, `--foreground`, `--card`, `--border`, `--primary`, `--accent`,
  `--destructive`, `--warning`, `--success`, `--chart-1…6`, `--radius`, `--font-sans|mono`…), posted again when the theme changes, so it
  follows light and dark without reloading. The bootstrap reports the page's height (the frame fits it, 60–4,000 px; a page sized in `vh`
  gets a fixed 480 px and scrolls, `usesViewportHeight`), hands web link clicks to the app (`postAppLink`: Conquer, a PR in the GitHub
  tab) and hands back ⌘K, ⌘B and Esc the page didn't use. Messages are taken only from the frame's own window and read strictly
  (`readSize`, `readLink`, `readKey`). Local images named by absolute path (PNG, JPEG, GIF, WebP) are embedded as data: URLs through the
  chat's bounded image loader (`embedImages`; on another host they can't be read, and the block says which). A page that navigates
  itself away (a second load) is stopped, with Show it again. It has no banner or title bar over the page (the user's call: the page
  is its own heading; the block is named by the page's `<title>` only for assistive tech): two quiet buttons show over its upper-right
  corner on hover or focus (`.visual-tools`: Show HTML / Show the page, and full screen: a second frame of the page filling a
  focus-trapped dialog, which keeps a bar for its title, zoom and close; Esc closes). Zoom (the page laid out narrower and drawn
  larger) and copying the HTML are in ⌘K, through the registry shared with Mermaid (`mermaidCommands.ts`, `page: true`); ⌘K "Show the visual reply's HTML" / "…page",
  "Expand the visual reply", "Zoom in on / out of the visual reply", "Reset the visual reply's zoom", "Copy the visual reply's HTML"
  (page Command), only while one is in view. A block still streaming shows its source until its fence closes; over 512 KB it stays
  source. Not done, unlike T3's: no headless-browser preview for the agent, and no MCP apps. Tests: `src/visual/page.test.ts`,
  `e2e/visual.e2e.ts`, `server/agentPrompt.test.ts`.
  Published with a tool, where the host's daemon has the `visual-replies` plugin (github.com/owenconti/paseo-cc-plugins, installed per
  daemon as `host-stats` is; `paseo plugin install github:owenconti/paseo-cc-plugins:plugins/visual-replies`): its `agent.open.before`
  hook gives every agent there an `html_render` tool (title, and `html` or the absolute `path` of an `.html` file), whoever created the
  agent; the tool's description carries the page rules, and the standing prompt tells an agent that has it to use it rather than the
  fence. The plugin checks the page on the agent's host (a real `.html` document, no `vh`, local images embedded by their bytes, so a
  remote host's images work), keeps it in `<paseo home>/plugin-data/visual-replies` (the newest 500) and answers with its id
  (`structuredContent.visualReply`). `web/server/visual.ts`: `shapeTimeline` marks a completed call (`publishedPage`: a tool named
  `…html_render`, the id from the call's output wherever the provider put it, else from its text) as `visual: {page, title}` on the tool
  row, without its HTML; `GET /api/visual?id=&host=` reads the page from that host's plugin (`invokePluginRpc` `page.read`, the id
  checked, 15 s, 25 MB). The page draws it in the call's place as a block of its own (`toBlocks` kind `visual`, `PublishedPage.tsx`:
  read once and kept, Try again if the host can't answer; then the same `VisualBlock`, `prepared`, named by the call's title). A running
  or refused call stays an ordinary tool row.
  Tests: `server/visual.test.ts` (over the row a real daemon gave), `e2e/visual.e2e.ts`; the plugin's own in its repository.
  In the macOS app the window's navigation policy (`WorldWindow.swift` `decidePolicyFor`) cancels everything off the app's origin, so it
  allows a frame's inline document by name (`WebOrigin.inlineFrame`: `about:srcdoc`, never in the main frame; `WebOriginTests`): without
  it the frame stays blank (0.31.0 shipped so; Chrome's tests can't see it). A page's frame going anywhere else is still cancelled there.
  Check a page in a copy of the app (`--info`, `.eval`, `.windowshot`), not only in the browser tests.
- Mentions in the chat link themselves (`web/src/autolink.ts`): in an agent's conversation (`Timeline` provides `Autolinks` from
  `useAutolinks` in `web/src/autolinkStore.ts`), its replies (`Markdown.tsx` adds `remarkAutolink`, a remark step over text nodes) and
  your messages (`autolinkRuns`), but not tool output. Linear keys only of the Linear workspace's teams (`GET /api/linear/teams`, asked
  once per five minutes while Linear is on; never a bare `[A-Z]+-\d+` guess) link to `https://linear.app/<urlKey>/issue/<KEY>`;
  `#123`, "PR #123", "pull request (#)123" to the workspace's repository (`repoOf` its remote, else its PR's), `owner/repo#123` to that
  one, as `https://github.com/<owner>/<repo>/pull/<n>`; without a repository they stay plain. Never in code, links, URLs or paths,
  nor "step #3", hex colours or leading zeros (`NOT_PR`). Paths to the workspace's files link too (`docs/report.md`, `src/a.ts:12`,
  `:12:3`, `:12-20`, `#L12`, `#L12-L20`; absolute ones inside the workspace's `cwd` made relative; inline code that is exactly a path,
  keeping its code look): only those in its `GET /api/files/all` list (`useWorkspaceFiles` in `autolinkStore.ts`, through the Files
  page's reads in `files/api.ts`, so one list per workspace, asked again five minutes on; `workspaceFiles`: a Set, and each file name
  only one file has), a bare name only when unique, in prose only with an extension; never in code blocks, URLs, `..` or `~`.
  Absolute paths outside that list link without waiting for it, including folders and inline code with spaces. Explicit Markdown
  file links (absolute, `file://`, `sandbox:/`, indexed relative paths and reference links) are resolved before URL filtering, so their
  labels remain clickable. Paths outside the index carry `data-file-reveal="true"` and "Show in Finder": `postAppReveal` sends
  `revealFile` to `WorldWindow.swift`, which reveals the local path with `NSWorkspace.activateFileViewerSelecting`. Remote-host paths
  carry `data-file-host` and show a notice instead of revealing this Mac's same-named file; plain browsers explain the app requirement.
  A file link is `#files:<path>` with `data-file-path`/`-line`/`-end` and the title "Open in Files"; the session's click
  (`openFileLink` in `Session.tsx`) sends `openFilesFile` (`web/src/files/open.ts`: kept as `files:openFile` for the page as it mounts,
  and `files-open-at`) and `postAppMenu("files")`: the agent's workspace (the one Files shows for it) opens the file as a kept tab
  (in the editor too when that's set), scrolled to the line and marked as a find's match is; in a browser a notice says the tab is the
  macOS app's. Tests: `src/autolink.test.ts`, `e2e/autolink-files.e2e.ts`, `e2e/world-chat.e2e.ts`.
  Only text is wrapped (it copies as written); other clicks take the link path below.
- Images in the chat named by absolute path (a screenshot an agent took, a file it read; `![…](/tmp/…png)`) load through
  `GET /api/attachments/image?path=` (`resolveImage` in `web/src/imageSource.ts`, the bounded loader in `imageLoad.ts`). A local
  agent's are read from this Mac (`server/attachment.ts`: prompt attachments and paths a local transcript gave, one descriptor,
  no symlinks or hard links); a remote agent's add `&host=<server id>` and are read through that host's daemon
  (`server/remoteImage.ts`: `readFile` with the file's folder as the root and its name as the path, so the daemon keeps the read
  in that folder; only paths that host's own transcript gave, `rememberTimelineImages(items, <server id>)`, or its prompt
  attachments; PNG, JPEG, GIF or WebP by their header, 20 MB at most; never this Mac's same-named file). Tests:
  `server/remoteImage.test.ts`, `src/imageSource.test.ts`.
- A conversation's context window (`web/src/ContextMeter.tsx`, pure `contextUsage.ts`): its header (Crew's drawer, or the side panel's
  beside the other tabs) shows a ring filling with the window and "476k / 1M · 48%", amber from 70% and red
  from 90%, from the daemon's `lastUsage.contextWindowUsedTokens` / `contextWindowMaxTokens` (`ContextUsedTokens`,
  `ContextMaxTokens` in `LastUsage`: `agentDetail` in `server/api/agents.ts`, `inspectOf` in `server/rows.ts`; live as the
  feed pushes the record); its tooltip (`data-summary`) gives the exact tokens and the last turn's in, cached, out and cost.
  Where the daemon doesn't report the window, the last turn's cost and output, as before. Tests: `src/contextUsage.test.ts`,
  `e2e/crew.e2e.ts`.
- Web links clicked in the chat (`.session`, `openInAppBrowser` in `web/src/Session.tsx`, `postAppLink` → the `openLink` message)
  switch to Conquer and open there as a new tab, once its tabs are restored (`whenStarted`).
- Main commits: in the GitHub page, choose a repository and Main commits (`web/src/github/MainHistory.tsx`,
  `GithubPlace` kind `commits`, optional `sha`). The repository picker stays in main history while switching repositories.
  It polls the selected repository's `main` every 15 s while visible. Arrivals offer Show latest commits without moving
  the reader; Load older commits uses a cursor pinned to the original head, so newer commits cannot shift pagination.
  Every history page is reachable. A commit opens its full message, author, date, parents and the shared read-only diff
  viewer; Back and Escape return to the retained list, then the repository's PRs. Place and last-seen head are kept.
  `GET /api/github/q/commits?repo=&head=&after=` and `commit?repo=&sha=` (`web/server/github/commits.ts`), under the existing
  GitHub integration and token, are named, validated read-only calls: GraphQL history (50 per page), REST commit metadata
  and diff. A missing main branch says why; an oversized diff is labelled partial. No daemon mutation or git checkout.
  Palette entries include repository histories, commit rows, older/latest pages, Back and external/copy links.
  Tests: `web/server/github/commits.test.ts`, `web/e2e/github.e2e.ts`.

- Links to a GitHub pull request (see GitHub, above) open in the GitHub tab while it's on, wherever they're clicked: the chat,
  a Conquer page (⌥-click stays there), a PR's body. The app matches them (`pageMode`, `routeLink` in `WorldWindow.swift`) and sends
  the page `paseo:link`; `web/src/appLinks.ts` (`parseAppLink`, the same shape) opens it. Links to a Linear issue or project
  (`linear.app/<workspace>/issue/<KEY>…`, `…/project/<slug>…`; the chat, a Conquer page, a PR's body, the header's issue chip and L,
  Activity's Linear items) open in Linear's desktop app when it's installed, else as other links do (Conquer; in a browser, a new
  tab): `LinearLink` (`native/Sources/PaseoCommandNative/LinearLink.swift`, tested by `native/tests/LinearLinkTests.swift`) maps
  the address to Linear's documented deep link, `linear://` and the rest of it (`linear://<workspace>/issue/<KEY>…`), and opens it
  only when Launch Services names an app for it (`NSWorkspace.urlForApplication(toOpen:)`); nothing is installed and no other app
  launched. Slack links are ordinary links (Conquer).

## Crew

Crew (`web/src/crew/`) is the only map (the user's call: the Islands, Overworld and Dungeon Board maps were removed, below).
It is the fleet as a chat app, drawn by the page itself on the Command tab, in a plain browser as in the macOS app
(main's `crewShown`: the Command tab, Settings not showing). It began as the user's ask for a simpler, more traditional
chat/AI interface that keeps the robots, their progress animations and the status medallions; then: no left sidebar,
grouped Host › Project › Workspace, larger nodes, the agent's browser, equal-height cells, what is open beside the map and
closed with Esc, the robot's strip above the message box; then that the session panel beside the other tabs be exactly
the component Crew's drawer is.

- The macOS app draws nothing in the map's place (its SpriteKit world is gone): `useMapBridge` (`web/src/mapBridge.ts`,
  always mounted) sets the Galaxy theme while dark (the pages' near-black palette keys on it) and tells the app `loaded`
  (the splash lifts), `workspace` (the Terminal tab's: the selected workspace or agent's) and `viewport`, the map's place
  in CSS px (`.native-world-frame`, posted as it resizes or moves: the panel opening, resizing or changing sides), which
  Conquer, the Terminal tab and the Files editors are laid over.
- The map (`CrewMap.tsx`, `.crew-board`, `buildRoster` in `roster.ts`, pure): "Your crew" with its counts, a filter (⌘K
  "Filter the crew…", `crew-filter`; Esc clears; by agent, workspace, project or host) and New agent; then each host (its
  head folds it; offline faded) › project (by name; a chevron folds it, its name opens the project) › its workspaces as
  panels in one grid of equal columns for every row (oldest first; `--crew-cols`, as many one-robot cards as fit,
  `columnsFor`, measured as the map resizes; each card spans as many columns as it has robots, at most all of them, never
  following its text's length; `grid-auto-flow: dense`; a row's panels one height, as are all nodes: a name keeps two
  lines' room). A workspace's head opens it and carries its CI, review, Probe and auto-merge medallions, each with a hover
  tooltip (`data-summary`: its name and `flagTip`'s facts, else its description; the seal `autoMergeLine`), and Archive
  beside it (shown on hover or focus; the app's confirmation, `openArchive`; a pool box's last workspace releases the
  box, src/poolArchive.ts). A claimed pool box's host head has Release (`.crew-head-action`, its confirmation;
  "Releasing…" while it runs), and such a host stays on the map with nothing on it (`buildRoster`'s `keepHosts`) so it can
  be released. Agents without a workspace sit in a dashed panel of their project's, or their host's. Each workspace holds
  its agents (oldest first) as large nodes (standing; under 960 px wide, `@container crew-board`, on their side): the robot
  (72 px) over its state's glow (pulsing for states that need you) with its mark (the running gear turning) and running
  drones (`subagentModels`' colours), its name, a dot and its state with its model, what it is doing while it runs
  (`workingOn`, shimmering) over a sliding bar, on a soft wash of its state's colour; nodes that need you are tinted, an
  unread reply has a gold dot. Projects and hosts without workspaces are left out; folds are kept in `crew:collapsed`. The
  arrow keys, Home and End move through the map's nodes and heads.
- What is open (`CrewDetail.tsx`: main's `detailView`, the agent's `Session`, a subagent's, New agent, a workspace, a
  project, Add project, with `ChatDecorContext` putting the robot beside each reply and in the working row, and
  `ChatFooterContext` the strip above the message box, `Stage` in `parts.tsx`: its robot, glow, mark and drones, its
  state, model and subagents, what it is doing with a progress bar, its workspace's chip and medallions, and (the macOS
  app's) its Browser button) shows in Crew's drawer, `.crew-drawer` on the map's right (440–760 px, 46% by default; under
  a 900 px window over the map), its left edge resizing it (`ResizeEdge`; at least 360 px, leaving the map 320 px; kept in
  `crew:drawerWidth`, set as `--crew-drawer` on the map's frame, which the agent's browser follows), the map staying, its
  node or head marked and kept in view. Esc closes it from anywhere on Crew, its message box too (main's key handler:
  after menus, pickers, previews and confirmations; a subagent goes back to its agent first), as does Back (Fleet).
- Beside the other tabs (GitHub, Files, Terminal, Conquer, Activity) the session panel (`FloatingPanel`, one column) shows
  what is open as the same `CrewDetail`, only while something is (main's `panelAbsent` = `crewShown || detailEmpty`: the
  panel takes no width and the bar's panel buttons go). It keeps its side, width and ⌘B; choosing something (J/K, ⌘K, a
  notification, the GitHub tab's Open in agent) opens it. There are no lists (the Agents, Workspaces, Projects and Hosts
  tabs, their filters and the host filter were removed: Crew is the list). The bar's "need you" opens the next agent
  that needs you.
- J/K (and → / ←, ‹ › in the conversation's header) and N walk a stable roster (`conversationOrder.ts`: host, project,
  workspace, age). The shortcuts dialog's "The crew" group lists Crew's keys.
- The robots, drones, glows, marks and medallions are `parts.tsx`'s, from the art in `rendering/src/assets/dungeon/`
  (`sheets.ts`, sizes checked against the PNGs in `roster.test.ts`); an agent's report in the chat shows its robot
  (`Robot`). All motion is CSS and stops with reduced motion. The fleet's vocabulary (states, models and robot colours,
  `AtlasData`) is `web/src/model/fleet.ts`; PR flags and Probe's verdicts `model/prStatus.ts` and `model/probe.ts`.
- Tests: `web/src/crew/roster.test.ts`, `web/e2e/crew.e2e.ts`, `web/e2e/pool.e2e.ts` (Release and Archive on the heads).
  `npm run native:mock -- --dungeon --probe --pr-flags` serves a fleet for it (the `dungeon` fleet is a test fixture).

### The agent's browser

Each agent has a browser of its own, tracked to it (host and daemon id): its tabs, shown on Crew in the map's place left
of its conversation (the user's ask: an integrated browser attached to the agent, which the agent can open tabs in; it
began on the Dungeon Board). Main's `crewBrowsing` (Crew shows, the macOS app, an agent open, not a subagent): B (outside a
text field; main's `boardKeys`), the strip's Browser button (which counts its tabs) and ⌘K "Show …’s browser" show or hide
it (`world:browserOpen`, kept as you step from agent to agent and across launches). ⇧⌘W hides it from anywhere (the user's
ask: a key that closes it): the page takes it, in a field too (`BoardBrowser.tsx`), and while a web page has the keyboard
the app does and tells the page (`key` `hide`), which gives the keyboard back to the page. The page draws the panel
(`web/src/browser/BoardBrowser.tsx`, `board-browser.css`, `.board-browser.crew` in `crew.css`: the app's tokens, a tab strip
with +, back / forward / reload or stop, an address field that takes `localhost:5173` or `example.com`
(`BrowserPolicy.destination`: local names and addresses over http, the rest https; never a search), Open in Conquer, Fill
the view (over the conversation too) and ×) and leaves a box (`.bb-view`) for the web page, which the macOS
app draws: `native/Sources/PaseoCommandNative/BoardBrowser.swift` owns the web views, as `EditorOverlay` owns the Files
editors' terminals. The page reports the box's frame and whose browser shows (`browser`, `postBrowserPlacement` in
`web/src/browser/browserBridge.ts`; sent as it changes, on mutations and a 250 ms poll), `covered` while a dialog of the
page's is open (⌘K: the web page steps aside), and `holes`: the page's own things lying over the box (a tooltip, a menu),
which `BrowserStage` cuts out of the web page with a layer mask and passes clicks
through. What the strip and bar do goes as `browserDo` (open, navigate, back, forward, reload, stop, close, select, focus);
the app answers on `paseo:browser`: every browser's tabs (`state`: id, address, title, loading, back, forward, a load's
error), `opened` when an agent opened a tab, `refused` (an address it won't open) and `key`. The box shows its own words only
while no page does: no tab yet (and how agents' tools stand), or a page that didn't load, with Try again. Tabs not on show
keep their pages in `parking`, a transparent view under everything in the window, so they draw and can be read and
photographed; the shown one is in `stage`, in the window's `content`. While a web page has the keyboard the app keeps the
window's keys and takes ⌘R, ⌘[, ⌘], ⌘W (the tab) and ⌘L, ⌘T (told to the page, which owns the address field) in
`BrowserStage.performKeyEquivalent`; ⌘K opens the page's palette (`AppWindow`, as for the terminals). Tabs (addresses and
titles, at most 12 an agent, the 40 most recently used agents') come back on launch, unloaded, in the app's preferences
(`boardBrowserState`; check runs keep none). Its pages have a cookie store of their own, apart from Conquer's and the app's:
an agent never acts with the user's Conquer logins. Nothing is downloaded.
Agents open and drive its tabs with Paseo's own browser tools, not a tool of this app's: the daemon gives agents
`browser_new_tab`, `browser_list_tabs`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`,
`browser_type`, `browser_keypress`, `browser_select`, `browser_hover`, `browser_drag`, `browser_scroll`, `browser_wait`,
`browser_evaluate`, `browser_screenshot`, `browser_upload`, `browser_logs`, `browser_resize`, `browser_back|forward|reload`
and `browser_close_tab` while its `browserTools.enabled` is on, and sends each call, with the calling agent's id and
workspace, to a connected client registered as a browser host (the newest registered gets new tabs; the Paseo app is one).
Settings → Browser "Agents’ browser tools open tabs here" (`world:browserTools`, off by default, since on it takes those calls
from the Paseo app's browser; ⌘K "Let / Stop agents’ browser tools…"; the page tells the app with `browserHost`) makes the
app one: it holds a socket to its own server (`/api/browser-host`, `web/server/browserHost.ts`, same origin rules as the
other sockets; one app socket at a time), and while that is open the server registers on every followed host's daemon
(`registerBrowserHost` on each live feed's client, `attached` in `live/feed.ts`, again as a daemon reconnects), relays each
`browser.automation.execute.request` to the app with its host key and the app's answer back to that daemon
(`sendBrowserAutomationExecuteResponse`), and tells the app how each daemon answered (`hosts`: registered, refused), which
Settings and the empty browser say. A browser tab of the page, or the setting off, registers nothing. The app runs the
commands (`BoardBrowser.execute`, `BrowserAutomation.swift`): a tab an agent opens joins that agent's browser, in the
background; a tab is its host's and workspace's only (another's id is "not found"). `BrowserScript` is the page script
(installed in the page on first use, its element refs ending with the document): `snapshot` writes the page's
accessibility outline as Paseo's own browser does (`- role "name" [attributes ref=@e12]`, text as `- text: "…"`, links'
addresses beneath them; at most 1,500 nodes, 500 refs, 80,000 characters, then `truncated`), and the actions find a ref's
element (a stale one is `browser_stale_ref`) and dispatch what a person's click, typing or key would: pointer and mouse
events with the click itself (so links, buttons, checkboxes and forms do what they do), values set past a framework's own
setter with `input` and `change`, keys with their codes and the defaults a page expects (Enter submits a field's form, Tab
moves on, Backspace erases, ⌘A selects). They are synthetic events, not the system's: `:hover` styles and things a browser
only lets a real gesture do won't follow. A screenshot is the page's own picture at one pixel a point (`fullPage`: the view
as tall as the page for a moment, to 12,000 px); `browser_resize` sizes a tab's page while it isn't on show (shown, it has
the box's size); a dialog a page raises while an agent's call runs is accepted for it and reported in the answer's
`dialogs` (a tab on show that no agent is using asks the user in a sheet; otherwise a confirm or prompt is dismissed).
Addresses (`BrowserPolicy`, checked before any load): only http and https. A tab of an agent on another host never loads
this Mac's own addresses (localhost, `*.localhost`, 127.0.0.0/8 however written, ::1, 0.0.0.0): to that agent localhost is
its own machine, and the Mac's local services (this app's unauthenticated API among them) aren't its to read. The tool is
refused with why, a page that sends itself there is stopped, and its pages carry content rules (`loopbackRules`, a
`WKContentRuleList`) that block frames, images, scripts and requests to them; such a tab is not made until those rules
compile. `browser_upload` reads files only for this Mac's own agents (the paths are the agent's machine's).
While an agent's conversation is open, a tab it opens shows at once (Settings → Browser "Show the browser when its agent
opens a tab", `world:browserFollows`, on by default), else the Browser button counts it; another agent's is said in a
notice, at most every 30 s an agent. While the browser shows, a web link clicked in the conversation (a visual reply's page
too) opens in it, not in Conquer (the user's call; `web/src/chatLinks.ts`: `openChatLink`, which `BoardBrowser` takes over
with `setBoardLinkOpener` while mounted, for links inside `.crew-detail` only): in a tab already at that address, else a
blank tab on show, else a new tab. A pull
request's link (the GitHub tab, while GitHub is on) and a Linear issue's or project's (Linear's app) keep the app's own
places; hidden, links go to the app as before. New agents are told what a tab is for (`agentPrompt.ts`,
`<paseo_command_browser>`). ⌘K (page Command, only while they apply): Show / Hide the browser (B; ⇧⌘W hides), and, while it shows,
Open a new tab, Type an address, Reload, Go back / forward, Close the tab, Make the browser fill the view, Open the page in
Conquer (`board-browser-*` in `appCommands.ts`). Limits: with the Dev and the release app both hosting, the daemon knows
them as one client (`clientId` "paseo-command") and sends calls to whichever registered last; a remote host's agent sees
only what the user's Mac can reach. `--info`'s `browser` is its state; hooks `browser` (run `<info>.browser`'s relayed
requests, answers to `<info>.browser.out`) and `browserfocus`; `native/scripts/fake-server.ts` serves `/__page` and takes
`POST /__browser {command, args}` as an agent's call through its fake daemon. Tests: `web/server/browserHost.test.ts`
(the fake daemon's `browserExecute`), `web/e2e/crew.e2e.ts`, `native/tests/BrowserAutomationTests.swift` (the
policy, keys, and the page script on a page in a web view).

### The maps (removed)

The Islands (the hex Atlas), Overworld and Dungeon Board map styles were removed at the user's request, with everything
only they used: the layout and painting code in `rendering/` (now only its art: `rendering/src/assets/`, the board's interface
art in `rendering/src/assets/board/`, `artifacts/`, `ASSETS.md`, kept at the user's request), the macOS app's SpriteKit world (`AtlasView`, `AtlasScene`, `DungeonScene`,
`MapScene`, `SpriteGlow`, `Geometry`, the watchdog and its stall hooks, View → Map Style), `NativeWorld.tsx`, map styles
(`atlas:style`, `?map=`, Settings → Map, ⌘K "Use the … map"), the Atlas legend and minimap, map hover cards, the Dungeon
Board's dialogue box (talking to robots), command belt and trays, board menu, board place panels and board Dispatch, the
host load banners (`host-stats`, `GET /api/hoststats`) and the board's PR and issue counts (`GET /api/github/q/prCounts`,
`GET /api/linear/issue-counts`). The Village had been removed before. Don't add any back unless asked. The user's saved
data stays as it is, ignored (`atlas:style`, `world:talkOnPick`, the lists' URL parameters).

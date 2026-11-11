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
  Tests of code using SwiftTerm (`TerminalFontTests.swift`) are compiled with `swiftc` against `native/.build/release`'s SwiftTerm (built first if missing).
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
  branch in a small form) with the usual composer; its first message creates the agent. Its /skills and @files
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
- `rendering/src/native/bridge.ts`: inside the native app, the Atlas world `mountAtlas` returns: it lays out and paints
  with the shared modules (`placement.ts`, `art.ts`, `terrain.ts`) and posts the result to Swift (`native/Sources/`),
  which draws, animates and owns camera, hover and picking under a transparent page.
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
  An unnamed sole-agent worktree gets that task title too. Map hover cards use the chat panel's display name, including workspace titles,
  and read it from the current snapshot while hovered. `PASEO_COMMAND_AUTOMATIC_NAMES=off` disables the observer (other test fixtures
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
- `web/src/urlState.ts`: the panel's place (selection, subagent, tab, filter, host filter, list toggle) kept in
  the page's query, so a refresh returns there; a new selection pushes history, other changes replace it.
- `web/src/games/`: the top bar's mini games (gamepad button), a floating non-modal window with one game dealt at
  random by the server (`web/server/games.ts`, `/api/games`): no choosing or restarting, the next game only once it ends.
  Progress and each game's best score are kept in the data directory's `games.json`. Games implement `types.tsx`'s
  `GameDef` (plain JSON state) and are listed in `catalog.ts` and `registry.ts`.
- `web/server/probe.ts`: Probe's verdict (Diagonal's `diagonalprobe` review bot) on each workspace's open PR, from one
  read-only GitHub GraphQL query per PR (`githubApi.ts`, the GitHub token) (`GET /api/probe`, polled by `web/src/useProbe.ts`): reviewing, approved,
  findings open (with their count), stale (new commits since, or deferred) or failed. The Atlas sets a medallion of its own in the
  workspace's first cell (the one facing its landmark): enamel in the verdict's colour round an original review magnifier,
  with a glyph badge (`rendering/src/probe.ts`, `placeProbes`, `paintProbe`); its hover card
  says the verdict. `native:mock -- --probe` shows each.
- Host load: `web/server/hostStats.ts` (`GET /api/hoststats`, polled by `web/src/useHostStats.ts`) asks each online host's
  daemon for the `host-stats` plugin's `stats.snapshot` (github.com/owenconti/paseo-cc-plugins, installed per daemon) over
  `invokePluginRpc`; a host without it is left out. Its host banner gains a second line, `CPU · MEM · DISK` percents
  (`statParts` in `rendering/src/placement.ts`, `RIBBON_DETAIL` in `ribbon.ts`; 90% and over in red). `native:mock -- --stats` shows it.
- Auto-merge: a PR's `autoMerge` comes from Paseo's GitHub facts (`autoMergeRequest`), else GitHub's API (`web/server/links.ts`, the GitHub token).
  While it's on, a teal seal with a merge mark sits on the review medallion's upper-right rim, else the CI one's (`placeSeals`,
  `paintSeal`, `AUTO_MERGE` in `rendering/src/prStatus.ts`); the medallion's hover card says how it merges and who turned it on.
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
- Chat Markdown renders fenced `mermaid` blocks (`web/src/mermaid/`), in the session panel and both map
  conversation views. The engine loads near the viewport, with serialized strict-mode renders and each view's
  palette; its SVG is shown as an isolated image. Source/copy, zoom/reset and an expanded focus-trapped view have
  matching context-sensitive palette entries (`mermaidCommands.ts`, `mermaid-diagram` in `appCommands.ts`). An
  incomplete streamed fence waits, invalid/oversized diagrams keep their source, and map paging keeps a chart whole.
  Mermaid stays on the 11.x line for the app's older WebKit support; its KaTeX override keeps the patched trust checks.
  Tests: `web/e2e/mermaid.e2e.ts`, the Mermaid case in `world-chat.e2e.ts`, and `worldChat/script.test.ts`.
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
  source. The Dungeon dialogue keeps a page whole when paging (`script.ts`), and the tray's reply previews leave its HTML out
  (`withoutPages`). Not done, unlike T3's: no headless-browser preview for the agent, and no MCP apps. Tests: `src/visual/page.test.ts`,
  `e2e/visual.e2e.ts`, `server/agentPrompt.test.ts`, `worldChat/script.test.ts`.
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
  or refused call stays an ordinary tool row. The Dungeon dialogue shows such a page in its Conversation log, not in the box.
  Tests: `server/visual.test.ts` (over the row a real daemon gave), `e2e/visual.e2e.ts`; the plugin's own in its repository.
  In the macOS app the window's navigation policy (`WorldWindow.swift` `decidePolicyFor`) cancels everything off the app's origin, so it
  allows a frame's inline document by name (`WebOrigin.inlineFrame`: `about:srcdoc`, never in the main frame; `WebOriginTests`): without
  it the frame stays blank (0.31.0 shipped so; Chrome's tests can't see it). A page's frame going anywhere else is still cancelled there.
  Check a page in a copy of the app (`--info`, `.eval`, `.windowshot`), not only in the browser tests.
- Mentions in the chat link themselves (`web/src/autolink.ts`): in an agent's conversation (`Timeline` and the map dialogue provide `Autolinks` from
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
running borders, states that need you pulse); robots carry no rings or badges. Running subagents circle their agent as drones (up to four), each in its own provider's colour (`subagentModels` → `droneArts`), its agent's where the daemon doesn't say. Hosts, projects, workspaces and
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
It never stays frozen (the map once stopped updating and animating while hover and clicks still worked): a watchdog
(`AtlasView.watch`, every 2 s) finds, on two looks in a row, a visibility kept out of step with the window's, the view or
its scene paused while the map should draw, or no frame for 3 s, and restarts the loop (pausing and unpausing restarts
SpriteKit's CVDisplayLink); a second stall with no frame between gives the scene a fresh `AtlasView`
(`WorldWindow.rebuildAtlasView`), the only mend for a display link whose frame callback stays "in progress". A display
change restarts the link at once. Each recovery is logged to `<data>/logs/native.log` (`Log.file`; display changes too)
and asks the page to post its world again (`stalled`). The page's side (`rendering/src/native/watch.ts`): every scene and
agents post carries a revision, Swift reports what it applied (`sceneRevision`, `agentsRevision` in its state), and a
bridge behind for 10 s posts the world again; every 5 s it tells Swift how it stands (`pageStatus`: since its last data
and post, the live connection), shown in `--info`'s `page` beside the view's `map`. The live connection (`web/src/live.ts`
`verify`) reads the fleet after 2 minutes without a message and, if the read is newer than its pushes, connects again.
Check hooks `stallview`, `stallscene`, `stallvisible`, `stallcv`, `stalllink` (native/README.md); `native/tests/AtlasViewTests.swift`.
The inherited React UI is preserved; its panels follow the system's appearance: the Galaxy theme (as in the user's
reference) when it is dark, the Light theme when it is light (`worldLook` in `web/src/theme.ts`). In dark, the pages (GitHub, Activity, Files, Settings) use neutral near-black greys of their own instead of the Galaxy navy (`pages.css`). The Terminal tab and Conquer's chrome and pages follow it too
(their tones are `Ink` in `native/Sources/PaseoCommandNative/Textures.swift`).
Five original references may be retained locally in ignored `design/references/atlas-01.webp` through `atlas-05.webp`; they are not redistributed.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.
Architecture uses the original `buildings.png` plus `structures.png`: eight project landmarks
and seven workspace cottages, balanced deterministically across neighbours (`STRUCTURE_SAMPLE` in the tests).

### Overworld style

A second map style (Settings → Map, ⌘K "Use the Overworld map" / "Use the Islands map"; `web/src/mapStyle.ts`, localStorage
`atlas:style`, Islands by default), from the user's concept render (ignored `design/references/overworld-concept.png`): each host a
terraced island region with its castle on top (lit while online, dark and grey while offline), project halls left and right of it, two
a row, and each project's workspaces as market booths beneath it (rows of up to three; a camp for agents without a workspace). A hall's roof is also its project's mark: seeded from the project's name (the same project has the same roof on every host; two
halls on a host never share one), and a host's scenery theme is seeded from it but never its neighbour's (the host before it takes the
first other theme, forest before farm before volcanic). It is a painted world with nothing laid over it (the user asked for it to feel real, without fake overlay
layers): no plaques, emblems, icon badges, banners, connector lines, PR / Probe medallions, clouds or glows. The only text is
on wooden signboards that belong to the buildings (the user's call): each host's name on a board hung on two chains from its
castle's corbels over the gate, and each project's on a smaller board on two iron brackets on its hall's front eave over the
door (`SignItem` in `layout.ts`, `paintSign` in `rendering/src/signboard.ts`: planks lit from the upper left with grain, seams and iron bolts,
the name in cream capitals in the Dungeon Board's old-style serif with a carved inset, sized to the name, tracking tightening,
then "…" past `maxW`; an offline host's board dull). Workspaces and agents carry no names. The
castle's and halls' painted emblem discs and parchment signs were repainted out of `host.png` and `halls.png` (their badge, banner and
emblem frames dropped, the `ui-world` and `status` sheets removed). Pull requests are in the hover cards: a project, workspace
or agent says its name, and a workspace its PR, CI and review flags, Probe's verdict and auto-merge (`workspacePrLines` in
`web/src/flagTip.ts`, only on the Overworld; its legend lists no medallions). Hosts stay uninteractive; the Overworld shows no
CPU · MEM · DISK (the other map styles do). An agent's state is the light it casts in its booth
(`stateLight` in `native.ts`, in its `STATE_TILE` colour, no ring or outline: a pool on the floor at its feet, a booth slot wide so
neighbours never blend, and a wash on the back wall behind it, which the robot doesn't hide; both pulse while it needs you; idle casts
none), its work frames while running, and a faded robot offline. Booths are a neutral stage for it (the stalls sheet darker and
greyer, no warm glow; awnings undyed canvas, never a state's colour; only sacks, barrels and crates in empty slots), with no tree or
bush before them; halls keep a forecourt clear before their doors.
One natural palette, as a lit scene has (the user's example: a dungeon board where the world is one muted family and the agents carry
the colour): each world sheet is recoloured as it loads (`SHEET_COLOURS`, `recolourSheets` in `paint.ts`: colour thinned, values kept
mid-range, split-toned cool grey in the shadows and warm daylight in the light; `greens` pulls acid yellow-greens to a leaf green and
`bands` quiet hue families that read as plastic, optionally darkening where they're strong: enamel roofs to slate, verdigris and moss,
turquoise surf, violet peaks and rocks, glowing golds to brass (`GOLDS`: the warm saturated colours are the robots' and states'), lava
to smouldering rust seams),
in two allocation-free passes (`shiftHues`, `liftAndSplit`); there is no overlay or wash on the finished painting (the user rejected one).
The sea is a deep, slightly green blue (`sea2.png`'s calm tile, `SEA_LIFT`) with lighter shallows round every coast and quiet
grey-white surf (`paintSea`, over each island's own wider sea field, `seaFieldAt`; the coast sheet's surf ribbons are left out; a host
has open sea below its last coast); meadows sage, woods mostly green (autumn and blossom canopies only as accents), rivers teal. Robots and their state light
are the only saturated colour: they keep provider colours (Claude orange, ChatGPT/Codex pearl, others the neutral robot tinted), stand
in a contact shadow with no rim glow (`litRobot`), and step through their pose's frames (idle or working; Swift cycles a streamer's
`frames`, the first only with reduced motion). Scenery is a theme seeded per host, kept to a few landmarks: forest (snowy peaks, a fall
off the plateau), farmland (windmill, fields, hay) or volcanic (dark peaks, a smoking volcano); forests are canopy masses (`foliage.png`),
with bushes and the odd boulder between open meadow, and islands' fronts carry cliff faces, headlands and rocks (`coast.png`,
`paintCoast`). Its sprites are HD painted sheets in `rendering/src/assets/overworld/` (frame maps beside them; provenance in
`rendering/ASSETS.md`). `rendering/src/overworld/`: `fleet.ts` maps the fleet, `layout.ts` lays a host out in concept pixels
(deterministic; no emblems or banners, text only on the signs; `rendering/tests/overworld.test.mjs`), `paint.ts` paints it (sea and shallows, islands
with perspective cliffs and surf, rivers, scenery, buildings), `native.ts` (`OverworldMap`) paints each host once per layout change into
tiles, a few at a time, arranges hosts in columns to suit the map's shape, and posts the robots and their state light as overlays, with
each entity's rectangle. Swift (`AtlasScene`, scene `style: "overworld"`) tiles the page's graded sea tile (`overworldSeaTile`, scene
`seaTile`, image `ow-sea`) over the whole view in place of the Islands sea, glints and clouds, picks the smallest rectangle under the
pointer. Hover and selection glow as the Dungeon Board's do (the user's call: no borders): the page paints each hall's and booth's own
silhouette, cut to its own pixels (`paintSilhouette`, `ow-sil:` images, the entity's `glow`), and robots use their first frame;
`SpriteGlow.overlay` adds a warm white halo just outside that silhouette and a faint lift over it on hover, its breathing
gold (with a wider pass) when selected. Halls and booths spread by `SpriteGlow.structureSpread` (17 units),
robots by 5% of their frame. `rendering/overworld-preview/` renders the concept's fleet beside the concept for
comparison (`build.sh`, then `node shoot.mjs <out.png> [k] [dy] [query]` against a static server on the rendering folder, port 4391;
`?fleet=crowded|sample`), and `?app=user|dungeon|sample` (`app.ts`) composites exactly what the macOS app is sent (the hosts' tiles over
the sea tile, robots and state light) for a fleet shaped like the user's, the Dungeon Board's or the sample.

### Map styles and the Dungeon Board

The map's styles are `MAP_STYLES` in `web/src/mapStyle.ts` (localStorage `atlas:style`; a page opened with `?map=<style>` starts in that
style and keeps it): Islands (the default), Overworld and the Dungeon Board (below; the Village was removed). Settings → Map lists them; ⌘K offers "Use the <name> map"
for each one not shown (page Settings); the macOS app's View → Map Style lists them with the shown one checked (`MapStyles` in
`MapScene.swift`; the page reports its style with a `mapStyle` message, and an item asks the page's `map-style-<id>` app command, then
shows Command). Islands and Overworld are one world (`mountNativeAtlas`, switched in place by `AtlasWorld.style`); the Dungeon Board is a
world of its own (`mountNativeDungeon`), which `NativeWorld.tsx` mounts in their place, and back, when the style crosses that line.
`AtlasView` hosts a `MapScene` (`MapScene.swift`, `kind` "atlas" or "dungeon": `AtlasScene` or `DungeonScene`); the page's `art`
message names its `scene`, and `WorldWindow.adopt` swaps in that scene in a fresh view. Both worlds share the page's input forwarding
(`rendering/src/native/surface.ts`), revisions and watchdog (`native/watch.ts`, `AtlasView.watch`). The Atlas legend hides on the board.
Every style's hover cards (`.atlas-world-tip`, the vault's `.atlas-world-card`; `MapCard` in `web/src/NativeWorld.tsx`) stay inside
the map the user sees (the user's call): `placeCard` (`web/src/cardPlace.ts`, pure) puts a card above the hovered thing when it fits,
else below it (each scene's hover report carries the thing's `bottom` as well as its top centre, threaded through `ScreenPoint`), else
on the side with more room, held 8 px inside the map's edges, centred and clamped sideways, and cut to the map's height when taller;
measured before paint, placed again as the map resizes. Tests: `web/src/cardPlace.test.ts`, `web/e2e/map-cards.e2e.ts`,
`native/tests/MapHoverTests.swift` (the `bottom` the Atlas sends), `DungeonSceneTests.swift`.
The Dungeon Board (`rendering/src/dungeon/`; the user's concept is ignored `design/references/dungeon-concept.png`): a front
cutaway of a dungeon, one floor per host with workspaces (the Atlas's host order), 365 concept px tall, stacked; its gate
column central (the round surround, its top a plain dark keystone opening with no icon (the user's call), the host's sign (the user's call: part of the world): a wooden board hanging on chains from two brackets
between the surround's opening and the arch, its name painted in capitals (cream, in an old-style serif, `SIGN_FONT`, Iowan Old Style
then Palatino, with a worn inset), a status gem on its left (online, warning when a reading is ≥ 90%, dark offline) and the
host-stats `CPU · MEM · DISK` beneath, ≥ 90% painted red, lit by a warm wash; an offline host's board dull, unlit, "OFFLINE" painted, a gold node, the portcullis lit while online, stairs to the next floor); projects
with workspaces alternating left and right outward from the gate (`hostGroups` in `world.ts`, shared with the Atlas), each
marked by its hall and its colour (the user's choice; no medallion or icon): its alcoves stand in one stone hall (end piers, one lintel, a dark back wall and a floor strip; `hall` in the layout, the `projects` sheet), with a valance under the lintel and a runner along the floor in its muted cloth colour (`CLOTHS`, `assignCloths`: hashed from the project, stepped past its row neighbour's so neighbours never share one; strips tiled in whole swags), a pair of wall candles above; its workspaces' alcoves in a row in it (oldest first, left
to right; camps for agents without one). Hosts carry their signs and projects their name boards (the user's call): a small
copy of the host's wooden board on short chains from its hall's lintel, centred over its valance, its name in capitals painted
in the same cream serif, as wide as the name needs and no wider than between the hall's piers (cut short with "…"), its bottom
above the alcoves' lintels and medallions (`projectSign` in `layout.ts`, `D.projectSign*`; `paintProjectSign` in `bridge.ts`,
dull on an offline floor; tagged with the project, so it glows with its hall); workspaces and agents are named on their hover cards; alcoves keep a plain lintel, the PR medallions on it; robots on each alcove's ledge in provider colours (`robotColor`: Claude orange, ChatGPT white, any other provider its own of the sheet's eight), oldest
first, drones for running subagents. No links join them (the user removed the gold pipes). Rooms and side rooms keep their natural, content-driven width; the painted masonry, terrace floors and ramparts continue behind them to the viewport edges (the user’s call),
including below the final floor, without enlarging entity bounds or cropping the board; a side's projects wrap onto more tiers only while the board would be wider than 1.6 × its
height. Decorations (side rooms: a recess, `room-*`, holding its vignette as the art's `v3/rooms-mock.png` composes them, dealt through the board so neighbours differ; plain cloth banners (no icons, the user's call), torches, windows, chains; the foot of the last stairs, closed by a low front parapet either side of the stair opening, its top above the HUD's count bar; standing props cast contact shadows, and pockets darken where the upper wall meets its piers) are seeded and
never cover what the board says (`layoutDungeon` in `layout.ts`, pure; `rendering/tests/dungeon.test.mjs`). The robots are what the eye should land on first (the user's call): drawn large (55 concept px tall), each with a
spotlight on the ledge, a halo of its colour baked from its silhouette (`bakeHalos`) and glowing visor eyes, the robot
sheet only saturation-lifted; the gate, links, torches and signs are kept a notch below them (`k` on lights, the
alcoves' interiors darker). The other sheets are graded at load (`grade`, `GRADE`) toward the
concept's purples. State: a state
glow under each robot in the Atlas's state colours (`STATE_TILE`, idle a quiet lavender; pulsing for states that need you), a marker at its head's upper right, calm idle poses at 0.5 fps and a slow half-pixel breath (no work-pose cycling or hopping),
a project's two torches lit while any of its agents runs,
its terrace glowing between its candles in the most urgent state's colour, offline floors dimmed and dark. PR, Probe and auto-merge medallions
sit on each alcove's lintel, larger (`D.flag`, 24) in one row centred on its bricks (CI, review, Probe; the user's call), the auto-merge seal on its medallion's rim, with the Atlas's hover cards.
The old upper-wall Pull Requests / Linear Issues stained-glass totals and their boards were removed: actionable integration
work lives in the React belt. The layout keeps empty `vault` / `vaultSigns` arrays for bridge compatibility; there are no
tile entities or picks. Integration polling is separate from the native scene snapshot, so counts do not re-lay the map out.
The HUD slots light their painted frame and icon on hover, selection and keyboard focus (brightness and an alpha-shaped
gold glow; no overlaid rectangle). Disabled slots stay unlit; reduced motion removes the filter transition.
Its persistent game HUD (`web/src/dungeon/`, mounted by `NativeWorld.tsx`) replaces the static footer: amber Waiting and
teal Running orbs, a seven-slot belt of Replies, Problems, Reviews, Assigned, Issues, Inbox and Dispatch, original painted transparent art
(`hud.webp`, `queues.webp`, `ART.md`; `art.ts` cuts and trims the two atlases). Labels and counts are accessible HTML. Slots open a non-modal
quest-log tray above the belt; the same slot, × or Escape closes it, Escape returning focus (other modal layers go first).
Agent rows open their conversation; PRs and issues open through `openAppLink`; Dispatch opens the app's New agent form in the world, in the belt's framed panel above it (`web/src/dungeon/WorldDispatch.tsx`, `world-dispatch.css`; Esc or × closes it; ⌘K "Dispatch an agent on the board"), and the new robot is picked on the board. The belt carries no title; the trays have no pointer.
Counts use the map's real states; offline hosts are excluded. Integrations retain “—” and their reason while unavailable,
and capped item lists say how many they show. Read-only timeline snippets load as rows enter the tray; opening a tray never
marks replies read. The map viewport ends above the measured HUD, as does the dialogue box; the belt stays beneath it.
GitHub’s Reviews slot uses outstanding `review-requested:@me` PRs; Assigned uses `assignee:@me`, not authorship. Both read
`github/q/prs?scope=review|assigned` (`useWorkQueues` in `dungeon/queues.ts`) and show GitHub’s total beyond the first 50,
with a full GitHub dashboard link. GitHub’s own sidebar has Assigned to you too. Linear Issues lists unfinished assigned
work (including backlog/triage, excluding completed/canceled), preserving the workflow name; Problems groups failed agents
and blocked assigned issues under separate headings. Linear Inbox uses Activity’s shared unread, unsnoozed grouped feed
(`useActivityPoll`, `useActivity`, `writeItems`); opening a tray reads nothing, choosing a notification marks it read as
Activity does. Source page limits carry `ActivitySourceStatus.limited` and use N+; unknown/error sources use — and say why.
A partial Problems count is a lower bound while its Linear part cannot answer; other source queues keep working.
`dashboardCounts.ts` polls only the assigned-issue source while the belt shows. Secret changes refresh every source.
The belt is capped at 116 px tall (124 px for narrow maps, with two slot rows and stable-size orbs); it has no integration group captions.
The palette’s `dungeon-tray`, settings, full-GitHub links and `dungeon-tray-close` mirror these actions. Robots stand at a 70 px pitch (55 px tall).
Upper wall cloth hangs in front of its rampart, with pillar capitals in front of both; lit braziers and forges have no
extra purple shade (offline floors remain dim). A hovered niche's card
follows its counts as they refresh. Each floor is assembled
from the v2 kit as the art's reconstruction (`rendering/artifacts/dungeon/mock.png`) is: ramparts, the gate's surround,
terrace floors, alcove sides, lintels and ledges. The page paints the host signs (`paintSign` in `bridge.ts`; the HUD keeps `ui-rounded`), purple shading on the upper walls and toward the board's edges, and posts top-left sprite
boxes; `DungeonScene.swift` draws, animates (the background holds still so the agents draw the eye, the user's call: the magic circle, alchemy tank, crystal and portcullis show one frame, light pools are steady (`still`), and flames alone flicker slowly between two frames at `FLAME_FLICKER` (1/3; 0 stills them) of their old pace; robots breathe slowly in idle poses, drones, state glows, markers and the glows' breath keep moving; ≈30 fps while something moves smoothly, the 15 fps drift rate when only flames and resting robots do, still with reduced motion), owns the camera (fit, bounded pan,
wheel, pinch, arrows, F/Home), hover and selection (project hover and architectural selection use brass thresholds:
`rendering/src/dungeon/thresholds.ts` sends their actual ledges, independently of pick boxes; `DungeonScene.swift` paints
worn, bevelled metal with no bloom. Project hover gives the threshold and two capitals a quiet sheen. Workspace hover fills the alcove's bay with
candlelight (the user's choice among mockups): warm pools over its interior, behind its stone frame (`lightBay`), with no rail, caps or lit border. Selection sets inward
chevrons and a centre diamond on the ledge, plus a small diamond on a project's sign. Project markers span the hall;
workspace markers stay on their own step. They stay still and clear when the entity or hover goes. Robots and PR
medallions keep their silhouette cues from `SpriteGlow.swift`, a restrained warm robot hover lift (45% of the shared glow),
a full medallion hover and a breathing gold robot selection), and picks (a PR medallion, then a robot, its
alcove, its project by its terrace wall, the hover card naming it; never a host). Sprites: `rendering/src/assets/dungeon/<sheet>.png|json` (the frame contract is `frames.ts`,
3× scale; a missing frame is painted as a placeholder; robots are trimmed to their opaque pixels). `npm run native:mock --
--dungeon` serves the concept's fleet (`dungeon` in `web/e2e/fleets.ts`, with PR and issue counts (`DASHBOARD_PRS`, `DASHBOARD_ISSUES`) and GitHub and
Linear on, for the vault) and prints its address with `?map=dungeon`. Tests:
`rendering/tests/dungeon.test.mjs`, `web/e2e/dungeon.e2e.ts`, `native/tests/DungeonSceneTests.swift`.

### Talking on the Dungeon Board

Dungeon map cards and in-world control hints use the dialogue’s own painted gold/navy panel, cream text and lavender
secondary text (`worldChat/game-tooltip.css`, `.dungeon-tooltip`). Its shared frame cutter and `useGameTooltipFrame`
live in `worldChat/frame.ts`; `worldChat/art.ts` re-exports the cuts for the dialogue. `TooltipLayer` themes hints by their
source control (inside `.world-chat`, `.world-dispatch` or `.dungeon-hud`) even though it portals to the body. Other app
controls keep their usual tooltip theme. Painted icon-only buttons are recognised by their CSS background; navigation
uses `data-tip` rather than native title hints. `MapCard` measures the framed card before placing it inside the map.

Its left/right navigation buttons are original stone-and-bronze medallions (`worldChat/navigation.webp`, `ART.md`), without
shortcut badges. Plain ←/→ step through a stable roster of the map’s active robots, grouped by host/workspace and age
(`conversationOrder` in `navigation.ts`), rather than the sidebar’s filtered, collapsed or attention-sorted list. They never
enter the native map’s pan loop (`native/surface.ts`); text fields keep their arrow keys. J/K still step too. Narrow maps
keep these controls inside a bottom row of the dialogue so the sidebar cannot cover them. Home, End and Enter page the
reply; Left/Right no longer page it. The palette and shortcut dialog mirror these keys.

The user asked to chat with agents from within the world, as an in-game conversation the user proceeds through, so they stay
in the world instead of switching to the chat panel (which stays). It starts on the Dungeon Board (`web/src/worldChat/`):
picking a robot selects it and opens its dialogue box over the board's foot (`WorldChat.tsx`, `world-chat.css`), an RPG's:
the board's own gold-framed HUD `panel`, a parchment `label` name plate and the robot (the board's `robots` sheet, its
provider's colour, in its calm idle poses, as the board's) in the stone `medallion`, cut from the `ui` sheet (`art.ts`), with its state's glow, state
and model. Its latest reply is typed out page by page (`pageReply` in `script.ts`: whole blocks while they fit the box,
measured; paragraphs cut between sentences, lists between items, code between lines, refenced; a heading never ends a page;
the page laid out whole and its untyped rest hidden by the CSS highlight `world-chat-untyped`; instant with reduced motion),
Enter, Space, a click or its ⏎ Skip showing the rest of the page at once (held, it never skips pages), then the next page;
then its choices (a menu above the box's right end, clear of the raised Conversation tab; ↑/↓, 1–9,
Enter, a click): an approval's Allow / Deny (or its actions; a plan's Approve / Reject), a question's options one question at
a time (multiple choice with Done, Something else…, Decline to answer; answers keyed by header as `PermissionCard` sends them),
the asks' quick replies and suggestion, Reply… (R; the app's own `Composer` in the box's colours, the box growing to it: files
and images, /skills, @files, queue, steer and interrupt; its draft, attachments and answers apart from the panel's, `draftScope`
":world"; input `world-composer`; files dropped on the box go to it; Esc back to the box),
Interrupt while it runs, Open the full chat (the panel, its composer focused) and Leave (Esc; the robot stays selected).
Archive… (and the composer's /archive, ⌘K's Archive “…”… on the board, the board menu's Archive…) asks in the box first, its
safe answer marked: archive the agent (not while it runs: Interrupt is offered), archive its workspace (the app's confirming
dialog, the box staying open under it) or Never mind (Esc). /new asks, then archives it and opens the board's Dispatch in its
workspace (else project); /clear does that without asking, keeping its provider, model, thinking and mode (`onFreshDraft`).
Asked from the whole conversation (/clear, /new, its header's +, ⌘K "Start a new conversation in this workspace on the board"),
that Dispatch stands where the conversation stood as an empty conversation ("New conversation", `WorldDispatch`'s
`conversation`, main's `worldDispatchConversation`), and its first message opens the new robot's whole conversation there
rather than its dialogue box.
The board's right-click menu (`web/src/dungeon/BoardMenu.tsx`, `boardMenu` in main; on what the world reports as hovered):
a robot's Talk, Open the full chat and Archive…; a workspace's Dispatch an agent here and Archive the workspace…; a project's
Dispatch an agent here. ↑/↓ move, Enter picks, Esc or a click elsewhere closes it.
After a sent reply, quick reply or queued follow-up, the actions stay closed. Actions (or Enter at the last page,
or ⌘K “Show conversation actions on the board”) reopens them; a new finished reply or request resets that suppression; live working progress does not.
Only the agent's own words are its speech; what it is doing (`workingOn`, else its last step, `exchangeOf`), failures,
offline and waiting are narration, never invented lines (truthful state). The Conversation button sits inside the dialogue header below the name banner, never in its raised strip. User-message
links use dark brown ink and full underlines against the box’s parchment bubbles, with a distinct keyboard focus ring.
The whole conversation opens upward over the board as
its log (H, the Conversation button, or scrolling up past the page's top; Back, H or Esc returns). It is the side panel's own
conversation component with the board's styling, so the two never differ in what they can do (the user's call): `Session.tsx`'s
`Session` is `useAgentSession` plus `SessionView`, and the log renders that `SessionView` over the session the box already reads
(one stream for box and log), told what differs through `SessionSurface` (class `world-session`, the composer's input
`world-composer` and draft scope, asking before archiving in the box, Escape). So the log has the header's tools (rename, new
agent in this workspace, copy ID, Open in Paseo, Archive, usage, Subagents, the branch chip and PR / Linear chips; no Fleet
button or position, which the box's own Back and arrows are), the reply forks (a click or a selection in a reply shows the
Ask / Add / Answer pill; forks open beside or over the conversation, their markers under replies, collected pieces), the
reply's questions and suggested reply above the composer, pending diff comments, the current-work line, requests' cards,
dropped files and agents' reports (`PeersContext`). A subagent chosen from its header opens in the log's place
(`SubagentSession`); Escape there goes back to its agent's. Escape in the log leaves a field first, then lets a picked block or
selection go, then closes an open fork (`SessionSurface.escape`), then the log. A field of the box that goes while focused (a
fork's question as it is asked) drops the keyboard on the page's body: the box takes it back (`held` in `WorldChat.tsx`).
Because the panel's copy of the conversation is usually mounted too (hidden or not), commands one copy should answer are
registered with `onOwnedAppCommand` (`appCommands.ts`: the copy mounted last answers; `agent-interrupt`, `agent-open-paseo`,
`agent-archive`, `agent-question-toggle`, `diff-comments-apply|show`), and fork highlights are kept per conversation root
(`paintMarks` in `forks/marks.ts`), so neither copy clears the other's. Its complete local colour palette in `world-chat.css` covers event cards,
tools, code/syntax, tables, request cards, fields, placeholders, metadata and focus, so a light app theme never leaks pale
surfaces behind cream text (your messages stay parchment with brown metadata). Narrow logs use the full panel width,
without a portrait, and keep navigation in their explicit bottom grid row;
the board keeps the box's own room under it; it stays open as the box steps robots (`talkLog` in main, ⌘K "Show the whole
conversation on the board"). Painted left/right controls beside the box (← →, as K and J; named on hover) step to the previous and next agent
(main's `step`; ⌘K's Previous / Next agent show those keys while the box does). The box follows the selected agent (J/K step to
the next robot), counts as viewing it (mark read, no notification), and keeps where each conversation was left. T and ⌘K
"Talk to … on the board" open it for the selected robot; "Leave the conversation on the board", "Continue the conversation in
the side panel"; Settings → Map's switch (localStorage `world:talkOnPick`, on by default; ⌘K too) says whether picking opens it.
While it speaks a pick doesn't open a hidden panel (`FloatingPanel`'s `openOnSelect`). The board frames the robot above the box
(`world.talk(id, inset)`, the bridge's `talk` message, `DungeonScene.talk`: the camera remembered, the robot framed in the clear
area above the box's `inset`, the “Now” footer hidden, the camera put back on leaving). The box runs its own `useAgentSession` beside
the panel's: the server keeps every sid a socket watches an agent under (`web/server/live/sessions.ts`, `MAX_VIEWS` per agent).
Keys are taken in the capture phase while the box or the map has the keyboard (not while typing elsewhere); the shortcuts
dialog's "Talking on the Dungeon Board" group lists them. `npm run native:mock -- --dungeon --talk` gives every robot a
conversation for its state and its request in full, and takes the box's sends and answers (logged). Tests:
`web/src/worldChat/script.test.ts`, `web/e2e/world-chat.e2e.ts`, `web/server/live/sessions.test.ts`, `DungeonSceneTests.swift`.

### The robot's browser on the Dungeon Board

Each robot has a browser of its own, tracked to its agent (host and daemon id): its tabs, shown over the board above its
dialogue box (the user's ask: an integrated browser on the board, attached to the agent, which the agent can open tabs in).
B, the box's Browser button (which counts its tabs), the board menu's Browser and ⌘K "Show …’s browser on the board" show
or hide it (`world:browserOpen`, kept as the box steps robots and across launches). ⇧⌘W hides it from anywhere (the user's
ask: a key that closes it): the page takes it, in a field too (`BoardBrowser.tsx`), and while a web page has the keyboard
the app does and tells the page (`key` `hide`), which gives the keyboard back to the page. With the whole conversation open
too (H) they show together (the user's call): the conversation on the board's left in a narrower column
(`--board-chat-width`, 380–560 px, 36% of the map; `.world-chat.log.beside`, laid out as on a narrow map, the robots' arrows
at its foot), the browser on its right down to the belt (`.board-browser.beside`), from a map 900 px wide
(`BESIDE_MIN_WIDTH` in `main.tsx`, the frame measured); on a narrower one the conversation takes the browser's place, and
B there shows the browser above the box instead. The page draws the panel (`web/src/worldChat/BoardBrowser.tsx`, `board-browser.css`: the dialogue's
gold-framed navy panel, a tab strip with +, back / forward / reload or stop, an address field that takes `localhost:5173` or
`example.com` (`BrowserPolicy.destination`: local names and addresses over http, the rest https; never a search), Open in
Conquer, Fill the board (over the dialogue box too) and ×) and leaves a box (`.bb-view`) for the web page, which the macOS
app draws: `native/Sources/PaseoCommandNative/BoardBrowser.swift` owns the web views, as `EditorOverlay` owns the Files
editors' terminals. The page reports the box's frame and whose browser shows (`browser`, `postBrowserPlacement` in
`web/src/worldChat/browserBridge.ts`; sent as it changes, on mutations and a 250 ms poll), `covered` while a dialog of the
page's is open (⌘K: the web page steps aside), and `holes`: the page's own things lying over the box (the dialogue's
choices, a hint, the board's menu, a menu of the conversation's), which `BrowserStage` cuts out of the web page with a layer mask and passes clicks
through. What the strip and bar do goes as `browserDo` (open, navigate, back, forward, reload, stop, close, select, focus);
the app answers on `paseo:browser`: every browser's tabs (`state`: id, address, title, loading, back, forward, a load's
error), `opened` when an agent opened a tab, `refused` (an address it won't open) and `key`. The box shows its own words only
while no page does: no tab yet (and how agents' tools stand), or a page that didn't load, with Try again. Tabs not on show
keep their pages in `parking`, a transparent view under everything in the window, so they draw and can be read and
photographed; the shown one is in `stage`, in the window's `content`. While a web page has the keyboard the app keeps the
window's keys and takes ⌘R, ⌘[, ⌘], ⌘W (the tab) and ⌘L, ⌘T (told to the page, which owns the address field) in
`BrowserStage.performKeyEquivalent`; ⌘K opens the page's palette (`AppWindow`, as for the terminals). Tabs (addresses and
titles, at most 12 a robot, the 40 most recently used robots') come back on launch, unloaded, in the app's preferences
(`boardBrowserState`; check runs keep none). Its pages have a cookie store of their own, apart from Conquer's and the app's:
an agent never acts with the user's Conquer logins. Nothing is downloaded.
Agents open and drive its tabs with Paseo's own browser tools, not a tool of this app's: the daemon gives agents
`browser_new_tab`, `browser_list_tabs`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`,
`browser_type`, `browser_keypress`, `browser_select`, `browser_hover`, `browser_drag`, `browser_scroll`, `browser_wait`,
`browser_evaluate`, `browser_screenshot`, `browser_upload`, `browser_logs`, `browser_resize`, `browser_back|forward|reload`
and `browser_close_tab` while its `browserTools.enabled` is on, and sends each call, with the calling agent's id and
workspace, to a connected client registered as a browser host (the newest registered gets new tabs; the Paseo app is one).
Settings → Map "Agents’ browser tools open tabs here" (`world:browserTools`, off by default, since on it takes those calls
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
While you talk to a robot, a tab it opens shows at once (Settings → Map "Show the browser when its agent opens a tab",
`world:browserFollows`, on by default; beside the whole conversation where both fit, never over it), else the Browser button counts it; another
robot's is said in a notice, at most every 30 s a robot. New agents are told what a tab is for (`agentPrompt.ts`,
`<paseo_command_browser>`). ⌘K (page Command, only while they apply): Show / Hide the browser (B; ⇧⌘W hides), and, while it shows,
Open a new tab, Type an address, Reload, Go back / forward, Close the tab, Make the browser fill the board, Open the page in
Conquer (`board-browser-*` in `appCommands.ts`). Limits: with the Dev and the release app both hosting, the daemon knows
them as one client (`clientId` "paseo-command") and sends calls to whichever registered last; a remote host's agent sees
only what the user's Mac can reach. `--info`'s `browser` is its state; hooks `browser` (run `<info>.browser`'s relayed
requests, answers to `<info>.browser.out`) and `browserfocus`; `native/scripts/fake-server.ts` serves `/__page` and takes
`POST /__browser {command, args}` as an agent's call through its fake daemon. Tests: `web/server/browserHost.test.ts`
(the fake daemon's `browserExecute`), `web/e2e/board-browser.e2e.ts`, `native/tests/BrowserAutomationTests.swift` (the
policy, keys, and the page script on a page in a web view).

### The Village (removed)

The Village map style was removed at the user's request: its world (`rendering/src/village/`), scene (`VillageScene.swift`),
sheets, fleet, mock flag and tests, its entry in `MAP_STYLES`, Settings → Map, ⌘K and View → Map Style. Don't add it back
unless asked. A saved `atlas:style` of `village` reads as Islands. What the Dungeon Board borrowed stays: the stained-glass
`tiles` and At a Glance `hud` sheets (now `rendering/src/assets/dungeon/`), the PR and issue counts (`useDashboardCounts` in
`web/src/dashboardCounts.ts`, `GET /api/github/q/prCounts`, `GET /api/linear/issue-counts`), `rendering/src/dashboard.ts`, and
the glow in `SpriteGlow.swift`. `native:mock -- --fleet sparse` still serves a small two-host fleet (on the Islands).

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

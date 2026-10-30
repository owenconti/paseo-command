# Self-contained Paseo Command App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Paseo Command as a downloadable, self-updating `.app` that holds its own Node, server and page, and runs from `/Applications` with no checkout.

**Architecture:** The server is bundled by esbuild into one ESM file from the existing standalone helper (`web/server/native.ts`), which serves a packaged `ui/` without Vite and exits with its owning app. `bundle.sh` puts a pinned universal Node, that file and `web/dist` under `Contents/Resources/`. The Swift `ServerManager` runs them with the user's shell environment. Sparkle updates release builds from a GitHub-hosted appcast, and `npm run release` builds, signs (self-signed identity), and publishes from Owen's Mac.

**Tech Stack:** Swift 5.10 / AppKit / SwiftPM (Sparkle 2 binary target), Node 22 LTS, esbuild, TypeScript, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-30-self-contained-app-design.md`

## Global Constraints

- macOS 14+; build with Command Line Tools only (`swift build`), no Xcode project.
- Bundled Node satisfies `^20.19.0 || >=22.12.0`; pin one exact Node 22 LTS version with SHA-256 checksums for both darwin tarballs.
- Server binds `127.0.0.1` only; release port `4310`, dev flavour port `4331`.
- Release bundle id `io.github.owenconti.paseo-command`, name "Paseo Command", data `~/Library/Application Support/Paseo Command/`.
- Dev bundle id `io.github.owenconti.paseo-command.dev`, name "Paseo Command Dev", data `~/Library/Application Support/Paseo Command Dev/`, Sparkle off.
- `~/.paseo-command/settings.json` stays where it is.
- No Developer ID, no notarization; releases are signed with the self-signed identity `Paseo Command Release` from Owen's login keychain. Nothing secret enters the repo or GitHub.
- Sparkle updates must carry a valid EdDSA signature; only the public key (`SUPublicEDKey`) is committed.
- Feed URL: `https://github.com/owenconti/paseo-command/releases/latest/download/appcast.xml`.
- Versions: semver from `0.2.0`, source of truth root `package.json` `version`.
- Publishing pushes `main` only (the push guard refuses tags); release tags are created on GitHub by `gh release create --target <sha>`.
- Old checkout data is copied, never moved or deleted; nothing on port 4310 that isn't the old Paseo Command launcher is ever stopped.
- Daemon mutations tested only against fake daemons. Never quit, relaunch or open the user's running app; check copies launch with `open -g … --background`.
- Palette rule (CLAUDE.md): renamed/added actions update `paletteCommands`, and `ShortcutsButton.tsx` if keys change.

## Review Focus

1. Port 4310 held by the *previous* app instance during Restart app / Sparkle relaunch: the new instance must wait for it (up to 10 s) instead of failing → Task 4 test `waitsForPortHeldByExitingHelper`.
2. Shell environment capture hangs or prints junk (oh-my-zsh prompts, `exec fish`): app must still start the server within ~12 s with the app's own environment → Task 4 test `startsWithAppEnvironmentWhenShellFails`.
3. First launch while the old checkout server still runs and writes `.paseo-command/`: copy must happen only after it is stopped (or the user declines — then no copy, data starts fresh, and the app reports the port as taken) → Task 6 test `copiesOnlyAfterOldServerStopped`.
4. App moved, renamed, or run from a read-only DMG mount: everything resolves from `Bundle.main`, nothing writes into the bundle → Task 4 test `resolvesResourcesFromAnyBundlePath`; Task 3 asserts no path under the bundle is written.
5. Update feed unreachable or GitHub API rate-limited (60/h unauthenticated): app keeps working, release notes show the installed version and "Couldn't load release notes" → Task 8 test `releaseNotesSurviveFetchFailure`.

---

### Task 1: Standalone server needs no checkout

**Files:**
- Modify: `web/server/native.ts` (`validateNativeConfig`, `startNativeHelper`)
- Modify: `web/server/subagentArchive.ts:47-50` (`dataDir`)
- Create: `web/server/native.test.ts`

**Interfaces:**
- Produces: env contract of the helper process — `PASEO_COMMAND_DATA` (absolute, required), `PASEO_NATIVE_UI` (absolute, required in bundle), `PASEO_NATIVE_PORT` (default 4310), `PASEO_NATIVE_OWNER_PID` (required), `PASEO_COMMAND_VERSION` (optional string, `"dev"` if absent), `PASEO_COMMAND_CHECKOUT` (optional; used only if set). `GET /__native/health` → `{ ready: true, pid, ownerPid, version }`.

- [ ] **Step 1: Write failing tests** in `web/server/native.test.ts` (node:test, run by `npm run app:test`):
  - `validateNativeConfig accepts no checkout`: env `{PASEO_COMMAND_DATA:"/tmp/d", PASEO_NATIVE_OWNER_PID:"<process.pid of a spawned sleep>", PASEO_NATIVE_UI:"/tmp/ui"}` → `config.checkout === undefined`, `config.data === "/tmp/d"`, `config.port === 4310`.
  - `rejects a relative data path`: throws `/absolute PASEO_COMMAND_DATA/`.
  - `serves health with version`: start with a temp `ui/index.html`, `PASEO_COMMAND_VERSION="0.2.0"`, fake connector; `GET /__native/health` JSON has `version: "0.2.0"`; `GET /` returns the index; `GET /` with `Host: evil.example` → 403.
  - `runs in the data folder`: after start, `process.cwd() === realpath(data)`; and `dataDir() === data`.
- [ ] **Step 2:** `npm --prefix web test -- --test-name-pattern native` → FAIL.
- [ ] **Step 3: Implement.** `checkout` becomes optional (sets `PASEO_COMMAND_REPO` only when given); `process.chdir(config.data)` after `mkdir -p`; port default 4310; health includes `version: env.PASEO_COMMAND_VERSION ?? "dev"`. `dataDir()` unchanged in precedence (`PASEO_COMMAND_DATA` first).
- [ ] **Step 4:** tests PASS; `npm run app:typecheck` clean.
- [ ] **Step 5: Commit** `Let the standalone server run without a checkout`.

### Task 2: Bundle the server into one file

**Files:**
- Create: `web/scripts/bundle-server.mjs`
- Modify: `web/package.json` (script `"bundle:server": "node scripts/bundle-server.mjs"`), root `package.json` (`"app:bundle-server": "npm --prefix web run bundle:server"`)
- Create: `web/scripts/bundle-server.test.mjs`
- Modify: `.gitignore` (`web/dist-server/`)

**Interfaces:**
- Consumes: Task 1's env contract.
- Produces: `web/dist-server/server.mjs` — run as `node server.mjs`, it starts the helper (the `isNativeEntrypoint` branch of `native.ts`).

- [ ] **Step 1: Failing test** `bundle-server.test.mjs` (`node --test`): after running the bundler, spawn `process.execPath web/dist-server/server.mjs` with Task 1 env (`PASEO_NATIVE_UI=web/dist`, port 0 not allowed → use a free port found first, temp data, `PASEO_COMMAND_DAEMON=127.0.0.1:1` so no real daemon is reached), assert `/__native/health` ready within 10 s, `GET /` contains `<div id="root"`, `GET /api/presets` is 200, and kill → exits 0. Assert the bundle imports no path under `web/node_modules` (`grep -c node_modules` of resolved imports is 0 except bare `node:` builtins).
- [ ] **Step 2:** run → FAIL (no bundler).
- [ ] **Step 3: Implement** esbuild call: entry `web/server/native.ts`, `bundle: true, platform: "node", format: "esm", target: "node22"`, banner defining `require` via `createRequire(import.meta.url)`, `external: ["bufferutil", "utf-8-validate"]` (ws optional peers), `define` none. Fail the build if esbuild reports any other unresolved import.
- [ ] **Step 4:** `npm run app:build && npm run app:bundle-server && node --test web/scripts/bundle-server.test.mjs` → PASS.
- [ ] **Step 5: Commit** `Bundle the app server into a single file`.

### Task 3: App bundle carries Node, server and page, in two flavours

**Files:**
- Create: `native/node-version.json` (`{"version":"22.x.y","sha256":{"arm64":"…","x64":"…"}}` — exact LTS and checksums from nodejs.org `SHASUMS256.txt` at implementation time)
- Create: `native/scripts/fetch-node.mjs`
- Modify: `native/scripts/bundle.sh`, `native/Info.plist`, `package.json` scripts
- Modify: `.gitignore` (`native/.cache/`, `native/release/`)
- Modify: `THIRD_PARTY_NOTICES.md`, add `licenses/node.txt`

**Interfaces:**
- Produces: `sh native/scripts/bundle.sh [--release]`. Without `--release`: dev flavour (Global Constraints values) at `native/build/Paseo Command Dev.app`. With: `native/build/Paseo Command.app`. Both contain `Contents/Resources/node/node` (universal), `Contents/Resources/server/server.mjs`, `Contents/Resources/ui/` (copy of `web/dist`), and `Info.plist` keys `CFBundleIdentifier`, `CFBundleName`, `CFBundleShortVersionString` = package.json version, `CFBundleVersion` = `git rev-list --count HEAD`, `PaseoCommandFlavor` = `dev|release`, `PaseoCommandPort` = `4331|4310`.
- `npm run native:build` → dev; `npm run app:update` = `app:build && app:bundle-server && native:build` (unchanged name).

- [ ] **Step 1: Failing check** `native/scripts/test-bundle.mjs` (added to `native:test` after the Swift checks, skipped with a message when no build exists): for each built flavour, `lipo -archs Resources/node/node` contains `arm64` and `x86_64`; `Resources/node/node --version` matches `node-version.json`; plist keys as above; `codesign --verify --deep --strict` passes.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `fetch-node.mjs`: download both `node-v<ver>-darwin-{arm64,x64}.tar.gz` into `native/.cache/node/`, verify SHA-256 (abort on mismatch), extract `bin/node`, `lipo -create` to `native/.cache/node/<ver>/node`; reuse the cache when present. `bundle.sh`: run it, copy the three resources, write plist values with `/usr/libexec/PlistBuddy`, sign inside-out (`node`, then Sparkle once Task 7 lands, then the app) with `codesign --force --sign -` for dev; `--release` signs with identity `Paseo Command Release` (fail clearly if absent: "Run npm run release:setup first"). Keep the atomic executable replacement for running copies.
- [ ] **Step 4:** `npm run app:update && sh native/scripts/bundle.sh --release` (release half may be skipped with the documented message if the identity isn't set up) → `node native/scripts/test-bundle.mjs` PASS.
- [ ] **Step 5: Commit** `Build the app with its own Node, server and page`.

### Task 4: The app runs its bundled server

**Files:**
- Modify: `native/Sources/PaseoCommandNative/ServerManager.swift` (rewrite)
- Create: `native/Sources/PaseoCommandNative/AppFlavor.swift`
- Modify: `native/Sources/PaseoCommandNative/ShellEnvironment.swift` (remove `node(in:)` and `newerVersion`; keep `capture`, `parse`, `userShell`)
- Modify: `native/tests/ShellEnvironmentTests.swift`
- Create: `native/tests/ServerManagerTests.swift` (run by `native/scripts/test-origin.mjs`, rename to `test-native.mjs`, update `native:test`)
- Modify: `native/Sources/PaseoCommandNative/main.swift` (default `--url` from `AppFlavor.port`; `reloadApp`), `WorldWindow.swift` (`refreshServer`, `startServer`)

**Interfaces:**
- Consumes: Task 1 env contract and health JSON; Task 3 resource layout and plist keys.
- Produces:
  - `enum AppFlavor { static var isRelease: Bool; static var port: Int; static var dataFolder: URL; static var version: String }` (from `Bundle.main` plist; `dataFolder` = Application Support / `CFBundleName`).
  - `final class ServerManager { init?(bundle: Bundle = .main); func ensure(port: Int, _ done: @escaping (Result<Void, Error>) -> Void); func stop(timeout: TimeInterval = 5) }` — `ensure` launches `Resources/node/node Resources/server/server.mjs` with captured shell env + `PASEO_COMMAND_DATA`, `PASEO_NATIVE_UI`, `PASEO_NATIVE_PORT`, `PASEO_NATIVE_OWNER_PID = getpid()`, `PASEO_COMMAND_VERSION`, stdout/stderr appended to `<data>/logs/server.log`; succeeds on health `ready`. `stop` sends SIGTERM and waits.
  - `static func classify(health: Data?) -> PortOwner` with `enum PortOwner { case free, ours(pid: Int32), otherHelper(pid: Int32, ownerPid: Int32), foreign }` (health JSON present → helper; `ownerPid == getpid()` → ours).
- Removes: `refresh(port:)` and the `scripts/app-server.mjs` route from the app (scripts stay for browser use).

- [ ] **Step 1: Failing tests** (`ServerManagerTests.swift`, pure parts):
  - `classify`: nil → `.free`; `{"ready":true,"pid":5,"ownerPid":<getpid()>}` → `.ours(5)`; same with ownerPid 7 → `.otherHelper(5,7)`; non-JSON body → `.foreign`.
  - `resolvesResourcesFromAnyBundlePath`: `ServerManager.resources(in: URL("/Volumes/X/Paseo Command.app"))` returns `…/Contents/Resources/node/node`, `…/server/server.mjs`, `…/ui`.
  - `waitsForPortHeldByExitingHelper`: `ServerManager.shouldWait(for: .otherHelper(pid:5, ownerPid: <dead pid>))` is true; for `.foreign` false.
  - `startsWithAppEnvironmentWhenShellFails`: `ShellEnvironment.capture(shell: "/bin/sh -c 'sleep 30'", timeout: 1)` returns nil within 2 s (add `shell` parameter defaulting to `userShell()`).
- [ ] **Step 2:** `npm run native:test` → FAIL.
- [ ] **Step 3: Implement.** On `ensure`: classify port → `.ours`/`.free` proceed; `.otherHelper` with dead owner or owner exiting → poll every 250 ms up to 10 s, then start; `.foreign` → failure "Port 4310 is used by another program. Quit it and reopen Paseo Command." (Task 6 inserts the old-launcher case before this). `AppDelegate.applicationWillTerminate` calls `stop()`. Restart app (no update pending): `stop()`, then the existing `relaunch`. Dev flavour keeps `Build.newer` for "Update ready".
- [ ] **Step 4:** `npm run native:test` PASS; then end-to-end: `npm run app:update`, copy `native/build/Paseo Command Dev.app` to `$SCRATCH/Moved/`, `open -g -n "$SCRATCH/Moved/Paseo Command Dev.app" --args --background --info $SCRATCH/x.json`; health on 4331 within 15 s; `ps` shows the bundle's own `node`; quit via `notifyutil -p com.paseo.command.native.quit.x` → port 4331 free within 6 s.
- [ ] **Step 5: Commit** `Run the bundled server from the app, wherever it is installed`.

### Task 5: Keep Conquer and page state across the bundle id change

**Files:**
- Create: `native/Sources/PaseoCommandNative/LegacyState.swift`
- Create: `native/tests/LegacyStateTests.swift`
- Modify: `main.swift` (call `LegacyState.migrate()` first thing in `applicationDidFinishLaunching`, before any web view or `UserDefaults` read)

**Interfaces:**
- Produces: `enum LegacyState { static let oldBundleID = "local.paseo.command.native"; static func migrate(home: URL = …, defaults: UserDefaults = .standard) }`. Once (flag `legacyStateMigrated` in `defaults`), release flavour only: copy every key of the old defaults domain (`UserDefaults(suiteName: oldBundleID)`) not already set; copy `~/Library/WebKit/<oldBundleID>/` to `~/Library/WebKit/<new id>/` if the latter doesn't exist (this holds the Conquer store `C0A9B6E2-…` and the page's localStorage). Never deletes the old ones.

- [ ] **Step 1: Failing tests** with a temp home and `UserDefaults(suiteName: "test.<uuid>")`: keys copied, existing keys untouched, WebKit folder copied when missing and left alone when present, second call is a no-op, nothing under the old paths removed.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; manual check on a dev build with `--info` that nothing runs for the dev flavour.
- [ ] **Step 5: Commit** `Carry Conquer and page state over to the new app id`.

### Task 6: Hand over from the old checkout server and copy its data

**Files:**
- Create: `native/Sources/PaseoCommandNative/OldInstall.swift`
- Create: `native/tests/OldInstallTests.swift`
- Modify: `ServerManager.swift` (`.foreign` branch), `WorldWindow.swift` (the alert)

**Interfaces:**
- Consumes: `PortOwner`, `AppFlavor.dataFolder`.
- Produces:
  - `struct OldServer { let pid: Int32; let checkout: URL; let launchAgent: URL? }`
  - `static func OldInstall.find(port: Int) -> OldServer?` — the pid listening on the port (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`) whose command line (`ps -o command= -p`) contains `scripts/app-server.mjs` or `web/node_modules/.bin/vite`; checkout = path before `/scripts/` (or `/web/`); `launchAgent` = `~/Library/LaunchAgents/com.paseo-command.serve.plist` if it exists.
  - `static func OldInstall.checkoutFromCommand(_ command: String) -> URL?` (pure; tested).
  - `static func OldInstall.stop(_ s: OldServer) throws` — `launchctl bootout gui/<uid> <plist>` then move the plist to `<data>/old-launch-agent.plist` (kept, not deleted), SIGTERM pid, wait ≤ 5 s.
  - `static func OldInstall.copyData(from checkout: URL, to data: URL) -> [String]` — copies `secrets.json`, `games.json`, `forks.json`, `archived-subagents.json` from `<checkout>/.paseo-command/` when none of those four exist in `data`; writes `<data>/migrated-from.json` `{checkout, date, files}`; returns copied names; does nothing if `migrated-from.json` exists.
- Release flow: `.foreign` → `OldInstall.find` → alert "An older Paseo Command server is running from <checkout>. Stop it and use this app?" [Stop and Continue] [Quit]. Continue → `stop`, `copyData`, then start. Not found → Task 4's foreign failure.

- [ ] **Step 1: Failing tests:** `checkoutFromCommand("/usr/local/bin/node /Users/example/dev/paseo-command/scripts/app-server.mjs --serve {…}")` → `/Users/example/dev/paseo-command`; vite variant; unrelated command → nil. `copyData`: copies the four when absent; copies nothing when `games.json` already exists; second call no-op; source files still present after. `copiesOnlyAfterOldServerStopped`: a `HandOver` sequence object records order `stop` before `copyData` (inject closures).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. End-to-end against a throwaway launcher: start `node scripts/app-server.mjs start --port 4339` from a temp clone of this worktree with a fake `.paseo-command/games.json`, launch the dev build with `PaseoCommandPort` overridden by `--port 4339` (add the option) and `--info`; trigger the alert's default via a check hook `….handover.<run>`; assert the launcher died, `games.json` copied, health is the bundle's.
- [ ] **Step 5: Commit** `Take over from an old checkout server and copy its data once`.

### Task 7: Sparkle updates

**Files:**
- Modify: `native/Package.swift` (dependency `https://github.com/sparkle-project/Sparkle` from `2.6.0`, product `Sparkle`; linker rpath `@executable_path/../Frameworks`)
- Create: `native/Sources/PaseoCommandNative/Updater.swift`
- Modify: `bundle.sh` (copy `Sparkle.framework` into `Contents/Frameworks`, sign it; release plist keys `SUFeedURL`, `SUPublicEDKey`, `SUEnableAutomaticChecks=true`, `SUAutomaticallyUpdate=true`, `SUScheduledCheckInterval=3600`), `main.swift` (mode bar from `Updater`, `reloadApp`), `Info.plist`
- Create: `native/tests/UpdaterTests.swift`

**Interfaces:**
- Produces: `final class Updater: NSObject, SPUUpdaterDelegate { static let shared: Updater?  // nil in dev flavour; var pendingVersion: String? ; var onChange: (() -> Void)?; func installNow() -> Bool }`. Delegate `updater(_:willInstallUpdateOnQuit:immediateInstallationBlock:)` stores the block and sets `pendingVersion` from the item's `displayVersionString`. `installNow` saves the window frame and `pageURL` to `UserDefaults` key `restorePage`, runs the block, returns false if none.
- Page event: `paseo:update` `{ installed: String, pending: String|null }` posted on load and on change (used by Task 8).
- `main.swift` launch reads and clears `restorePage` when no `--url` is given.
- Restart app: `Updater.shared?.installNow()` if pending, else Task 4's stop + relaunch. Mode bar `updateReady = Updater.shared?.pendingVersion != nil` (release) or `Build.newer` (dev).

- [ ] **Step 1: Failing tests:** `Updater.restoreURL(saved: "http://127.0.0.1:4310/?agent=a", port: 4310)` → that URL; saved URL with a different host or port → nil (only our own origin is restored, via `WebOrigin.matches`).
- [ ] **Step 2:** FAIL. **Step 3:** implement; `SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)` only when `AppFlavor.isRelease`.
- [ ] **Step 4:** tests PASS; `npm run app:update` builds; `otool -L` shows `@rpath/Sparkle.framework`; dev build launches with `--info` and logs no Sparkle start. Full update path is verified in Task 9's dry run.
- [ ] **Step 5: Commit** `Update release builds with Sparkle`.

### Task 8: Release notes replace the commit list

**Files:**
- Create: `web/server/releases.ts`, `web/server/releases.test.ts`
- Delete: `web/server/commits.ts`, its tests, `/api/commits` in `web/server/api/routes.ts`
- Modify: `web/server/api/routes.ts` (`GET /api/releases`)
- Rename/modify: `web/src/commits.ts` → `web/src/releases.ts`, `web/src/CommitsButton.tsx` → `web/src/ReleasesButton.tsx`
- Modify: `web/src/main.tsx` (palette entry: `show-commits` → `show-releases`, label "What's new", keywords `["release","notes","version","update","changelog"]`), `web/src/appCommands.ts`, any e2e referencing commits
- Delete: `web/server/checkout.ts` if no longer used (service.ts keeps its own copy or imports it — keep if still used)

**Interfaces:**
- Produces: `GET /api/releases` → `{ installed: string, releases: { version: string, date: string, notes: string, url: string }[], error?: string }`. Source: `https://api.github.com/repos/owenconti/paseo-command/releases?per_page=20`, unauthenticated, cached 1 h, last good answer kept on failure; `installed` = `PASEO_COMMAND_VERSION ?? "dev"`.
- Page: `useReleases()` → `{ installed, releases, pending: string | null, error }` (`pending` from the `paseo:update` event). Button dot when the newest release ≠ last seen (`readStore("releases-seen")`), as the commit dot works today. Notes render with the existing `react-markdown` setup.

- [ ] **Step 1: Failing tests** (`releases.test.ts`, fetch stubbed): maps GitHub JSON (`tag_name "v0.3.0"` → `version "0.3.0"`, `published_at`, `body`, `html_url`); drafts and prereleases excluded; second call within an hour doesn't fetch; `releaseNotesSurviveFetchFailure`: fetch rejects → `{installed, releases: <last good or []>, error: "Couldn't load release notes"}` with 200. Page unit test: `newSince` equivalent for versions.
- [ ] **Step 2:** FAIL. **Step 3:** implement; panel shows "Version X" header, "Update ready: Y — choose Restart app" when pending, then each release's notes.
- [ ] **Step 4:** `npm run app:test`, `npm run app:typecheck`, `npm run app:e2e` PASS.
- [ ] **Step 5: Commit** `Show release notes in place of the commit list`.

### Task 9: `npm run release` and its setup

**Files:**
- Create: `scripts/release-setup.mjs` (`"release:setup"`), `scripts/release.mjs` (`"release"`), `scripts/appcast.mjs` (pure appcast writer), `scripts/appcast.test.mjs`
- Modify: root `package.json`, `native/Info.plist` (`SUPublicEDKey` filled by setup)

**Interfaces:**
- `appcastXML({ version, build, date, url, length, edSignature, notesHTML, minimumSystemVersion: "14.0" }): string` — one-item Sparkle RSS with `sparkle:version`, `sparkle:shortVersionString`, `sparkle:edSignature`, `<enclosure>`.
- `npm run release:setup` (Owen, once, interactive): creates the self-signed code-signing identity `Paseo Command Release` in the login keychain if missing (openssl key + cert with codeSigning EKU, `security import`, `security add-trusted-cert -p codeSign`); runs Sparkle's `generate_keys` (from `.build/artifacts/sparkle/Sparkle/bin/`), writes the printed public key into `native/Info.plist`. Idempotent.
- `npm run release -- <version> [--notes <file>] [--dry-run]`:
  1. Refuse unless on `main`, clean, equal to `origin/main`, version > current and semver.
  2. `npm run public:check -- --history`, `app:test`, `render:test`, `native:test`.
  3. Set `package.json` version; build `app:build`, `app:bundle-server`, `bundle.sh --release`.
  4. `ditto -c -k --keepParent` → `native/release/Paseo-Command-<version>.zip`; `sign_update` → EdDSA signature; `appcastXML` → `native/release/appcast.xml`.
  5. Verify: `codesign --verify --deep --strict`, `sign_update --verify`, unzip to temp and `node --version` from the bundle.
  6. Notes: `--notes` file, else commit subjects since the previous release's commit (`gh release view --json targetCommitish`), opened in `$EDITOR` for editing.
  7. Unless `--dry-run`: commit `Release v<version>` (noreply email, attribution line), `git push origin main`, `gh release create v<version> --target <sha> --title "Paseo Command <version>" --notes-file … zip appcast.xml`.

- [ ] **Step 1: Failing test** `appcast.test.mjs`: output parses as XML, contains the exact enclosure URL `https://github.com/owenconti/paseo-command/releases/download/v0.2.0/Paseo-Command-0.2.0.zip`, `sparkle:edSignature`, `sparkle:shortVersionString="0.2.0"`, notes inside CDATA, and escapes `&` in titles.
- [ ] **Step 2:** FAIL. **Step 3:** implement all three scripts.
- [ ] **Step 4:** `node --test scripts/appcast.test.mjs` PASS; `npm run release -- 0.2.0 --dry-run --notes /dev/null` completes through step 5 on a machine with setup done (an agent without the identity reports the setup message and stops at step 3 — acceptable; Owen runs the full dry run).
- [ ] **Step 5: Commit** `Add the release command`.

### Task 10: Docs and agent workflow

**Files:**
- Modify: `README.md` (Install: download the zip from GitHub releases, drag to Applications, first open: System Settings → Privacy & Security → Open Anyway; needs Paseo; integrations; data location; "Building from source" with the current clone steps and `native:build` making "Paseo Command Dev"; remove the "keep it in the checkout" note), `RUNNING.md`, `native/README.md`, `CLAUDE.md` and `AGENTS.md` (identical): "Completing a feature" ends at push `main` plus `npm run app:update` as a build check of the dev flavour, never `release`; agents mention when a release is pending; structure entries for `releases.ts`, `ServerManager`/`OldInstall`/`Updater`, the bundle layout; replace the commits list description; `DIRECTORIES.md` if folders changed.
- [ ] **Step 1:** write; `npm run public:check` passes; every command named in the docs exists in `package.json`.
- [ ] **Step 2: Commit** `Document the downloadable app and the release flow`.

# Self-contained Paseo Command app — design

## Intent

Paseo Command becomes a Mac app other Paseo users download from GitHub releases,
drag into `/Applications` and open. They need nothing but Paseo itself: no clone,
no Node, no terminal. Today the `.app` only works inside a checkout, because it
starts the server from the checkout (`scripts/app-server.mjs`, Vite preview,
`web/node_modules`) with the user's own Node.

The owner (Owen) also stops running a checkout build day to day: he runs the
released app like everyone else, and his changes reach him through releases.

## Goals

- A single `.app` holds everything it runs: a Node runtime, the app server, and
  the built page. It works from any location, including `/Applications`.
- Releases ship **without Apple's Developer ID signing or notarization** (Owen's
  choice, for now). macOS blocks the first open; the README walks people through
  allowing it once (System Settings → Privacy & Security → Open Anyway). Adding a
  Developer ID and notarization later must need no other change.
- The app updates itself from GitHub releases with Sparkle: it checks, downloads
  in the background, and shows the existing "Update ready · Restart app" in the
  mode bar; **Restart app** (command palette, ⌘K) installs and relaunches.
- Releases are made from Owen's Mac by `npm run release`: build, sign, publish the
  GitHub release and update the Sparkle feed. No signing secret is stored on GitHub.
- Owen runs releases himself. Agents finishing a feature stop at pushing `main`
  (after their checks); they may remind him a release is pending.
- The panel header's commit list (`web/src/CommitsButton.tsx`, `web/server/commits.ts`,
  reading `git log` from the checkout) becomes **release notes**: the installed
  version, recent releases' notes, and what's new in a pending update, from the
  Sparkle feed / GitHub releases.
- Existing behaviour stays: the server binds `127.0.0.1` only, a browser on the
  same Mac can use it, integrations (gh, Linear, TypeSafe, Apple Music, Conquer)
  work as now, and the inherited React UI is unchanged apart from the commit list.

## Non-goals

- No Mac App Store build, no Windows/Linux.
- No CI release pipeline (GitHub Actions) in this change.
- No change to the map, panels or daemon behaviour.

## Anti-goals (a failure even if it works)

- Shipping a signing certificate, notarization password or any key in the
  repository or on GitHub.
- A release that macOS keeps blocking after the one-time Open Anyway, or an update
  that makes people allow it again or re-grant permissions (Automation for Music).
- Users losing their settings, presets, game scores or keys when moving to the
  bundled app.
- The server listening beyond loopback, or the update feed allowing an unsigned
  update (Sparkle updates must be EdDSA-signed; the private key stays on Owen's Mac).

## Constraints

- macOS 14+; built with the Command Line Tools (`swift build`, no Xcode project)
  as today. Sparkle comes in via Swift Package Manager.
- The bundled Node must meet the server's engines (`^20.19.0 || >=22.12.0`); use
  a current LTS. Its license goes into `THIRD_PARTY_NOTICES.md` / `licenses/`.
- Sparkle's EdDSA private key lives in Owen's keychain; the public key ships in
  `Info.plist`. Without a Developer ID, Sparkle relies on that EdDSA signature.
- The repo's publication rules apply (`npm run public:check -- --history`,
  noreply email, `main` only). Release artifacts are GitHub release assets,
  never committed.
- Daemon mutations are still tested against fake daemons only.

## Decided

- Distribution: GitHub releases of `owenconti/paseo-command`, as a
  `.dmg` or `.zip`, with a Sparkle appcast (`appcast.xml`) published with each
  release.
- Signing: no Developer ID or notarization for now; README explains Open Anyway.
- Updates: Sparkle auto-update, surfaced through the existing mode-bar prompt
  and **Restart app**.
- Releasing: local `npm run release`, run by Owen only.
- Commit list → release notes.

## Calls made by the designer (Owen to check)

- **Server inside the app.** The server is bundled into one JavaScript file
  (esbuild) and run by the bundled Node. The unused standalone helper in
  `web/server/native.ts` is the starting point: it serves a packaged `ui/`
  without Vite, binds loopback first, and exits when its owning app does
  (`PASEO_NATIVE_OWNER_PID`). So the bundled server **lives and dies with the
  app** rather than outliving it as today; a browser on the same Mac works while
  the app runs.
- **Port.** Stays `127.0.0.1:4310`. If 4310 is already taken by something else,
  the app says so rather than stopping it (as `native.ts` does).
- **Data location.** `~/Library/Application Support/Paseo Command/` holds what
  `.paseo-command/` holds today (`secrets.json`, `games.json`, forks, archived
  subagents, logs). `~/.paseo-command/settings.json` stays where it is. On first
  launch, if the app finds an old checkout data directory it knows of, it copies
  (never moves or deletes) it in; otherwise it starts fresh. The README explains
  how to copy it by hand.
- **Shell environment.** The bundled server is still started with the user's
  shell environment (`ShellEnvironment.swift`), so `gh`, `LINEAR_API_KEY` and
  `TYPESAFE_API_KEY` exported in their profile still reach it. Node itself no
  longer comes from it.
- **Architectures.** A universal app (arm64 and x86_64), with both Node builds
  joined by `lipo`.
- **Versions.** Semantic versions from `0.2.0`, kept in one place (the root
  `package.json` `version`), written into `Info.plist` at build;
  `npm run release` asks for or takes the next version and tags it.
- **Bundle identifier.** Changes from `local.paseo.command.native` to a stable
  reverse-DNS id (e.g. `io.github.owenconti.paseo-command`); Conquer's persisted
  state is migrated or the old one kept so tabs and cookies survive.
- **Development checks.** Agents and Owen still build and run a local copy from
  the checkout for checks (`native:build`, `native:run --no-server`,
  `native:mock`, fake daemons), now producing the same self-contained bundle.
  `app:dev` and `app:start` remain for browser-only development.
  `npm run app:update` no longer means "deliver to the user"; CLAUDE.md's
  "Completing a feature" section is rewritten accordingly.
- **README.** Setup becomes "download, drag to Applications, open"; the clone
  and Node steps move to a "Building from source" section.

- **Code signature.** Releases are signed with a stable self-signed code-signing
  certificate kept in Owen's keychain (made once by a setup script), not ad hoc,
  so each update keeps the same code identity: macOS's Automation permission and
  keychain access survive updates. A Developer ID can replace it later.
- **Check copies beside the released app.** Copies built from the checkout for
  checks get their own bundle id (e.g. `….dev`), a different default port (4331),
  their own data folder (`Paseo Command Dev`), and Sparkle off. They never touch
  the released app's server, data or Conquer state.
- **The old checkout server.** If the released app finds the old checkout launcher's
  server on 4310 (its state file under the temp folder, or the `com.paseo-command.serve`
  launchd agent from `service.ts`), it offers to stop it (and remove the launchd
  agent) and then starts its own; anything else on 4310 is reported, never stopped.
- **Copying old data.** Once, on a first launch with an empty data folder and after
  any old server is stopped: from the checkout named by the old launcher's state or
  the launchd agent, else none. Copy, never move. Later checkout data stays separate.
- **Working folder.** The bundled server runs in its data folder. The builder checks
  that nothing (helper agents in `workingOn.ts`/`askAnswers.ts`, forks, `mainCheckout()`)
  needs it to be this repository, and replaces any such use.

## Left to the builder

- Exact esbuild configuration, how Node is fetched at build time (pinned version
  and checksum), and the `.app` layout under `Contents/Resources`.
- `.dmg` vs `.zip`, and how the appcast is hosted (release asset vs a branch-free
  location; it must not push branches other than `main`).
- How release notes are written (from the commit subjects since the last tag,
  editable before publishing) and how the page reads them.
- How the existing `Build.newer` mode-bar check is replaced by Sparkle's state.
- Tests: the bundled server's start/stop and data-copy logic against fakes,
  `npm run release -- --dry-run` that builds and verifies signatures without
  uploading.

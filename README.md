# Paseo Command

A macOS command center for [Paseo](https://paseo.sh) coding agents. Follow hosts,
projects, workspaces and conversations on a painted Atlas, with agent controls,
pull request status, a native terminal panel, and the experimental Conquer browser.

SpriteKit draws the map underneath a React interface in a WKWebView. In a regular
browser the conversations and panels work; the map requires the macOS app.

## Install

1. Download the latest `Paseo-Command-<version>.dmg` from
   [GitHub Releases](https://github.com/owenconti/paseo-command/releases/latest)
   (a `.zip` of the same app is there too).
2. Open the disk image and drag **Paseo Command** onto the Applications shortcut beside it.
3. Open it. Releases are signed with a Developer ID and notarized by Apple, so macOS only asks
   once whether to open an app downloaded from the internet.

Requirements: a Mac with Apple silicon (M1 or later; Intel Macs aren't supported), macOS 14 or later, and [Paseo](https://paseo.sh) installed in Applications and
opened once, so its daemon is running (check with `paseo status`, or
`/Applications/Paseo.app/Contents/Resources/bin/paseo status`). Optional: the
[GitHub CLI](https://cli.github.com), signed in with `gh auth login`, for pull request and
review status. Node.js is not needed: the app carries its own.

The app runs its own local server on `http://127.0.0.1:4310` and stops it when it quits. It
reads your shell's environment (`~/.zprofile`, `~/.zshrc` and so on) once at launch, so `gh`
and the keys you export there apply even when it is opened from Finder.

If an old checkout server is still running on port 4310 when the released app starts, it offers
to stop it and then copies its keys, game scores and forks (once; the old folder is left
untouched). If you already stopped it, copy `secrets.json`, `games.json`, `forks.json` and
`archived-subagents.json` from `<checkout>/.paseo-command/` into
`~/Library/Application Support/Paseo Command/` by hand while the app is closed.

### Security

The app server listens on **127.0.0.1:4310 only**. It can read conversations and
control agents and terminals with your local daemon's permissions. It has no
network login. Do not expose it through shared hosting, port forwarding, proxies
or tunnels. See [SECURITY.md](SECURITY.md).

## Settings and integrations

Presets and the Linear workspace live in `~/.paseo-command/settings.json` and are edited
in the app. Runtime state (logs, game scores, forks, the TypeSafe key) is in
`~/Library/Application Support/Paseo Command/` (`logs/server.log` is the server's log). The
dev build from source uses `Paseo Command Dev/` beside it. Connect and authenticate hosts
through Paseo itself.

All integrations are optional:

- **GitHub**: `gh`, signed in, enables pull request and review status.
- **Linear**: `LINEAR_API_KEY` enables Linear issue details. Export it in your shell profile,
  then restart the app (⌘K → **Restart app**, or quit and open it).
- **TypeSafe**: a TypeSafe API key enables question detection and reply suggestions. Export
  `TYPESAFE_API_KEY` in your shell profile, or put `{"typesafeApiKey": "…"}` in
  `~/Library/Application Support/Paseo Command/secrets.json`, then restart the app. This sends
  candidate sentences from agent replies to TypeSafe. Helper summaries and drafted answers
  use the daemon's configured model provider.
- **Apple Music**: the music bar asks once for macOS Automation permission.
- **Conquer** keeps browser cookies and history locally. Importing Zen Browser's
  sessions is optional: use Conquer → Import Zen Cookies and confirm the import.

Do not commit keys, daemon configuration, browser profiles, runtime state, real
fleet snapshots or screenshots containing private conversations.

## Updating

The app checks for updates itself (Sparkle, from this repository's GitHub Releases). When one
is ready its mode bar shows **Update ready · Restart app**; choose **Restart app** in the
command palette (⌘K) to install it and reopen at the same page. **What's new** in ⌘K shows
the release notes.

## Troubleshooting

- **macOS says the app can't be opened**: make sure it's an Apple silicon Mac on macOS 14 or
  later, and that the app came from the GitHub release (a copy built from source isn't notarized).
- **Port 4310 in use**: another program holds the port. The app never stops it; quit that
  program (or the old checkout server, if the app offers to stop it) and restart the app.
- **"Paseo CLI was not found"**: install Paseo in `/Applications` or
  `~/Applications` and open it, or set `PASEO_COMMAND_CLI` to the `paseo` executable.
- **No hosts or "The local daemon isn't answering"**: open Paseo and check
  `paseo status`. To use a fixed daemon address, set `PASEO_COMMAND_DAEMON=host:port`
  (loopback only).
- **The app shows a blank page or no server**: read
  `~/Library/Application Support/Paseo Command/logs/server.log`, then restart the app.

## Building from source

```sh
git clone https://github.com/owenconti/paseo-command.git
cd paseo-command
npm run app:install   # installs rendering/ and web/ dependencies
npm run app:update    # tests, builds the web app, bundles the server, builds the app
npm run native:run    # opens Paseo Command Dev on http://127.0.0.1:4321, without taking focus
```

This needs Apple's Command Line Tools (`xcode-select --install`) and Node.js 20.19+ or 22.12+
with npm. `native:build` makes `native/build/Paseo Command Dev.app`, a separate app from the
released one (its own bundle id, port 4321 and data folder, and no updates). It carries its own
Node and server, so it can live anywhere, and it runs beside the released app.

### Testing changes before a release

Keep `native/build/Paseo Command Dev.app` (in the main checkout) open while changes are made. After
each change is merged, `npm run app:update` from the main checkout rebuilds it in place; the running
Dev app then shows **Update ready · Restart app** in its mode bar. Choose **Restart app** from its
command palette (⌘K): it restarts with the new page, server and app, at the same window position and page.
Once you're happy, ask an agent to cut a release; it chooses the version from the changes below.

Without the macOS app, `npm run app:dev` (development) or `npm run app:start` (built preview)
serves the app at http://127.0.0.1:4310 in any browser. Conversations and panels work there,
but the map is drawn only by the macOS app. Port 4310 is also the installed app's: while it
runs, use another port (`npm run app:dev -- --port 4311` or `npm run app:start -- --port 4311`). See [RUNNING.md](RUNNING.md) for ports, logs and
stopping the server, and [native/README.md](native/README.md) for native development and
checks against a mocked fleet.

### Releasing (maintainers)

Releases are signed with the maintainer's Developer ID (an Apple Developer Program membership)
and notarized. Once, on the maintainer's Mac, run `npm run release:setup`. It walks through three
things and keeps whatever already exists:

1. A **Developer ID Application** certificate in the login keychain. If there's none it says how to
   make one: a certificate request from Keychain Access, then developer.apple.com → Certificates →
   Developer ID Application, then double-click the downloaded `.cer`. It installs Apple's
   intermediate certificate if that's missing.
2. A **notarization login**, saved in the keychain as `paseo-command-notary` by
   `xcrun notarytool store-credentials`: your Apple ID, team and an app-specific password
   (account.apple.com → Sign-In and Security → App-Specific Passwords).
3. The **Sparkle update keys**: the private key stays in the keychain, and the public key
   (`SUPublicEDKey`) is written into `native/Info.plist` for you to commit and push.

With more than one Developer ID identity in the keychain, set `PASEO_COMMAND_SIGN_IDENTITY` to the
one to use. Then release from `main`. It needs the checkout on `main`, clean, a full (not shallow) clone and equal to
`origin/main` and `gh` signed in
(`--dry-run` only warns about the first three):

```sh
npm run release
# Optional flags:
npm run release -- --bump minor --notes notes.md --dry-run
```

No version is required. By default it increments the highest GitHub release's patch version
(for example, `0.2.1` → `0.2.2`). If `package.json` already has a newer version, or there are no
releases yet, it uses that version. `--bump patch|minor|major` explicitly increments the newer of
the package and published versions, resetting lower components. An exact version remains available
as an override (`npm run release -- 1.0.0`); it must be greater than the latest release.
The chosen version is printed before tests or builds, and existing releases and tags are never reused.

When asked to cut a release, an agent reviews the changes since the last published release:
fixes and maintenance get a patch, compatible new features get a minor, and incompatible changes
get a major once the app is at 1.0 (a minor while it is still at 0.x). It chooses the bump and writes
user-facing notes without asking you for a version. Asking to change release tooling alone does
not request a release.

It runs the checks and tests, builds `native/release/Paseo Command.app` (apart from
`native/build/`, where an older checkout app may live), signs it with your Developer ID under the
hardened runtime, has Apple notarize it (`xcrun notarytool submit --wait`, usually a few minutes),
staples the ticket and checks Gatekeeper accepts it, zips it (the zip is what Sparkle updates
download), makes `Paseo-Command-<version>.dmg` (the app beside an Applications shortcut; signed,
notarized and stapled too), writes the Sparkle appcast,
commits the version bump as `Release v<version>` (if package.json changes), pushes `main` and
creates the GitHub release with `gh release create`. The build number (the commit count) must be
greater than the published appcast's, so updates always install. `--dry-run` does everything,
notarization included, except commit, push and publish. The private keys stay in the keychain; nothing secret enters
the repository.

**Before the Developer ID is ready**, `npm run release:setup -- --unsigned` makes only the Sparkle
keys, and `npm run release -- --unsigned` publishes an ad hoc signed release that isn't
notarized: its notes tell people to choose System Settings → Privacy & Security → Open Anyway on
first open. Once the Developer ID works, run `npm run release:setup` again and release without
`--unsigned`; installed copies update to the notarized release through Sparkle (macOS asks for
Music's Automation permission once more, as the signature changes).

Before announcing a release, download the published zip in Safari, install it and confirm it opens
without a warning beyond macOS's usual first-open question; after 0.2.1, also confirm that an update installs.

#### Switching from the checkout app

For the maintainer moving from the app built in a checkout (`local.paseo.command.native`):

1. `npm run release:setup`, then commit the `SUPublicEDKey` change to `native/Info.plist`.
2. Push `main`.
3. `npm run release -- --dry-run`, and check its output.
4. `npm run release`.
5. Download `Paseo-Command-<version>.zip` from the release and drag the app to `/Applications`.
6. Quit the old checkout app.
7. Open the new app. It offers to stop the old server, then brings
   over the old app's tabs, settings and data.
8. Remove the old checkout app from the Dock and from Login Items.

## Development

```sh
npm run app:typecheck
npm run app:test
npm run app:e2e
npm run render:test
npm run native:test
npm run public:check
```

Tests use fake daemons. Never test mutations against a real fleet.

Run `npm run public:hooks` to install the local publication push guard. It checks
the exact history being pushed and refuses old private branches or tags. This
checkout publishes `main` only. `npm run check` runs every
check locally (this repository has no GitHub Actions), including a Gitleaks
credential scan when `gitleaks` is installed.

- `web/`: React panels and a local API built with the official Paseo SDK.
- `native/`: AppKit, WebKit, SpriteKit and SwiftTerm desktop application.
- `rendering/`: shared map geometry, placement rules, generated art and painters.
- `scripts/`: local server launcher and publication checks.

Artwork provenance is recorded in [rendering/ASSETS.md](rendering/ASSETS.md).
External visual references and retired third-party prototype files are excluded
from this repository. Screenshots in `web/landing/shots/` show sample fleets and
include views of retired renderers; the current app draws the Atlas with SpriteKit.

## License

Original project code and artwork are provided under the [MIT license](LICENSE),
to the extent rights are held by the project. Dependencies and fonts retain their
own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.
Provider names and marks identify integrations and do not imply endorsement.

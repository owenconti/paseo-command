# Paseo Command

A macOS command center for [Paseo](https://paseo.sh) coding agents. Follow hosts,
projects, workspaces and conversations on a painted Atlas, with agent controls,
pull request status, a native terminal panel, and the experimental Conquer browser.

SpriteKit draws the map underneath a React interface in a WKWebView. In a regular
browser the conversations and panels work; the map requires the macOS app.

## Install

1. Download the latest `Paseo-Command-<version>.zip` from
   [GitHub Releases](https://github.com/owenconti/paseo-command/releases/latest).
2. Unzip it and drag **Paseo Command** to Applications.
3. Open it. Releases are not notarized by Apple, so the first open is blocked: choose
   **System Settings → Privacy & Security → Open Anyway** for Paseo Command, then open it
   again. Later opens and updates need nothing.

Requirements: macOS 14 or later, and [Paseo](https://paseo.sh) installed in Applications and
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

- **macOS says the app can't be opened, or is from an unidentified developer**: open System
  Settings → Privacy & Security, scroll to the message about Paseo Command and choose
  **Open Anyway**.
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
Node and server, so it can live anywhere.

Without the macOS app, `npm run app:dev` (development) or `npm run app:start` (built preview)
serves the app at http://127.0.0.1:4310 in any browser. Conversations and panels work there,
but the map is drawn only by the macOS app. See [RUNNING.md](RUNNING.md) for ports, logs and
stopping the server, and [native/README.md](native/README.md) for native development and
checks against a mocked fleet.

### Releasing (maintainers)

Once, on the maintainer's Mac: `npm run release:setup` creates the self-signed code-signing
identity "Paseo Command Release" in the login keychain and the Sparkle update keys, and writes
the public key (`SUPublicEDKey`) into `native/Info.plist` for you to commit and push. Then, from
`main`. It needs the checkout on `main`, clean and equal to `origin/main`, `gh` signed in, and a
version greater than the latest GitHub release (`--dry-run` only warns about the first three):

```sh
npm run release -- 0.2.1 [--notes notes.md] [--dry-run]
```

It runs the checks and tests, builds and signs `Paseo Command.app`, zips it, writes the Sparkle
appcast, commits the version bump as `Release v0.2.1` (if package.json changes), pushes `main` and creates the GitHub release with
`gh release create`. `--dry-run` does everything except commit, push and publish. The
private keys stay in the keychain; nothing secret enters the repository.

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
checkout publishes `main` only. Gitleaks also checks credential patterns in CI.

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

# Paseo Command

A macOS command center for [Paseo](https://paseo.sh) coding agents. Follow hosts,
projects, workspaces and conversations on a painted Atlas, with agent controls,
pull request status, a native terminal panel, and the experimental Conquer browser.

SpriteKit draws the map underneath a React interface in a WKWebView. In a regular
browser the conversations and panels work; the map requires the macOS app.

## Setup

### 1. Prerequisites

- macOS 14 or later.
- Apple's Command Line Tools: `xcode-select --install` (Xcode itself is not needed).
- Node.js 20.19+ or 22.12+, with npm. Check with `node --version`.
- [Paseo](https://paseo.sh), installed in Applications and opened once, so its daemon
  is running. Check with `paseo status` (or
  `/Applications/Paseo.app/Contents/Resources/bin/paseo status`).
- Optional: the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`,
  for pull request and review status.

### 2. Install and build

```sh
git clone https://github.com/owenconti/paseo-command.git
cd paseo-command
npm run app:install   # installs rendering/ and web/ dependencies
npm run app:update    # runs tests, builds the web app and the macOS app
```

The macOS app is built at `native/build/Paseo Command.app`.

### 3. Run

```sh
npm run native:run
```

The app starts its local server (`http://127.0.0.1:4310`) itself and keeps it
running after you quit; `npm run app:stop` stops it. The app opens in the
background, so switch to it from the Dock.

The server is started with a login shell (`zsh -l`), so `node` must be on the
`PATH` set in `~/.zprofile` or `~/.zshenv`, not only in `~/.zshrc`. If you use a
Node version manager that is set up only in `~/.zshrc`, start the server yourself
first with `npm run app:start`.

### 4. Updating

```sh
git pull
npm run app:install
npm run app:update
```

The running app then shows **Update ready · Restart app**. Choose **Restart app**
from the command palette (⌘K) to apply it.

### Without the macOS app

`npm run app:dev` (development) or `npm run app:start` (built preview) serves the
app at http://127.0.0.1:4310 in any browser. Conversations and panels work there,
but the map is drawn only by the macOS app. See [RUNNING.md](RUNNING.md) for ports,
logs and stopping the server, and [native/README.md](native/README.md) for native
development and checks against a mocked fleet.

### Troubleshooting

- **"Paseo CLI was not found"**: install Paseo in `/Applications` or
  `~/Applications` and open it, or set `PASEO_COMMAND_CLI` to the `paseo` executable.
- **No hosts or "The local daemon isn't answering"**: open Paseo and check
  `paseo status`. To use a fixed daemon address, set `PASEO_COMMAND_DAEMON=host:port`
  (loopback only).
- **The app shows a blank page or no server**: run `npm run app:status`, and check
  the log path it prints.

### Security

The app server listens on **127.0.0.1:4310 only**. It can read conversations and
control agents and terminals with your local daemon's permissions. It has no
network login. Do not expose it through shared hosting, port forwarding, proxies
or tunnels. See [SECURITY.md](SECURITY.md).

## Settings and integrations

Settings and preset prompts live in `~/.paseo-command/settings.json` and are
edited in the app. Runtime state (logs, game scores, keys) is kept in
`.paseo-command/` in the checkout, which git ignores; set `PASEO_COMMAND_DATA` to
keep it elsewhere. Connect and authenticate hosts through Paseo itself.

All integrations are optional:

- **GitHub**: `gh`, signed in, enables pull request and review status.
- **Linear**: `LINEAR_API_KEY` enables Linear issue details. Set it in
  `~/.zprofile` (or the environment of `npm run app:start`) and restart the server
  with `npm run app:restart`.
- **TypeSafe**: a TypeSafe API key enables question detection and reply
  suggestions. Put it in `.paseo-command/secrets.json` as
  `{"typesafeApiKey": "…"}`, or set `TYPESAFE_API_KEY`. This sends candidate
  sentences from agent replies to TypeSafe. Helper summaries and drafted answers
  use the daemon's configured model provider.
- **Apple Music**: the music bar asks once for macOS Automation permission.
- **Conquer** keeps browser cookies and history locally. Importing Zen Browser's
  sessions is optional: use Conquer → Import Zen Cookies and confirm the import.

Do not commit keys, daemon configuration, browser profiles, runtime state, real
fleet snapshots or screenshots containing private conversations.

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

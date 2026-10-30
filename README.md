# Paseo Command

A macOS command center for [Paseo](https://paseo.sh) coding agents. Follow hosts,
projects, workspaces and conversations on a painted Atlas, with agent controls,
pull request status, a native terminal panel, and the experimental Conquer browser.

SpriteKit draws the map underneath a React interface in a WKWebView. In a regular
browser the conversations and panels work; the map requires the macOS app.

## Build and run

Requires macOS 14 or later, Apple's Command Line Tools (`xcode-select --install`),
Node.js 22.12 or later, npm, and a configured Paseo CLI and daemon. GitHub features
also use the `gh` CLI with your own authenticated account.

```sh
npm run app:install
npm run app:update
npm run native:run
```

For web development, use `npm run app:dev`. For a detached web preview, build and
run `npm run app:start` from your terminal. See [RUNNING.md](RUNNING.md) for
updates, ports, logs and stopping the server, and [native/README.md](native/README.md)
for native development and fake-fleet checks.

The app server listens on **127.0.0.1:4310 only**. It can read conversations and
control agents and terminals with your local daemon's permissions. It has no
network login. Do not expose it through shared hosting, port forwarding, proxies
or tunnels. See [SECURITY.md](SECURITY.md).

## Settings and integrations

Settings and preset prompts live in `~/.paseo-command/settings.json`; runtime state
is kept in the ignored `.paseo-command/` directory. Connect and authenticate hosts
through Paseo using your own configuration.

- `gh` enables pull request and review status.
- `LINEAR_API_KEY` optionally enables Linear issue details.
- `TYPESAFE_API_KEY` optionally enables question detection and reply suggestions.
  This sends candidate sentences from agent replies to TypeSafe. Helper summaries
  and drafted answers use the daemon's configured model provider.
- Apple Music controls use macOS Automation permission.
- Conquer keeps browser cookies and history locally. Importing Zen Browser's
  sessions is optional: use Conquer → Import Zen Cookies and confirm the import.
  Existing sessions from earlier versions remain until you clear them.

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

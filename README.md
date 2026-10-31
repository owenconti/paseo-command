# Paseo Command

A macOS command center for [Paseo](https://paseo.sh) coding agents. See your hosts,
projects, workspaces and agents on a painted map, then open a conversation to follow
the work or send a message.

## Requirements

- **An Apple silicon Mac** (M1 or later). Intel Macs are not supported.
- **macOS 14 or later.**
- **[Paseo](https://paseo.sh)** installed in Applications and opened at least once,
  with its daemon running.

You do not need to install Node.js: Paseo Command includes its own copy.
The integrations below are optional.

## Install

1. Download `Paseo-Command-<version>.dmg` from
   [the latest release](https://github.com/owenconti/paseo-command/releases/latest).
2. Open the disk image and drag **Paseo Command** onto the **Applications** shortcut.
3. Open **Paseo Command** from Applications.

The app is signed with a Developer ID and notarized by Apple. On first launch,
macOS may ask you to confirm that you want to open an app downloaded from the internet.

## Get started

Connect and authenticate your hosts in Paseo first. Paseo Command reads those
connections from Paseo's daemon.

- Browse **Hosts** and **Projects**, or select a workspace or agent on the map.
- Open an agent to read its conversation and send messages.
- Use **New agent** to start work in a project or worktree.
- Press **⌘K** to find actions in the command palette, including terminal controls,
  navigation and settings.

Alongside the map and conversations, the app includes a native terminal panel,
pull request status, a Linear issues view and the experimental **Conquer** browser.
The map requires the macOS app; conversations and panels also work in a regular browser.

## Optional integrations

- **GitHub:** Install the [GitHub CLI](https://cli.github.com) and sign in with
  `gh auth login` to enable pull request and review status.
- **Linear:** Export `LINEAR_API_KEY` in your shell profile to enable your assigned
  issues and their details. Choose your Linear workspace in the app's settings.
- **TypeSafe:** Export `TYPESAFE_API_KEY` to enable question detection and reply
  suggestions. You can also save `{"typesafeApiKey": "…"}` in
  `~/Library/Application Support/Paseo Command/secrets.json`. Candidate sentences
  from agent replies are sent to TypeSafe; helper summaries and drafted answers use
  the daemon's configured model provider.
- **Apple Music:** Use the music bar to control playback. macOS asks for Automation
  permission the first time it is needed.

Paseo Command reads your shell environment at launch, including `~/.zprofile` and
`~/.zshrc`, so exported keys and the GitHub CLI are available when you open it from
Finder. After changing them, choose **Restart app** in the command palette (⌘K).

## Updates

The app checks for updates about once an hour. To check immediately, choose
**Check for Updates…** in the app menu or **Check for updates** in the command palette.

When the mode bar shows **Update ready · Restart app**, choose **Restart app** in
the command palette to install the update. The app returns to the same page.
Choose **What's new** in the command palette to read release notes.

## Settings and local data

Presets and your Linear workspace are edited in the app and saved in
`~/.paseo-command/settings.json`.

Logs, game progress, conversation forks and local credentials are stored in
`~/Library/Application Support/Paseo Command/`. The server log is
`logs/server.log` within that folder. Conquer also keeps its browser cookies and
history locally.

## Security

Paseo Command starts a local server at **http://127.0.0.1:4310** and stops it when
the app quits. It listens on this machine only and can read conversations and
control agents and terminals with your Paseo daemon's permissions.

The server has no network login. Do not expose it through shared hosting, port
forwarding, proxies or tunnels. Keep API keys, daemon configuration, browser
profiles and private conversations out of Git. See [SECURITY.md](SECURITY.md).

## Troubleshooting

- **No hosts or “The local daemon isn't answering”:** Open Paseo and check
  `paseo status`. If `paseo` is not on your PATH, use
  `/Applications/Paseo.app/Contents/Resources/bin/paseo status`.
- **“Paseo CLI was not found”:** Install Paseo in `/Applications` or
  `~/Applications` and open it. For a custom location, set `PASEO_COMMAND_CLI` to
  the `paseo` executable in your shell profile, then restart Paseo Command.
- **Port 4310 is in use:** Quit the program using that port, then restart Paseo Command.
- **Blank page or server error:** Check
  `~/Library/Application Support/Paseo Command/logs/server.log`, then restart the app.
- **macOS cannot open the app:** Confirm that your Mac has Apple silicon, runs
  macOS 14 or later, and that you downloaded the app from this repository's releases.

## Building from source

Development requires Apple's Command Line Tools (`xcode-select --install`) and
Node.js 20.19+ or 22.12+ with npm.

```sh
git clone https://github.com/owenconti/paseo-command.git
cd paseo-command
npm run app:install
npm run app:update
npm run native:run
```

This builds **Paseo Command Dev** at `native/build/Paseo Command Dev.app`. It uses
port **4321** and stores its data in
`~/Library/Application Support/Paseo Command Dev/`. Rebuild with `npm run app:update`,
then choose **Restart app** in the Dev app's command palette to load your changes.

For a browser preview, run `npm run app:dev -- --port 4311`. The panels work in the
browser; SpriteKit draws the map in the macOS app.

Run `npm run check` for publication checks, a credential scan when Gitleaks is
installed, tests and builds. Run `npm run app:e2e` for browser tests. Tests use fake
daemons; never test mutations against a real fleet. Use `npm run public:hooks` to
install the local publication push guard.

See [RUNNING.md](RUNNING.md) for server commands and
[native/README.md](native/README.md) for native development and mock-fleet checks.
Maintainer release instructions are in [AGENTS.md](AGENTS.md#cutting-a-release).

## License

Original project code and artwork are provided under the [MIT license](LICENSE),
to the extent rights are held by the project. Dependencies and fonts retain their
own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.
Artwork provenance is recorded in [rendering/ASSETS.md](rendering/ASSETS.md).
Provider names and marks identify integrations and do not imply endorsement.

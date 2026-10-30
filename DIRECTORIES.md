# Local app directories

The current app is `/Users/example/development/paseo-command`, on local `main`.
It contains the SpriteKit native app (`native/`), React panels and API (`web/`),
shared Atlas layout and art (`rendering/`). The cached Phaser prototype (`game/`),
engine (`phaser/`) and generated prototype build (`dist/`) were removed at the user’s request.

## Linked worktrees

Use Paseo's default allocation under `~/.paseo/worktrees/<project-hash>/<slug>/`.
There is no custom worktree command, root override or placement plugin for this app.
Create new worktree workspaces through Paseo, using local `main` as the base for
this local-only repository.

The existing current-app checkouts were moved into
`~/.paseo/worktrees/280r21aw/`, using the installed Paseo allocator's hash:

- `add-project/` — branch `add-project`.
- `agent-a0f87fc4c43b16ea1/` — branch `worktree-agent-a0f87fc4c43b16ea1`.
- `dom-atlas/` — branch `dom-atlas` (older renderer experiment).

Git's worktree registrations were updated and each checkout's commit and
uncommitted changes verified after moving. These existing checkouts were created
outside Paseo; relocating them does not register new Paseo workspaces.
Use `git worktree list` to inspect them. Do not remove unfinished work.

## Preserved history and assets

Everything previously spread across sibling app folders is retained in ignored
`archive/`, without deleting files or discarding branches:

- `legacy-app/` — original React/Unity-era repository, retained read only.
- `legacy-app/worktrees/themes/` — former `paseo-command-themes` checkout.
- `legacy-app/worktrees/theme-preview/` — former `paseo-command-theme-preview`.
- `legacy-app/worktrees/req-multihost-checks/` — former `paseo-command-req/req-multihost-checks`, including its uncommitted work.
- `art/` — former `paseo-command-art`, including its asset mapping and provenance.
- `git-backup-2026-10-25/` — untouched historical Git backup; its old worktree metadata is a snapshot, not the live registry.
- `pre-rewrite-2026-10-25.bundle` — original Git bundle backup.

Both live repositories' Git worktree links were repaired after the move.
`archive/` and local `.paseo-command/` state are ignored by Git.
Historical worktrees in `archive/legacy-app/worktrees/` remain with their archived repository.

## Compatibility and running app

`/Users/example/development/paseo-cc-phaser-ae`, the former compatibility symlink,
was removed at the user’s request. Use the canonical `paseo-command` path.
The old app's files are in `archive/legacy-app`; `paseo-command` now belongs
to the SpriteKit app. Historical documents may still describe the original paths.

Build locally from the main checkout with `npm run app:update` (a build check; it makes the dev
flavour `native/build/Paseo Command Dev.app`). The released app is installed from GitHub Releases and
updates itself. Ignored build outputs: `web/dist/`, `web/dist-server/`, `native/build/`, `native/.cache/`
(downloaded Node) and `native/release/` (the release app, zip and appcast).

# Local app directories

The current app is `/Users/example/development/paseo-command`, on local `main`.
It contains the SpriteKit native app (`native/`), React panels and API (`web/`),
shared Atlas layout and art (`rendering/`), and the cached Phaser prototype
(`game/` and ignored `phaser/`). The prototype is retained but is not used by the app.

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

`/Users/example/development/paseo-cc-phaser-ae` is a symlink to this directory,
not another copy. It preserves existing sessions and the running native app's
cached executable/server paths. Keep it until those sessions have ended and
the native app has loaded the new build via ⌘R. New work should use the canonical path.
The old app's files are in `archive/legacy-app`; its former pathname now belongs
to the SpriteKit app. Historical documents may still describe the original paths.

Build and update locally from the main checkout with `npm run app:update`.
This keeps the existing native window open; press ⌘R when ready to load the update.

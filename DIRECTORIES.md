# Local app directories

The current app is `/Users/example/development/paseo-command`, on local `main`.
It contains the SpriteKit native app (`native/`), React panels and API (`web/`),
shared Atlas layout and art (`rendering/`), and the cached Phaser prototype
(`game/` and ignored `phaser/`). The prototype is retained but is not used by the app.

## Linked worktrees

Current repository checkouts live in `worktrees/`:

- `add-project/` — branch `add-project`.
- `agent-a0f87fc4c43b16ea1/` — branch `worktree-agent-a0f87fc4c43b16ea1`.
- `dom-atlas/` — branch `dom-atlas` (older renderer experiment).

Create a new branch and checkout from local main:

```sh
npm run worktree:add -- my-feature
# Optional explicit start point:
npm run worktree:add -- my-feature refs/heads/main
```

The helper always resolves the main repository and places the checkout at
`worktrees/<branch>`; branch slashes become `--`. Git has no default directory
setting for `git worktree add`, so use this helper or explicitly supply a path
inside this folder. These instructions apply to human and agent-created checkouts;
external tools that manage their own worktree paths need their own configuration.
Use `git worktree list` to inspect and `git worktree remove <path>` when finished.
Do not remove a checkout containing unfinished work.

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
`archive/`, `worktrees/` and local `.paseo-command/` state are ignored by Git.

## Compatibility and running app

`/Users/example/development/paseo-cc-phaser-ae` is a symlink to this directory,
not another copy. It preserves existing sessions and the running native app's
cached executable/server paths. Keep it until those sessions have ended and
the native app has loaded the new build via ⌘R. New work should use the canonical path.
The old app's files are in `archive/legacy-app`; its former pathname now belongs
to the SpriteKit app. Historical documents may still describe the original paths.

Build and update locally from the main checkout with `npm run app:update`.
This keeps the existing native window open; press ⌘R when ready to load the update.

# PR status labels and flags — design

## Intent

Owen wants to see, at a glance on the Atlas, where each workspace's pull request stands:
whether CI is running, green or failing, and whether it is awaiting review, approved or has
changes requested. The status should be **real Paseo workspace labels**, so Paseo's own app
shows the same thing, and **the map should draw from those labels**, not from its own GitHub
lookup. On the map it appears as two painted flags planted on the workspace's land.

## Goals

- Paseo Command's server keeps two Paseo workspace labels per workspace in step with its PR:
  one for CI, one for review.
- The Atlas plants a CI flag and a review flag on each labelled workspace, read from those
  labels.
- The status stays truthful: flags show only states GitHub reported; no PR, merged or closed means
  no flags. A failed lookup keeps the last known labels rather than guessing.

## Non-goals

- Agents get no PR labels (a PR belongs to a workspace). *(my call)*
- The Galaxy world is unchanged for now. *(my call)*
- No Paseo plugin; nothing runs inside the daemon (Owen chose the app server).
- Merge queue standing is not labelled.

## Anti-goals

- Touching labels outside the six. The six names belong to the labeller: setting or removing one
  of them by hand is overwritten on the next pass (Owen chose this; no record of who assigned what).
- Writes to a real daemon from tests; all labeller tests run against `web/server/fake-daemon.ts`.
- Any publishing, upload or network use beyond the existing read-only `gh` lookups and the
  user's own Paseo daemons.

## Labels (decided)

Six labels, in two groups. A workspace carries at most one from each group.

| Group  | Name                | Colour (Paseo) | Flag glyph       |
|--------|---------------------|----------------|------------------|
| CI     | `CI running`        | amber          | hourglass        |
| CI     | `CI green`          | emerald        | check            |
| CI     | `CI failing`        | red            | cross            |
| Review | `Awaiting review`   | sky            | eye              |
| Review | `Approved`          | violet         | laurel and check |
| Review | `Changes requested` | orange         | quill            |

Mapping from PR facts:
- No PR, or PR merged or closed: neither label.
- CI: from the PR's folded CI state (`pending` → running, `passing` → green, `failing` → failing,
  `none`/unknown → no CI label).
- Review: draft PRs get no review label *(Owen agreed)*. Open PRs: `approved` → Approved,
  `changes_requested` → Changes requested, otherwise (pending, or no decision) → Awaiting review.

## The labeller (server)

- Runs in Paseo Command's server (`web/server/`) while the app runs; labels go stale while it
  is stopped (Owen accepted this).
- PR facts come from the existing lookup in `web/server/links.ts`: Paseo's
  `githubRuntime.pullRequest` first (covers remote hosts; it includes `checks`/`checksStatus`
  and `reviewDecision`), falling back to the read-only `gh pr view` in a local checkout, which
  should add `reviewDecision` to its `--json` fields. Remote checkouts without Paseo facts are
  skipped.
- Writes go through the SDK's `setWorkspaceLabel({ workspaceId, label: { name, color }, assigned })`,
  as `labelWorkspace` in `web/server/api/workspaces.ts` already does, on each host with write
  access.
- Each pass computes the wanted pair per workspace, and only sends changes: assign the wanted
  label, unassign the other owned labels of that group. Labels outside the six are never
  touched. If a label already exists in the host's catalog with a different colour, the
  daemon's colour is kept.
- Cadence: its own server loop over every workspace on every host while the app runs (the
  existing 15 s refresh is the browser's, for the one workspace on screen). About every 30 s;
  Paseo's facts first, `gh` only as the fallback, reusing `ghPullRequest`'s cache. *(my call)*
- Failures: only a definite answer (no PR, merged, closed) removes labels. A failed or
  impossible lookup (gh missing or erroring, remote checkout without Paseo facts, daemon write
  error) leaves the workspace's labels as they are, is logged, and never surfaces as a UI
  error. *(my call: avoids flags flickering on a gh hiccup)*

## The map (Atlas)

- Workspace labels already reach the web app (`Workspace.labels` via `web/server/rows.ts`).
  `web/src/NativeWorld.tsx` passes them through to the Atlas entity; `rendering/` maps the six
  names to flag frames. Unknown labels are ignored on the map.
- **Placement (Owen chose):** the two flags stand on the two cells of the workspace's triangle
  that are furthest from the landmark: CI flag on the left one, review flag on the right one
  (for a workspace below its landmark, screen left and right as in the approved mockup; other slots turn with the workspace). There they **replace** the
  garden's plant in that cell (`garden()` in `rendering/src/AtlasScene.ts`). The cell
  nearest the landmark keeps its plant. With no flag for a cell, that cell keeps its plant as today.
- **Size (Owen chose):** the large size from the mockup, about 50 px tall at the default zoom
  (the scale is set relative to the cell). Each flag fits wholly inside its own cell, its pole
  foot on the cell's decking, like the other sprites.
- **Motion:** only the `CI running` flag sways gently (a small skew around the pole foot, in the
  scene's existing animation steps). The others stand still.
- Stale or offline workspaces show their last flags faded, as their plants fade now.
- Camps (agents without a workspace) never show flags.
- Flags are not interactive by themselves; hovering or picking them behaves as the workspace.
- The legend gains a short "Workspace flag · PR" section for the six states. *(my call)*

## Art

- `design/pr-status/flags.png`: GPT-6.1-Sol's 3×2 transparent atlas (top row CI, bottom row
  review; square cloths for CI, swallowtails for review; brass-footed poles with aligned bases).
  Prompts and provenance are in `design/pr-status/NOTES.md`.
- The build copies it to `rendering/src/assets/flags.png` and adds an entry to
  `rendering/ASSETS.md` in its usual style. The emblem atlas (`emblems.png`) and the
  alternates stay in `design/` as references.

## Testing

- Labeller: unit tests for the PR → label-pair mapping; an integration test against the fake
  daemon checking label assignment and removal, that labels outside the six are untouched, and that a failed
  lookup leaves labels in place.
- Atlas: layout/scene test that flagged workspaces put flags in the two outer cells and drop
  those plants; an e2e check (`web/e2e`, mocked fleet) that a workspace with labels shows flags.

## Left to the builder

- Exact flag scale and offset within each cell, within "about 50 px and wholly inside the cell".
- Sway amplitude and timing.
- Whether the labeller lives in its own module (suggested: `web/server/prLabels.ts`) and how it
  schedules its loop.

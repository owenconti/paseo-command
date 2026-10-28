# PR Status Labels and Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label each workspace with its PR's CI and review state as Paseo workspace labels, and plant matching flags on the workspace in the Atlas, read from those labels.

**Architecture:** A pure shared vocabulary (`rendering/src/prStatus.ts`) names the six labels, their colours and groups. The app server runs a labeller loop (`web/server/prLabels.ts`) that reads workspace rows (Paseo's PR facts, else `gh`) and sends only label changes through `setWorkspaceLabel`. Labels already reach the browser on workspace rows; the world snapshot carries them to the Atlas, which turns them into two flags drawn in the workspace's two yard cells in place of their plants.

**Tech Stack:** TypeScript, Node (`tsx --test`, `node:test`), `@getpaseo/client` SDK, Phaser 4, React, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-28-pr-status-labels-design.md`

## Global Constraints

- Local only: never publish, upload, push, or contact phaser.io. Tests never reach a real daemon (fake daemon / injected clients only).
- Label names, exact: `CI running`, `CI green`, `CI failing`, `Awaiting review`, `Approved`, `Changes requested`. Colours: amber, emerald, red, sky, violet, orange respectively.
- A workspace carries at most one CI and one review label. Labels outside the six are never touched; the six are owned by the labeller (hand edits to them are overwritten).
- Only a definite answer removes labels: no PR, PR merged, PR closed. Failed/impossible lookups and stale host rows leave labels as they are.
- Draft PR: CI label only, no review label. Open PR review: `approved` → Approved, `changes_requested` → Changes requested, else Awaiting review. CI: `pending` → running, `passing` → green, `failing` → failing, `none`/unknown → no CI label.
- If a label already exists in the host's catalog, send the catalog's colour, not ours.
- Labeller loop about every 30 s; one per process; stopped when the last server closes.
- Map: flags only from labels. CI flag in the workspace's `cells[1]`, review flag in `cells[2]` (for a workspace below its landmark these are the screen-left and screen-right yard cells, as in the approved mockup; `world.ts` turns them consistently for other slots). A flag replaces that cell's garden plant; `cells[0]` (cottage) keeps its plant. About 50 px tall at default zoom, scaled relative to the cell, wholly inside its cell. Only `CI running` sways. Stale workspaces show flags at the plants' faded alpha (0.6). Camps never show flags. Flags are not separately interactive.
- Labels stay at fixed world scale; no screen-size compensation (CLAUDE.md).
- Galaxy unchanged. Agents get no PR labels.
- One commit per task; finish on local `main`, then `npm run app:build && npm run app:restart` from the main checkout.

## Review Focus

1. **A host goes stale or offline mid-pass** → its rows are `stale: true`; the labeller must not write to it or strip its labels. (Task 3 test `stale rows are left alone`.)
2. **`gh` missing or erroring for a local workspace without Paseo facts** → labels stay as they were, not removed. (Task 3 test `an unknown PR keeps its labels`.)
3. **A workspace on `main`/`master`** → definitely no PR: any PR labels are removed. (Task 3 test `a base branch has no PR labels`.)
4. **Label catalog already has `Approved` in another colour (user recoloured it)** → labeller assigns with the catalog colour and doesn't fight it. (Task 3 test `catalog colours win`.)
5. **A workspace whose labels include an unknown name or both a stale CI label and a new one** (e.g. `CI green` left over plus `CI running` wanted) → after one pass exactly one CI label remains; on the map, an unknown name draws nothing and a duplicated group picks the most urgent (`CI failing` > `CI running` > `CI green`; `Changes requested` > `Awaiting review` > `Approved`). (Task 2 test `prFlags picks one per group`, Task 3 test `a stale CI label is replaced`.)

---

### Task 1: Review decision on PR facts

**Files:**
- Modify: `web/server/links.ts` (`PullRequest` type ~line 27, `prFromRuntime` ~291, `ghPr` ~361, `ghPullRequest` `--json` fields ~402)
- Modify: `web/src/types.ts` (`PullRequest` ~94, mirror the field)
- Test: `web/server/links.test.ts`

**Interfaces:**
- Produces: `export type ReviewState = "pending" | "approved" | "changes_requested";` and `PullRequest.review?: ReviewState` (absent when unknown).

- [ ] **Step 1: Write failing tests** in `links.test.ts`:
  - `test("Paseo's review decision is carried through")`: `prFromRuntime({ pullRequest: { url: "https://github.com/o/r/pull/7", number: 7, state: "open", reviewDecision: "approved" } })?.review === "approved"`; same for `"changes_requested"` and `"pending"`; `reviewDecision: null` or absent → `review` is `undefined`.
  - `test("gh's review decision is read")`: `ghPr({ url: "https://github.com/o/r/pull/7", number: 7, state: "OPEN", reviewDecision: "APPROVED" })?.review === "approved"`; `"CHANGES_REQUESTED"` → `"changes_requested"`; `"REVIEW_REQUIRED"` → `"pending"`; `""` → `undefined`.
- [ ] **Step 2: Run** `npm --prefix web test -- --test-name-pattern="review decision"` → FAIL (`review` undefined).
- [ ] **Step 3: Implement**: add `ReviewState`, `review?` to both `PullRequest` types; read it in `prFromRuntime` and `ghPr` (spread only when known, as `ci` is); add `reviewDecision` to the `gh pr view --json` list.
- [ ] **Step 4: Run** `npm --prefix web test` → all PASS; `npm run app:typecheck` → clean.
- [ ] **Step 5: Commit** `git commit -m "Read PR review decisions from Paseo and gh"`.

### Task 2: Shared PR status vocabulary

**Files:**
- Create: `rendering/src/prStatus.ts` (pure, no imports)
- Test: `rendering/tests/prStatus.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type PrFlag = "ci-running" | "ci-green" | "ci-failing" | "review-awaiting" | "review-approved" | "review-changes";
  export type PrGroup = "ci" | "review";
  export const PR_LABELS: readonly { flag: PrFlag; group: PrGroup; name: string; color: "amber"|"emerald"|"red"|"sky"|"violet"|"orange" }[];
  export function prFlags(labels: readonly string[] | undefined): { ci?: PrFlag; review?: PrFlag };
  ```
  `PR_LABELS` order is the atlas order (top row CI running/green/failing, bottom row awaiting/approved/changes) and the legend order. Names and colours are the Global Constraints values.

- [ ] **Step 1: Write failing tests** (`prStatus.test.mjs`, import from `../src/prStatus.ts`):
  - `PR_LABELS` has six entries with exactly the names/colours above.
  - `prFlags(["CI running", "Awaiting review", "bug"])` → `{ ci: "ci-running", review: "review-awaiting" }`.
  - `prFlags(undefined)` and `prFlags(["bug"])` → `{}`.
  - `prFlags picks one per group`: `prFlags(["CI green", "CI failing"]).ci === "ci-failing"`; `prFlags(["Approved", "Changes requested"]).review === "review-changes"`. Urgency: failing > running > green; changes > awaiting > approved.
  - Name matching is exact (`"ci running"` → `{}`).
- [ ] **Step 2: Run** `npm run render:test` → FAIL (module missing).
- [ ] **Step 3: Implement** `prStatus.ts`.
- [ ] **Step 4: Run** `npm run render:test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Name the six PR status labels"`.

### Task 3: The labeller

**Files:**
- Create: `web/server/prLabels.ts`
- Test: `web/server/prLabels.test.ts`

**Interfaces:**
- Consumes: `PR_LABELS`, `PrGroup` from `../../rendering/src/prStatus.ts`; `PullRequest`, `BASE_BRANCHES`, `GhAnswer` from `./links`.
- Produces:
  ```ts
  /** The labels a workspace should carry: names, or null when its PR can't be known (leave labels alone). */
  export function wantedLabels(pr: PullRequest | null | undefined): string[] | null;
  export type LabelRow = { workspaceId: string; host?: string; cwd?: string; branch?: string; pr?: PullRequest | null; labels?: string[]; stale?: boolean };
  export type LabellerDeps = {
    rows(): Promise<LabelRow[]>;
    gh(cwd: string, branch: string): Promise<GhAnswer>;
    catalog(host: string | undefined): Promise<{ name: string; color: string }[]>;
    setLabel(host: string | undefined, o: { workspaceId: string; label: { name: string; color: string }; assigned: boolean }): Promise<unknown>;
    log?(message: string): void;
  };
  export function createPrLabeller(deps: LabellerDeps): { pass(): Promise<void> };
  ```
  `wantedLabels`: `null` PR, merged or closed → `[]`; `undefined` → `null`; else per Global Constraints mapping. Each pass: skip `stale` rows; base branch (`BASE_BRANCHES`) → `[]`; row `pr !== undefined` → use it; else local row (`!host`) with `cwd` → `deps.gh`, `available: false` → skip; remote without facts → skip. Diff wanted vs the row's current owned labels (those whose name is in `PR_LABELS`); unassign extras, assign missing, with the catalog colour when the name exists there. One host's failure is logged and doesn't stop other workspaces. `pass()` never throws.

- [ ] **Step 1: Write failing tests** (`node:test`, injected deps recording `setLabel` calls; one test uses `new FakeDaemon("srv_local","Mac").client("t")` from `./fake-daemon` as the `setLabel` target to prove the real SDK call shape works, then asserts the daemon workspace's `labels`):
  - `wantedLabels` table: open+pending CI+no decision → `["CI running","Awaiting review"]`; draft+passing → `["CI green"]`; open+failing+changes_requested → `["CI failing","Changes requested"]`; open+ci none+approved → `["Approved"]`; merged → `[]`; `null` → `[]`; `undefined` → `null`.
  - `a stale CI label is replaced`: row labels `["CI green","bug"]`, PR CI pending → calls: unassign `CI green`, assign `CI running` (amber); `bug` untouched.
  - `stale rows are left alone`: `stale: true` → no calls.
  - `an unknown PR keeps its labels`: local row without `pr`, `gh` → `{ available: false, pr: null }` → no calls.
  - `a base branch has no PR labels`: branch `main`, labels `["Approved"]` → unassign `Approved`; `gh` not called.
  - `catalog colours win`: catalog has `Approved` as `blue` → assigned with `color: "blue"`.
  - Unchanged labels → no calls (idempotent second pass).
  - A throwing `setLabel` for one workspace still lets the next workspace be labelled, and `pass()` resolves.
- [ ] **Step 2: Run** `npm --prefix web test -- --test-name-pattern="label"` → FAIL.
- [ ] **Step 3: Implement** `prLabels.ts`.
- [ ] **Step 4: Run** `npm --prefix web test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Keep PR status labels in step with each workspace's PR"`.

### Task 4: Run the labeller with the app server

**Files:**
- Modify: `web/server/prLabels.ts` (add the loop and real deps)
- Modify: `web/server/api/server.ts` (`attachApiServer` start; stop inside `shutdown` when `last`)
- Test: `web/server/prLabels.test.ts`

**Interfaces:**
- Consumes: `aggregate("workspaces")` (`./api/reads`), `labelCatalog(host)` (`./api/reads`), `resolveHost(serverId, "write")`, `sdk(host)`, `timed` (`./api/hosts`), `ghPullRequest` (`./links`), `TUNING.writeMs` (`./fleet`).
- Produces: `export const PR_LABELS_TUNING = { everyMs: 30000 };` `export function startPrLabels(deps?: LabellerDeps): void;` (idempotent: a second call while running does nothing) and `export function stopPrLabels(): void;`. Default deps resolve `host` (a serverId, absent for local) with `resolveHost(host, "write")` then call `sdk(...).setWorkspaceLabel` with `timed(..., TUNING.writeMs)`, as `labelWorkspace` does. Passes never overlap (skip a tick while one runs). First pass shortly after start (a few seconds, so startup isn't slowed).

- [ ] **Step 1: Write failing tests**: with injected deps and `PR_LABELS_TUNING.everyMs` set small, `startPrLabels(deps)` twice runs a single loop (count `rows()` calls over a short wait); after `stopPrLabels()` no further `rows()` calls.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** loop and default deps; call `startPrLabels()` in `attachApiServer`, `stopPrLabels()` in its `shutdown` when it's the last server. Do not start it under `npm test` runs that don't call it (only `attachApiServer` starts it).
- [ ] **Step 4: Run** `npm --prefix web test` and `npm run app:typecheck` → PASS / clean.
- [ ] **Step 5: Commit** `git commit -m "Run the PR labeller while the app serves"`.

### Task 5: Flags in the Atlas layout

**Files:**
- Modify: `rendering/src/world.ts` (`AtlasData.workspaces[]` gains `labels?: string[]`; `Entity` gains `flags?: { ci?: PrFlag; review?: PrFlag }`; set on non-camp workspaces in `layoutAtlas` ~line 721; include flags in `signature` ~817)
- Test: `rendering/tests/tiles.test.mjs`

**Interfaces:**
- Consumes: `prFlags`, `PrFlag` from `./prStatus.ts`.
- Produces: `Entity.flags` (absent when empty or camp). A flags change changes `layout.signature` (so the scene rebuilds).

- [ ] **Step 1: Write failing tests** in `tiles.test.mjs`: a fleet whose workspace has `labels: ["CI running","Approved","bug"]` → its entity has `flags: { ci: "ci-running", review: "review-approved" }`; a camp never has `flags`; changing only labels changes `signature`; unlabelled workspace has no `flags` key.
- [ ] **Step 2: Run** `npm run render:test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run render:test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lay out PR flags on labelled workspaces"`.

### Task 6: Draw the flags

**Files:**
- Create: `rendering/src/assets/flags.png` (copy of `design/pr-status/flags.png`, unchanged)
- Modify: `rendering/src/textures.ts` (register six frames `flag-<PrFlag>` from the 3×2 grid of 512 px cells, trimmed like `props`)
- Modify: `rendering/src/AtlasScene.ts` (`preload` loads `flags`; `garden()` skips cells that carry a flag; new `private flags(ws, cells)` called beside `garden` in the cottage branch ~612; sway in `update`; `inspect()` adds `flags`)
- Modify: `rendering/ASSETS.md` (a `flags.png` section in the file's style, with the prompt and original filename from `design/pr-status/NOTES.md`)

**Interfaces:**
- Consumes: `Entity.flags`, `PR_LABELS`.
- Produces: `inspect().flags: Record<string /* workspace id */, { ci?: PrFlag; review?: PrFlag }>` for e2e.

Decisions the implementer can't make alone:
- Flags must stay **live** (not drawn into the static caches) so the running one can sway. Use depth 17.2 (above the buildings cache image at 17, below lamp glows at 17.4; not ≥ 20, which is above the cloud shadows) and exclude them from `cacheWorld()` (e.g. `setData("live", true)` checked in its filter).
- Pole foot sits on the cell, the flag is fitted with `fittedWidth(..., [cell])` so it stays inside its own cell; target height ≈ 50 world px at the default fit (tune; spec: "about 50 px, wholly inside the cell").
- Sway: only `ci-running`; small skew/rotation about the pole foot (`setOrigin` at the foot), driven by `this.clock`, disabled when `this.reduced`.
- Stale workspace → alpha 0.6, as plants.

- [ ] **Step 1: Add study data**: extend the render study (`rendering/src/sample.ts`) so one illustrative workspace has `labels: ["CI running","Awaiting review"]` and another `["CI green","Approved"]`.
- [ ] **Step 2: Implement** loading, frames, drawing, garden skip, sway, `inspect().flags`, ASSETS.md.
- [ ] **Step 3: Verify**: `npm run render:test` PASS; `npm run app:typecheck` clean; `npm run render:dev` and screenshot http://127.0.0.1:4320 with Playwright — flags stand in the two yard cells, no plant under them, cottage cell keeps its plant, running flag moves between two screenshots 500 ms apart, nothing clipped at the cell edge. Look at the screenshot.
- [ ] **Step 4: Commit** `git commit -m "Plant PR flags on workspaces in the Atlas"`.

### Task 7: Labels from the app to the map, legend and e2e

**Files:**
- Modify: `web/src/worldBridge.ts` (snapshot `workspaces[]` gains `labels: string[]` from `w.labels ?? []`, ~line 53 type and ~257 mapping)
- Modify: `web/src/NativeWorld.tsx` (~line 68: pass `labels: w.labels`)
- Modify: `web/src/WorldLegend.tsx` (Atlas only: a "Workspace flag · PR" section listing the six `PR_LABELS` names with a swatch of their colour, after the agent states)
- Test: `web/e2e/atlas.e2e.ts`

**Interfaces:**
- Consumes: `PR_LABELS` (via `../../rendering/src/prStatus`), `inspect().flags`.

- [ ] **Step 1: Write failing e2e test** `test("workspace PR labels plant flags on the map")`: give fixture `wks_a` `labels: ["CI running","Awaiting review"]` and `wks_b` `labels: ["CI green","Approved","bug"]` (in the mocked `/api` workspace rows); assert `inspect(page).flags` for their world keys equals `{ ci: "ci-running", review: "review-awaiting" }` and `{ ci: "ci-green", review: "review-approved" }`, and `wks_c` has none. Then push a live change removing `wks_a`'s labels (as the existing "live changes redraw the world" test does) and assert its flags disappear.
- [ ] **Step 2: Run** `npm run app:e2e -- --test-name-pattern="PR labels"` → FAIL.
- [ ] **Step 3: Implement** snapshot field, NativeWorld pass-through, legend section.
- [ ] **Step 4: Run** `npm run app:e2e` → all PASS (existing tests included).
- [ ] **Step 5: Commit** `git commit -m "Show workspace PR labels as flags on the map"`.

### Task 8: Finish

- [ ] **Step 1:** On `main` in the main checkout: `npm run app:build` → layout tests, typecheck and bundle succeed.
- [ ] **Step 2:** `npm run app:restart` → restarted on the saved port; `npm run app:status` shows it running.
- [ ] **Step 3:** After ~40 s, check the app log (path in `app:status`) for labeller errors, and confirm in the running app that a workspace with an open PR shows its labels in the panel and flags on the map. Report the commits and whether build and restart succeeded.

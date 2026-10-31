# Linear client: foundation and issue editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Linear tab into a Linear client that navigates like Linear (My issues, teams, projects, initiatives) and edits issues fully (properties, comments, creation, sub-issues, relations, subscription, archive).

**Architecture:** The server gets a `web/server/linear/` module: a GraphQL client that tracks the rate limit, named reads (`GET /api/linear/q/<name>`), a whitelist of validated writes (`POST /api/linear/m/<name>`), and a fake Linear answering by GraphQL operation name. The page gets `web/src/linear/`: a normalised store fed by one-time reads and a 20 s "changed since" sync, optimistic writes with rollback, and screens drawn from the store.

**Tech Stack:** TypeScript, Node `http` (existing `web/server/api/routes.ts`), React 18, `node:test` + `tsx`, Playwright e2e (`web/e2e/harness.ts`), Linear GraphQL API (`https://api.linear.app/graphql`).

**Spec:** `docs/superpowers/specs/2026-10-31-linear-client-design.md` (phases 1 and 2; Decisions section).

## Global Constraints

- Every write happens only on an explicit user action; launching an agent changes nothing in Linear.
- Tests never reach Linear: `web/server/test-setup.ts` deletes `LINEAR_API_KEY`; server tests and e2e use `fake.ts`.
- Real-Linear writes only in Task 10's check script, and only to one issue in team **DE** titled exactly `Paseo Command write check (safe to delete)`.
- API budget measured on this key: 2,500 requests and 3,000,000 complexity points an hour (`x-ratelimit-*` headers).
- Sync: at most every 20 s while Linear shows; none while it doesn't (the inbox count is phase 3).
- No passthrough GraphQL route; only named reads and whitelisted writes. No `@linear/sdk`.
- The page never receives the API key. Images from `uploads.linear.app` keep loading through `GET /api/linear/image?url=`.
- Keep shipped behaviour: Launch agent (`DispatchTarget.issue`, `issuePrompt`, presets' `{{issue}}`), the list's resize and ⌘S, `linearImages`.
- UI uses `web/src/styles/` tokens and primitives (`.primary`, `.secondary`, `.icon-btn`, `.ghost-btn`, `.search-wrap`), both themes.
- Every new user-facing action: a ⌘K entry in `paletteCommands` (`web/src/main.tsx`) shown only when it works, and a row in `web/src/ShortcutsButton.tsx` for any key.
- Commit per task with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; at the end `npm run public:check -- --history`, push `main`, `npm run app:update`.

## Review Focus

1. **A write Linear refuses** (validation error, network failure, 401): the edited field returns to its previous value and a notice says why. Test: Task 7, `rolls back a refused edit`.
2. **Sync arriving during an in-flight edit**: a sync result older than the pending write must not overwrite the field the user just changed. Test: Task 4, `sync never overwrites a field with a pending write`.
3. **A half-written comment survives** switching to Command and back, and a page reload. Test: Task 8, `keeps a comment draft across remounts`.
4. **Budget nearly spent**: sync stops asking and the view says `Linear's API limit is nearly used; refreshing again at <time>` instead of failing every 20 s. Test: Task 1, `refuses to sync when the budget is low`, and Task 4, `pauses sync while limited`.
5. **Single-letter keys while typing**: S, P, A, C, L do nothing inside an input, textarea or contenteditable. Test: Task 10, `letter keys are ignored while typing`.

---

## File Structure

Server (`web/server/linear/`, replacing `web/server/linear.ts`):
- `client.ts` — the key, `linearRequest`, rate-limit budget, `LinearError`.
- `fragments.ts` — GraphQL fragments per entity.
- `normalize.ts` — GraphQL nodes → shared types.
- `reads.ts` — named reads (`workspace`, `issues`, `issue`, `sync`, `status`).
- `writes.ts` — whitelisted writes with validation.
- `image.ts` — `linearImage`, `linearUpload` (moved unchanged from `linear.ts`).
- `route.ts` — `linearRoute()` for `/api/linear/*`.
- `fake.ts` — the fake Linear.
- Tests beside each: `client.test.ts`, `reads.test.ts`, `writes.test.ts`, `route.test.ts`.

Page (`web/src/linear/`, replacing `web/src/LinearView.tsx` and `web/src/linearIssues.ts`):
- `types.ts` — shared entity types (server imports them, as `server/asks.ts` does).
- `prompt.ts` — `IssueContext`, `issueBlock`, `issuePrompt`, `issueContext`, `linearImages` (moved).
- `api.ts` — `linearRead`, `linearWrite`.
- `store.ts` — normalised store, scopes, sync loop, optimistic writes.
- `place.ts` — `LinearPlace` (where the user is), kept in localStorage.
- `LinearView.tsx` — the shell: sidebar + screen + detail pane; resize and ⌘S (moved from `LinearView.tsx`).
- `Sidebar.tsx`, `IssueList.tsx`, `IssueDetail.tsx`, `Properties.tsx`, `Picker.tsx`, `Comments.tsx`, `CreateIssue.tsx`, `Relations.tsx`, `ProjectList.tsx`, `InitiativeList.tsx`, `keys.ts`.
- Tests: `store.test.ts`, `place.test.ts`, `keys.test.ts`, `prompt.test.ts` (from `linearIssues.test.ts`).
- Styles: `web/src/styles/linear.css` (extended).
- e2e: `web/e2e/linearFake.ts` (routes `/api/linear/*` to the real server code over the fake), `web/e2e/linear.e2e.ts` (extended).

---

### Task 1: Shared types and the GraphQL client with its budget

**Files:**
- Create: `web/src/linear/types.ts`, `web/server/linear/client.ts`, `web/server/linear/client.test.ts`
- Modify: `web/server/links.ts` (keep `LINEAR` there; `client.ts` imports it)

**Interfaces:**
- Produces (`types.ts`):
  - `LinearUser = { id: string; name: string; displayName: string; avatarUrl?: string; me?: boolean }`
  - `LinearState = { id: string; name: string; type: "triage"|"backlog"|"unstarted"|"started"|"completed"|"canceled"; color: string; position: number; teamId: string }`
  - `LinearLabel = { id: string; name: string; color: string; teamId?: string }`
  - `LinearTeam = { id: string; key: string; name: string; cyclesEnabled: boolean; triageEnabled: boolean; estimates: number[] }` (`estimates` from the team's estimation type; `[]` when off)
  - `LinearCycle = { id: string; teamId: string; number: number; name?: string; startsAt: string; endsAt: string; isActive: boolean; isNext: boolean }`
  - `LinearProject = { id: string; name: string; icon?: string; color: string; status: string; health?: "onTrack"|"atRisk"|"offTrack"; leadId?: string; targetDate?: string; progress: number; teamIds: string[]; milestones: { id: string; name: string }[]; url: string; updatedAt: string }`
  - `LinearInitiative = { id: string; name: string; status: string; health?: string; ownerId?: string; targetDate?: string; projectIds: string[]; url: string; updatedAt: string }`
  - `LinearIssue = { id: string; key: string; title: string; url: string; teamId: string; stateId: string; priority: 0|1|2|3|4; estimate?: number; assigneeId?: string; creatorId?: string; labelIds: string[]; projectId?: string; milestoneId?: string; cycleId?: string; parentId?: string; dueDate?: string; branchName: string; subscriberIds: string[]; sortOrder: number; createdAt: string; updatedAt: string; archivedAt?: string; description?: string; childIds?: string[]; relations?: LinearRelation[]; links?: { title: string; url: string }[] }` (the last four only after `q/issue`)
  - `LinearRelation = { id: string; type: "blocks"|"blocked_by"|"related"|"duplicate"|"duplicate_of"; issueId: string }` (always from this issue's side; inverse relations are mapped to `blocked_by` / `duplicate_of`)
  - `LinearComment = { id: string; issueId: string; parentId?: string; authorId?: string; body: string; createdAt: string; editedAt?: string; resolvedAt?: string; reactions: { emoji: string; userIds: string[] }[] }`
  - `LinearWorkspace = { viewerId: string; users: LinearUser[]; teams: LinearTeam[]; states: LinearState[]; labels: LinearLabel[]; cycles: LinearCycle[]; projects: LinearProject[]; initiatives: LinearInitiative[] }`
  - `LinearSync = { cursor: string; issues: LinearIssue[]; comments: LinearComment[]; projects: LinearProject[]; initiatives: LinearInitiative[]; more: boolean }`
  - `LinearBudget = { requestsRemaining: number; complexityRemaining: number; resetAt: number }`
  - `LinearUnavailable = { available: false; reason: string; retryAt?: number }`
  - `IssueScope = "assigned"|"created"|"subscribed"|`team:${string}:${"triage"|"active"|"backlog"|"all"}`|`project:${string}``
  - `WriteName = "issueUpdate"|"issueCreate"|"issueArchive"|"issueUnarchive"|"issueDelete"|"issueSubscribe"|"issueUnsubscribe"|"issueRelationCreate"|"issueRelationDelete"|"commentCreate"|"commentUpdate"|"commentDelete"|"commentResolve"|"commentUnresolve"|"reactionCreate"|"reactionDelete"` (inputs in Task 6)
- Produces (`client.ts`):
  - `linearApiKey(): string | undefined` (moved from `linear.ts`, unchanged)
  - `class LinearError extends Error { kind: "no-key"|"refused"|"limited"|"failed"|"invalid"; retryAt?: number }`
  - `linearRequest<T>(operation: string, query: string, variables: Record<string, unknown>, opts?: { essential?: boolean }): Promise<T>` — sends `{ operationName: operation, query, variables }`; reads `x-ratelimit-requests-remaining`, `x-ratelimit-complexity-remaining`, `x-ratelimit-requests-reset` into the budget; maps GraphQL `errors` to `LinearError` (`refused` for 401 or `AUTHENTICATION_ERROR`, `invalid` for `InvalidInput`/user errors with Linear's message, `failed` otherwise).
  - `linearBudget(): LinearBudget | null`
  - `LOW_BUDGET = { requests: 100, complexity: 100_000 }`; a non-`essential` request while either remaining value is under its floor and before `resetAt` throws `LinearError("limited")` with `retryAt = resetAt` and sends nothing.
  - `resetLinearClient(): void` (tests)

- [ ] **Step 1: Write the failing tests** in `client.test.ts`, faking `LINEAR.fetch`:
  - `sends the operation name, query and key`: `assert.equal(body.operationName, "Workspace")`, `assert.equal(auth, "lin_api_test")`.
  - `records the budget from the headers`: headers `x-ratelimit-requests-remaining: 2400`, `x-ratelimit-complexity-remaining: 2900000`, `x-ratelimit-requests-reset: 1793461871221` → `assert.deepEqual(linearBudget(), { requestsRemaining: 2400, complexityRemaining: 2900000, resetAt: 1793461871221 })`.
  - `refuses to sync when the budget is low`: after a reply with requests remaining `50`, a non-essential request rejects with `kind === "limited"`, `retryAt === 1793461871221`, and the fake saw 1 request; an `essential: true` request still goes out.
  - `names a refused key and Linear's own validation message`: 401 → `kind "refused"`, message `Linear refused the API key.`; `{ errors: [{ message: "Argument Validation Error", extensions: { type: "InvalidInput", userPresentableMessage: "Title is too long" } }] }` → `kind "invalid"`, message `Title is too long`.
  - `no key: kind no-key, nothing sent`.
- [ ] **Step 2: Run** `cd web && npx tsx --test --import ./server/test-setup.ts server/linear/client.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `client.ts` as above.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `Add Linear's shared types and a GraphQL client that keeps to the API budget`.

### Task 2: The fake Linear

**Files:**
- Create: `web/server/linear/fake.ts`, `web/server/linear/fake.test.ts`

**Interfaces:**
- Consumes: `types.ts` (Task 1).
- Produces:
  - `type FakeWorkspace = { viewerId: string; users: …; teams: …; states: …; labels: …; cycles: …; projects: …; initiatives: …; issues: FakeIssue[]; comments: FakeComment[] }` — stored in Linear's GraphQL shape (`identifier`, `state { id }`, …) so reads exercise `normalize.ts`.
  - `fakeWorkspace(): FakeWorkspace` — a fixed sample: viewer `Owen` (`u-owen`) and `Sam` (`u-sam`); teams `ENG` (`t-eng`, cycles on, triage on, estimates `[0,1,2,3,5,8]`) and `DE` (`t-de`); each with states Triage, Backlog, Todo, In Progress, In Review, Done, Canceled; labels `Bug`, `Feature`; one active cycle per team; projects `Launch` (ENG, milestones `Beta`, `GA`) and `Docs`; initiative `Q4` holding `Launch`; issues `ENG-1`…`ENG-6` and `DE-1`, `DE-2` spread over states, assignees, a parent/child pair (`ENG-2` child of `ENG-1`), a `blocks` relation (`ENG-3` blocks `ENG-4`), and three comments on `ENG-1` (one a reply, one with a reaction).
  - `installFakeLinear(ws?: FakeWorkspace): { ws: FakeWorkspace; requests: { operation: string; variables: Record<string, unknown> }[]; fail(operation: string, error: { status?: number; message: string; type?: string }): void; restore(): void }` — sets `process.env.LINEAR_API_KEY = "lin_api_fake"` and `LINEAR.fetch` to a handler that dispatches on the body's `operationName` to one function per named operation (reads in Task 3, writes in Task 6), bumps `updatedAt` on every write, answers rate-limit headers (`2500`/`3000000` remaining), and refuses unknown operations with a GraphQL error `Unknown operation <name>`.
- [ ] **Step 1: Write the failing test** `fake.test.ts`: `installFakeLinear()` then a raw `LINEAR.fetch` with `operationName: "Nope"` answers an error containing `Unknown operation Nope`; `restore()` puts back the real fetch and deletes the key.
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts server/linear/fake.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `fake.ts` with the sample and dispatch table (empty table for now).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Add a fake Linear for tests`.

### Task 3: Named reads, sync and the route

**Files:**
- Create: `web/server/linear/fragments.ts`, `normalize.ts`, `reads.ts`, `image.ts`, `route.ts`, `reads.test.ts`, `route.test.ts`
- Modify: `web/server/api/routes.ts` (replace the two `/api/linear/…` blocks with `if (url.pathname.startsWith("/api/linear/")) return linearRoute(req, url, res, reply);`), `web/server/linear/fake.ts` (read operations)
- Delete: `web/server/linear.ts`, `web/server/linear.test.ts` (their image test moves to `route.test.ts`)

**Interfaces:**
- Consumes: Task 1 client and types, Task 2 fake.
- Produces (`reads.ts`, each throws `LinearError`):
  - `readWorkspace(): Promise<LinearWorkspace>` — operation `Workspace`: viewer, users (active, first 250), teams with states, labels, active and next cycles, estimation; projects (first 250, not completed/canceled more than 30 days ago) with milestones; initiatives (first 100). Cached 5 minutes; `fresh` bypasses.
  - `readIssues(scope: IssueScope, after?: string): Promise<{ issues: LinearIssue[]; next?: string }>` — operation `Issues`, 250 per page, ordered by `updatedAt`; `assigned`/`created`/`subscribed`/`active`/`triage`/`backlog` exclude `completed` and `canceled`; `all` and `project:` include issues completed in the last 14 days.
  - `readIssue(key: string): Promise<{ issue: LinearIssue; comments: LinearComment[]; children: LinearIssue[] } | null>` — operation `Issue`: description, children, relations and inverse relations, attachments as `links`, comments (first 250) with reactions.
  - `readSync(since: string): Promise<LinearSync>` — operation `Sync`, one request: issues, comments, projects, initiatives with `updatedAt > since`, `includeArchived: true`, 100 each; `cursor` = the newest `updatedAt` seen (or `since`); `more` when any list hit 100. Not essential (Task 1's floor applies).
  - `readStatus(): { configured: boolean; budget: LinearBudget | null }`.
- Produces (`route.ts`): `linearRoute(req: IncomingMessage, url: URL, res: ServerResponse, reply: (status: number, body: unknown) => void): Promise<void>` answering
  - `GET /api/linear/q/workspace[?fresh=1]`, `q/issues?scope=…[&after=…]`, `q/issue?key=…`, `q/sync?since=…`, `q/status`, `GET /api/linear/image?url=…` (unchanged behaviour);
  - unknown parameters → 400 `Unexpected parameters`; `LinearError` → 200 `LinearUnavailable` for `no-key`/`refused`/`limited` (`reason` and `retryAt`), 502 `{ error }` for `failed`, 400 for `invalid`.
  - `POST /api/linear/m/:name` → 404 `Unknown endpoint` until Task 6.
- [ ] **Step 1: Write the failing tests** in `reads.test.ts` against `installFakeLinear()`:
  - `reads the workspace`: viewer `u-owen`; team `ENG` has 7 states ordered by position, estimates `[0,1,2,3,5,8]`; project `Launch` has milestones `["Beta","GA"]`; initiative `Q4` has `projectIds` containing Launch's id.
  - `reads scopes`: `assigned` holds exactly the open issues whose assignee is `u-owen`; `team:t-eng:backlog` only backlog-type states; `project:<Launch>` includes an issue completed yesterday and not one completed 20 days ago.
  - `reads an issue with comments, children and both sides of a relation`: `ENG-4`'s relations contain `{ type: "blocked_by", issueId: <ENG-3 id> }`; `ENG-1` has `childIds` `[<ENG-2 id>]` and 3 comments, one with `parentId`.
  - `syncs what changed since a cursor`: after the fake bumps `ENG-5`, `readSync(cursor)` returns only `ENG-5` and a newer cursor; an archived issue comes back with `archivedAt`.
- And in `route.test.ts`: `answers named reads and refuses others` (`q/nope` → 404, `q/issues?scope=bad` → 400), `answers limited as unavailable with retryAt`, plus the image test moved from `linear.test.ts`.
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts server/linear/*.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the fragments, `normalize.ts` (clip strings as `linear.ts` did: titles 300, names 120, bodies 100000; colours `#rrggbb` else `#8a8f98`; https URLs only), the reads, the fake's read operations, `image.ts` (moved), `route.ts`; wire `routes.ts`; delete `linear.ts`.
- [ ] **Step 4: Run** the server tests and `npm run app:typecheck` — Expected: PASS (the old page code still compiles against the deleted endpoints only through `fetch`; Task 5 replaces it).
- [ ] **Step 5: Commit** `Read Linear through named operations, with one sync request for what changed`.

### Task 4: The page's store and sync loop

**Files:**
- Create: `web/src/linear/api.ts`, `web/src/linear/store.ts`, `web/src/linear/store.test.ts`

**Interfaces:**
- Consumes: `types.ts`; routes from Task 3.
- Produces (`api.ts`): `linearRead<T>(name: "workspace"|"issues"|"issue"|"sync"|"status", params?: Record<string, string>): Promise<T | LinearUnavailable>`; `linearWrite<T>(name: string, input: unknown): Promise<T>` (Task 6's route; rejects with Linear's message).
- Produces (`store.ts`):
  - `type LinearData = { workspace?: LinearWorkspace; issues: Map<string, LinearIssue>; byKey: Map<string, string>; comments: Map<string, LinearComment>; loadedScopes: Set<IssueScope>; unavailable?: LinearUnavailable; cursor?: string }`
  - `linearStore` with `getState(): LinearData`, `subscribe(fn): () => void`, `mergeIssues(list)`, `mergeComments(list)`, `applySync(sync: LinearSync)`, `reset()` (tests).
  - `useLinear<T>(select: (d: LinearData) => T): T` (`useSyncExternalStore`).
  - `scopeIssues(d: LinearData, scope: IssueScope): LinearIssue[]` — the scope as a predicate over the store (so edits move issues between lists at once), archived excluded.
  - `loadScope(scope: IssueScope): Promise<void>` (once per scope; pages until `next` is absent or 1,000 issues), `loadIssue(key: string): Promise<void>`, `loadWorkspace(fresh?: boolean): Promise<void>`.
  - `useLinearSync(active: boolean): void` — while `active`, `sync` every 20 s (and at once when `more`), never while `unavailable.retryAt` is in the future.
  - Pending fields: `pending: Map<string /* entity id */, Map<string /* field */, number /* started at */>>`; `applySync` and `merge*` skip a field with a pending write.
- [ ] **Step 1: Write the failing tests** `store.test.ts` (node, no DOM):
  - `scopes follow the store`: merging an issue with `assigneeId: viewer` adds it to `scopeIssues(d, "assigned")`; changing its state to a `completed` state removes it.
  - `sync merges newer issues and drops archived ones`.
  - `sync never overwrites a field with a pending write`: mark `stateId` pending on `ENG-1`, apply a sync whose `ENG-1` has another `stateId` and a new `title` → `stateId` unchanged, `title` updated.
  - `pauses sync while limited`: with `unavailable = { available: false, reason: "…", retryAt: now + 60_000 }`, the loop's tick (exported as `syncTick(now)`) sends nothing.
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts src/linear/store.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `api.ts` and `store.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Keep Linear's data in one store on the page, kept current by sync`.

### Task 5: Navigation, lists and the read-only detail

**Files:**
- Create: `web/src/linear/place.ts`, `place.test.ts`, `prompt.ts`, `prompt.test.ts`, `LinearView.tsx`, `Sidebar.tsx`, `IssueList.tsx`, `IssueDetail.tsx`, `ProjectList.tsx`, `InitiativeList.tsx`, `web/e2e/linearFake.ts`
- Modify: `web/src/main.tsx` (import `./linear/LinearView`; pass `onNotice={setNotice}`), `web/src/Dispatch.tsx` and `web/src/presets.ts` (import from `./linear/prompt`), `web/src/styles/linear.css`, `web/e2e/linear.e2e.ts`
- Delete: `web/src/LinearView.tsx`, `web/src/linearIssues.ts`, `web/src/linearIssues.test.ts`

**Interfaces:**
- Consumes: Task 4 store; Task 3 routes.
- Produces:
  - `type LinearPlace = { screen: "my"; tab: "assigned"|"created"|"subscribed" } | { screen: "team"; teamId: string; tab: "triage"|"active"|"backlog"|"all" } | { screen: "projects" } | { screen: "project"; projectId: string } | { screen: "initiatives" }`, plus `issue?: string` (the open issue's key).
  - `placeScope(p: LinearPlace): IssueScope | null`; `readPlace(): LinearPlace` / `writePlace(p)` (localStorage `linear:place`, default `{ screen: "my", tab: "assigned" }`, an unknown team falls back to the default).
  - `prompt.ts`: `IssueContext`, `issueBlock`, `issuePrompt`, `linearImages` moved unchanged; `issueContext(issue: LinearIssue): IssueContext`.
  - `LinearView({ onLaunch, onNotice }: { onLaunch(issue: IssueContext): void; onNotice(message: string): void })`.
  - `e2e/linearFake.ts`: `mockLinear(page: Page, ws?: FakeWorkspace): Promise<{ ws: FakeWorkspace; requests: … }>` — routes `**/api/linear/**` to `linearRoute` in the test process over `installFakeLinear(ws)` (a minimal `IncomingMessage`/`ServerResponse` pair), so e2e runs the real server code.
- Layout: sidebar sections **My issues** (Assigned, Created, Subscribed), **Teams** (each team, expanding to Triage when `triageEnabled`, Active, Backlog, All), **Projects**, **Initiatives**. The sidebar is the resizable, ⌘S list of today (`LIST` limits unchanged). The main area lists the place's issues grouped by state type (started, unstarted, triage, backlog, then completed, canceled), each row: priority, key, title, labels' dots, assignee initials, project. The open issue shows in a third pane when the view is at least 1,100 px wide, else in place of the list with a Back button. The detail shows what `LinearView` shows today, plus children, relations, cycle, milestone and assignee, from the store; `loadIssue` on open. Projects list: name, status, health dot, lead, target date, progress %; a project opens `{ screen: "project" }`, its issues. Initiatives list: name, status, health, owner, target date and its projects, each opening that project.
- [ ] **Step 1: Write the failing tests**: `place.test.ts` (`readPlace` defaults and falls back; `placeScope` maps each place) and `prompt.test.ts` (the three tests from `linearIssues.test.ts`, re-pointed). In `linear.e2e.ts`, replace the hand-written routes with `mockLinear(page)` and assert: the sidebar lists `Assigned`, `ENG`, `DE`, `Projects`, `Initiatives`; choosing `ENG` → `Backlog` shows only backlog issues; opening `ENG-1` shows its child `ENG-2` and 3 comments; `Projects` → `Launch` lists its issues; the place survives a reload; the shipped checks (Launch agent, ⌘S, resize, uploaded image) still pass.
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts src/linear/*.test.ts e2e/linear.e2e.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the components; move and delete the old files.
- [ ] **Step 4: Run** the same, then `npm run app:typecheck` and `npm --prefix web test` — Expected: PASS.
- [ ] **Step 5: Commit** `Navigate Linear like Linear: my issues, teams, projects and initiatives`.

### Task 6: Whitelisted writes

**Files:**
- Create: `web/server/linear/writes.ts`, `writes.test.ts`
- Modify: `route.ts` (`POST /api/linear/m/:name`, JSON only, body ≤ 1 MB), `fake.ts` (write operations)

**Interfaces:**
- Produces: `WRITES: Record<WriteName, { validate(input: unknown): Record<string, unknown>; run(vars): Promise<unknown> }>` and `linearWrite(name: string, input: unknown): Promise<{ issue?: LinearIssue; comment?: LinearComment; ok?: true }>` (all `essential: true`). `WriteName` and inputs:
  - `issueUpdate { id, title?, description?, stateId?, priority? (0–4), estimate? (number|null), assigneeId? (id|null), labelIds? (≤ 50 ids), projectId? (id|null), projectMilestoneId? (id|null), cycleId? (id|null), parentId? (id|null), dueDate? ("YYYY-MM-DD"|null) }` → `{ issue }`
  - `issueCreate { teamId, title (1–255 chars after trim), description?, stateId?, priority?, assigneeId?, labelIds?, projectId?, projectMilestoneId?, cycleId?, parentId?, estimate?, dueDate? }` → `{ issue }`
  - `issueArchive { id }`, `issueUnarchive { id }`, `issueSubscribe { id }`, `issueUnsubscribe { id }` → `{ issue }`
  - `issueDelete { id }` → `{ ok }` (Linear moves it to the trash, restorable there for 30 days)
  - `issueRelationCreate { issueId, relatedIssueId, type: "blocks"|"related"|"duplicate" }`, `issueRelationDelete { id }` → `{ ok }`
  - `commentCreate { issueId, body (1–100000), parentId? }`, `commentUpdate { id, body }` → `{ comment }`; `commentDelete { id }`, `commentResolve { id }`, `commentUnresolve { id }` → `{ ok }` (resolve returns the comment)
  - `reactionCreate { commentId, emoji (1–50 chars) }`, `reactionDelete { id }` → `{ ok }`
  - ids match `/^[0-9a-f-]{8,64}$/i` (the fake's ids are UUID-shaped too); any other field → `LinearError("invalid", "Unexpected field <name>")`.
- [ ] **Step 1: Write the failing tests** `writes.test.ts`: each write against the fake changes the fake's workspace as Linear would (e.g. `issueUpdate { id: ENG-1, stateId: <ENG Done> }` → the fake's issue state is Done and the answer's `issue.stateId` matches); `refuses unknown writes and fields` (`m/issueNope` → 404; `{ id, foo: 1 }` → 400); `refuses bad values` (priority 7, title of 256 chars, `dueDate: "tomorrow"`); `passes Linear's refusal through` (`fail("IssueUpdate", { message: "x", type: "InvalidInput" })` → 400 with Linear's message).
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts server/linear/writes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `writes.ts`, the route and the fake's writes.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Write to Linear through a fixed list of checked operations`.

### Task 7: Editing an issue's properties

**Files:**
- Create: `web/src/linear/Picker.tsx`, `web/src/linear/Properties.tsx`
- Modify: `store.ts` (`write`), `IssueDetail.tsx`, `IssueList.tsx` (row context menu), `linear.css`, `web/e2e/linear.e2e.ts`

**Interfaces:**
- Produces:
  - `linearStore.write(name: WriteName, input: Record<string, unknown>, optimistic?: { issueId: string; patch: Partial<LinearIssue> }): Promise<boolean>` — applies `patch` and marks its fields pending; on success merges the answer and clears pending; on failure restores the previous values, clears pending, and calls the notice hook with `Linear didn't save that: <message>`.
  - `setLinearNotice(fn: (message: string) => void): void` (LinearView sets it to `onNotice`).
  - `Picker<T>({ label, options: { value: T; text: string; icon?: ReactNode; hint?: string }[], value: T | T[], multiple?: boolean, onPick(value: T | T[]): void, onClose(): void })` — a popover with a filter field (type-to-filter, ↑/↓, Enter picks, Esc closes; multiple toggles with Enter or click and closes with Esc), focus returned to its opener.
  - `Properties({ issue })` — status, priority, assignee, labels, estimate (team's scale; hidden when `estimates` is empty), cycle (team's active and next; hidden when cycles are off), project, milestone (the project's), due date (date input), parent (issue search over the store); each opens a `Picker` and writes with `issueUpdate`.
- [ ] **Step 1: Write the failing e2e tests** (in `linear.e2e.ts`, `mockLinear`): `edits each property` — on `ENG-1` set status `In Review`, priority `Urgent`, assignee `Sam`, labels `Bug`+`Feature`, estimate `3`, cycle, project `Launch`, milestone `Beta`, due date `2026-11-15`; after each the row and the detail show it and `ws` has it. `rolls back a refused edit` — `fail("IssueUpdate", { message: "Not allowed" })`, set priority → the detail shows the old priority again and the notice reads `Linear didn't save that: Not allowed`. `moves an issue out of Assigned when assigned to someone else`.
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts e2e/linear.e2e.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `write`, `Picker`, `Properties` and the row context menu (right-click: Status, Priority, Assignee, Labels).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Edit Linear issues' properties in place`.

### Task 8: Comments

**Files:**
- Create: `web/src/linear/Comments.tsx`
- Modify: `IssueDetail.tsx`, `linear.css`, `linear.e2e.ts`

**Interfaces:**
- Produces: `Comments({ issueId })` — threads (top-level comments oldest first, replies under each), each with author, time, `edited` mark, Markdown body (`linearImages`), reactions (counts; click toggles yours via `reactionCreate`/`reactionDelete`; a small picker of 👍 👎 😄 🎉 😕 ❤️ 🚀 👀), Reply, and on your own comments Edit and Delete (delete after `confirm`-style inline "Delete this comment? Delete / Keep"). Resolved threads collapse to one line with Unresolve. A composer at the bottom (textarea, ⌘↩ sends, Markdown preview toggle). Drafts in localStorage `linear:draft:<issueId>[:<parentId>]`, removed on send.
- [ ] **Step 1: Write the failing e2e tests**: `writes, edits, replies to, reacts to, resolves and deletes a comment` (each checked in the page and in `ws.comments`); `keeps a comment draft across remounts` (type, switch `paseo:mode` to `command` and back → text still there; reload → still there; send → draft gone).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `Comments.tsx`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Read and write Linear comments, with threads and reactions`.

### Task 9: Creating issues, sub-issues, relations, subscription and archive

**Files:**
- Create: `web/src/linear/CreateIssue.tsx`, `web/src/linear/Relations.tsx`
- Modify: `IssueDetail.tsx`, `LinearView.tsx`, `linear.css`, `linear.e2e.ts`

**Interfaces:**
- Produces:
  - `CreateIssue({ initial?: { teamId?: string; parentId?: string; projectId?: string; stateId?: string }, onClose(created?: LinearIssue): void })` — a dialog (as `web/src/styles/dialogs.css`): team (default: the place's team, else the last used, else the first), title, description (textarea), status, priority, assignee, labels, project, then **Create** (⌘↩) and "Create more" (keeps the dialog open, clears title and description). The new issue opens. Draft kept in localStorage `linear:draft:new`.
  - `Relations({ issue })` — lists blocks / blocked by / related / duplicate of, each removable; **Add relation** picks the type and an issue (search over the store by key or title).
  - Detail actions: **Add sub-issue** (CreateIssue with `parentId`, same team), **Subscribe/Unsubscribe**, **Archive** (with an undo notice action that runs `issueUnarchive`), **Delete** (after an inline "Move ENG-1 to Linear's trash? Delete / Keep"; the issue leaves the lists), **Copy branch name**, **Copy link**.
- [ ] **Step 1: Write the failing e2e tests**: `creates an issue in the place's team and opens it`; `creates a sub-issue`; `adds and removes a blocking relation` (shown on both issues); `subscribes and unsubscribes`; `archives, and undoes it`; `deletes only after confirming`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the dialog, relations and actions.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Create Linear issues and sub-issues, link them, subscribe and archive`.

### Task 10: Keys, palette, docs and the real-Linear write check

**Files:**
- Create: `web/src/linear/keys.ts`, `web/src/linear/keys.test.ts`, `web/scripts/linear-write-check.ts`
- Modify: `LinearView.tsx`, `web/src/main.tsx` (palette), `web/src/ShortcutsButton.tsx`, `web/src/appCommands.ts`, `AGENTS.md` (the Linear bullet), `linear.e2e.ts`

**Interfaces:**
- Produces:
  - `linearKeyAction(e: { key: string; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; target: { tagName?: string; isContentEditable?: boolean } | null }): LinearKey | null` with `LinearKey = "down"|"up"|"open"|"back"|"create"|"status"|"priority"|"assign"|"assignMe"|"labels"|"project"|"cycle"|"copyBranch"|"copyLink"|"filter"` for j/↓, k/↑, Enter/o, Esc, c, s, p, a, i, l, m, ⇧C, ⌘., ⌘⇧, (`,` with ⌘⇧), `/`; `null` while typing (input, textarea, select, contenteditable) and for any other key. ⌘S keeps toggling the sidebar.
  - The view handles these only while focus is inside `.linear-view`, and stops them from reaching the page's own J/K/N/D.
  - App commands `linear-create`, `linear-copy-branch`, `linear-copy-link`; palette entries while Linear shows: "Create Linear issue" (C), "Copy the issue's branch name" (⌘.), "Copy the issue's link" (⌘⇧,) — the last two only with an issue open — alongside today's "Refresh Linear issues" and "Show or hide the Linear issue list". The shortcuts dialog gains a "Linear" group listing every key above.
  - `web/scripts/linear-write-check.ts` (run by hand: `cd web && npx tsx scripts/linear-write-check.ts`): with the real key, finds team `DE` and the issue titled `Paseo Command write check (safe to delete)` there (creating it, unassigned, in Backlog, if absent — the only `issueCreate` against real Linear), then runs `issueUpdate` (priority, estimate when DE has estimates, due date, label add and remove, then puts each back), `commentCreate`, `commentUpdate`, `reactionCreate`, `reactionDelete`, `commentResolve`, `commentUnresolve`, `commentDelete`, `issueSubscribe`, `issueUnsubscribe` through `linearWrite`, printing each result; it refuses to write to any issue whose title differs.
- [ ] **Step 1: Write the failing tests**: `keys.test.ts` — `letter keys are ignored while typing` (`s` with `target.tagName "TEXTAREA"` → null; `isContentEditable` → null), each mapping above, `⌘S → null` (left to the view). e2e: `drives an issue from the keyboard` (j, j, Enter opens the second row; s opens status, typing `rev` + Enter sets In Review; c opens Create).
- [ ] **Step 2: Run** `npx tsx --test --import ./server/test-setup.ts src/linear/keys.test.ts e2e/linear.e2e.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `keys.ts`, its wiring, the palette and shortcuts entries, the AGENTS.md update and the check script.
- [ ] **Step 4: Run** `npm --prefix web test`, `npm run app:e2e`, `npm run render:test`, `npm run app:typecheck` — Expected: all PASS. Then run `npx tsx scripts/linear-write-check.ts` once against real Linear — Expected: every step prints `ok`, and the check issue is back to its starting values except for the subscription state.
- [ ] **Step 5: Commit** `Drive the Linear tab from the keyboard and ⌘K`; then `npm run public:check -- --history`, `git push origin main`, `npm run app:update`, and report a pending release naming: Linear navigation (my issues, teams, projects, initiatives), editing issues, comments, creating issues and sub-issues, relations, Linear's keys.

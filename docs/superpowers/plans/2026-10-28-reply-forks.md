# Reply Forks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight parts of an agent's reply in the Paseo Command panel and ask about them in a short
side conversation (a fork) that knows the main conversation and can send a conclusion back.

**Architecture:** A fork is a hidden helper agent created by `web/server` with the daemon's
fork-context attachment (`buildAgentForkContext`) and the main agent's provider, model and mode. Fork
records live in the data directory (`forks.json`). The browser talks to the helper through the
existing `/api/agents/:id/...` routes. A new `ForkPane` shows the helper's conversation beside the main
one, or in place of it when the panel is narrow. Highlights are drawn with the CSS Custom Highlight API,
so the Markdown DOM is never rewritten.

**Tech Stack:** React 19 + TypeScript (Vite), Node server in `web/server`, `@getpaseo/client` 0.13.2,
`node:test` via `tsx`, Playwright e2e with a mocked `/api`.

**Spec:** `docs/superpowers/specs/2026-10-28-reply-forks-design.md`

## Global Constraints

- Work only in `web/`. Nothing in `native/` or `rendering/` changes.
- Keep the inherited React UI and the Galaxy panel theme. New UI uses existing panel styles and tokens.
- Test daemon mutations only against fake daemons (`web/server/fake-daemon.ts`). Browser tests answer
  every `/api` request in the browser (`web/e2e/harness.ts` `mockApi`), and `app.apiHits` stays `[]`.
- Hide fork helpers in Paseo Command: never on the map, in lists, in attention or unread counts, or in
  notifications or sounds. Other Paseo clients may show them.
- Forks have the main agent's powers: the same provider, model and current mode. They are not read-only.
- The only thing a fork ever sends the main agent is the "send back" message.
- Helper label: `paseo-command-fork` (value: the fork id).
- Unsupported host copy, verbatim: `Forks aren't supported on this host.`

## Review Focus

1. **Highlight inside streaming text.** If the reply is still streaming when the user selects text, the
   pill must not appear until the reply settles. A quote's offsets are meaningless while `settle()`
   rewrites the text. *Test: Task 7, "no pill on a live reply".*
2. **Reply re-rendered or scrolled out of the tail window.** Highlights must re-mark by message id plus
   offsets, falling back to a text match. If neither matches, there is no mark, and the fork stays
   listed. *Test: Task 5, `anchorQuote` fallback and miss cases.*
3. **Send back while the main agent is running.** Enqueue with `queue.ts` `enqueue`; never call `send`
   with an interrupt. *Test: Task 7, "send back queues while running".*
4. **Main agent archived with open forks.** Archive its fork helpers too (best effort) so none are left
   behind. *Test: Task 2, "archiving the main agent archives its fork helpers".*
5. **Helper needs approval while the user is elsewhere.** The fork marker shows "waiting", and nothing
   reaches the map, notifications or sounds. *Test: Task 3, helpers are filtered out of `hostRows`;
   Task 7, marker shows waiting.*

---

## File Structure

| File | Responsibility |
|------|----------------|
| `web/src/forks/types.ts` (create) | `Quote`, `Boundary`, `Fork` types and `nextColour`, shared by server and page (as `src/games/catalog.ts` is) |
| `web/server/forks.ts` (create) | `forks.json` store, prompt text, create/close/reopen/conclude logic |
| `web/server/forks.test.ts` (create) | Store and prompt unit tests |
| `web/server/api/forks.test.ts` (create) | API tests against the fake daemon |
| `web/server/api/routes.ts` (modify) | Route `/api/agents/:id/forks` and `/api/forks/:forkId/:action` |
| `web/server/api/commands.ts` (modify) | On `archive`, archive the agent's fork helpers |
| `web/server/fake-daemon.ts` (modify) | `buildAgentForkContext`, server-info feature flags, recorded attachments |
| `web/server/live/hostRows.ts` (modify) | Drop entries labelled `paseo-command-fork` |
| `web/server/workingOn.ts` (modify) | Never summarise a fork helper |
| `web/src/transcript.ts` (modify) | Assistant `Entry`/`Block` carry `messageId` and `seq` |
| `web/src/forks/anchor.ts` (create) | Pure quote anchoring |
| `web/src/forks/api.ts` (create) | Typed browser client for the fork routes |
| `web/src/useAgentSession.ts` (create) | Session data hook extracted from `Session.tsx` |
| `web/src/forks/ForkPane.tsx`, `ForkPill.tsx`, `forks.css` (create) | Fork column, selection pill, markers |
| `web/src/Session.tsx` (modify) | Uses the hook; hosts pill, markers and pane; side-by-side vs takeover |
| `web/e2e/forks.e2e.ts` (create) | Browser tests |

---

### Task 1: Fork store and prompts

**Files:**
- Create: `web/src/forks/types.ts`, `web/server/forks.ts`
- Test: `web/server/forks.test.ts`

**Interfaces:**
- Produces (types and `nextColour` in `web/src/forks/types.ts`; the rest in `web/server/forks.ts`):
  ```ts
  export const FORK_LABEL = "paseo-command-fork";
  export const FORK_COLOURS = 6;
  export function nextColour(used: number[]): number;  // lowest unused 0..5, else used.length % 6
  export type Quote = { messageId?: string; replyKey: string; text: string; start: number; end: number };
  export type Boundary = { messageId?: string; epoch?: string; seq?: number };
  export type Fork = {
    id: string; host: string | null; agentId: string; helperId: string;
    boundary: Boundary; quotes: Quote[]; question: string; colour: number;
    createdAt: string; closedAt?: string; sentBackAt?: string;
  };
  export const forksFile: () => string;               // join(dataDir(), "forks.json")
  export function listForks(host: string | null, agentId: string): Fork[];   // newest first
  export function getFork(id: string): Fork | undefined;
  export function saveFork(fork: Fork): Fork;          // insert or replace by id
  export function firstPrompt(quotes: Quote[], question: string): string;
  export const CONCLUDE_PROMPT: string;
  export function sendBackText(quotes: Quote[], conclusion: string): string;
  ```

- [ ] **Step 1: Write the failing tests** in `web/server/forks.test.ts`. Use the data-directory setup
  from `server/test-setup.ts`, as `games.test.ts` does.
  - `saveFork` then `listForks(null, "a1")` returns it; a fork for `("h2","a1")` isn't returned for `null`.
  - `listForks` orders by `createdAt` descending.
  - A damaged `forks.json` makes `listForks` throw `/forks\.json/`. Missing file → `[]`.
  - `firstPrompt([{text:"Each bundle lives in two places."…}], "Why?")` equals exactly:
    ```
    This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:

    > Each bundle lives in two places.

    Their question: Why?
    ```
    Multi-line quotes get `> ` on every line, and quotes are separated by a blank line.
  - `CONCLUDE_PROMPT === "In a few sentences, state what this side conversation concluded, written for the main conversation. Reply with the conclusion only."`
  - `sendBackText(quotes, "Two checks call build:*.")` starts with
    `From a side conversation about:\n> Each bundle lives in two places.\n\n` and ends with the conclusion.
  - `nextColour([0, 1, 3])` is `2`; `nextColour([0, 1, 2, 3, 4, 5])` is `0`.
- [ ] **Step 2:** Run `cd web && npx tsx --test --import ./server/test-setup.ts server/forks.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement `web/server/forks.ts`, following `games.ts`'s read/atomic-write pattern
  (tmp file + `renameSync`). The file holds `{ forks: Fork[] }`.
- [ ] **Step 4:** Run the tests again. Expect PASS.
- [ ] **Step 5:** Commit: `git add web/src/forks/types.ts web/server/forks.ts web/server/forks.test.ts && git commit -m "Store reply forks and their prompts"`

### Task 2: Fork API on the server

**Files:**
- Modify: `web/server/forks.ts` (add operations), `web/server/api/routes.ts`, `web/server/api/commands.ts:128` (`archive`), `web/server/fake-daemon.ts`
- Test: `web/server/api/forks.test.ts`

**Interfaces:**
- Consumes: Task 1's store and prompts.
- Produces, as HTTP (all take `?host=` like the agent routes):
  - `GET /api/agents/:id/forks` → `{ supported: boolean; forks: Fork[] }`
  - `POST /api/agents/:id/forks` body `{ question: string; quotes: Quote[]; boundary: Boundary }` → `Fork`
  - `POST /api/forks/:forkId/close` → `Fork` (sets `closedAt`)
  - `POST /api/forks/:forkId/reopen` → `Fork` (clears `closedAt`)
  - `POST /api/forks/:forkId/conclude` → `{ text: string }` (already formatted by `sendBackText`)
  - `POST /api/forks/:forkId/sent` → `Fork` (sets `sentBackAt`)
- Server functions in `forks.ts`:
  `createFork(client, host, agentId, body)`, `concludeFork(client, fork)`, and
  `archiveForkHelpers(client, host, agentId)`.

- [ ] **Step 1: Extend the fake daemon.**
  - Add `buildAgentForkContext(agentId, { boundaryMessageId?, boundaryCursor? })`. It returns
    `{ requestId, agentId, attachment: { type: "text", mimeType: "text/plain", contextKind: "chat_history", title: "Conversation", text: <the agent's user and assistant rows up to the boundary, joined> }, error: null }`.
  - Record each `createAgent` call's `attachments`, `config` and `labels` on the created agent.
  - Add an `agentForkContext: true, agentForkContextCursor: true` toggle to the server-info message
    that a test can switch off (`getLastServerInfoMessage`, about line 845).
- [ ] **Step 2: Write the failing tests** in `web/server/api/forks.test.ts`, using the
  `projects.test.ts` setup (`fleet`, `install`, `get`, `post`):
  - **Create:**
    - It calls fork context with `boundaryMessageId` when given. Without a message id it uses
      `boundaryCursor {epoch, seq}`.
    - The helper gets that attachment, the main agent's provider, model, `modeId`, `cwd` and
      `workspaceId`, and the label `{ "paseo-command-fork": <fork.id> }`.
    - Its `initialPrompt` equals `firstPrompt(...)`.
    - The returned fork is listed by `GET`.
  - **Unsupported:** with the flags off, `GET` gives `supported: false`, and `POST` gives a 400 with
    `Forks aren't supported on this host.`
  - **Validation:** 400 for an empty question, no quotes, more than 20 quotes, a quote over 4000
    characters, or a question over `MAX_PROMPT`.
  - **Close and reopen** toggle `closedAt`. Neither archives the helper.
  - **Conclude:**
    - It sends `CONCLUDE_PROMPT` to the helper, waits for it to finish, and returns
      `sendBackText(quotes, lastMessage)`.
    - The main agent receives nothing.
    - If the helper is running, the reply is a 409 with `The fork is still answering.`
  - **Sent** sets `sentBackAt`.
  - **Archiving the main agent archives its fork helpers.** Use `POST agents/:id/archive` with
    `{confirm:true}`, then check that the helper's `archivedAt` is set.
  - **Unknown fork id:** 404.
- [ ] **Step 3:** Run `cd web && npx tsx --test --import ./server/test-setup.ts server/api/forks.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement.**
  - Create helpers as `workingOn.ts:194-235` does: `idempotencyKey`, `workspaceId`,
    `callerAgentId: agentId`, and `title: "Fork: " + question.slice(0, 60)`.
  - Do not pass `systemPrompt` or `mcpServers` overrides, so the fork keeps the main agent's powers.
  - Read the main agent with `agentSnapshot` (`api/agents.ts`), which gives provider, model,
    `runtimeInfo.modeId` and cwd.
  - Assign the colour with `nextColour` over the colours of the agent's open forks.
  - In `concludeFork`, wait with `client.waitForFinish(helperId, 120000)`.
  - Add the routes in `routes.ts` next to the `agents/:id/...` branches.
- [ ] **Step 5:** Run the tests. Expect PASS. Also run `npm test` in `web/`. Expect PASS.
- [ ] **Step 6:** Commit: `git commit -m "Create, list and conclude reply forks on the server"`

### Task 3: Hide fork helpers

**Files:**
- Modify: `web/server/live/hostRows.ts` (`hostRows`, where `byId` is pruned), `web/server/workingOn.ts:246-250`
- Test: `web/server/live/hostRows.test.ts`, `web/server/workingOn.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - In `hostRows`, an active, running agent labelled `paseo-command-fork` is absent from the result's
    agents. It's also not counted toward its parent's busy state (it carries
    `paseo.parent-agent-id`), and its pending permission produces no permission row.
  - `workingOn.request` returns `{ sentence: null, pending: false }` for a fork helper.
- [ ] **Step 2:** Run the two test files. Expect FAIL.
- [ ] **Step 3:** In `hostRows`, delete labelled entries from `byId` right after the archived pruning.
  Import `FORK_LABEL` from `../../src/forks/types`. In `workingOn.ts`, add `source.labels?.[FORK_LABEL]` to the
  skip condition.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Keep fork helpers off the map, lists and attention"`

### Task 4: Replies carry their message id and sequence

**Files:**
- Modify: `web/src/transcript.ts` (`Entry` assistant variant, `fromTimeline`, `Block`, `toBlocks`)
- Test: `web/src/transcript.test.ts` (create)

**Interfaces:**
- Produces: `Entry` and `Block` assistant variants gain `messageId?: string` and `seq?: number`. `seq`
  is the last daemon sequence of the merged reply, taken from the `HistoryItem.last ?? seq` that
  `Session.tsx` maps from. Also add a `seq` field to the assistant `TimelineItem` variant.

- [ ] **Step 1: Write the failing tests:**
  - Two assistant items with the same `messageId` merge into one entry carrying that id and the second
    item's `seq`.
  - `toBlocks` passes both fields through.
  - Block keys are unchanged, compared with the current key format for the same input.
- [ ] **Step 2:** Run `npx tsx --test --import ./server/test-setup.ts src/transcript.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep where the `seq` is threaded from in `Session.tsx` minimal: pass
  through whatever `HistoryItem` already holds.
- [ ] **Step 4:** Run the tests plus `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Carry a reply's message id and sequence into the transcript"`

### Task 5: Quote anchoring

**Files:**
- Create: `web/src/forks/anchor.ts`
- Test: `web/src/forks/anchor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function quoteFromSelection(root: { textContent: string | null }, start: number, end: number,
    reply: { key: string; messageId?: string }): Quote | null;  // null when empty or whitespace only
  export function anchorQuote(text: string, q: Quote): { start: number; end: number } | null;
  ```
  `Quote` comes from `web/src/forks/types.ts`.

- [ ] **Step 1: Write the failing tests** for `anchorQuote`:
  - It returns the offsets when `text.slice(start, end) === q.text`.
  - When the text moved, it falls back to the first `indexOf(q.text)`.
  - It returns `null` when the text is absent.
  - `quoteFromSelection` trims surrounding whitespace and adjusts the offsets.
- [ ] **Step 2:** Run the test. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Anchor fork quotes in reply text"`

### Task 6: Extract the session data hook

A refactor with no behaviour change, so `ForkPane` can show a helper agent the way `Session` shows one.

**Files:**
- Create: `web/src/useAgentSession.ts`
- Modify: `web/src/Session.tsx:139-430` (state, the `watchSession` effect, `command`, `send` and `respond`)

**Interfaces:**
- Produces:
  ```ts
  export function useAgentSession(target: { id: string; host?: string; status?: string }): {
    detail: Detail | null; entries: Entry[]; source: Source | null; error: string; unavailable: string;
    earlier: Earlier; loadOlder: () => void; pending: Pending[]; running: boolean; archived: boolean;
    busy: string | null;
    command: (name: string, body: object, notice: string) => Promise<boolean>;
    send: (o: Outgoing) => Promise<boolean>;
    respond: (p: Permission, d: PermissionDecision) => Promise<void>;
  };
  ```
  Session-only concerns stay in `Session.tsx`: drag and drop, confirm and archive, sounds, and
  `onChanged`. Pass `onNotice` and `onChanged` into the hook only if the moved code needs them.

- [ ] **Step 1:** Run `npm run app:e2e` and `npm test` in the repo root and in `web/`, and note the
  baseline. Expect PASS.
- [ ] **Step 2:** Move the code into the hook, and make `Session` call `useAgentSession(agent)`.
- [ ] **Step 3:** Run `npm run app:typecheck`, `npm test` and `npm run app:e2e`. Expect the same results
  as the baseline.
- [ ] **Step 4:** Commit: `git commit -m "Extract the agent session hook from Session"`

### Task 7: Fork UI in the panel

**Files:**
- Create: `web/src/forks/api.ts`, `web/src/forks/ForkPill.tsx`, `web/src/forks/ForkPane.tsx`, `web/src/forks/forks.css`
- Modify: `web/src/Session.tsx` (`TimelineBlock` assistant branch at about line 1129, the root layout, and the `Timeline` props)
- Test: `web/e2e/forks.e2e.ts`

**Interfaces:**
- Consumes:
  - Tasks 2, 4, 5 and 6.
  - `queue.ts` `enqueue(agentId, text, [])`.
  - `PermissionCard`, `Composer` and `Timeline` as `Session` uses them.
- Produces:
  - `forks/api.ts` exports `listForks`, `createFork`, `closeFork`, `reopenFork`, `concludeFork` and
    `markSent`. Each wraps the route of the same meaning with `api()` and `hostQuery(host)`.
  - The assistant `.msg.assistant` element gets `data-reply-key={block.key}` and
    `data-message-id={block.messageId}`.

**Behaviour, as decided:**
- **Pill:** it appears for a non-empty selection that lies within one settled `.msg.assistant` (not
  live) and not inside a fork pane. It shows **Ask** and **+ Add**.
  - **+ Add** pushes the quote to a "collected" list shown as chips above the pane's question box (or
    above the pill when no pane is open) and clears the selection.
  - **Ask** opens a draft fork in the pane with the collected quotes plus the selection, focusing its
    question box. Sending the question calls `createFork`. The fork's boundary is the newest quoted
    reply's `messageId`, or `{epoch, seq}` when it has none.
- **Marks:** `CSS.highlights.set("fork-<colour>", new Highlight(...ranges))`, with ranges rebuilt from
  `anchorQuote` against each reply element's `textContent`. Rebuild after every timeline change, and
  style the marks in `forks.css` with `::highlight(fork-N)`, using six colours from the theme tokens.
  Skip marking when `CSS.highlights` is missing.
- **Closed forks:** a small marker button after its reply, in the fork's colour, with the question's
  first 40 characters. Clicking it calls `reopenFork` and opens the pane. While the helper has pending
  permissions, the marker reads `waiting`.
- **Layout:** measure the session root with a `ResizeObserver`.
  - At 720px or wider (`SPLIT_MIN` in `panelGeometry.ts`), the pane is a right-hand column.
  - Below that, the pane replaces the timeline and footer, with a `← Back to main` button. The main
    timeline stays mounted but hidden, so its scroll position is kept.
- **Pane contents:**
  - The quote chips and the helper's `Timeline` and permission cards, from
    `useAgentSession({ id: fork.helperId, host })`.
  - A `Composer` placeholder of `Reply in fork…`.
  - **↩ Send back** calls `concludeFork`. Then, if the main agent is running, it calls
    `enqueue(mainId, text, [])`; otherwise it calls the main session's `send`. Then it calls `markSent`
    and shows `Sent back` with the time.
  - **✕ Close** calls `closeFork`.
  - Several open forks show as tabs (in their colours) at the top of the pane.
- **Unsupported host:** when `supported` is false, the pill's Ask and + Add are disabled, with the
  tooltip `Forks aren't supported on this host.`

- [ ] **Step 1: Write the failing e2e tests** in `web/e2e/forks.e2e.ts`, using the `games.e2e.ts` and
  `harness.ts` patterns (`startApp`, `mockApi`, `openSession`, and a fleet with one idle agent whose
  timeline has two assistant replies with message ids). Answer the fork routes in the browser.
  - "select text in a reply shows the pill; Ask then a question creates a fork". Check the POST body's
    quotes, question and boundary `messageId`, and that the pane shows the helper's timeline.
  - "+ Add collects two pieces from different replies into one fork". The boundary is the newer reply.
  - "no pill on a live reply" (the agent is running and the last reply is streaming).
  - "narrow panel: the fork takes over; Back to main restores the scroll position".
  - "wide panel (≥720px): the pane sits beside the conversation".
  - "send back while idle sends to the main agent". A POST `agents/<main>/send` is seen with the
    conclude text.
  - "send back queues while running". No send POST happens; `readQueue(main)` holds the text.
  - "close leaves a marker; clicking it reopens the fork".
  - "marker reads waiting while the helper has a pending permission".
  - "unsupported host disables Ask".
- [ ] **Step 2:** Run `cd web && npx tsx --test --import ./server/test-setup.ts --test-concurrency=1 e2e/forks.e2e.ts`. Expect FAIL.
- [ ] **Step 3:** Implement `api.ts`, `ForkPill.tsx`, `ForkPane.tsx` and `forks.css`, and wire them
  into `Session.tsx`.
- [ ] **Step 4:** Run the fork e2e tests, then `npm run app:e2e` and `npm run app:typecheck`. Expect PASS.
- [ ] **Step 5:** Commit: `git commit -m "Ask about highlighted parts of a reply in a fork"`

### Task 8: Finish

- [ ] **Step 1:** In the repo root, run `npm run app:build`. Expect success.
- [ ] **Step 2:** Merge into local `main` if the work was done on a branch, then `git push origin main`.
- [ ] **Step 3:** From the main checkout on `main`, run `npm run app:update`. Never relaunch the app;
  the user presses ⌘R.
- [ ] **Step 4:** Report the commits, whether the push succeeded, and whether the build succeeded.

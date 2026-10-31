# Linear in Paseo Command: a working client (plan)

## Intent

The Linear tab should be where daily Linear work happens: triage the inbox, move issues along,
read and write comments, follow projects and initiatives, and start agents on the work, without
leaving the app or opening Linear in Conquer. The differentiator over Linear's own app is the agent
link: every issue, project and selection of issues can launch agents, and shows the agents and PRs
already working on it.

## Where it stands (shipped)

- Mode bar tab Linear (⌘` steps Command → Conquer → Linear). `LinearView` draws over the map's frame.
- The open issues assigned to you, grouped by state; search; ↑/↓.
- An issue's details: properties, labels, parent, description (Markdown, Linear uploads load through
  `GET /api/linear/image`), links and comments.
- Launch agent → New agent with the issue (Worktree on Linear's branch, draft prompt, presets with `{{issue}}`).
- The list resizes and hides with ⌘S, as Conquer's sidebar.
- Read-only, through `web/server/linear.ts` with `LINEAR_API_KEY` (or `linearApiKey` in `secrets.json`).

## Goals

1. **Navigate like Linear.** The sidebar becomes Linear's: Inbox, My issues, Favorites, Views, each team
   (Triage, Issues, Cycles, Projects), Projects, Initiatives, Documents, and global search.
2. **Issues, fully.** List and board views with display options (group, sort, filter, sub-issues shown or not);
   every property editable inline; create issues and sub-issues (templates too); relations;
   comments with threads, reactions, resolve, edit, delete; subscribe; archive and delete; bulk edit of a selection;
   the issue's history.
3. **Inbox.** Notifications by type, read and unread, snooze, archive, mark all; an unread count on the
   mode bar's Linear tab and in ⌘K.
4. **Projects.** List by status with health, lead, target date and progress. A project page with overview
   (description, properties), milestones, issues by milestone, updates (read and post, with health), documents and links.
5. **Initiatives.** List and page: description, owner, status, health, target date, projects with progress,
   sub-initiatives, updates (read and post).
6. **Cycles.** Each team's current, next and past cycles: progress, scope, issues.
7. **Documents.** Read and edit project and initiative documents and standalone ones.
8. **Agents.** Launch from an issue, from several selected issues (one agent each, or one for all), from a project
   or milestone. Issues show the Paseo workspaces and agents on their branch (key in branch or title, as
   `linearKey` already finds) with live state, and their PRs. On launch, optionally assign to me and move to
   the team's first "started" state.
9. **Keyboard.** Linear's own shortcuts while Linear has focus (see Keys), and Linear's actions in ⌘K.

## Non-goals

- Workspace administration: teams, members and invites, workflow states, labels' and templates'
  definitions, integrations, SLAs, billing, API keys, webhooks, imports.
- Customers and customer requests, releases and release pipelines, Asks, time schedules (possible later).
- Linear's own agent sessions (`agentSession*`): they need an OAuth app acting as an app user. A later step could
  show Paseo agents as Linear agent sessions.
- Offline use and Linear's private sync engine.

## Anti-goals (a failure even if it works)

- Tests or checks writing to the user's real Linear. Every write is tested against a fake Linear.
- A write the user didn't ask for. Nothing changes in Linear except by an explicit action. Launching an agent
  changes the issue only if the user turned that on.
- Running into the API limits. Measured on this account: 2,500 requests and 3,000,000 complexity points an hour.
  Polling every view on a timer would exhaust that.
- Losing the user's typing. A draft comment or description survives a refresh, a mode switch and a restart.
- Lying about state. A write that fails puts the old value back and says so; the list never shows an edit Linear refused.

## Constraints

- Loopback-only server, same-origin API (`web/server/api/http.ts`). The page never sees the API key.
- Images and files from `uploads.linear.app` load only through the server with the key.
- The React UI's tokens and primitives (`web/src/styles/`), both themes. No new UI library.
- ⌘K is the app's palette; Linear's ⌘K actions join it while Linear shows.
- Each user-facing action gets its palette entry and its shortcuts-dialog row (`AGENTS.md`, Command palette).

## The how

### Server: `web/server/linear/`

- `client.ts`: one GraphQL request at a time per kind, with the key; reads the `x-ratelimit-*` headers, backs off
  as remaining nears zero, and reports the budget (`GET /api/linear/status`).
- **Named operations, not a GraphQL passthrough.** `queries.ts` holds the hand-written queries (fragments per
  entity, sized to what each screen shows); `mutations.ts` holds a whitelist of operations, each with input
  validation (`issueUpdate`, `issueCreate`, `issueBatchUpdate`, `commentCreate`, `commentUpdate`, `commentDelete`,
  `commentResolve`, `reactionCreate`, `reactionDelete`, `issueRelationCreate`, `issueRelationDelete`, `issueSubscribe`,
  `issueArchive`, `issueDelete`, `notificationUpdate` (read, snooze), `notificationArchive`, `notificationMarkReadAll`,
  `projectUpdate`, `projectUpdateCreate`, `projectMilestoneCreate|Update`, `initiativeUpdate`, `initiativeUpdateCreate`,
  `documentCreate|Update`, `favoriteCreate|Delete`, `fileUpload`). Routes: `GET /api/linear/q/<name>?…` and
  `POST /api/linear/m/<name>`. A passthrough would hand any local page full write access to Linear; the
  whitelist keeps the surface reviewable.
- Raw GraphQL, not `@linear/sdk`: the SDK fetches relations lazily, one request each, which the limits can't afford.
- **Sync.** One `GET /api/linear/sync?since=<cursor>` asks, in one request, for issues, comments, projects,
  initiatives and notifications updated since the cursor (`updatedAt: { gt }` filters), at most every 20 s while
  Linear shows and every few minutes while it doesn't (the inbox count). That is about 180 requests an hour.
  Screens read from the client store; opening one fetches it once if it isn't there.
- Uploads: comment and description images are uploaded with `fileUpload` (a signed PUT); the page sends the file
  to the server, which uploads it.
- `fake.ts`: a fake Linear answering every named operation from an in-memory workspace. Server tests,
  `native/scripts/fake-server.ts --linear` and the e2e mocks all use it.

### Client: `web/src/linear/`

- `store.ts`: entities normalised by id (issues, users, teams, states, labels, cycles, projects, milestones,
  initiatives, documents, notifications), merged from sync results. Optimistic writes with rollback.
- Layout: the resizable, ⌘S-collapsible sidebar (shipped) becomes navigation; the main area shows the screen.
  The issue opens in a third pane when there's room, else in place with Back.
- Screens: `Inbox`, `IssueList` (list and board, display options), `Issue`, `Project`, `Initiative`, `Cycle`, `Document`,
  `Search`, `CreateIssue` (dialog, as Linear's C).
- Property pickers (status, priority, assignee, labels, project, cycle, milestone, estimate, due date) as one
  `Picker` component with type-to-filter, shared by the detail view, rows' context menus and bulk edit.
- Markdown editing: a plain textarea with preview first; the composer's attachment code for pasting images.
- Where the user is in Linear (screen, selection, display options) is kept per viewer in localStorage, as `urlState` does for the panel.

### Keys (while Linear has the keyboard)

j/k or ↑/↓ move, Enter or o open, Esc back, x select, C create, S status, P priority, A assign to…, I assign to me,
L labels, M move to project, Shift+C cycle, ⌘. copy branch name, ⌘⇧, copy link, / search, G I inbox, G M my issues.
These take over the page's single-letter keys (J, K, N, D) only while focus is inside the Linear view.

### Phases

1. **Foundation.** `web/server/linear/` (client, budget, named reads, sync, fake), the client store, the sidebar as
   navigation (My issues tabs: Assigned, Created, Subscribed; each team's Issues; Projects; Initiatives as plain lists).
2. **Issue editing.** Pickers, inline edits, comments (write, edit, react, resolve), create issue, sub-issues,
   relations, subscribe, archive. Optimistic writes.
3. **Inbox.** Notifications screen, unread badge on the mode bar tab (a `paseo:mode`-style message to Swift) and in ⌘K.
4. **Projects and initiatives.** Their pages, milestones, updates (read and post), progress.
5. **Lists at scale.** Display options, board view with drag between states, bulk edit, custom views and favorites,
   triage, cycles, search.
6. **Agents.** Launch from a selection or a project; agents and PRs on each issue; assign and start on launch.
7. **Documents and the rest.** Documents, history, file uploads, Linear actions in ⌘K.

Each phase ships on its own: commit, push, `app:update`, release note.

### Testing

- Server: named operations and validation against `fake.ts`; the budget's back-off; sync merging.
- e2e (`web/e2e/linear*.e2e.ts`): every screen and write against the fake; that nothing reaches Linear.
- Native: `fake-server.ts --linear` and snapshots for the mode bar badge and layout.
- Real Linear: read-only checks only, unless the user names a sandbox team for writes.

## Left to the builder

Exact query shapes and page sizes, the store's internals, component boundaries, the board's drag library (none
new: pointer events), how much of Linear's display options to mirror, empty and error states' wording.

## Open questions for the user

1. Should the app write to Linear (edit issues, comment, create, post updates), or stay read-only with only
   the agent launch? This plan assumes full writes.
2. Which comes first after the foundation: issue editing, the inbox, or projects and initiatives?
3. May checks write to a sandbox team in the real Linear, or fakes only?

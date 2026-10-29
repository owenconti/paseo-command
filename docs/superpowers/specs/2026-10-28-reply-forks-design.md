# Reply forks: short side conversations about parts of a reply

## Intent

Agents often reply with a lot of information, and the user wants to dig into a couple of pieces. Today
that means copying each piece, writing a question, and repeating the whole thing for every piece. What
the user wants is a short conversation about their question, like a short-lived fork of the main
conversation, started straight from the text they highlight.

Success: the user highlights one or more parts of a reply, asks a question, and gets a focused answer
from an agent that knows the main conversation. The main agent is not disturbed. If the side
conversation reaches something useful, the user can send it back in one click.

## Goals

- In an agent's reply in the Paseo Command panel (`web/src/Session.tsx`), highlighting text starts a fork.
- A fork can be about one highlight or about several highlights gathered together. Both are supported.
- The fork appears in a column beside the conversation. When the panel is too narrow, it takes over
  the panel instead.
- A fork has the same powers as the agent it came from. It isn't read-only.
- "Send back to main" sends a short conclusion to the main agent.
- Closed forks stay as history and can be reopened from the reply they came from.

## Non-goals

- Forks of forks, and highlighting text inside a fork's own replies to start a new fork.
- Highlighting in user messages, tool calls, or thought steps. Only assistant replies count.
- Changes to the macOS app (SpriteKit, `native/`) or to the Atlas.

## Anti-goals (it would be a failure even if it works)

- The main agent is interrupted, gets a different mode, or receives anything the user didn't send.
  The only exception is the "send back" message.
- Fork helper agents show up as robots on the map, in agent lists, in attention or unread counts, or as
  notifications or sounds. They must not look like real work.
- A fork answers without the main conversation's context, so the user has to explain again what they
  quoted.

## How it works (decided with the user)

### Starting a fork

- When the user selects text inside an assistant reply, a small pill appears next to the selection
  with **Ask** and **+ Add**.
- **Ask** starts a fork. It quotes the current selection plus anything already collected with + Add,
  and focuses the fork's question box.
- **+ Add** keeps the selection as a collected piece, shown as a chip, so the user can highlight more
  before asking. A selection may cross formatting such as bold, code, or list items inside one reply.
  *(Builder's call: whether pieces can come from different replies of the same agent. Allowing it is
  fine.)*
- Highlights stay marked in the reply. Each fork has its own colour, and its highlights and its
  column share that colour.

### Where the fork appears

- The fork appears in a **side column next to the conversation**. The mockup showed the fork pane to
  the right of the transcript with its quote chips, the conversation, a "Reply in fork…" box,
  **↩ Send back**, and **✕ Close**.
- When the panel is too narrow for both (it defaults to 440px, see `web/src/panelGeometry.ts`), the
  fork **takes over the panel** and shows a "back to main" link. The main conversation keeps its
  scroll position.
- *(Builder's call: the width at which the layout switches to side by side, and how to handle several
  open forks at once, for example a list or tabs in the column.)*

### What a fork is

- A fork is a helper agent on the same host and workspace. It gets the main agent's conversation up to
  the reply it came from, using the daemon's fork-context support:
  `client.buildAgentForkContext(agentId, { boundaryMessageId | boundaryCursor })` returns a
  `chat_history` text attachment, which is passed to `client.createAgent({ attachments })`. The first
  prompt is the user's question with the highlighted pieces quoted.
- **Same powers as the main agent.** The user first asked for read-only forks, then changed their
  mind. A fork uses the main agent's provider, model and current mode, so it can edit files and run
  commands just as the main agent can, in the same workspace.
- *(Our call: a fork's permission requests and questions show inside its column, using the same cards
  as the main conversation (`web/src/PermissionCard.tsx`). The fork's marker on the reply, and its
  entry in the column, show that it is waiting. They don't add to the map's attention, unread counts,
  notifications or sounds.)*
- Hidden: label helpers, for example `paseo-command-fork`, and filter them out on the server
  everywhere the app lists, counts, or draws agents: the map, lists, attention, unread, notifications,
  sounds, and the summary helper in `web/server/workingOn.ts`. The SDK's `internal` flag doesn't reach
  the daemon (see "Findings"), so the app has to do this filtering itself.
- Hiding applies to Paseo Command only (the user's choice). Paseo's own app, CLI and MCP may show
  fork helpers as ordinary agents, and that's acceptable.
- The existing throwaway helper in `web/server/workingOn.ts:194-235` is the pattern for creating,
  labelling, cancelling, and archiving helpers.

### Send back to main

- **↩ Send back** asks the fork to write a short conclusion, then **sends it to the main agent
  immediately**. No editing step.
- The message makes clear it comes from a side conversation, and it includes the quoted pieces it was
  about, so the main agent has the context.
- *(Our call: if the main agent is in the middle of a turn, the message joins the panel's existing
  queue (`web/src/queue.ts`) instead of interrupting the turn.)*
- The fork stays open after sending back. It records that it was sent, and when.

### History

- **✕ Close** collapses the fork to a small marker on the reply it came from. Clicking the marker
  reopens the fork with its question, answers, and highlights. When it's reopened, follow-up messages
  continue the same helper agent.
- *(Our call: store forks on the server in the data directory, like `games.json`, keyed by host and
  agent, so they survive refreshes and show on any device. A fork stores the source reply, its quotes
  with enough to re-mark them, the helper agent's id, its colour, and whether it was sent back.)*
- *(Builder's call: when to archive a closed fork's helper agent. Archiving on close and resuming on
  reopen is fine, as long as reopening shows the full fork conversation.)*

## Constraints

- Keep the inherited React UI and the Galaxy panel theme. The pill, chips, and column use the panel's
  existing styles.
- The world never sends daemon actions. Everything goes through the React UI and `web/server` API
  routes.
- Test daemon mutations against fake daemons only (`web/server/fake-daemon.ts`). Add browser tests in
  `web/e2e/` with mocked `/api`.
- Work only through `web/`. Nothing in `native/` or `rendering/` should need to change.

## Findings that shape the build

- `@getpaseo/client` 0.13.2 provides:
  - `buildAgentForkContext` (`daemon-client.d.ts:953`), advertised by the server-info flags
    `agentForkContext` and `agentForkContextCursor`. If a host lacks them, show "Forks aren't
    supported on this host" rather than forking without context.
  - `sendMessage` with `activeTurnBehavior`, and `archiveAgent`, `cancelAgent` and `deleteAgent`.
- `AgentSessionConfig.internal` exists, but the SDK neither forwards nor validates it, so it never
  reaches the daemon. That's why the app filters forks by label.
- The panel has no text-selection or quote feature yet. Replies render through `web/src/Markdown.tsx`
  inside `TimelineBlock` (`web/src/Session.tsx:1129-1134`). Merged reply chunks share a `messageId`
  (`web/src/transcript.ts:46`), which can serve as the fork boundary.

## Left to the builder

- API shape (for example `POST /api/agents/:id/forks`, `GET …/forks`, and send, reply, close and
  reopen actions) and how the fork's replies stream to the column (reuse the timeline polling in
  `web/src/sessionPoll.ts` if that fits).
- How highlights are anchored and re-marked across reloads and re-renders, for example message id plus
  text offsets with a fallback text match.
- Wording of the system prompt, the send-back summary prompt, and the empty or error states.
- Keyboard access for Ask and + Add.

# Slack tab and Activity tab

## Intent

Bring Slack into Paseo Command the way Linear is: a client drawn by the page in the map's
place (a mode bar tab), talking to Slack only through the app server, which holds the
credentials. Then gather GitHub, Linear and Slack notifications into one Activity tab, so
what needs you is in one place beside your agents.

## Goals

1. **Slack tab** (mode bar: Command → Conquer → Linear → Slack → Activity, each shown only while enabled):
   - Sidebar: unread conversations first, then channels, direct messages, group DMs; search.
   - A conversation: messages newest at the bottom, day dividers, sender grouping, edits, reactions,
     files (images inline, others as downloads), link previews, rich text (Slack's blocks) with
     mrkdwn as fallback, mentions, channel links, emoji (standard and custom).
   - Threads: open beside the conversation (in its place on narrow windows), reply, "also send to channel".
   - Composer: Markdown (sent as `markdown_text`), @mentions, emoji, paste/drop/attach files, edit and
     delete your messages, react, mark read as you read.
   - Search all messages (`search.messages`).
   - Launch agent from a message or thread (New agent with it as the draft; presets take `{{slack}}`).
   - Keys and ⌘K entries for everything, as Linear has.
2. **Live updates through Socket Mode** (an app-level token), falling back to 20 s polling when there's
   no app token or the socket is down; the page hears about changes over server-sent events.
3. **Activity tab**: one feed, newest first, of
   - GitHub notifications (`gh api /notifications`, the user's own gh sign-in): read, done, open in Conquer;
   - Linear notifications (the Inbox's): read/unread, done (archive), open in the Linear tab;
   - Slack: unread DMs and group DMs, mentions of you, replies in threads you're in: read, open in the Slack tab.
   Filter by source and unread; a preview of the selected item with its actions; the tab shows the unread count.

## Non-goals

Huddles, calls, canvases, lists, workflows, channel management (create, invite, archive), admin,
Slack Connect specifics, scheduled messages, reminders, presence changes, user groups editing.
Not a GitHub client (Activity opens GitHub in Conquer).

## Constraints (from the project)

- Opt-in: `integrations.slack` and `integrations.github` in `settings.json`, default off. Credentials only in the
  data directory's `secrets.json` (`slackUserToken` xoxp, `slackAppToken` xapp), never the environment, never the page.
- Named reads and whitelisted writes only, each input checked field by field; no passthrough.
- Private Slack files and images load only through the server (`files.slack.com`, with the token), files as downloads.
- Tests never reach Slack, GitHub or Linear: a fake Slack (`web/server/slack/fake.ts`) and fake socket; gh is injected.
- Every write is the user's own action; shown at once, rolled back with a notice if refused.
- Real state stays truthful: unread counts not yet known show as unknown, not zero.

## Shape

- Server `web/server/slack/`: `client.ts` (Web API calls, token, per-method rate-limit cooldowns, `SLACK.fetch` injectable),
  `normalize.ts`, `reads.ts`, `unreads.ts` (per-conversation read state: `conversations.info` for `last_read`, history since it,
  a paced queue, DMs first), `writes.ts`, `files.ts` (image/file/avatar proxies), `upload.ts` (`files.getUploadURLExternal` +
  `files.completeUploadExternal`), `socket.ts` (Socket Mode over `ws`, acks, reconnect with backoff), `events.ts` (SSE hub),
  `fake.ts`, `route.ts` (`/api/slack/q/…`, `/api/slack/m/…`, `upload`, `file`, `image`, `avatar`, `events`).
- Server `web/server/activity/`: `github.ts`, `linear.ts`, `slack.ts`, `feed.ts`, `route.ts` (`GET /api/activity`, `POST /api/activity/m/read|unread|done`).
- Page `web/src/slack/` and `web/src/activity/`, shared types in each `types.ts`.
- Native: `Mode` gains `slack` and `activity` (`Conquer.swift`), enabled through the page's `integrations` message;
  the Activity tab's title carries the unread count (`activity` message).

## Slack app setup (the user's)

The app's manifest is `web/src/slack/manifest.ts` (Settings → Slack → Set up a Slack app opens Slack's Create app
page with it filled in, or copies it; ⌘K has both). User token scopes, one table per Web API method the server calls
(`METHOD_SCOPES`, checked against the server's code by `manifest.test.ts`): `channels:history channels:read channels:write
groups:history groups:read groups:write im:history im:read im:write mpim:history mpim:read mpim:write chat:write
reactions:read reactions:write files:read files:write users:read search:read emoji:read` (marking read and opening a DM are
writes). Socket Mode on, user events `message.channels message.groups message.im message.mpim reaction_added
reaction_removed channel_rename group_rename member_joined_channel user_change` (not the `*_marked` events: those are
Slack's old real-time API's, which a manifest refuses, so a conversation read elsewhere shows at the next unread check); the app-level token with `connections:write` is made by hand (a manifest can't).

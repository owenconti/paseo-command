# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`), one at a time, in order;
mark it done with its commit once merged into `main`.

## Open

- [ ] **Slack: your own messages show as "Paseo Command" (App).** A message you send from the Slack tab
  (e.g. a thread reply) is drawn with the app's name, a "PC" avatar and the App tag instead of as you.
  Find whether Slack really posts it as the app (`web/server/slack/writes.ts`, `chat.postMessage` with the
  user token) or our client mislabels it (`messageOf` in `web/server/slack/normalize.ts` takes `bot_profile`
  as `botName`; `web/src/slack/Message.tsx` shows App for `botName`). Messages with a person behind them
  (`user`) should show that person. Workspace: `fix-slack-own-message-as-app`.
- [ ] **Activity: Linear items and links open the issue in the Linear tab.** Linear notifications in the
  Activity feed (seen on pull request notifications about an issue, e.g. "Pull request checks failed" and
  "Pull request commented" on DE-7919) and links to Linear issues in it should open the issue in the Linear tab.
  `web/src/activity/open.ts` handles `open.kind === "linear-issue"`, which `web/server/activity/linear.ts`
  sets only when the group has an `issueKey`; check whether these PR-type notifications lack one (falling back
  to `url`), and whether Linear links in the preview are routed through `parseAppLink`. Workspace: `fix-activity-linear-links`.

## Done

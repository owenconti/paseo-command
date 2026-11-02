# TODO

Fixes to work through. Each open item is worked in its own Paseo workspace (worktree off local `main`);
mark it done with its commit once merged into `main`.

## Open

- [ ] **Slack: your own messages show as "Paseo Command" (App).** A message you send from the Slack tab
  (e.g. a thread reply) is drawn with the app's name, a "PC" avatar and the App tag instead of as you.
  Find whether Slack really posts it as the app (`web/server/slack/writes.ts`, `chat.postMessage` with the
  user token) or our client mislabels it (`messageOf` in `web/server/slack/normalize.ts` takes `bot_profile`
  as `botName`; `web/src/slack/Message.tsx` shows App for `botName`). Messages with a person behind them
  (`user`) should show that person. Workspace: `fix-slack-own-message-as-app`.

## Done

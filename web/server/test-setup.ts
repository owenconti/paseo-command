/**
 * Loaded before every test file (`npm test`): the app's data directory,
 * repository and settings file point into a temporary directory of their
 * own, so no test reads or writes a real checkout's `.paseo-command` or
 * `~/.paseo-command/settings.json`.
 * Nothing is created up front (other suites watch the OS temp directory).
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SLACK } from "./slack/client";

const root = join(tmpdir(), `paseo-command-test-${randomUUID()}`);
process.env.PASEO_COMMAND_DATA = join(root, "data");
process.env.PASEO_COMMAND_REPO = join(root, "repo");
process.env.PASEO_COMMAND_SETTINGS = join(root, "home", "settings.json");
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
// Tests never reach Linear's API, whatever the shell exports.
delete process.env.LINEAR_API_KEY;
// Tests never reach Slack: its Web API and Socket Mode refuse unless a test installs the fake (`slack/fake.ts`).
SLACK.fetch = (async () => {
  throw new Error("Tests never reach Slack: install the fake Slack (installFakeSlack).");
}) as typeof fetch;
SLACK.connect = () => {
  throw new Error("Tests never reach Slack: install the fake Slack (installFakeSlack).");
};

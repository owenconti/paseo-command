/**
 * Loaded before every test file (`npm test`): the app's data directory and
 * repository point into a temporary directory of their own, so no test
 * reads or writes a real checkout's `.paseo-command`.
 * Nothing is created up front (other suites watch the OS temp directory).
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), `paseo-command-test-${randomUUID()}`);
process.env.PASEO_COMMAND_DATA = join(root, "data");
process.env.PASEO_COMMAND_REPO = join(root, "repo");
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
// Tests never reach Linear's API, whatever the shell exports.
delete process.env.LINEAR_API_KEY;

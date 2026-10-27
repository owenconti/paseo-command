/**
 * `npm run subagents:archive -- [--dry-run] [--json] [--only <id>]... (--self | <agent-id>)`
 * (scripts/archive-subagents.mjs): archive the finished subagents of one
 * agent on the local daemon, as the Paseo app's "Archive finished subagents"
 * does (server/subagentArchive.ts). Running subagents are never touched.
 *
 * `--self` is the agent running the command: the daemon gives every agent's
 * processes `PASEO_AGENT_ID` (as the Paseo CLI's own `resolveCallerAgentId`
 * reads it), checked against the daemon before anything is done.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { daemon, discard, loopbackTarget } from "./daemon";
import {
  archiveFinishedSubagents,
  describeReport,
  type ArchiveClient,
} from "./subagentArchive";

export const USAGE = `Usage: npm run subagents:archive -- [--dry-run] [--json] [--only <subagent-id>]... (--self | <agent-id>)

Archives the finished subagents (completed, failed or canceled provider
subagents, and idle hidden daemon subagents) of one agent on the local Paseo
daemon. Running subagents, and finished ones with something still running
under them, are never touched.

  --self       The agent running this command (its PASEO_AGENT_ID).
  --dry-run    List what would be archived; change nothing.
  --only <id>  Only this subagent (an ID a dry run lists); repeatable.
  --json       Print the report as JSON.`;

type Io = {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Where the local daemon listens (host:port); found with `paseo status` when absent. */
  target?: () => Promise<string>;
};

/** The local daemon's address, as the Paseo CLI reports it. */
function statusTarget(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.PASEO_COMMAND_DAEMON)
    return Promise.resolve(loopbackTarget(env.PASEO_COMMAND_DAEMON));
  const cli =
    env.PASEO_COMMAND_CLI ||
    ["/Applications/Paseo.app/Contents/Resources/bin/paseo"].find((p) =>
      existsSync(p),
    ) ||
    "paseo";
  const clean = { ...env };
  delete clean.PASEO_AGENT_ID;
  return new Promise((resolve, reject) =>
    execFile(
      cli,
      ["status", "--json"],
      { env: clean, timeout: 15000 },
      (error, stdout) => {
        if (error)
          return reject(new Error("Couldn't find the local Paseo daemon."));
        try {
          resolve(loopbackTarget(String(JSON.parse(stdout).listen ?? "")));
        } catch (e) {
          reject(e);
        }
      },
    ),
  );
}

export async function runArchiveCli(argv: string[], io: Io): Promise<number> {
  const only = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++)
    if (argv[i] === "--only") {
      const id = argv[++i] ?? "";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id)) {
        io.err(`--only needs a subagent ID.\n\n${USAGE}`);
        return 2;
      }
      only.add(id);
    } else rest.push(argv[i]);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const ids = rest.filter((a) => !a.startsWith("--"));
  const known = new Set(["--self", "--dry-run", "--json", "--help"]);
  const unknown = [...flags].find((f) => !known.has(f));
  if (flags.has("--help")) {
    io.out(USAGE);
    return 0;
  }
  if (unknown || ids.length > 1 || flags.has("--self") === (ids.length === 1)) {
    io.err(unknown ? `Unknown option ${unknown}.\n\n${USAGE}` : USAGE);
    return 2;
  }
  const self = flags.has("--self");
  const parent = self ? (io.env.PASEO_AGENT_ID ?? "").trim() : ids[0];
  if (!parent) {
    io.err(
      "--self needs PASEO_AGENT_ID: run it from a Paseo agent, or pass the agent ID.",
    );
    return 2;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(parent)) {
    io.err(`Invalid agent ID: ${parent}`);
    return 2;
  }
  let client: Awaited<ReturnType<typeof daemon>> | undefined;
  try {
    const target = await (io.target ?? (() => statusTarget(io.env)))();
    client = await daemon(target);
    if (self) {
      // As the Paseo CLI checks a caller: the daemon must know it.
      const own = await client.fetchAgent(parent).catch(() => null);
      if (own?.agent?.id !== parent)
        throw new Error(
          `PASEO_AGENT_ID ${parent} isn't an agent on the local daemon.`,
        );
    }
    const report = await archiveFinishedSubagents({
      client: client as unknown as ArchiveClient,
      host: "local",
      parent,
      dryRun: flags.has("--dry-run"),
      ...(only.size ? { only } : {}),
    });
    io.out(
      flags.has("--json")
        ? JSON.stringify(report, null, 2)
        : describeReport(report),
    );
    return report.failed.length ? 1 : 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (client) discard(client);
  }
}

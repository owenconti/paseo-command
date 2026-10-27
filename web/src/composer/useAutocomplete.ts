import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import { composerTrigger } from "../trigger";
import { hostQuery } from "../types";
import type { Command } from "./types";

export type FileEntry = { path: string; kind: string };
export type Match =
  | { key: string; command: Command; file?: undefined }
  | { key: string; file: FileEntry; command?: undefined };

const CLIENT_COMMANDS: Command[] = [
  {
    name: "archive",
    description: "Archive the current agent",
    argumentHint: "",
    kind: "client",
  },
  {
    name: "new",
    description: "Archive this agent and start a fresh draft",
    argumentHint: "",
    kind: "client",
  },
  // An alias, for hands used to other agents' /clear.
  {
    name: "clear",
    description: "same as /new",
    argumentHint: "",
    kind: "client",
  },
];

/** Suggestions for the /command or @file being typed before the caret. */
export function useAutocomplete({
  agentId,
  host,
  before,
  focused,
}: {
  agentId: string;
  host?: string;
  /** The draft up to the caret. */
  before: string;
  focused: boolean;
}) {
  const trigger = useMemo(() => composerTrigger(before), [before]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const triggerKey = trigger ? `${trigger.type}:${trigger.start}` : null;
  const open = Boolean(trigger && focused && dismissed !== triggerKey);
  // Escape dismisses this trigger only: once it ends (or another starts),
  // typing "/" or "@" again reopens suggestions.
  useEffect(() => {
    if (dismissed !== null && triggerKey !== dismissed) setDismissed(null);
  }, [triggerKey, dismissed]);
  const [commands, setCommands] = useState<Command[] | null>(null);
  const [commandError, setCommandError] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open || trigger?.type !== "command" || commands) return;
    api<{ commands: Command[]; error: string | null }>(
      `agents/${agentId}/commands${hostQuery(host)}`,
    )
      .then((r) => {
        // Here /clear is /new: a provider's own /clear isn't offered.
        setCommands([
          ...r.commands.filter((c) => c.kind === "skill" || c.name !== "clear"),
          ...CLIENT_COMMANDS,
        ]);
        setCommandError(r.error || "");
      })
      .catch((e: unknown) => {
        setCommands(CLIENT_COMMANDS);
        setCommandError(errorMessage(e));
      });
  }, [open, trigger?.type, commands, agentId, host]);
  useEffect(() => {
    if (!open || trigger?.type !== "file") return;
    const controller = new AbortController();
    setFilesLoading(true);
    const t = setTimeout(
      () => {
        api<{ entries: FileEntry[] }>(
          `agents/${agentId}/files${hostQuery(host)}${host ? "&" : "?"}q=${encodeURIComponent(trigger.query)}`,
          undefined,
          controller.signal,
        )
          .then((r) => setFiles(r.entries))
          .catch(() => setFiles([]))
          .finally(() => setFilesLoading(false));
      },
      trigger.query ? 120 : 0,
    );
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, trigger?.type, trigger?.query, agentId, host]);
  const matches = useMemo((): Match[] => {
    if (!open || !trigger) return [];
    if (trigger.type === "file")
      return files.map((f) => ({ key: f.path, file: f }));
    const q = trigger.query.toLowerCase();
    // App commands (/new, /archive) replace the whole draft, so only at the start.
    const scored = (commands || [])
      .filter((c) => c.kind !== "client" || trigger.start === 0)
      .map((c) => {
        const n = c.name.toLowerCase();
        // Prefix, then word-boundary ("security-review" for "rev"), then substring, then description.
        const score = !q
          ? 1
          : n.startsWith(q)
            ? 0
            : n.split(/[-_:/]/).some((w) => w.startsWith(q))
              ? 1
              : n.includes(q)
                ? 2
                : c.description.toLowerCase().includes(q)
                  ? 3
                  : 9;
        return { c, score };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
    // A skill can share a name with a command (or /new, /archive).
    return scored.map(({ c }, i) => ({ key: `${c.name}:${i}`, command: c }));
  }, [open, trigger, files, commands]);
  useEffect(() => setActive(0), [triggerKey, trigger?.query]);
  return {
    trigger,
    triggerKey,
    open,
    dismiss: () => setDismissed(triggerKey),
    commands,
    commandError,
    filesLoading,
    matches,
    active,
    setActive,
  };
}

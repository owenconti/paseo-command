/**
 * Reply forks' record, in a small file in this app's data directory
 * (`forks.json`), and the words a fork is started and concluded with. A
 * fork is a helper agent that knows the main conversation up to a reply;
 * the record keeps which helper, what was highlighted and asked, and
 * whether it was closed or sent back.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Fork, Quote } from "../src/forks/types";
import { dataDir } from "./subagentArchive";

export const forksFile = () => join(dataDir(), "forks.json");

/** Every fork. No file: none. A damaged one throws rather than be
 *  overwritten (it holds the forks' history). */
function read(): Fork[] {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(forksFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("The forks record (forks.json) can't be read.");
  }
  return Array.isArray(raw?.forks) ? raw.forks : [];
}

function write(forks: Fork[]) {
  const file = forksFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ forks }) + "\n");
  renameSync(tmp, file);
}

/** One agent's forks, newest first. */
export function listForks(host: string | null, agentId: string): Fork[] {
  return read()
    .filter((f) => (f.host ?? null) === host && f.agentId === agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getFork = (id: string): Fork | undefined =>
  read().find((f) => f.id === id);

/** Insert, or replace the fork with the same id. */
export function saveFork(fork: Fork): Fork {
  write([...read().filter((f) => f.id !== fork.id), fork]);
  return fork;
}

const quoted = (quotes: Quote[]) =>
  quotes
    .map((q) =>
      q.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .join("\n\n");

/** The helper's first prompt: the highlighted pieces, then the question. */
export const firstPrompt = (quotes: Quote[], question: string) =>
  "This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:\n\n" +
  `${quoted(quotes)}\n\nTheir question: ${question}`;

export const CONCLUDE_PROMPT =
  "In a few sentences, state what this side conversation concluded, written for the main conversation. Reply with the conclusion only.";

/** What the main agent receives when a fork is sent back. */
export const sendBackText = (quotes: Quote[], conclusion: string) =>
  `From a side conversation about:\n${quoted(quotes)}\n\n${conclusion.trim()}`;

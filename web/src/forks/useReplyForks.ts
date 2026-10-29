/**
 * One agent's reply forks in its session: the forks listed for it, the
 * pieces collected for the next question, which fork the pane shows, and
 * the highlights drawn over its replies.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";
import { errorMessage } from "../api";
import { enqueue } from "../queue";
import { soundEvent } from "../soundCues";
import {
  closeFork,
  concludeFork,
  createFork,
  listForks,
  markSent,
  reopenFork,
  type ForkRow,
} from "./api";
import { paintMarks, replyFor } from "./marks";
import { nextColour, type Boundary, type Fork, type Quote } from "./types";

export const UNSUPPORTED = "Forks aren't supported on this host.";
/** The pane: a fork, or the question being written about collected pieces. */
export type Shown = string | "draft" | null;

export function useReplyForks(
  agent: { id: string; host?: string },
  {
    root,
    onNotice,
    repaint,
  }: {
    root: RefObject<HTMLElement | null>;
    onNotice: (message: string) => void;
    /** Changes whenever the replies may have re-rendered. */
    repaint: unknown;
  },
) {
  const [supported, setSupported] = useState(true);
  const [forks, setForks] = useState<ForkRow[]>([]);
  const [collected, setCollected] = useState<Quote[]>([]);
  const [shown, setShown] = useState<Shown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setForks([]);
    setCollected([]);
    setShown(null);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      listForks(agent.id, agent.host)
        .then((r) => {
          if (stop) return;
          // An answer without forks (a server that doesn't know them) is none.
          setSupported(r?.supported !== false);
          setForks(Array.isArray(r?.forks) ? r.forks : []);
        })
        .catch(() => {
          // The list is a convenience; its forks come back with the next read.
        })
        .finally(() => {
          if (!stop) timer = setTimeout(load, document.hidden ? 30000 : 5000);
        });
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [agent.id, agent.host]);

  const update = (fork: Fork) =>
    setForks((all) => {
      const at = all.findIndex((f) => f.id === fork.id);
      const row = { ...all[at], ...fork } as ForkRow;
      if (fork.closedAt === undefined) delete row.closedAt;
      return at < 0 ? [row, ...all] : all.map((f, i) => (i === at ? row : f));
    });

  const draftColour = nextColour(
    forks.filter((f) => !f.closedAt).map((f) => f.colour),
  );
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    paintMarks(el, [
      ...forks.map((f) => ({ name: `fork-${f.colour}`, quotes: f.quotes })),
      { name: "fork-draft", quotes: collected },
    ]);
  }, [forks, collected, repaint, root]);
  useEffect(() => () => paintMarks(document.body, []), []);

  const add = useCallback((q: Quote) => {
    setCollected((c) =>
      c.some((x) => x.replyKey === q.replyKey && x.start === q.start && x.end === q.end)
        ? c
        : [...c, q],
    );
  }, []);
  const askAbout = useCallback(
    (q: Quote) => {
      add(q);
      setShown("draft");
    },
    [add],
  );

  /** Where to cut the conversation: after the newest reply quoted. */
  const boundaryOf = (quotes: Quote[]): Boundary | null => {
    const el = root.current;
    if (!el) return null;
    const replies = quotes
      .map((q) => replyFor(el, q))
      .filter((r): r is HTMLElement => !!r);
    const newest = replies.reduce<HTMLElement | null>(
      (last, r) =>
        !last || last.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING
          ? r
          : last,
      null,
    );
    if (newest?.dataset.messageId) return { messageId: newest.dataset.messageId };
    if (newest?.dataset.seq) return { seq: Number(newest.dataset.seq) };
    return null;
  };

  const ask = async (question: string) => {
    const boundary = boundaryOf(collected);
    if (!boundary) {
      onNotice("This reply can't be forked.");
      return false;
    }
    setBusy("ask");
    try {
      const fork = await createFork(agent.id, agent.host, {
        question,
        quotes: collected,
        boundary,
      });
      update(fork);
      setCollected([]);
      setShown(fork.id);
      return true;
    } catch (e) {
      soundEvent("actionFailed");
      onNotice(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const open = async (id: string) => {
    const fork = forks.find((f) => f.id === id);
    if (fork?.closedAt)
      try {
        update(await reopenFork(id));
      } catch (e) {
        onNotice(errorMessage(e));
        return;
      }
    setShown(id);
  };

  const close = async (id: string) => {
    try {
      update(await closeFork(id));
      const next = forks.find((f) => f.id !== id && !f.closedAt);
      setShown(next ? next.id : null);
    } catch (e) {
      onNotice(errorMessage(e));
    }
  };

  /** Ask the fork for its conclusion and send it to the main agent through
   *  its queue: delivered once it isn't working (it may start a turn while
   *  the conclusion is written), after anything queued before, never
   *  interrupting. */
  const sendBack = async (id: string, main: { running: boolean }) => {
    setBusy(`send:${id}`);
    try {
      const { text } = await concludeFork(id);
      await enqueue(agent.id, text, []);
      onNotice(
        main.running ? "Queued for the main agent" : "Sent back to the main agent",
      );
      update(await markSent(id));
    } catch (e) {
      soundEvent("actionFailed");
      onNotice(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return {
    supported,
    forks,
    collected,
    draftColour,
    shown,
    busy,
    add,
    askAbout,
    removeCollected: (i: number) =>
      setCollected((c) => c.filter((_, j) => j !== i)),
    ask,
    open,
    close,
    back: () => setShown(null),
    show: setShown,
    sendBack,
  };
}

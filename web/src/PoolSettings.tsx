import { useEffect, useId, useState } from "react";
import { api, errorMessage } from "./api";
import { plainText } from "./ui";
import { refreshPool, usePool } from "./poolStore";
import { DEFAULT_POOL, idleBoxes, poolCheckoutProblem, poolDirProblem, type PoolSettings as Paths } from "./pool";

/** Settings → Integrations → Pool boxes: its state beside its switch. */
export function poolBadge(pool: ReturnType<typeof usePool>) {
  if (!pool?.enabled) return null;
  return pool.problem ? { tone: "needs" as const, text: "Scripts not found" } : { tone: "ready" as const, text: "Ready" };
}

/** The paseo-boxes folder on this Mac and the checkout on a box, each saved as it's left. */
export function PoolSettings() {
  const pool = usePool();
  const [error, setError] = useState("");
  const save = async (change: Partial<Paths>) => {
    setError("");
    try {
      const answer = await api<{ error?: string | null }>("settings", { pool: change });
      if (answer.error) throw new Error(answer.error);
    } catch (e) {
      setError(errorMessage(e));
    }
    await refreshPool();
  };
  const boxes = pool?.boxes ?? [];
  const idle = idleBoxes(boxes).length;
  return (
    <>
      <PathField
        label="paseo-boxes folder"
        hint="On this Mac: where claim.sh, release.sh and pool-state.json are"
        value={pool?.settings.dir ?? DEFAULT_POOL.dir}
        placeholder="~/…/paseo-boxes"
        problem={poolDirProblem}
        onSave={(dir) => save({ dir })}
      />
      <PathField
        label="Checkout on the box"
        hint="Where a pool box's agent works"
        value={pool?.settings.checkout ?? DEFAULT_POOL.checkout}
        placeholder="/path/to/the/repo/on/the/box"
        problem={poolCheckoutProblem}
        onSave={(checkout) => save({ checkout })}
      />
      <p className="pool-setting-state" role="status">
        {error ||
          pool?.problem ||
          (pool
            ? boxes.length
              ? `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"} · ${idle} idle. New agent's Host has “New pool box”; a claimed box's host can be released from the Hosts tab.`
              : "pool-state.json lists no boxes yet."
            : "")}
      </p>
    </>
  );
}

function PathField({
  label,
  hint,
  value,
  placeholder,
  problem,
  onSave,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  problem: (v: string) => string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [why, setWhy] = useState("");
  const id = useId();
  useEffect(() => setText(value), [value]);
  const save = () => {
    const next = text.trim();
    if (next === value) return setWhy("");
    const p = problem(next);
    setWhy(p);
    if (!p) onSave(next);
  };
  return (
    <div className="linear-setting pool-setting">
      <label htmlFor={id}>
        <b>{label}</b>
        <small>{why || hint}</small>
      </label>
      <div className="linear-slug-field">
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          {...plainText}
          aria-invalid={!!why || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </div>
    </div>
  );
}

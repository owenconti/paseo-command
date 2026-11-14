/**
 * The crew's Pool boxes section (Settings → Integrations → Pool boxes on): every box paseo-boxes records
 * (`pool-state.json`), each with its state (idle and asleep, claimed with its host online or not and how many
 * agents it has, provisioning, failed, or a claim or release running on it) and Release on a claimed one. A
 * claimed box's name shows its host's head on the map. Folded with the map's other folds (`crew:collapsed`).
 */
import { ChevronDown, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { boxView, jobRunning, jobText, type PoolBox, type PoolJob } from "../pool";

export type BoxHost = { key: string; online: boolean; agents: number };

export function PoolBoxes(props: {
  boxes: PoolBox[];
  /** Claims and releases the server knows (running ones say what they're doing). */
  jobs: PoolJob[];
  /** The Paseo host registered as the box (`pool-N`), on the map. */
  hostOf: (label: string) => BoxHost | undefined;
  release: (box: PoolBox) => void;
  shut: boolean;
  toggle: () => void;
  /** Show a host's head on the map (scrolled into view). */
  showHost: (key: string) => void;
}) {
  // "claimed 2h ago" moves on.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const running = props.jobs.find(jobRunning) ?? null;
  const claimed = props.boxes.filter((b) => b.status === "claimed").length;
  const idle = props.boxes.filter((b) => b.status === "idle").length;
  return (
    <section className="crew-host crew-pool" aria-label="Pool boxes">
      <h3 className="crew-host-head">
        <button className="crew-fold" aria-expanded={!props.shut} onClick={props.toggle}>
          <ChevronDown size={14} aria-hidden="true" />
          Pool boxes
        </button>
        <span className="crew-pool-count">{`${claimed} claimed · ${idle} idle`}</span>
      </h3>
      {!props.shut && (
        <ul className="crew-pool-boxes">
          {props.boxes.map((box) => {
            const host = props.hostOf(box.label);
            const job = props.jobs.find((j) => j.pool === box.id && jobRunning(j)) ?? null;
            const view = boxView(box, host, job, now);
            const canShow = !!host && box.status === "claimed";
            return (
              <li key={box.id} className="crew-pool-box" data-tone={view.tone} data-box={box.id}>
                <span className="crew-pool-dot" aria-hidden="true" />
                <span className="crew-pool-text">
                  {canShow ? (
                    <button className="crew-pool-name" data-tip={`Show ${box.label}'s host on the map`} onClick={() => props.showHost(host.key)}>
                      {box.label}
                    </button>
                  ) : (
                    <span className="crew-pool-name">{box.label}</span>
                  )}
                  <span className="crew-pool-state">{view.state}</span>
                  {view.detail && <span className="crew-pool-detail">{view.detail}</span>}
                </span>
                {box.status === "claimed" && !job && (
                  <button
                    className="crew-head-action"
                    disabled={!!running}
                    data-tip={running ? jobText(running) : `Release pool box ${box.label}: restore it and return it to the pool`}
                    aria-label={`Release pool box ${box.label}`}
                    onClick={() => props.release(box)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    Release
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

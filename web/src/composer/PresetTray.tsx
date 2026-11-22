import { useEffect } from "react";
import { Pencil, Play } from "lucide-react";
import { presetNeedsPr, type Preset } from "../presets";
import { openPresetEditor, refreshPresets, usePresetList } from "../presetsStore";

/** A conversation's preset prompts: a bar of buttons joined to the top of its message box, always shown,
 * each sending its prompt at once. */
export function PresetTray({
  disabled,
  hasPr,
  onSend,
}: {
  disabled: boolean;
  /** Whether the workspace has a pull request for `{{pr}}`. */
  hasPr: boolean;
  onSend: (preset: Preset) => void;
}) {
  const presets = usePresetList();
  // Read settings.json again as a conversation opens, so presets edited elsewhere show.
  useEffect(() => {
    void refreshPresets();
  }, []);
  return (
    <div className="preset-dock">
      <div className="preset-tray" role="group" aria-label="Preset prompts">
        {presets.map((p) => {
          const waiting = presetNeedsPr(p) && !hasPr;
          return (
            <button
              type="button"
              key={p.name}
              className="preset-btn"
              disabled={disabled || waiting}
              aria-description={
                waiting
                  ? "This prompt names the workspace's pull request, and it has none"
                  : `Sends this prompt now: ${p.prompt.slice(0, 200)}`
              }
              onClick={() => onSend(p)}
            >
              <Play size={10} aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
        <button
          type="button"
          className="preset-btn edit"
          aria-description="Add, change or reorder the preset prompts"
          onClick={openPresetEditor}
        >
          <Pencil size={10} aria-hidden="true" />
          {presets.length ? "Edit" : "Add a preset prompt"}
        </button>
      </div>
    </div>
  );
}

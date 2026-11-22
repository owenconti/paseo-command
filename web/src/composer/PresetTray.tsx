import { ChevronDown, ChevronUp, Pencil, Play } from "lucide-react";
import { presetNeedsPr, type Preset } from "../presets";
import {
  openPresetEditor,
  refreshPresets,
  setPresetTray,
  usePresetList,
  usePresetTray,
} from "../presetsStore";

/** A conversation's preset prompts: a tab on the message box's top edge that slides out a tray of
 * buttons above it, each sending its prompt at once. Out or tucked away is remembered. */
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
  const open = usePresetTray();
  const presets = usePresetList();
  const Chevron = open ? ChevronDown : ChevronUp;
  return (
    <div className="preset-dock" data-open={open || undefined}>
      <button
        type="button"
        className="preset-tab"
        aria-expanded={open}
        aria-controls="preset-tray"
        aria-description={open ? "Tuck the preset prompts away" : "Show the preset prompts, each sent with a click"}
        onClick={() => {
          // Read settings.json again as it opens, so presets edited elsewhere show.
          if (!open) void refreshPresets();
          setPresetTray(!open);
        }}
      >
        Presets
        <Chevron size={11} aria-hidden="true" />
      </button>
      {open && (
        <div id="preset-tray" className="preset-tray" role="group" aria-label="Preset prompts">
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
      )}
    </div>
  );
}

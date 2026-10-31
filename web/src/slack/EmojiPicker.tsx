import { useEffect, useRef, useState } from "react";
import { plainText } from "../ui";
import { placeBelow } from "../linear/Picker";
import { Emoji } from "./bits";
import { matchEmoji } from "./emoji";
import { useSlack } from "./store";

/** What the picker offers before anything's typed: Slack's usual reactions. */
const USUAL = [
  "+1", "heart", "joy", "tada", "eyes", "white_check_mark", "pray", "raised_hands",
  "fire", "rocket", "100", "thinking_face", "clap", "sob", "slightly_smiling_face", "ok_hand",
  "muscle", "sparkles", "wave", "heavy_plus_sign", "x", "warning", "bulb", "saluting_face",
];

/**
 * A reaction picker under its button: the usual reactions, or those whose
 * names match what's typed (the workspace's custom emoji too). Enter takes
 * the first, Esc or a click elsewhere closes it.
 */
export function EmojiPicker({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const custom = useSlack((d) => d.workspace?.emoji);
  const [query, setQuery] = useState("");
  const menu = useRef<HTMLDivElement | null>(null);
  const names = query.trim() ? matchEmoji(query.trim().replace(/^:|:$/g, ""), custom, 40) : USUAL;
  useEffect(() => {
    const el = menu.current;
    if (el) placeBelow(el);
    const down = (e: MouseEvent) => {
      if (!menu.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);
  return (
    <div
      ref={menu}
      className="popover-menu slack-emoji-picker"
      role="dialog"
      aria-label="Add a reaction"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <input
        {...plainText}
        autoFocus
        type="search"
        aria-label="Find an emoji"
        placeholder="Find an emoji"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && names[0]) {
            e.preventDefault();
            onPick(names[0]);
          }
        }}
      />
      <div className="slack-emoji-grid" role="group" aria-label="Emoji">
        {names.length === 0 && <p className="slack-note">No emoji match.</p>}
        {names.map((name) => (
          <button key={name} type="button" aria-label={`:${name}:`} data-tip={`:${name}:`} onClick={() => onPick(name)}>
            <Emoji name={name} />
          </button>
        ))}
      </div>
    </div>
  );
}

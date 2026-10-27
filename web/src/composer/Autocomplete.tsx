import { File as FileIcon, LoaderCircle, Slash } from "lucide-react";
import { pathText } from "../names";
import { placePopover } from "../popover";
import type { Agent } from "../types";
import type { useAutocomplete } from "./useAutocomplete";

/** The /commands and @files suggestion list above the text area. */
export function Autocomplete({
  agent,
  suggestions,
  onChoose,
}: {
  agent: Agent;
  suggestions: ReturnType<typeof useAutocomplete>;
  onChoose: (index: number) => void;
}) {
  const {
    open,
    trigger,
    matches,
    filesLoading,
    commands,
    commandError,
    active,
    setActive,
  } = suggestions;
  if (
    !open ||
    !(
      matches.length > 0 ||
      (trigger?.type === "file" && filesLoading) ||
      commands === null ||
      commandError
    )
  )
    return null;
  return (
    <div
      ref={placePopover}
      className="autocomplete"
      role="listbox"
      aria-label={trigger?.type === "file" ? "Files" : "Commands and skills"}
    >
      <div className="autocomplete-head">
        {trigger?.type === "file" ? (
          <>
            <FileIcon size={11} /> Files in{" "}
            {pathText(agent.cwd.split("/").slice(-2).join("/"), [
              agent.id,
              agent.shortId,
            ])}
          </>
        ) : (
          <>
            <Slash size={11} /> Commands &amp; skills
          </>
        )}
        {(filesLoading ||
          (trigger?.type === "command" && commands === null)) && (
          <LoaderCircle size={11} className="spinning" />
        )}
      </div>
      {commandError && trigger?.type === "command" && (
        <p className="autocomplete-note">{commandError}</p>
      )}
      {matches.map((m, i) => (
        <button
          aria-description={
            "command" in m && m.command
              ? `/${m.command.name}${m.command.description ? ` — ${m.command.description}` : ""}`
              : "file" in m && m.file
                ? `Insert @${m.file.path}`
                : undefined
          }
          key={m.key}
          role="option"
          aria-selected={i === active}
          className={i === active ? "active" : ""}
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(i);
          }}
          onMouseMove={() => i !== active && setActive(i)}
          ref={(el) => {
            if (el && i === active) el.scrollIntoView({ block: "nearest" });
          }}
        >
          {"command" in m && m.command ? (
            <>
              <b>/{m.command.name}</b>
              {m.command.argumentHint && <code>{m.command.argumentHint}</code>}
              <span>{m.command.description}</span>
              <em className={m.command.kind}>
                {m.command.kind === "client" ? "app" : m.command.kind}
              </em>
            </>
          ) : "file" in m && m.file ? (
            <>
              <FileIcon size={12} />
              <b className="path">{m.file.path}</b>
              {m.file.kind === "directory" && <em>folder</em>}
            </>
          ) : null}
        </button>
      ))}
      {trigger?.type === "file" && !filesLoading && !matches.length && (
        <p className="autocomplete-note">No matching files.</p>
      )}
    </div>
  );
}

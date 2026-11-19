/** The open agent's workspace files beside its conversation on Crew, in the place its browser takes (the user's pick,
 * "A" of three mockups): the Files tab's own view (`FilesView`, `embedded`: the tree, the file tabs, Changes, and a
 * file in the editor set in Settings → Files, such as nvim, which the macOS app lays over it for the Command tab). F,
 * the strip's Files button and ⌘K show or hide it; it can fill the view over the conversation too, or open in the Files
 * tab, which keeps the same tabs and editors. */
import { useState } from "react";
import { ExternalLink, FolderTree, Maximize2, Minimize2, X } from "lucide-react";
import { FilesView, type FilesWorkspaceInfo } from "../files/FilesView";
import { postAppMenu } from "../worldBridge";
import "./crew-files.css";

export function CrewFiles(props: {
  workspace?: FilesWorkspaceInfo & { branch?: string };
  /** The agent's name, for what the pane is called. */
  name: string;
  onClose: () => void;
  onNotice: (message: string) => void;
  onOpenPr?: (repo: string, number: number) => void;
  onExternal?: (url: string) => void;
}) {
  const [filled, setFilled] = useState(false);
  const { workspace } = props;
  return (
    <section className={`crew-files ${filled ? "filled" : "beside"}`} aria-label={`${props.name}’s files`}>
      <header className="crew-files-head">
        <FolderTree size={14} aria-hidden="true" />
        <b>Files</b>
        {workspace?.name && <span className="crew-files-where">{workspace.branch && workspace.branch !== workspace.name ? `${workspace.name} · ${workspace.branch}` : workspace.name}</span>}
        <span className="crew-files-tools">
          <button className="icon-btn crew-files-tool" aria-label="Open in the Files tab" data-tip="Open in the Files tab (⇧⌘E)" onClick={() => postAppMenu("files")}>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
          <button
            className="icon-btn crew-files-tool"
            aria-label={filled ? "Put the files beside the conversation" : "Make the files fill the view"}
            aria-pressed={filled}
            data-tip={filled ? "Beside the conversation" : "Fill the view"}
            onClick={() => setFilled(!filled)}
          >
            {filled ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn crew-files-tool" aria-label="Close the files" data-tip="Close the files (F)" onClick={props.onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="crew-files-body">
        <FilesView
          workspace={workspace}
          embedded
          onNotice={props.onNotice}
          {...(props.onOpenPr ? { onOpenPr: props.onOpenPr } : {})}
          {...(props.onExternal ? { onExternal: props.onExternal } : {})}
        />
      </div>
    </section>
  );
}

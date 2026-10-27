export type ImageAttachment = {
  kind: "image";
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};
export type UploadedFile = {
  type: "uploaded_file";
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
};
export type FileAttachment = {
  kind: "file";
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  uploaded?: UploadedFile;
  error?: string;
};
export type GitHubItem = {
  kind: "pr" | "issue";
  number: number;
  title: string;
  url: string;
  state?: string;
  body?: string | null;
  baseRefName?: string | null;
  headRefName?: string | null;
};
export type GitHubAttachment = { kind: "github"; id: string; item: GitHubItem };
export type Attachment = ImageAttachment | FileAttachment | GitHubAttachment;

export type Behavior = "queue" | "steer" | "interrupt";
export type Outgoing = {
  text: string;
  images: { data: string; mimeType: string; dataUrl: string }[];
  attachments: unknown[];
  behavior?: "steer" | "interrupt";
  /** Kept across attempts so the daemon can recognise a repeat. */
  messageId?: string;
};
export type Command = {
  name: string;
  description: string;
  argumentHint: string;
  kind: "command" | "skill" | "client";
};
export type Feature = {
  id: string;
  type: string;
  label: string;
  description?: string;
  tooltip?: string;
  value?: unknown;
  options?: { id: string; label: string }[];
};
export type Config = {
  provider: string;
  model: string | null;
  thinking: string | null;
  mode: string | null;
  features: Feature[];
};

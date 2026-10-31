import type { LinearIssue } from "./types";

/** An issue a new agent starts from (New agent's `DispatchTarget.issue`). */
export type IssueContext = {
  key: string;
  title: string;
  url: string;
  description?: string;
  branchName?: string;
};

/** Markdown images uploaded to Linear (which load only with the API key) as
 * the app server's route to them, `origin`'s `/api/linear/image`. Links to
 * uploads, and images elsewhere, are left as they are. */
export function linearImages(markdown: string, origin: string) {
  return markdown.replace(
    /(!\[[^\]]*\]\()\s*<?(https:\/\/uploads\.linear\.app\/[^)\s>]+)>?/g,
    (_, head: string, url: string) =>
      `${head}${origin}/api/linear/image?url=${encodeURIComponent(url)}`,
  );
}

/** How much of a description goes into a prompt. */
const DESCRIPTION_LIMIT = 8000;

/** The issue as a prompt names it: its key, title, link and description. */
export function issueBlock(issue: IssueContext) {
  const description = issue.description?.trim() ?? "";
  return [
    `Linear issue ${issue.key}: ${issue.title}`,
    issue.url,
    description &&
      `\n${description.length > DESCRIPTION_LIMIT ? `${description.slice(0, DESCRIPTION_LIMIT)}…` : description}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The first message New agent offers for an issue, to edit before sending. */
export const issuePrompt = (issue: IssueContext) =>
  `Work on this issue.\n\n${issueBlock(issue)}`;

/** The issue a detail view launches an agent for. */
export const issueContext = (issue: LinearIssue): IssueContext => ({
  key: issue.key,
  title: issue.title,
  url: issue.url,
  description: issue.description,
  branchName: issue.branchName,
});

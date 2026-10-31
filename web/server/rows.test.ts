import { test } from "node:test";
import assert from "node:assert/strict";
import { githubRepoUrl, workspaceRow } from "./rows";

test("a GitHub remote names its repository page", () => {
  for (const remote of [
    "git@github.com:acme/app.git",
    "https://github.com/acme/app.git",
    "https://github.com/acme/app",
    "ssh://git@github.com/acme/app.git",
    "https://token@github.com/acme/app/",
  ])
    assert.equal(githubRepoUrl(remote), "https://github.com/acme/app", remote);
  assert.equal(
    githubRepoUrl("git@github.com:acme/my.site.git"),
    "https://github.com/acme/my.site",
  );
  for (const remote of [
    null,
    "",
    "git@gitlab.com:acme/app.git",
    "https://github.com.evil.io/acme/app",
    "https://github.com/acme",
    "/tmp/repo",
  ])
    assert.equal(githubRepoUrl(remote), null, String(remote));
});

test("a workspace row carries its repository from the checkout's remote", () => {
  const row = workspaceRow({
    id: "w1",
    projectId: "p1",
    gitRuntime: { currentBranch: "main", remoteUrl: "git@github.com:acme/app.git" },
  } as any);
  assert.equal(row.repo, "https://github.com/acme/app");
  assert.equal(
    workspaceRow({
      id: "w2",
      project: { checkout: { remoteUrl: "https://github.com/acme/app.git" } },
    } as any).repo,
    "https://github.com/acme/app",
  );
  assert.equal("repo" in workspaceRow({ id: "w3" } as any), false);
});

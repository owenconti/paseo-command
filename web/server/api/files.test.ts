import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get, install, register, serve } from "../fake-daemon";
import { isIgnored, parseIgnore } from "../files/gitignore";
import { checkPath, FILES, resetFilesCache } from "./files";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;

const BIG = "x".repeat(1024 * 1024 + 1);
before(async () => {
  uninstall = install(network);
  local.addProject({ projectId: "prj_app", path: "/home/review/code" });
  local.addWorkspace({ id: "wks_app", projectId: "prj_app", cwd: "/home/review/code/wt", branch: "feature" });
  local.trees.set(
    "/home/review/code/wt",
    new Map<string, string | Uint8Array | "dir" | "outside">([
      [".gitignore", "node_modules/\n*.log\n/dist\n!keep.log\n"],
      [".git/HEAD", "ref: refs/heads/feature\n"],
      [".git/info/exclude", "secret.txt\n"],
      ["README.md", "# App\n"],
      ["src/index.ts", "export const a = 1;\n"],
      ["src/util/strings.ts", "export const s = 'x';\n"],
      ["src/.gitignore", "generated/\n"],
      ["src/generated/out.ts", "// generated\n"],
      ["src/debug.log", "log\n"],
      ["src/keep.log", "kept\n"],
      ["dist/app.js", "built\n"],
      ["lib/dist/inner.js", "not the root's dist\n"],
      ["node_modules/pkg/index.js", "module.exports = 1;\n"],
      ["secret.txt", "shh\n"],
      ["empty", "dir"],
      ["logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])],
      ["data.bin", new Uint8Array([1, 2, 0, 3])],
      ["latin1.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9])],
      ["big.txt", BIG],
      ["escape", "outside"],
    ]),
  );
  local.checkouts.set("/home/review/code/wt", {
    diffs: { all: [{ path: "src/index.ts", isNew: false, isDeleted: false, additions: 1, deletions: 0, hunks: [] }, { path: "src/new.ts", isNew: true, isDeleted: false, additions: 1, deletions: 0, hunks: [] }] },
    status: {},
  });
  remote.addProject({ projectId: "prj_far", path: "/srv/far" });
  remote.addWorkspace({ id: "wks_far", projectId: "prj_far", cwd: "/srv/far" });
  remote.trees.set("/srv/far", new Map([["far.go", "package far\n"]]));
  server = await serve();
});
beforeEach(() => resetFilesCache());
after(async () => {
  await server?.close();
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

const names = (r: { data: { entries: { name: string; ignored?: boolean }[] } }) =>
  r.data.entries.map((e) => `${e.name}${e.ignored ? " (ignored)" : ""}`);

test("a workspace's root: directories first, by name, with git's ignores marked", async () => {
  const r = await get("files/tree?workspace=wks_app");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.dir, "");
  assert.deepEqual(names(r), [
    ".git (ignored)",
    "dist (ignored)",
    "empty",
    "lib",
    "node_modules (ignored)",
    "src",
    ".gitignore",
    "big.txt",
    "data.bin",
    "latin1.txt",
    "logo.png",
    "README.md",
    "secret.txt (ignored)",
  ]);
  const src = r.data.entries.find((e: { name: string }) => e.name === "src");
  assert.deepEqual(src, { name: "src", path: "src", kind: "directory", size: 0 });
  // A symlink out of the workspace isn't listed (the daemon leaves it out).
  assert.ok(!names(r).some((n) => n.startsWith("escape")));
});

test("a folder's own .gitignore and its parents' apply, the deeper and later ones winning", async () => {
  const r = await get("files/tree?workspace=wks_app&dir=src");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(names(r), ["generated (ignored)", "util", ".gitignore", "debug.log (ignored)", "index.ts", "keep.log"]);
  assert.deepEqual(r.data.entries.find((e: { name: string }) => e.name === "index.ts").path, "src/index.ts");
  // `/dist` is the root's only.
  assert.deepEqual(names(await get("files/tree?workspace=wks_app&dir=lib")), ["dist"]);
});

test("reads: a text file, and binary, image, non-UTF-8 and big files refused politely", async () => {
  const text = await get("files/read?workspace=wks_app&path=src/index.ts");
  assert.deepEqual(text.data, { path: "src/index.ts", size: 20, text: "export const a = 1;\n" });
  assert.equal((await get("files/read?workspace=wks_app&path=data.bin")).data.refused, "binary");
  assert.equal((await get("files/read?workspace=wks_app&path=latin1.txt")).data.refused, "binary");
  assert.equal((await get("files/read?workspace=wks_app&path=logo.png")).data.refused, "image");
  assert.deepEqual((await get("files/read?workspace=wks_app&path=big.txt")).data, { path: "big.txt", size: 1024 * 1024 + 1, refused: "large" });
  // Its size known from the listing, the big file isn't even asked for.
  resetFilesCache();
  await get("files/tree?workspace=wks_app");
  const reads = local.calls.filter((c) => c.method === "readFile" && c.args[1] === "big.txt").length;
  assert.equal((await get("files/read?workspace=wks_app&path=big.txt")).data.refused, "large");
  assert.equal(local.calls.filter((c) => c.method === "readFile" && c.args[1] === "big.txt").length, reads);
  // The daemon is asked for no more than the limit.
  assert.equal(local.calls.find((c) => c.method === "readFile" && c.args[1] === "src/index.ts")!.args[2], 1024 * 1024);
});

test("paths stay in the workspace: .., absolute, odd segments and symlinks out are refused", async () => {
  for (const bad of ["../etc/passwd", "src/../../x", "/etc/passwd", "~/x", "src//index.ts", "./src", "src/./index.ts", "a\\b", "a%00b"]) {
    const r = await get(`files/read?workspace=wks_app&path=${encodeURIComponent(bad).replace("%2500", "%00")}`);
    assert.equal(r.status, 400, `${bad}: ${JSON.stringify(r.data)}`);
    assert.equal((await get(`files/tree?workspace=wks_app&dir=${encodeURIComponent(bad)}`)).status, 400, bad);
  }
  // None of those reached the daemon.
  assert.ok(!local.calls.some((c) => (c.method === "readFile" || c.method === "listDirectory") && /\.\.|^\/|^~/.test(String(c.args[1]))));
  const out = await get("files/read?workspace=wks_app&path=escape");
  assert.equal(out.status, 400);
  assert.equal(out.data.error, "That path is outside the workspace.");
  assert.equal((await get("files/read?workspace=wks_app&path=gone.ts")).data.error, "That file or folder isn't there any more.");
  assert.equal((await get("files/tree?workspace=wks_app&x=1")).status, 400);
  assert.equal((await get("files/tree?workspace=wks_none")).status, 400);
  // A workspace is its own host's: not found on another.
  assert.equal((await get("files/tree?workspace=wks_far")).status, 400);
  assert.equal((await get("files/read?workspace=wks_app")).status, 400);
});

test("all files for quick-open: none ignored, none in .git", async () => {
  const r = await get("files/all?workspace=wks_app");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, {
    files: [".gitignore", "README.md", "big.txt", "data.bin", "latin1.txt", "lib/dist/inner.js", "logo.png", "src/.gitignore", "src/index.ts", "src/keep.log", "src/util/strings.ts"],
    capped: false,
  });
});

test("the walk stops at its cap and says so", async () => {
  const was = FILES.maxDirs;
  FILES.maxDirs = 1;
  try {
    const r = await get("files/all?workspace=wks_app");
    assert.equal(r.data.capped, true);
    assert.ok(r.data.files.includes("README.md") && !r.data.files.includes("src/index.ts"));
  } finally {
    FILES.maxDirs = was;
  }
});

test("answers are kept a few seconds; fresh=1 asks again", async () => {
  const count = () => local.calls.filter((c) => c.method === "listDirectory" && c.args[1] === "src").length;
  const was = count();
  await get("files/tree?workspace=wks_app&dir=src");
  await get("files/tree?workspace=wks_app&dir=src");
  assert.equal(count(), was + 1);
  await get("files/tree?workspace=wks_app&dir=src&fresh=1");
  assert.equal(count(), was + 2);
});

test("changed files, and a remote host's workspace read by its own daemon", async () => {
  assert.deepEqual((await get("files/changed?workspace=wks_app")).data, {
    files: [
      { path: "src/index.ts", change: "modified" },
      { path: "src/new.ts", change: "added" },
    ],
  });
  const far = await get("files/tree?workspace=wks_far&host=srv_remote");
  assert.equal(far.status, 200, JSON.stringify(far.data));
  assert.deepEqual(names(far), ["far.go"]);
  assert.equal((await get("files/read?workspace=wks_far&host=srv_remote&path=far.go")).data.text, "package far\n");
  assert.ok(remote.calls.some((c) => c.method === "readFile"));
  assert.deepEqual((await get("files/changed?workspace=wks_far&host=srv_remote")).data, { available: false, reason: "This workspace's folder isn't a git checkout." });
});

test("checkPath", () => {
  assert.equal(checkPath(null), "");
  assert.equal(checkPath("."), "");
  assert.equal(checkPath("a/b.ts"), "a/b.ts");
  assert.equal(checkPath(".github/workflows"), ".github/workflows");
  for (const bad of ["..", "a/..", "/a", "a/", "a//b", "a/./b", "~", "a\0b", "a\\b"]) assert.throws(() => checkPath(bad), bad);
});

test("gitignore patterns", () => {
  const rules = [
    ...parseIgnore("# comment\n\n*.log\n!important.log\nbuild/\n/root-only\ndocs/**/*.md\n**/cache\n\\#hash\nfoo?.txt\n[ab].c\ntrailing   \n"),
    ...parseIgnore("*.tmp\n!keep.log\n", "sub"),
  ];
  const yes = (p: string, dir = false) => assert.ok(isIgnored(rules, p, dir), `${p} ignored`);
  const no = (p: string, dir = false) => assert.ok(!isIgnored(rules, p, dir), `${p} not ignored`);
  yes("a.log");
  yes("deep/x/a.log");
  no("important.log");
  yes("build", true);
  no("build");
  yes("x/build", true);
  yes("root-only");
  no("x/root-only");
  yes("docs/a.md");
  yes("docs/x/y/a.md");
  no("docs/a.txt");
  yes("cache", true);
  yes("a/b/cache");
  yes("#hash");
  yes("foo1.txt");
  no("foo12.txt");
  yes("a.c");
  no("c.c");
  yes("trailing");
  yes("sub/x.tmp");
  no("x.tmp");
  no("sub/keep.log");
  yes("sub/other.log");
});

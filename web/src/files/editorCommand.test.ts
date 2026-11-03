import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DEFAULT_FILES_SETTINGS, editorCommandLine, editorCommandProblem, editorLaunch, filesSettings, shellQuote } from "./editorCommand";

test("an editor command: {file} required, {line} allowed, nothing else", () => {
  assert.equal(editorCommandProblem("nvim {file}"), null);
  assert.equal(editorCommandProblem("nvim +{line} {file}"), null);
  assert.equal(editorCommandProblem("  hx {file}:{line}  "), null);
  assert.equal(editorCommandProblem("cd sub && vim {file}"), null);
  assert.match(editorCommandProblem("")!, /Enter the command/);
  assert.match(editorCommandProblem("nvim")!, /Include \{file\}/);
  assert.match(editorCommandProblem("nvim {path}")!, /Unknown placeholder \{path\}/);
  assert.match(editorCommandProblem("nvim {file}\nrm -rf ~")!, /one line/);
  assert.match(editorCommandProblem("nvim {file}\u0007")!, /one line/);
  assert.match(editorCommandProblem("x".repeat(301) + "{file}")!, /under 300/);
  // Quoted for you: inside quotes the quoting would be read literally.
  assert.match(editorCommandProblem('nvim "{file}"')!, /unquoted/);
  assert.match(editorCommandProblem("nvim '{file}'")!, /unquoted/);
  assert.match(editorCommandProblem("nvim '+{line}' {file}")!, /unquoted/);
  assert.equal(editorCommandProblem("nvim \\\"x {file}"), null);
  assert.equal(editorCommandProblem("nvim '-c set nu' {file}"), null);
  assert.match(editorCommandProblem("nvim 'oops {file}")!, /unquoted|unclosed/);
  assert.match(editorCommandProblem("nvim {file} 'oops")!, /unclosed/);
  // Brace expansion and other braces are the user's.
  assert.equal(editorCommandProblem("nvim {file} -c {1,2}"), null);
});

test("the file is single-quoted and the line a number: no name becomes shell syntax", () => {
  assert.equal(editorCommandLine("nvim {file}", "src/index.ts"), "nvim 'src/index.ts'");
  assert.equal(editorCommandLine("nvim +{line} {file}", "a b.ts", 42), "nvim +42 'a b.ts'");
  assert.equal(editorCommandLine("nvim {file}", "it's.ts"), "nvim 'it'\\''s.ts'");
  assert.equal(editorCommandLine("nvim {file}", "-rf"), "nvim './-rf'");
  assert.equal(editorCommandLine("nvim +{line} {file}", "a", -3), "nvim +1 'a'");
  assert.equal(editorCommandLine("nvim +{line} {file}", "a", 1.5), "nvim +1 'a'");
  assert.throws(() => editorCommandLine("nvim", "a"), /Include \{file\}/);
  // What a POSIX shell actually reads, for names full of shell syntax.
  const names = ["$(touch pwned)", "`id`", "a;b", "it's", "a\"b", "x && y", "$HOME", "*", "new\nline", "-n"];
  for (const name of names) {
    const out = execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(name)}`], { encoding: "utf8" });
    assert.equal(out, name);
    const line = editorCommandLine("printf %s {file}", name);
    assert.equal(execFileSync("/bin/sh", ["-c", line], { encoding: "utf8" }), name.startsWith("-") ? `./${name}` : name);
  }
});

test("the launch: the login shell, interactive, given the command as an argument", () => {
  const { command, args } = editorLaunch("nvim +{line} {file}", "src/$(x).ts", 7);
  assert.equal(command, "/bin/sh");
  assert.deepEqual(args, ["-c", 'exec "${SHELL:-/bin/sh}" -l -i -c "$1"', "paseo-editor", "nvim +7 'src/$(x).ts'"]);
  // Run with a stand-in login shell that prints what it's given: the command arrives intact, one argument.
  const out = execFileSync(command, args, { encoding: "utf8", env: { ...process.env, SHELL: "/bin/echo" } });
  assert.equal(out, "-l -i -c nvim +7 'src/$(x).ts'\n");
});

test("the settings file's files object, read leniently", () => {
  assert.deepEqual(filesSettings(undefined), DEFAULT_FILES_SETTINGS);
  assert.deepEqual(filesSettings({ openIn: "editor", editorCommand: " hx {file} " }), { openIn: "editor", editorCommand: "hx {file}" });
  assert.deepEqual(filesSettings({ openIn: "vim", editorCommand: "nvim" }), DEFAULT_FILES_SETTINGS);
  assert.deepEqual(filesSettings([]), DEFAULT_FILES_SETTINGS);
});

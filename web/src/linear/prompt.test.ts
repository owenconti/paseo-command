import { test } from "node:test";
import assert from "node:assert/strict";
import { issueContext, issuePrompt, linearImages } from "./prompt";
import { fillPreset } from "../presets";
import type { LinearIssue } from "./types";

test("linear prompt: the prompt and presets carry the issue", () => {
  const issue = { key: "ENG-12", title: "Fix it", url: "https://linear.app/a/issue/ENG-12", description: "It breaks." };
  assert.equal(
    issuePrompt(issue),
    "Work on this issue.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12\n\nIt breaks.",
  );
  assert.equal(
    fillPreset("Plan {{ issue }} first.", undefined, issue),
    "Plan ENG-12 (Fix it) first.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12\n\nIt breaks.",
  );
  assert.equal(
    fillPreset("Review {{pr}}.", { number: 7 }, { ...issue, description: "" }),
    "Review #7.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12",
  );
  // Without an issue, presets are as they were.
  assert.equal(fillPreset("Review {{pr}}.", { number: 7 }), "Review #7.");
});

test("linear prompt: images uploaded to Linear load through the app server; links and other images don't", () => {
  const up = "https://uploads.linear.app/79bf/abc/image.png";
  assert.equal(
    linearImages(`See ![image.png](${up}) and ![x](<${up}>), [file](${up}), ![y](https://example.com/y.png).`, "http://127.0.0.1:4310"),
    `See ![image.png](http://127.0.0.1:4310/api/linear/image?url=${encodeURIComponent(up)}) and ![x](http://127.0.0.1:4310/api/linear/image?url=${encodeURIComponent(up)}), [file](${up}), ![y](https://example.com/y.png).`,
  );
});

test("linear prompt: an issue from the store as the agent's context", () => {
  const issue = {
    id: "i-1",
    key: "ENG-1",
    title: "Ship it",
    url: "https://linear.app/a/issue/ENG-1",
    description: "Soon.",
    branchName: "eng-1-ship-it",
  } as LinearIssue;
  assert.deepEqual(issueContext(issue), {
    key: "ENG-1",
    title: "Ship it",
    url: "https://linear.app/a/issue/ENG-1",
    description: "Soon.",
    branchName: "eng-1-ship-it",
  });
});

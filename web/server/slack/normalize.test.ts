import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentOf, blocksOf } from "./normalize";

test("apps' blocks: header, section fields and button, context, divider and link buttons are kept; menus and images aren't", () => {
  const blocks = blocksOf([
    { type: "header", block_id: "h", text: { type: "plain_text", text: ":rotating_light: Tests failed", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*Repository:*\nacme/app" },
        { type: "mrkdwn", text: "   " },
      ],
      accessory: { type: "button", text: { type: "plain_text", text: "Open" }, url: "https://ci.example/1", style: "primary" },
    },
    { type: "section", accessory: { type: "image", image_url: "https://x.example/i.png" } },
    { type: "context", elements: [{ type: "mrkdwn", text: "*Status*  Active" }, { type: "image", image_url: "https://x.example/i.png" }] },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "View run" }, url: "https://github.com/acme/app/actions/runs/1" },
        { type: "button", text: { type: "plain_text", text: "Resolve" }, value: "resolve", style: "danger" },
        { type: "button", text: { type: "plain_text", text: "Bad" }, url: "javascript:alert(1)" },
        { type: "external_select", placeholder: { type: "plain_text", text: "Select Assignee..." } },
      ],
    },
    { type: "image", image_url: "https://x.example/i.png" },
  ]);
  assert.deepEqual(blocks, [
    { type: "header", block_id: "h", text: { type: "plain_text", text: ":rotating_light: Tests failed" } },
    {
      type: "section",
      fields: [{ type: "mrkdwn", text: "*Repository:*\nacme/app" }],
      buttons: [{ text: "Open", url: "https://ci.example/1", style: "primary" }],
    },
    { type: "context", texts: [{ type: "mrkdwn", text: "*Status*  Active" }] },
    { type: "divider" },
    {
      type: "actions",
      buttons: [{ text: "View run", url: "https://github.com/acme/app/actions/runs/1" }, { text: "Resolve", style: "danger" }, { text: "Bad" }],
    },
  ]);
});

test("an attachment: its pretext, author, blocks, fields and footer; with blocks its fallback isn't repeated", () => {
  assert.deepEqual(
    attachmentOf({
      fallback: "File-based Diagonal",
      color: "5E6AD2",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "*<https://linear.app/x|File-based Diagonal>*" } }],
      fields: [{ title: "Est. reading time", value: "1 minute", short: true }, { title: "", value: "" }],
      footer: "Linear",
      author_name: "Owen",
      pretext: "New initiative",
    }),
    {
      pretext: "New initiative",
      authorName: "Owen",
      color: "#5E6AD2",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "*<https://linear.app/x|File-based Diagonal>*" } }],
      fields: [{ title: "Est. reading time", value: "1 minute", short: true }],
      footer: "Linear",
    },
  );
  assert.equal(attachmentOf({ color: "ff0000" }), null);
  assert.deepEqual(attachmentOf({ fallback: "Just this" }), { text: "Just this" });
});

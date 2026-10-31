import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emojiFace, fromCodePoints, matchEmoji, withSkinTone } from "./emoji";
import { editableText, formatSlackDate, messageBlocks, parseInline, parseMrkdwn, plainText, toMarkdown, type Names } from "./mrkdwn";
import type { SlackBlock } from "./types";

const NAMES: Names = { user: (id) => ({ U1: "ana", U2: "bo" })[id], channel: (id) => ({ C1: "eng" })[id] };

describe("mrkdwn inline", () => {
  it("styles: bold, italic, strike, code, nested, and not inside words", () => {
    assert.deepEqual(parseInline("a *b* _c_ ~d~ `e`"), [
      { t: "text", text: "a " },
      { t: "text", text: "b", bold: true },
      { t: "text", text: " " },
      { t: "text", text: "c", italic: true },
      { t: "text", text: " " },
      { t: "text", text: "d", strike: true },
      { t: "text", text: " " },
      { t: "text", text: "e", code: true },
    ]);
    assert.deepEqual(parseInline("*bold _both_*"), [
      { t: "text", text: "bold ", bold: true },
      { t: "text", text: "both", bold: true, italic: true },
    ]);
    assert.deepEqual(parseInline("snake_case_name and 2*3*4"), [{ t: "text", text: "snake_case_name and 2*3*4" }]);
    assert.deepEqual(parseInline("* not bold *"), [{ t: "text", text: "* not bold *" }]);
    // Styles don't cross lines.
    assert.deepEqual(parseInline("*a\nb*"), [{ t: "text", text: "*a\nb*" }]);
  });

  it("specials: links, mentions, channels, groups, broadcasts, dates", () => {
    assert.deepEqual(parseInline("<https://x.com/a?b=1&amp;c=2|the site> <https://y.com>"), [
      { t: "link", url: "https://x.com/a?b=1&c=2", label: "the site" },
      { t: "text", text: " " },
      { t: "link", url: "https://y.com" },
    ]);
    assert.deepEqual(parseInline("<@U1> <@U2|bo> <#C1|eng> <#C9> <!subteam^S1|@devs> <!here> <!channel>"), [
      { t: "user", id: "U1" },
      { t: "text", text: " " },
      { t: "user", id: "U2" },
      { t: "text", text: " " },
      { t: "channel", id: "C1", name: "eng" },
      { t: "text", text: " " },
      { t: "channel", id: "C9" },
      { t: "text", text: " " },
      { t: "usergroup", id: "S1", name: "devs" },
      { t: "text", text: " " },
      { t: "broadcast", range: "here" },
      { t: "text", text: " " },
      { t: "broadcast", range: "channel" },
    ]);
    assert.deepEqual(parseInline("<!date^1730000000^{date_short} at {time}|Oct 27>"), [
      { t: "date", timestamp: 1730000000, format: "{date_short} at {time}", fallback: "Oct 27" },
    ]);
    // A special inside a style stays whole, and takes the style.
    assert.deepEqual(parseInline("*see <https://a.b/*x*|here>*"), [
      { t: "text", text: "see ", bold: true },
      { t: "link", url: "https://a.b/*x*", label: "here", bold: true },
    ]);
  });

  it("entities and emoji (with skin tones), but not times", () => {
    assert.deepEqual(parseInline("a &lt;b&gt; &amp; c"), [{ t: "text", text: "a <b> & c" }]);
    assert.deepEqual(parseInline(":tada: :+1::skin-tone-3: at 10:30:45"), [
      { t: "emoji", name: "tada" },
      { t: "text", text: " " },
      { t: "emoji", name: "+1", skin: 3 },
      { t: "text", text: " at 10:30:45" },
    ]);
  });

  it("code is literal but for links and entities", () => {
    assert.deepEqual(parseInline("`*a* <https://x.y|z> &lt;`"), [{ t: "text", text: "*a* z <", code: true }]);
  });
});

describe("mrkdwn blocks", () => {
  it("fences, opened mid-line too, and quotes", () => {
    assert.deepEqual(parseMrkdwn("look:\n```const a = 1;\n&lt;b&gt;```\nafter"), [
      { t: "paragraph", inlines: [{ t: "text", text: "look:" }] },
      { t: "pre", text: "const a = 1;\n<b>" },
      { t: "paragraph", inlines: [{ t: "text", text: "after" }] },
    ]);
    assert.deepEqual(parseMrkdwn("&gt; quoted\n&gt; more\nnot"), [
      { t: "quote", inlines: [{ t: "text", text: "quoted\nmore" }] },
      { t: "paragraph", inlines: [{ t: "text", text: "not" }] },
    ]);
    assert.deepEqual(parseMrkdwn("hi\n>>> all\nof this"), [
      { t: "paragraph", inlines: [{ t: "text", text: "hi" }] },
      { t: "quote", inlines: [{ t: "text", text: "all\nof this" }] },
    ]);
    // An unclosed fence is text.
    assert.deepEqual(parseMrkdwn("a ``` b"), [{ t: "paragraph", inlines: [{ t: "text", text: "a ``` b" }] }]);
  });
});

describe("rich text blocks", () => {
  const blocks: SlackBlock[] = [
    {
      type: "rich_text",
      elements: [
        {
          type: "rich_text_section",
          elements: [
            { type: "text", text: "Hi " },
            { type: "user", user_id: "U1" },
            { type: "text", text: " see ", style: { bold: true } },
            { type: "link", url: "https://x.y", text: "this" },
            { type: "emoji", name: "thumbsup", unicode: "1f44d-1f3fb" },
            { type: "broadcast", range: "here" },
          ],
        },
        {
          type: "rich_text_list",
          list_style: "ordered",
          indent: 1,
          elements: [
            { type: "rich_text_section", elements: [{ type: "text", text: "one" }] },
            { type: "rich_text_section", elements: [{ type: "channel", channel_id: "C1" }] },
          ],
        },
        { type: "rich_text_quote", elements: [{ type: "text", text: "quoted" }] },
        { type: "rich_text_preformatted", elements: [{ type: "text", text: "code()" }] },
      ],
    },
  ];

  it("become the same blocks, preferred over the text", () => {
    assert.deepEqual(messageBlocks({ text: "ignored", blocks }), [
      {
        t: "paragraph",
        inlines: [
          { t: "text", text: "Hi " },
          { t: "user", id: "U1" },
          { t: "text", text: " see ", bold: true },
          { t: "link", url: "https://x.y", label: "this" },
          { t: "emoji", name: "thumbsup", unicode: "1f44d-1f3fb" },
          { t: "broadcast", range: "here" },
        ],
      },
      { t: "list", style: "ordered", indent: 1, offset: 0, items: [[{ t: "text", text: "one" }], [{ t: "channel", id: "C1" }]] },
      { t: "quote", inlines: [{ t: "text", text: "quoted" }] },
      { t: "pre", text: "code()" },
    ]);
  });

  it("a list in Slack's own shape (`style`) is read too; no rich text falls back to mrkdwn", () => {
    const raw = [{ type: "rich_text", elements: [{ type: "rich_text_list", style: "ordered", elements: [] }] }] as unknown as SlackBlock[];
    assert.equal((messageBlocks({ text: "", blocks: raw })[0] as { style: string }).style, "ordered");
    assert.deepEqual(messageBlocks({ text: "*x*", blocks: [{ type: "divider" }] }), [
      { t: "paragraph", inlines: [{ t: "text", text: "x", bold: true }] },
    ]);
  });

  it("plain text names people and channels; Markdown keeps mentions for editing", () => {
    const shown = messageBlocks({ text: "", blocks });
    assert.equal(
      plainText(shown, NAMES),
      "Hi @ana see this (https://x.y)👍🏻@here\n  1. one\n  2. #eng\n> quoted\n```\ncode()\n```",
    );
    assert.equal(
      toMarkdown(shown),
      "Hi <@U1> **see** [this](https://x.y):thumbsup:<!here>\n  1. one\n  2. <#C1>\n> quoted\n```\ncode()\n```",
    );
    assert.equal(editableText({ text: "*a* ~b~ <https://x|y> <@U1>" }), "**a** ~~b~~ [y](https://x) <@U1>");
  });
});

describe("dates and emoji", () => {
  it("formats Slack's date tokens, else the fallback", () => {
    const now = new Date(2026, 9, 31, 12);
    const ts = new Date(2026, 9, 31, 9, 5).getTime() / 1000;
    assert.equal(formatSlackDate(ts, "{date_pretty}", "x", now), "today");
    assert.equal(formatSlackDate(ts - 86400, "{date_short_pretty}", "x", now), "yesterday");
    assert.equal(formatSlackDate(ts, "{date_num}", "x", now), "2026-10-31");
    assert.equal(formatSlackDate(ts, "{ago}", "x", now), "3 hours ago");
    assert.equal(formatSlackDate(ts, "no tokens", "fallback", now), "fallback");
    assert.equal(formatSlackDate(Number.NaN, "{date}", "fallback", now), "fallback");
  });

  it("emoji: names, code points, skin tones, custom with aliases, autocomplete", () => {
    assert.equal(fromCodePoints("1f44d-1f3fb"), "👍🏻");
    assert.equal(fromCodePoints("nope"), undefined);
    assert.equal(withSkinTone("👍", 4), "👍🏽");
    assert.deepEqual(emojiFace("tada"), { kind: "unicode", char: "🎉" });
    assert.deepEqual(emojiFace("parrot", { parrot: "https://e/p.gif" }), { kind: "custom", name: "parrot" });
    assert.deepEqual(emojiFace("pp", { pp: "alias:parrot", parrot: "https://e/p.gif" }), { kind: "custom", name: "parrot" });
    assert.deepEqual(emojiFace("yay", { yay: "alias:tada" }), { kind: "unicode", char: "🎉" });
    assert.deepEqual(emojiFace("nothing-like-it"), { kind: "unknown" });
    assert.deepEqual(matchEmoji("thumbs", {}, 3), ["thumbsup", "thumbsdown"]);
    assert.equal(matchEmoji("parr", { parrot: "u" })[0], "parrot");
  });
});

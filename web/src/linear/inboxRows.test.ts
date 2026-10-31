import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxEntity, inboxGroups, inboxText, snoozeTimes, unreadCount } from "./inboxRows";
import type { LinearNotification } from "./types";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const n = (id: string, createdAt: string, extra: Partial<LinearNotification> = {}): LinearNotification => ({
  id,
  type: "issueNewComment",
  title: "ENG-1 Ship the Linear tab",
  subtitle: "Sam Rivera commented",
  url: "https://linear.app/x",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

test("inbox: an issue's notifications in one row, newest first, unread if any is, snoozed ones apart", () => {
  const list = [
    n("a", "2026-10-31T10:00:00Z", { issueId: "i1", issueKey: "ENG-1", readAt: "2026-10-31T10:30:00Z" }),
    n("b", "2026-10-31T11:00:00Z", { issueId: "i1", issueKey: "ENG-1" }),
    n("c", "2026-10-30T09:00:00Z", { projectId: "p1", title: "Launch", readAt: "2026-10-30T10:00:00Z" }),
    n("d", "2026-10-29T09:00:00Z", { issueId: "i2", issueKey: "DE-2", snoozedUntilAt: "2026-11-01T09:00:00Z" }),
    n("e", "2026-10-28T09:00:00Z", { issueId: "i3", issueKey: "ENG-3", snoozedUntilAt: "2026-10-30T09:00:00Z" }),
    n("f", "2026-10-31T11:30:00Z", { archivedAt: "2026-10-31T11:40:00Z" }),
    n("g", "2026-10-27T09:00:00Z", { title: "Welcome" }),
  ];
  const rows = inboxGroups(list, NOW);
  assert.deepEqual(
    rows.map((g) => [g.key, g.latest.id, g.notifications.length, g.unread]),
    [
      ["issue:i1", "b", 2, true],
      ["project:p1", "c", 1, false],
      ["issue:i3", "e", 1, true],
      ["notification:g", "g", 1, true],
    ],
    "a snooze that has passed is back; archived ones are gone",
  );
  assert.deepEqual(inboxGroups(list, NOW, true).map((g) => g.key), ["issue:i2"]);
  assert.equal(unreadCount(list, NOW), 3);
  assert.deepEqual(rows.map(inboxEntity), [{ issueId: "i1" }, { projectId: "p1" }, { issueId: "i3" }, { id: "g" }]);
});

test("inbox: a row's words", () => {
  const [row] = inboxGroups([n("a", "2026-10-31T10:00:00Z", { issueId: "i1", issueKey: "ENG-1", commentBody: "Can we\nstart?" })], NOW);
  assert.deepEqual(inboxText(row), { key: "ENG-1", title: "Ship the Linear tab", what: "Sam Rivera commented: “Can we start?”" });
  assert.equal(inboxText(row, "Renamed").title, "Renamed");
});

test("inbox: snoozing for an hour, until tomorrow at 9, or next Monday at 9", () => {
  const friday = new Date(2026, 9, 30, 15, 20);
  const [hour, tomorrow, week] = snoozeTimes(friday);
  assert.equal(hour.at.getTime() - friday.getTime(), 3_600_000);
  assert.deepEqual([tomorrow.at.getDate(), tomorrow.at.getHours(), tomorrow.at.getMinutes()], [31, 9, 0]);
  assert.deepEqual([week.at.getDay(), week.at.getDate(), week.at.getHours()], [1, 2, 9]);
  // On a Monday, next week is the Monday after.
  assert.equal(snoozeTimes(new Date(2026, 10, 2, 8))[2].at.getDate(), 9);
});

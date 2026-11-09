import test from "node:test";
import assert from "node:assert/strict";
import { prQueue, issueQueues, queueText } from "./queues";
import type { Resource } from "../github/api";
import type { PrList } from "../github/types";
const resource: Resource<PrList> = {
  loading: false,
  error: undefined,
  unavailable: undefined,
  reload: async () => {},
  data: {
    scope: "assigned",
    total: 123,
    viewer: { login: "me" },
    rows: [
      {
        id: "1",
        repo: "acme/app",
        number: 1,
        title: "Assigned work",
        url: "https://github.com/acme/app/pull/1",
        author: { login: "sam" },
        state: "open",
        createdAt: "",
        updatedAt: "",
        headRef: "work",
        baseRef: "main",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        comments: 0,
        reviewDecision: "review",
        checks: "pending",
        yourReview: null,
        labels: [],
      },
    ],
  },
};
test("queue counts preserve full totals, unknown states and capped previews", () => {
  const q = prQueue(resource, true);
  assert.equal(queueText(q), "123");
  assert.equal(q.items.length, 1);
  assert.match(q.items[0]!.status!, /Review required.*Checks pending/);
  assert.equal(
    queueText(prQueue({ ...resource, error: "Offline" }, true)),
    "—",
  );
  assert.match(prQueue(resource, false).why, /Enable GitHub/);
  const capped = prQueue(
    {
      ...resource,
      data: {
        ...resource.data!,
        total: undefined,
        rows: Array.from({ length: 50 }, () => resource.data!.rows[0]!),
      },
    },
    true,
  );
  assert.equal(queueText(capped), "50+");
});
test("assigned issues exclude completed totals, preserve workflow names, and blocked issues remain distinguishable", () => {
  const { issues, blocked } = issueQueues({
    issues: {
      state: "ok",
      counts: { done: 100, inProgress: 2, todo: 1, blocked: 1 },
      atLeast: ["todo"],
      items: {
        done: [
          {
            id: "DE-0",
            title: "Done",
            url: "https://linear.app/team/issue/DE-0",
          },
        ],
        inProgress: [
          {
            id: "DE-1",
            title: "Current",
            url: "https://linear.app/team/issue/DE-1",
            status: "Reviewing",
          },
        ],
        todo: [
          {
            id: "DE-2",
            title: "Later",
            url: "https://linear.app/team/issue/DE-2",
            status: "Backlog",
          },
        ],
        blocked: [
          {
            id: "DE-3",
            title: "Stuck",
            url: "https://linear.app/team/issue/DE-3",
            status: "In Progress",
          },
        ],
      },
    },
  });
  assert.equal(queueText(issues), "4+");
  assert.equal(issues.items.length, 3);
  assert.ok(!issues.items.some((i) => i.title === "Done"));
  assert.equal(issues.items[0]!.status, "Reviewing");
  assert.equal(issues.items[1]!.status, "Backlog");
  assert.equal(queueText(blocked), "1");
  assert.equal(blocked.items[0]!.status, "Blocked · In Progress");
});

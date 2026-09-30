import { test } from "node:test";
import assert from "node:assert/strict";
import { entryText, mergeEntries, renderActivity, replaceSection, timeAgo } from "../src/render-activity.mjs";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const push = (repo, count, message, date) => ({ kind: "push", repo, ref: "main", count, message, date });
const line = (text, date) => ({ kind: "line", text, date });

test("timeAgo buckets", () => {
  assert.equal(timeAgo("2026-09-30T11:59:45Z", NOW), "just now");
  assert.equal(timeAgo("2026-09-30T11:55:00Z", NOW), "5 minutes ago");
  assert.equal(timeAgo("2026-09-30T11:00:00Z", NOW), "1 hour ago");
  assert.equal(timeAgo("2026-09-30T09:00:00Z", NOW), "3 hours ago");
  assert.equal(timeAgo("2026-09-29T12:00:00Z", NOW), "1 day ago");
  assert.equal(timeAgo("2026-09-10T12:00:00Z", NOW), "20 days ago");
  assert.equal(timeAgo("2026-08-30T12:00:00Z", NOW), "1 month ago");
  assert.equal(timeAgo("2024-09-01T12:00:00Z", NOW), "2 years ago");
});

test("entryText renders pushes with counts and messages", () => {
  assert.equal(
    entryText(push("acme/demo", 2, "feat: x", "2026-09-29T12:00:00Z")),
    '📝 Pushed 2 commits to [acme/demo](https://github.com/acme/demo) (`main`) — "feat: x"',
  );
  assert.ok(entryText(push("acme/demo", null, "", "2026-09-29T12:00:00Z")).startsWith("📝 Pushed to [acme/demo]"));
});

test("mergeEntries collapses adjacent pushes to the same repo", () => {
  const merged = mergeEntries([
    push("acme/demo", 2, "newer", "2026-09-29T12:00:00Z"),
    push("acme/demo", 3, "older", "2026-09-29T11:00:00Z"),
    line("🔀 Opened PR", "2026-09-29T10:00:00Z"),
    push("acme/demo", 1, "after pr", "2026-09-29T09:00:00Z"),
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].count, 5);
  assert.equal(merged[0].message, "newer");
  assert.equal(merged[2].count, 1);
});

test("renderActivity list view", () => {
  const out = renderActivity([push("acme/demo", 2, "feat: x", "2026-09-29T12:00:00Z")], "list", 10, NOW);
  assert.equal(
    out,
    '- 📝 Pushed 2 commits to [acme/demo](https://github.com/acme/demo) (`main`) — "feat: x" · _1 day ago_',
  );
});

test("renderActivity table view", () => {
  const entries = [
    push("acme/demo", 2, "feat: x", "2026-09-29T12:00:00Z"),
    push("acme/demo", 1, "feat: y", "2026-09-29T11:00:00Z"),
    line('🔀 Merged PR [#1](u) "t" in [acme/demo](u)', "2026-09-28T12:00:00Z"),
  ];
  const out = renderActivity(entries, "table", 2, NOW);
  const lines = out.split("\n");
  assert.equal(lines[0], "| When | Activity |");
  assert.equal(lines.length, 4);
  assert.match(out, /\| 1 day ago \| 📝 Pushed 3 commits to /);
});

test("renderActivity respects max lines and empty input", () => {
  const entries = [1, 2, 3, 4].map((n) => line(`item ${n}`, "2026-09-29T12:00:00Z"));
  assert.equal(renderActivity(entries, "list", 2, NOW).split("\n").length, 2);
  assert.equal(renderActivity([], "list", 10, NOW), "_No recent public activity._");
});

test("replaceSection swaps only the marker block", () => {
  const md = "before\n<!--START_SECTION:activity-->\nold\n<!--END_SECTION:activity-->\nafter\n";
  const out = replaceSection(md, "activity", "new");
  assert.equal(out, "before\n<!--START_SECTION:activity-->\nnew\n<!--END_SECTION:activity-->\nafter\n");
  assert.throws(() => replaceSection("no markers", "activity", "x"), /marker "activity" not found/);
});

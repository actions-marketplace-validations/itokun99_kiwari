import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichTitles, entryText, mergeEntries, rankWeekly, renderActivity, replaceSection, timeAgo, toEntry, weeklyStats } from "../src/render-activity.mjs";

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

const prEvent = (payload, date = "2026-09-29T10:00:00Z") => ({
  type: "PullRequestEvent",
  repo: { name: "acme/demo" },
  created_at: date,
  payload,
});

test("toEntry rebuilds PR lines from identifiers when the payload is trimmed", async () => {
  const entry = await toEntry(
    prEvent({ action: "opened", number: 7, pull_request: { url: "https://api.github.com/repos/acme/demo/pulls/7", number: 7 } }),
  );
  assert.equal(
    entry.text,
    "🔀 Opened PR [#7](https://github.com/acme/demo/pull/7) in [acme/demo](https://github.com/acme/demo)",
  );
  assert.deepEqual(entry.needsTitle, {
    verb: "Opened",
    full: "acme/demo",
    number: 7,
    url: "https://github.com/acme/demo/pull/7",
  });
});

test("toEntry renders merged actions and keeps untrimmed titles", async () => {
  const merged = await toEntry(
    prEvent({ action: "merged", number: 7, pull_request: { title: "feat: x", html_url: "https://github.com/acme/demo/pull/7", merged: true } }),
  );
  assert.equal(
    merged.text,
    '🔀 Merged PR [#7](https://github.com/acme/demo/pull/7) "feat: x" in [acme/demo](https://github.com/acme/demo)',
  );
  assert.equal(merged.needsTitle, undefined);
  const closed = await toEntry(
    prEvent({ action: "closed", number: 8, pull_request: { title: "feat: y", html_url: "https://github.com/acme/demo/pull/8", merged: false } }),
  );
  assert.match(closed.text, /🔀 Closed PR \[#8\]/);
});

test("enrichTitles fills missing titles and keeps the fallback when the fetch fails", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/pulls/9")) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify({ title: "real title", html_url: "https://github.com/acme/demo/pull/7" }), { status: 200 });
  };
  try {
    const entries = [
      { kind: "line", text: "fallback 7", date: "2026-09-29T10:00:00Z", needsTitle: { verb: "Opened", full: "acme/demo", number: 7, url: "https://github.com/acme/demo/pull/7" } },
      { kind: "line", text: "fallback 9", date: "2026-09-29T10:00:00Z", needsTitle: { verb: "Opened", full: "acme/demo", number: 9, url: "https://github.com/acme/demo/pull/9" } },
      { kind: "push", repo: "acme/demo", ref: "main", count: 1, message: "", date: "2026-09-29T10:00:00Z" },
    ];
    await enrichTitles(entries);
    assert.equal(entries[0].text, '🔀 Opened PR [#7](https://github.com/acme/demo/pull/7) "real title" in [acme/demo](https://github.com/acme/demo)');
    assert.equal(entries[1].text, "fallback 9");
    assert.equal(entries[0].needsTitle, undefined);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
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

const WEEK_CUTOFF = "2026-09-23T00:00:00Z"; // 7 days before NOW
const event = (type, repo, created, payload = {}) => ({ type, repo: { name: repo }, created_at: created, payload });

test("weeklyStats counts opened PR/issues and releases, ranks own repos, respects the cutoff", () => {
  const events = [
    event("PushEvent", "acme/demo", "2026-09-29T08:00:00Z", { ref: "refs/heads/main" }),
    event("PullRequestEvent", "acme/demo", "2026-09-29T09:00:00Z", { action: "opened", number: 7 }),
    event("PullRequestEvent", "acme/demo", "2026-09-29T09:05:00Z", { action: "closed", number: 7 }),
    event("IssuesEvent", "acme/demo", "2026-09-29T10:00:00Z", { action: "opened", issue: { number: 3 } }),
    event("IssuesEvent", "acme/demo", "2026-09-29T11:00:00Z", { action: "closed", issue: { number: 4 } }),
    event("ReleaseEvent", "acme/demo", "2026-09-29T12:00:00Z", { release: { tag_name: "v1" } }),
    event("PullRequestEvent", "acme/old", "2026-09-01T09:00:00Z", { action: "opened", number: 1 }),
    event("PullRequestEvent", "other/repo", "2026-09-29T09:00:00Z", { action: "opened", number: 1 }),
  ];
  const { candidates, counters } = weeklyStats(events, "acme", WEEK_CUTOFF);
  assert.deepEqual(candidates, ["acme/demo"]);
  assert.deepEqual(counters["acme/demo"], { prs: 1, issues: 1, releases: 1 });
});

test("rankWeekly sorts by activity, caps at max, and formats rows", () => {
  const counters = {
    "acme/a": { prs: 0, issues: 0, releases: 0 },
    "acme/b": { prs: 2, issues: 1, releases: 0 },
    "acme/c": { prs: 0, issues: 0, releases: 1 },
  };
  const commitCounts = new Map([
    ["acme/a", 5],
    ["acme/b", 0],
    ["acme/c", 0],
  ]);
  const out = rankWeekly(["acme/a", "acme/b", "acme/c"], counters, commitCounts, { max: 10, days: 7 });
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '1. [**a**](https://github.com/acme/a) — 📝 5 commits');
  assert.equal(lines[1], '2. [**b**](https://github.com/acme/b) — 🔀 2 PRs · 🐛 1 issue');
  assert.equal(lines[2], '3. [**c**](https://github.com/acme/c) — 🚀 1 release');
});

test("rankWeekly caps rows and renders 100+ commit weeks without a count", () => {
  const counters = { "acme/x": { prs: 0, issues: 0, releases: 0 } };
  const commitCounts = new Map([
    ["acme/x", 150],
    ["acme/y", 0],
  ]);
  const out = rankWeekly(["acme/x", "acme/y"], counters, commitCounts, { max: 1, days: 7 });
  assert.equal(out, '1. [**x**](https://github.com/acme/x) — 📝 100+ commits');
});

test("rankWeekly falls back when nothing counts", () => {
  assert.equal(
    rankWeekly([], {}, new Map(), { max: 10, days: 7 }),
    "_No public activity in the last 7 days._",
  );
});

test("weeklyStats honors an excluded repository list", () => {
  const events = [
    event("PushEvent", "acme/demo", "2026-09-29T08:00:00Z", { ref: "refs/heads/main" }),
    event("PushEvent", "acme/dotfiles", "2026-09-29T08:00:00Z", { ref: "refs/heads/main" }),
  ];
  const { candidates, counters } = weeklyStats(events, "acme", WEEK_CUTOFF, new Set(["acme/dotfiles"]));
  assert.deepEqual(candidates, ["acme/demo"]);
  assert.equal(counters["acme/dotfiles"], undefined);
});

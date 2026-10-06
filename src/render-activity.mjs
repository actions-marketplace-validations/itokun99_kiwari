#!/usr/bin/env node
/**
 * kiwari - renders the latest public GitHub activity of a user into a README section.
 *
 * Environment variables:
 *   KIWARI_USERNAME     GitHub username (required)
 *   KIWARI_VIEW         "list" (default) or "table"
 *   KIWARI_MAX_LINES    maximum number of activity lines/rows (default 10)
 *   KIWARI_SECTIONS     comma-separated sections to render: activity, weekly (default activity)
 *   KIWARI_WEEKLY_DAYS  window in days for the weekly section (default 7)
 *   KIWARI_MAX_WEEKLY   maximum number of repositories in the weekly section (default 10)
 *   KIWARI_EXCLUDE_REPOS  comma-separated full repository names excluded from the weekly section
 *   KIWARI_TARGET_FILE  file that carries the marker section (default README.md)
 *   KIWARI_TOKEN        token for GitHub API calls (falls back to GITHUB_TOKEN)
 *
 * The target file must contain a marker block for every enabled section:
 *   <!--START_SECTION:activity--> ... <!--END_SECTION:activity-->
 *   <!--START_SECTION:weekly--> ... <!--END_SECTION:weekly-->
 *
 * The activity section renders the user's newest public events. The weekly section
 * ranks the user's own public repositories by commit / PR / issue / release counts
 * in the weekly window: PR/issue/release counts come from the user's events, commit
 * counts come from each repo's commits API (the public events API omits push sizes).
 * Events from private repositories are never rendered.
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USERNAME = process.env.KIWARI_USERNAME || "";
const VIEW = (process.env.KIWARI_VIEW || "list").toLowerCase() === "table" ? "table" : "list";
const MAX_LINES = Math.max(1, Number.parseInt(process.env.KIWARI_MAX_LINES || "10", 10) || 10);
const TARGET_FILE = process.env.KIWARI_TARGET_FILE || "README.md";
const TOKEN = process.env.KIWARI_TOKEN || process.env.GITHUB_TOKEN || "";
const SECTIONS = (process.env.KIWARI_SECTIONS || "activity")
  .split(",")
  .map((section) => section.trim().toLowerCase())
  .filter(Boolean);
const WEEKLY_DAYS = Math.max(1, Number.parseInt(process.env.KIWARI_WEEKLY_DAYS || "7", 10) || 7);
const MAX_WEEKLY = Math.max(1, Number.parseInt(process.env.KIWARI_MAX_WEEKLY || "10", 10) || 10);
const EXCLUDE_REPOS = new Set(
  (process.env.KIWARI_EXCLUDE_REPOS || "")
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean),
);
const MAX_CANDIDATES = Math.max(30, MAX_LINES * 3);
const ACTIVITY_TYPES = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "ReleaseEvent",
  "IssueCommentEvent",
  "DiscussionEvent",
]);
// Weekly ranking only - push, PR, issue, and release events are what the counters need.
const WEEKLY_EVENT_TYPES = new Set(["PushEvent", "PullRequestEvent", "IssuesEvent", "ReleaseEvent"]);

const HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "kiwari",
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

const oneLine = (text) => (text || "").replace(/\s+/g, " ").trim();
const truncate = (text, max) => {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;

export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

const isZeroSha = (sha) => !sha || /^0+$/.test(sha);
const repoLink = (full) => `[${full}](https://github.com/${full})`;
// The events API trims PR payloads to identifiers only (2025-08 changelog), so the
// line is built from repo + number and the title arrives later via enrichTitles().
const prLine = (verb, full, number, url, title) =>
  `🔀 ${verb} PR [#${number}](${url})${title ? ` "${truncate(title, 60)}"` : ""} in ${repoLink(full)}`;

const publicRepoCache = new Map();
async function isPublicRepo(full) {
  if (!publicRepoCache.has(full)) {
    let isPublic = false;
    try {
      const repo = await api(`/repos/${full}`);
      isPublic = repo.private === false;
    } catch {
      isPublic = false; // 404 / no access -> treat as non-public
    }
    publicRepoCache.set(full, isPublic);
  }
  return publicRepoCache.get(full);
}

async function pushCommitInfo(full, payload) {
  if (isZeroSha(payload.before) || isZeroSha(payload.head)) return null;
  try {
    const compare = await api(`/repos/${full}/compare/${payload.before}...${payload.head}`);
    return {
      count: compare.total_commits,
      message: truncate((compare.commits?.[0]?.commit?.message || "").split("\n")[0], 70),
    };
  } catch {
    return null; // force-pushed or deleted history: fall back to a plain push line
  }
}

export async function toEntry(event) {
  const full = event.repo.name;
  const date = event.created_at;
  const payload = event.payload || {};
  switch (event.type) {
    case "PushEvent": {
      const ref = (payload.ref || "").replace(/^refs\/(heads|tags)\//, "");
      const info = await pushCommitInfo(full, payload);
      return { kind: "push", repo: full, ref, count: info?.count ?? null, message: info?.message || "", date };
    }
    case "PullRequestEvent": {
      const pr = payload.pull_request || {};
      const number = payload.number ?? pr.number;
      const verb =
        payload.action === "opened" ? "Opened"
        : payload.action === "reopened" ? "Reopened"
        : payload.action === "merged" ? "Merged" // emitted since the payload trim
        : payload.action === "closed" ? (pr.merged ? "Merged" : "Closed")
        : null;
      if (!verb) return null;
      const url = pr.html_url || `https://github.com/${full}/pull/${number}`;
      const title = pr.title || "";
      const entry = { kind: "line", date, text: prLine(verb, full, number, url, title) };
      if (!title) entry.needsTitle = { verb, full, number, url }; // filled by enrichTitles()
      return entry;
    }
    case "IssuesEvent": {
      const verb = { opened: "Opened", closed: "Closed", reopened: "Reopened" }[payload.action];
      if (!verb) return null;
      const issue = payload.issue || {};
      return { kind: "line", date, text: `🐛 ${verb} issue [#${issue.number}](${issue.html_url}) "${truncate(issue.title, 60)}" in ${repoLink(full)}` };
    }
    case "ReleaseEvent": {
      const release = payload.release || {};
      return { kind: "line", date, text: `🚀 Released [${release.tag_name}](${release.html_url}) in ${repoLink(full)}` };
    }
    case "IssueCommentEvent": {
      const issue = payload.issue || {};
      return { kind: "line", date, text: `💬 Commented on [#${issue.number}](${issue.html_url}) "${truncate(issue.title, 60)}" in ${repoLink(full)}` };
    }
    case "DiscussionEvent": {
      const verb = { created: "Created", answered: "Answered", closed: "Closed", reopened: "Reopened" }[payload.action];
      if (!verb) return null;
      const discussion = payload.discussion || {};
      return { kind: "line", date, text: `🗣️ ${verb} discussion [#${discussion.number}](${discussion.html_url}) "${truncate(discussion.title, 60)}" in ${repoLink(full)}` };
    }
    default:
      return null;
  }
}

// PR titles are no longer part of the trimmed events payload: fetch them for the
// entries that actually render (a few calls per run). A failed fetch keeps the
// title-less fallback line instead of breaking the section.
export async function enrichTitles(entries) {
  const pending = entries.filter((entry) => entry.needsTitle);
  await Promise.all(
    pending.map(async (entry) => {
      const { verb, full, number, url } = entry.needsTitle;
      delete entry.needsTitle;
      try {
        const pr = await api(`/repos/${full}/pulls/${number}`);
        if (pr.title) entry.text = prLine(verb, full, number, pr.html_url || url, pr.title);
      } catch {
        // deleted PR / rate limit: keep the fallback line
      }
    }),
  );
}

export function entryText(entry) {
  if (entry.kind === "line") return entry.text;
  const bits = [`📝 Pushed${entry.count ? ` ${entry.count} commit${entry.count > 1 ? "s" : ""}` : ""} to ${repoLink(entry.repo)}`];
  if (entry.ref) bits.push(`(\`${entry.ref}\`)`);
  if (entry.message) bits.push(`— "${entry.message}"`);
  return bits.join(" ");
}

export function mergeEntries(entries) {
  const merged = [];
  for (const entry of entries) {
    const prev = merged[merged.length - 1];
    if (entry.kind === "push" && prev?.kind === "push" && prev.repo === entry.repo) {
      // Same repo pushed repeatedly: keep one line, sum the commit counts when both are known.
      prev.count = prev.count !== null && entry.count !== null ? prev.count + entry.count : null;
      if (!prev.message && entry.message) prev.message = entry.message;
      continue;
    }
    merged.push({ ...entry });
  }
  return merged;
}

export function renderActivity(entries, view = "list", maxLines = 10, now = Date.now()) {
  const picked = mergeEntries(entries).slice(0, maxLines);
  if (!picked.length) return "_No recent public activity._";
  if (view === "table") {
    const rows = picked.map((entry) => `| ${timeAgo(entry.date, now)} | ${entryText(entry).replace(/\|/g, "\\|")} |`);
    return ["| When | Activity |", "| --- | --- |", ...rows].join("\n");
  }
  return picked.map((entry) => `- ${entryText(entry)} · _${timeAgo(entry.date, now)}_`).join("\n");
}

async function fetchEvents(username) {
  // Up to 3 pages (~300 events) when the weekly section is enabled, so its 7-day
  // window is covered even for active users; 1 page is plenty for activity alone.
  const pages = SECTIONS.includes("weekly") ? 3 : 1;
  const results = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      api(`/users/${username}/events?per_page=100&page=${index + 1}`).catch(() => []),
    ),
  );
  return results.flat();
}

async function buildEntries(events) {
  const candidates = [];
  for (const event of events) {
    if (!ACTIVITY_TYPES.has(event.type)) continue;
    if (!(await isPublicRepo(event.repo.name))) continue;
    const entry = await toEntry(event);
    if (entry) candidates.push(entry);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

export function weeklyStats(events, username, cutoffIso, excluded = new Set()) {
  const counters = {}; // full repo name -> { prs, issues, releases }
  const candidates = new Set(); // own-repo names with any weekly event
  const owner = username.toLowerCase();
  for (const event of events) {
    if (!WEEKLY_EVENT_TYPES.has(event.type)) continue;
    if (event.created_at < cutoffIso) continue; // ISO strings compare lexically in UTC
    const full = event.repo.name;
    if (full.split("/")[0].toLowerCase() !== owner) continue; // rank own repos only
    if (excluded.has(full.toLowerCase())) continue; // user-curated exclusion
    const payload = event.payload || {};
    const counter =
      event.type === "PullRequestEvent" && payload.action === "opened" ? "prs"
      : event.type === "IssuesEvent" && payload.action === "opened" ? "issues"
      : event.type === "ReleaseEvent" ? "releases"
      : null;
    if (counter) {
      const stats = (counters[full] ||= { prs: 0, issues: 0, releases: 0 });
      stats[counter] += 1;
    }
    candidates.add(full);
  }
  return { candidates: [...candidates], counters };
}

export function rankWeekly(candidates, counters, commitCounts, { max = 10, days = 7 } = {}) {
  const rows = [];
  for (const full of candidates) {
    const stats = counters[full] || { prs: 0, issues: 0, releases: 0 };
    const commits = commitCounts.get(full) ?? 0;
    const counts = [
      commits > 0 ? `📝 ${commits >= 100 ? "100+ commits" : plural(commits, "commit")}` : "",
      stats.prs ? `🔀 ${plural(stats.prs, "PR")}` : "",
      stats.issues ? `🐛 ${plural(stats.issues, "issue")}` : "",
      stats.releases ? `🚀 ${plural(stats.releases, "release")}` : "",
    ].filter(Boolean);
    if (!counts.length) continue;
    rows.push({
      full,
      score: commits + stats.prs + stats.issues + stats.releases,
      text: `[**${full.split("/")[1]}**](https://github.com/${full}) — ${counts.join(" · ")}`,
    });
  }
  const lines = rows
    .sort((a, b) => b.score - a.score || a.full.localeCompare(b.full))
    .slice(0, max)
    .map((row, index) => `${index + 1}. ${row.text}`);
  return lines.length ? lines.join("\n") : `_No public activity in the last ${days} days._`;
}

async function buildWeeklyBody(events, username) {
  const cutoffIso = new Date(Date.now() - WEEKLY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { candidates, counters } = weeklyStats(events, username, cutoffIso, EXCLUDE_REPOS);
  const commitCounts = new Map();
  const eligible = [];
  for (const full of candidates) {
    if (!(await isPublicRepo(full))) continue; // private work never leaks into a public README
    let commits = 0;
    try {
      // Default branch, capped at one page: a 100+ commit week renders as "100+".
      const list = await api(`/repos/${full}/commits?since=${encodeURIComponent(cutoffIso)}&per_page=100`);
      commits = list.length;
    } catch {
      // commit fetch failed (rate limit): the row still shows the event-based counts
    }
    commitCounts.set(full, commits);
    eligible.push(full);
  }
  return rankWeekly(eligible, counters, commitCounts, { max: MAX_WEEKLY, days: WEEKLY_DAYS });
}

export function replaceSection(markdown, name, body) {
  const block = new RegExp(`<!--START_SECTION:${name}-->[\\s\\S]*?<!--END_SECTION:${name}-->`);
  if (!block.test(markdown)) throw new Error(`marker "${name}" not found in the target file`);
  return markdown.replace(block, `<!--START_SECTION:${name}-->\n${body}\n<!--END_SECTION:${name}-->`);
}

async function main() {
  if (!USERNAME) throw new Error("KIWARI_USERNAME is required");
  const target = await readFile(TARGET_FILE, "utf8");
  const events = await fetchEvents(USERNAME);
  const bodies = {};
  if (SECTIONS.includes("activity")) {
    // Merge and slice first so only the PR lines that actually render pay a title fetch.
    const entries = mergeEntries(await buildEntries(events)).slice(0, MAX_LINES);
    await enrichTitles(entries);
    bodies.activity = renderActivity(entries, VIEW, MAX_LINES);
  }
  if (SECTIONS.includes("weekly")) bodies.weekly = await buildWeeklyBody(events, USERNAME);
  let updated = target;
  for (const section of SECTIONS) {
    if (!(section in bodies)) throw new Error(`unknown section "${section}" (supported: activity, weekly)`);
    updated = replaceSection(updated, section, bodies[section]);
  }
  if (updated === target) {
    console.log(`kiwari: ${TARGET_FILE} is already up to date.`);
    return;
  }
  await writeFile(TARGET_FILE, updated);
  console.log(`kiwari: updated ${TARGET_FILE} (${SECTIONS.join(", ")} section${SECTIONS.length > 1 ? "s" : ""}).`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`kiwari: ${error.message}`);
    process.exit(1);
  });
}

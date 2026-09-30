#!/usr/bin/env node
/**
 * kiwari - renders the latest public GitHub activity of a user into a README section.
 *
 * Environment variables:
 *   KIWARI_USERNAME     GitHub username (required)
 *   KIWARI_VIEW         "list" (default) or "table"
 *   KIWARI_MAX_LINES    maximum number of activity lines/rows (default 10)
 *   KIWARI_TARGET_FILE  file that carries the marker section (default README.md)
 *   KIWARI_TOKEN        token for GitHub API calls (falls back to GITHUB_TOKEN)
 *
 * The target file must contain:
 *   <!--START_SECTION:activity-->
 *   <!--END_SECTION:activity-->
 *
 * Only public repositories are rendered - events from private repos are skipped,
 * so private work never leaks into a public README.
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USERNAME = process.env.KIWARI_USERNAME || "";
const VIEW = (process.env.KIWARI_VIEW || "list").toLowerCase() === "table" ? "table" : "list";
const MAX_LINES = Math.max(1, Number.parseInt(process.env.KIWARI_MAX_LINES || "10", 10) || 10);
const TARGET_FILE = process.env.KIWARI_TARGET_FILE || "README.md";
const TOKEN = process.env.KIWARI_TOKEN || process.env.GITHUB_TOKEN || "";
const MAX_CANDIDATES = Math.max(30, MAX_LINES * 3);
const ACTIVITY_TYPES = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "ReleaseEvent",
  "IssueCommentEvent",
  "DiscussionEvent",
]);

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

async function toEntry(event) {
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
      const verb =
        payload.action === "opened" ? "Opened"
        : payload.action === "reopened" ? "Reopened"
        : payload.action === "closed" ? (pr.merged ? "Merged" : "Closed")
        : null;
      if (!verb) return null;
      return { kind: "line", date, text: `🔀 ${verb} PR [#${payload.number}](${pr.html_url}) "${truncate(pr.title, 60)}" in ${repoLink(full)}` };
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

async function fetchEntries(username) {
  const events = await api(`/users/${username}/events?per_page=100`);
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

export function replaceSection(markdown, name, body) {
  const block = new RegExp(`<!--START_SECTION:${name}-->[\\s\\S]*?<!--END_SECTION:${name}-->`);
  if (!block.test(markdown)) throw new Error(`marker "${name}" not found in the target file`);
  return markdown.replace(block, `<!--START_SECTION:${name}-->\n${body}\n<!--END_SECTION:${name}-->`);
}

async function main() {
  if (!USERNAME) throw new Error("KIWARI_USERNAME is required");
  const target = await readFile(TARGET_FILE, "utf8");
  const entries = await fetchEntries(USERNAME);
  const updated = replaceSection(target, "activity", renderActivity(entries, VIEW, MAX_LINES));
  if (updated === target) {
    console.log(`kiwari: ${TARGET_FILE} is already up to date.`);
    return;
  }
  await writeFile(TARGET_FILE, updated);
  console.log(`kiwari: updated ${TARGET_FILE} (${VIEW} view).`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`kiwari: ${error.message}`);
    process.exit(1);
  });
}

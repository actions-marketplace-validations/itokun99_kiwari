# kiwari

**kiwari** *(Sundanese, "kee-WAH-ree": "now")* — render your latest public GitHub activity into a README section.

Commits, pull requests, issues, releases, and comments — the newest public events, refreshed on your own schedule. Extracted from the automation that keeps [@itokun99's profile README](https://github.com/itokun99) alive.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

## Preview

### `view: list` (default)

```md
- 📝 Pushed 2 commits to [acme/demo](https://github.com/acme/demo) (`main`) — "feat: add cache layer" · _2 hours ago_
- 🔀 Merged PR [#7](https://github.com/acme/demo/pull/7) "Add cache layer" in [acme/demo](https://github.com/acme/demo) · _1 day ago_
- 🚀 Released [v0.2.0](https://github.com/acme/demo/releases/tag/v0.2.0) in [acme/demo](https://github.com/acme/demo) · _3 days ago_
```

### `view: table`

```md
| When | Activity |
| --- | --- |
| 2 hours ago | 📝 Pushed 2 commits to [acme/demo](https://github.com/acme/demo) — "feat: add cache layer" |
| 1 day ago | 🔀 Merged PR [#7](https://github.com/acme/demo/pull/7) "Add cache layer" in [acme/demo](https://github.com/acme/demo) |
| 3 days ago | 🚀 Released [v0.2.0](https://github.com/acme/demo/releases/tag/v0.2.0) in [acme/demo](https://github.com/acme/demo) |
```

## Quick start

Add the markers to the file you want refreshed (usually `README.md`):

```md
## Latest Activity

<!--START_SECTION:activity-->
<!--END_SECTION:activity-->
```

Then add a workflow — the cron is yours to choose:

```yaml
name: Refresh README activity

on:
  schedule:
    - cron: "*/30 * * * *" # custom cron
  workflow_dispatch:

permissions:
  contents: write

jobs:
  kiwari:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: itokun99/kiwari@v1
        with:
          username: your-username # custom username
          view: list # list (default) or table
          max_lines: 10 # custom max row
```

The action renders the section and pushes a commit when it changes.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `username` | no | repository owner | GitHub username whose public activity is rendered |
| `view` | no | `list` | Rendering style: `list` or `table` |
| `max_lines` | no | `10` | Maximum number of activity lines/rows |
| `target_file` | no | `README.md` | File that carries the marker section |
| `commit` | no | `true` | Commit and push when the section changes |
| `commit_message` | no | `chore: refresh README activity` | Commit message |
| `token` | no | workflow token | Token used for GitHub API calls |

## Notes

- **Public activity only.** Events from private repositories are never rendered.
- **Relative times** ("2 hours ago") are recomputed on every run, so the section also commits while a label ages.
- The workflow needs `permissions: contents: write` (only when `commit: true`).
- GitHub disables scheduled workflows after 60 days without repository activity — an occasional push keeps the schedule alive.
- Scheduling is approximate: GitHub may delay cron runs under load.

## Local usage

```sh
KIWARI_USERNAME=your-username node src/render-activity.mjs
```

Requires Node 18+ (uses the built-in `fetch`).

## Development

```sh
node --test
```

## License

[MIT](LICENSE)

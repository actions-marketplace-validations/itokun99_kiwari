# kiwari

**kiwari** *(Sundanese, "kee-WAH-ree": "now")* — render your latest public GitHub activity into a README section.

Commits, pull requests, issues, releases, and comments — the newest public events, refreshed on your own schedule. Extracted from the automation that keeps [@itokun99's profile README](https://github.com/itokun99) alive.

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
[![Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-kiwari-2ea44f?logo=github)](https://github.com/marketplace/actions/kiwari-live-github-activity)

## Preview

### `view: list` (default)

_Example output — newest events first, with relative times:_

- 🚀 Released [v1.0.0](https://github.com/itokun99/kiwari/releases/tag/v1.0.0) in [itokun99/kiwari](https://github.com/itokun99/kiwari) · _1 hour ago_
- 📝 Pushed 1 commit to [itokun99/kiwari](https://github.com/itokun99/kiwari) (`main`) — "test: exercise default username and token fallbacks in self-test" · _1 hour ago_
- 📝 Pushed 2 commits to [itokun99/blogger-go](https://github.com/itokun99/blogger-go) (`main`) — "docs: add MIT license and contributing guide" · _1 day ago_
- 🚀 Released [v0.1.0](https://github.com/itokun99/blogger-mcp/releases/tag/v0.1.0) in [itokun99/blogger-mcp](https://github.com/itokun99/blogger-mcp) · _1 day ago_

### `view: table`

_Example output — the same events as a table, for narrower layouts:_

| When | Activity |
| --- | --- |
| 1 hour ago | 🚀 Released [v1.0.0](https://github.com/itokun99/kiwari/releases/tag/v1.0.0) in [itokun99/kiwari](https://github.com/itokun99/kiwari) |
| 1 hour ago | 📝 Pushed 1 commit to [itokun99/kiwari](https://github.com/itokun99/kiwari) — "test: exercise default username and token fallbacks in self-test" |
| 1 day ago | 📝 Pushed 2 commits to [itokun99/blogger-go](https://github.com/itokun99/blogger-go) — "docs: add MIT license and contributing guide" |
| 1 day ago | 🚀 Released [v0.1.0](https://github.com/itokun99/blogger-mcp/releases/tag/v0.1.0) in [itokun99/blogger-mcp](https://github.com/itokun99/blogger-mcp) |

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

# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

For the `wayfinder` skill. GitHub's **native** sub-issues and issue dependencies carry the structure, so
the frontier renders in GitHub's own UI without opening the map.

**Labels**: the map carries `wayfinder:map`; each ticket carries exactly one of `wayfinder:research`,
`wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`.

**Gotcha that costs a round trip**: the sub-issue and dependency endpoints take **integer** ids, and
`gh api -f` sends strings — use **`-F`**. The id is the issue's `.id` (database id), *not* its number.

```bash
# database id for an issue number
gh api /repos/{owner}/{repo}/issues/<number> --jq .id
```

**Child of the map** (run once per ticket, after the ticket exists):

```bash
gh api --method POST /repos/{owner}/{repo}/issues/<map>/sub_issues -F sub_issue_id=<child_db_id>
```

**Blocking** — wire in a second pass, since issues need ids before they can reference each other:

```bash
gh api --method POST /repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker_db_id>
```

**The frontier** — open, unblocked, unclaimed children of the map:

```bash
gh api /repos/{owner}/{repo}/issues/<map>/sub_issues \
  --jq '.[] | select(.state=="open") | select(.issue_dependencies_summary.blocked_by==0) | select(.assignee==null) | "\(.number)\t\([.labels[].name]|join(","))\t\(.title)"'
```

`blocked_by` in `issue_dependencies_summary` counts only *open* blockers, so it drops to 0 on its own as
blockers close — no bookkeeping needed.

**Claim a ticket** before any work: `gh issue edit <number> --add-assignee @me`.

**Resolve**: `gh issue comment <number> --body-file ...` with the answer, then
`gh issue close <number>`, then edit the map body to append the one-line pointer under Decisions so far.

**Scripting note**: this repo's shell is zsh, which does not word-split unquoted parameters. Use real
arrays (`for x in "${arr[@]}"`) rather than a space-separated string.

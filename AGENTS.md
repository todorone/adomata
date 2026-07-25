## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `todorone/adomata`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Checks

After completing any task, run `pnpm checks` (type-check, lint, format-check, test) and fix any issues it reports before finishing.

### Localization

All user-facing application text (UI copy, labels, placeholders, button text, error messages, table headers, etc.) must be written in Ukrainian. This applies to everything rendered in `apps/client`. Code identifiers, comments, commit messages, and internal docs stay in English.

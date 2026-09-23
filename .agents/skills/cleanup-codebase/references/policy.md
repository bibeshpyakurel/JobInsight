# Repository policy

Defaults apply when the repository has no `CLEANUP.md`. A `CLEANUP.md` at the repository root replaces a default only for the headings it contains.

| Heading | Default | Effect |
| --- | --- | --- |
| Protected paths | none | Findings under these paths stay on the ledger. A cleanup batch does not edit them. |
| Required commands | none | Each command joins the baseline and the per-batch verification. |
| Batch limit | 20 | Maximum files created, edited, or deleted in one batch. Split a larger proven set and verify between splits. |

## CLEANUP.md shape

```markdown
# Cleanup policy

## Protected paths
- migrations/**
- vendor/**

## Required commands
- npm test

## Batch limit
10
```

Paths use the repository root as the base. `examples/**` covers everything under `examples/`. A required command is copied as written and run from the repository root. A batch limit is a positive integer. An unreadable limit falls back to 20.

Protected paths do not hide a finding. They stop the edit. A secret under a protected path is still reported as a path and a kind, with the value omitted.

# Contributing

## Ground rules

`main` is protected. Every change arrives through a pull request, CI must pass
before it can merge, force pushes and branch deletion are refused, and history
stays linear.

Repository admins can still push directly in a genuine emergency. GitHub records
every such bypass on the push, so it is a break-glass path with an audit trail,
not a routine shortcut. If you use it, follow up with a pull request that adds
whatever test would have caught the problem.

## Workflow

1. Branch from `main`. Name it `feat/…`, `fix/…`, `chore/…`, or `docs/…`.
2. Make the change. Keep the diff to one concern.
3. Run the local checks (see below) before pushing.
4. Open a pull request and fill in the template.
5. Merge once CI is green.

## Local checks

Run whatever the repository defines as its full gate before opening a PR. If
the project has a `check` script, that script is the gate:

```bash
npm run check     # or: dotnet test, pytest, make check
```

CI runs the same commands. If it passes locally and fails in CI, treat the CI
result as correct and work out why they diverged — that gap is itself a bug.

## Commit messages

This repository uses [Conventional Commits](https://www.conventionalcommits.org/).
The format is machine-read to generate the changelog, so it is enforced rather
than encouraged:

```
<type>(<optional scope>): <summary in the imperative>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Append `!` after the type (or add a `BREAKING CHANGE:` footer) for a change
that breaks an existing contract.

Good:

```
feat(log): accept workouts pasted as free text
fix(auth): stop refreshing an expired session on the server
ci: run the Playwright suite on pull requests
```

Not good: `Update`, `changes`, `deployable`, `fixed stuff`.

## Tests

A bug fix comes with a test that fails before the fix and passes after it. A
feature comes with tests for its contract, not its implementation details.

Tests that exist but never run in CI are worse than no tests, because they
imply a guarantee nothing enforces. If you add a suite, add it to the pipeline
in the same pull request.

## Dependencies

Dependabot proposes updates. Review them like any other change — a version bump
that fails CI is a finding, not an inconvenience.

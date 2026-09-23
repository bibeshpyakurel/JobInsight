---
name: cleanup-codebase
description: "Preserves behavior while cleaning dead code, unused dependencies, debug leftovers, duplication, AI residue, and repo hygiene for Claude, Codex, Grok, and Cursor. Use when asked to clean up, tidy, deslop, prune, or sweep a codebase. Skip for new features, upgrades, and redesigns."
license: MIT
compatibility: Any agent that reads Agent Skills. Requires a shell. Uses tools already installed in the repository. The inventory script has no extra dependencies and does not use the network.
metadata:
  author: Bibesh Pyakurel
  version: "1.0.1"
  short-description: Behavior-preserving codebase cleanup
when-to-use: "clean up the codebase, tidy, deslop, prune dead code, remove unused dependencies, sweep technical debt, AI slop, repo hygiene, Claude, Codex, Grok, Cursor"
argument-hint: "[path]"
---

# Cleanup Codebase

Cleanup preserves behavior. A cleanup edit deletes unreachable material or applies a fix the project already automates. Structural change is a separate, named request.

The words that carry this skill are **baseline**, **proof**, **batch**, and **ledger**.

## Modes

Pick the mode from the request.

| Request | Mode |
| --- | --- |
| audit, review, report, "what should we clean", "don't change anything" | `report` |
| clean up, tidy, deslop, prune, sweep, remove dead code | `apply-proven` |
| the same, plus "including refactors" or "judgment calls too" | `apply-proven`, then judgment aspects that already have tests |
| a named structural change: extract, rename, split, inline, simplify this function | `named-change` for that target only |

A request that mixes a cleanup with a new feature, upgrade, or redesign gets the cleanup only. Record the other work on the ledger.

## Steps

1. **Bound the scope.** Default to the repository. A named directory, file, or diff limits edits to that set. Whole-program tools may still run; findings outside the set stay on the ledger as outside scope. Done when the edit set is fixed.

2. **Read the project's rules.** Read `AGENTS.md`, `CLAUDE.md`, `README`, and `CONTRIBUTING` when present, plus [references/policy.md](references/policy.md) and `CLEANUP.md` at the repository root when that file exists. Copy the formatter, linter, typecheck, test, and build commands actually configured (package scripts, `Makefile`, `justfile`, CI, tool configs). Those commands, plus any required commands from the policy, are the baseline. An absent command stays absent. Done when each command is copied from the repo or recorded as absent, and protected paths are listed.

3. **Record the baseline.** Run each existing command. Record pass, fail, or skip, plus counts when the tool prints them. Record `git status --porcelain` paths, or that the tree is not a git checkout. A red baseline is a fact, not a license to repair unrelated failures. Done when every baseline command has a result.

4. **Inventory.** Run this skill's `scripts/inventory.sh` with the repository root as its argument. Use its output as the signal list. Done when the script has printed its report.

5. **Classify.** Read [references/aspects.md](references/aspects.md). For each ecosystem the inventory names, read that section of [references/detectors.md](references/detectors.md) and run the detector. Put every finding in exactly one class from aspects.md: `proven`, `mechanical`, `judgment`, or `out-of-scope`. Done when each finding has a class, a file, and the evidence.

6. **Prove.** Read [references/false-alive.md](references/false-alive.md) before marking anything `proven`. A `proven` mark cites the search and the detector result. An item that fails any applicable life check is `judgment`. Done when every `proven` item has that citation.

7. **Apply or stop.**
   - `report`: stop. Write the report.
   - `apply-proven`: edit `proven` and `mechanical` items only.
   - judgment extension: after proven batches are green, edit one judgment aspect whose current tests cover the behavior.
   - `named-change`: edit the named target only, and only when a test covers the behavior being preserved. With no such test, leave the target on the ledger as blocked on verification.
   Done when each batch has been verified or reverted.

8. **Report** with the slots below. Done when every slot is present, including empty ones.

## Batches

One batch is one aspect, inside the batch limit and outside the protected paths in [references/policy.md](references/policy.md).

Order: proven deletes, then mechanical fixes, then a judgment aspect only when the mode allows it. Run the baseline commands that cover the touched area after each batch. A batch is green when it adds no failing check and flips no previously passing check to failing.

On a red batch, restore only the files that batch changed:

- The file was clean in the baseline: restore it with `git checkout -- <file>` (or `git restore -- <file>`).
- The file was already dirty: restore the pre-batch contents saved from `git diff -- <file>` before the edit.
- The tree is not a git checkout: undo those edits by hand before the next batch.

Leave pre-existing dirty paths intact. Commit only when the user asked for a commit.

A cleanup batch deletes code, drops an unused declaration, removes a qualifying comment or debug statement, or applies the project's own autofix or formatter. Adding a file, a dependency, an abstraction, or a behavior change ends that edit.

## Proof

Proof is the conjunction in [references/false-alive.md](references/false-alive.md): the detector or an exhaustive search shows no use, and every life check that applies to the item comes back empty.

Run a detector without its write flag. `knip --fix`, `cargo machete --fix`, and file-removing flags rewrite the tree before proof exists. Follow the install rule at the top of [references/detectors.md](references/detectors.md). A dependency edit follows the Dependencies section of [references/aspects.md](references/aspects.md).

## Report

The final message uses these slots:

## Scope
The edit set, the mode, and the version from this file's frontmatter.

## Baseline
Each project command and its result, plus whether the tree was dirty.

## Applied
Each batch: aspect, files, and the proof citation. `None` when the mode is `report`.

## Ledger
Remaining findings with class, file, and why they stayed. Group by class.

## Verification
Commands run after the last green batch, and their results.

## Not verified
Checks that could not be run, and any behavior the tests do not cover.

## Read next

- [references/aspects.md](references/aspects.md) — class of every cleanup aspect. Read during classification.
- [references/detectors.md](references/detectors.md) — commands per ecosystem. Read the matching section only.
- [references/false-alive.md](references/false-alive.md) — life checks. Read before any `proven` mark.
- [references/policy.md](references/policy.md) — protected paths, required commands, and the batch limit. Read while gathering project rules.

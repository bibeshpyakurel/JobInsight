# Aspects

Each finding gets one class. The class decides whether the current mode may edit it. Mode permissions are in `SKILL.md`. This file is the classification.

| Aspect | Class | Evidence that puts it here | Edit bar |
| --- | --- | --- | --- |
| Unreferenced file or private symbol | proven | Detector or search shows no use, and the life checks are clear | Delete the file or symbol |
| Commented-out code | proven | The comment is source text, not a constraint | Delete the comment |
| Narrating comment | proven | It restates the next line, or narrates the edit ("added", "removed", "now handles") | Delete the comment |
| Backup or scratch file | proven | Name ends in `.bak`, `.old`, `.orig`, `~`, or `.tmp`, and nothing reads it | Delete the file |
| Debug statement | proven | `debugger`, `dbg!`, `console.debug`, `pdb.set_trace`, `breakpoint()`, `binding.pry`, `byebug`, or a `console.log` whose message is a debug marker. The inventory signal `debug_leftovers` is this set | Delete that statement |
| Program log | judgment | `console.log` or a print used as operator output: server started, rows imported, migration applied. The inventory signal `console_log_calls` is this set, including lines already in `debug_leftovers` | Leave it. Deleting it changes what the program reports |
| Unused direct dependency | proven | Detector and search agree | Remove that declaration only |
| Unused import, local, or unreachable branch | mechanical | The project's linter or compiler reports it | Autofix, except a re-export |
| Unused suppression | mechanical | The linter reports an unused `eslint-disable`, `noqa`, `nolint`, or equivalent | Remove the suppression |
| Format drift | mechanical | The project's formatter would change the file | Run that formatter |
| Duplication | judgment | Same logic repeated, not two literals that differ on purpose | One batch, and only with tests on both callers |
| Live wrapper or extension point | judgment | Pass-through, registry, or plugin loader that still has a caller or a config key | Inlining it removes a way to extend the program |
| Naming | judgment | Breaks the convention of the surrounding module | Rename every reference in one batch |
| Complexity | judgment | A long function the user named, or a judgment pass with tests | Extract without changing returns or effects |
| Types | judgment | `any`, an ignored type error, or a missing annotation the project otherwise requires | A type change is a named change |
| Swallowed error | judgment | Empty `catch`, `except: pass`, or an ignored error value | Leave control flow for a named change |
| `TODO` / `FIXME` / `HACK` / `XXX` | judgment | The marker is present | Leave the marker. Record file and line |
| Docs that contradict code | judgment | A comment, README, or doc states behavior the code does not have | Change the doc when tests lock the code's behavior |
| Test whose target this cleanup removed | judgment | The production symbol is gone and the test only called it | Delete that test in a later batch, after the removal is green |
| Failing or skipped test | out-of-scope | The test fails or is skipped in the baseline | Keep it |
| Circular dependency | judgment | A tool reports a cycle | Report it. Breaking it is a named change |
| Generated source | judgment | A generated header, or a generator config owns the file | Regenerate with that generator, or leave the file |
| Tracked build output | judgment | Output is committed (`dist/`, bundles, coverage) | Report it. Removing it is a named change |
| Config for a tool the repo no longer runs | judgment | The config's tool is absent from manifests and CI | Report it |
| Secret or credential | out-of-scope | A token, private key, or password in a file | Record path and kind. Omit the value |
| Dependency upgrade or advisory | out-of-scope | A newer version or a CVE exists | Record the package name |
| Architecture or module boundaries | out-of-scope | Layers, folders, or a new abstraction | Record the observation |
| Defect noticed along the way | out-of-scope | Behavior looks wrong | Record it. A cleanup batch does not fix it |

## Comments

A comment that states a constraint, a unit, an external limit, or a reason the code cannot change is not narrating. Leave it.

## Dependencies

Remove one direct dependency declaration when both the detector and a repo search show no use, including config files and CI. Leave transitive dependencies to the lockfile's own tool (`go mod tidy` only to drop a module that no remaining import uses; if it also changes versions, revert the version edits and record them).

Dev dependencies that are the test runner, linter, or formatter are used when CI or a script invokes their binary. A detector that only scans imports will call them unused. They stay.

## Exports

A symbol exported from a published package entry (`main`, `exports`, `bin`, a library crate's public items, a Go module's exported API, a Python package's `__all__` or `__init__` re-export) is a breaking-change candidate. Class it `judgment`, including when no file inside the repo calls it.

An application package marked `private`, or a `main` program whose export is only an internal convenience, follows the unreferenced-symbol row instead.

## Tests

A skipped or failing test is part of the baseline. Deleting it makes the suite quieter and hides the failure. After a proven deletion, a test that only existed to call the deleted symbol is a judgment follow-up: delete it in its own batch when the production deletion is already green.

## Secrets

Name the file, the line, and the kind of credential (API token, private key, password). The report contains no secret characters. Cleaning the value out of history is a named change the user has to ask for.

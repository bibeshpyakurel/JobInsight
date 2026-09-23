# Detectors

Run the project's own check before any third-party detector. Copy the command from package scripts, the `Makefile`, `justfile`, CI, or the tool's config file in the repo.

**Install rule.** Run a third-party detector only when that ecosystem is present and the binary is already on `PATH` or already declared by the project (`npx --no-install` is the way to run a declared JavaScript tool). Skip a missing detector and record the gap. Do not download one, `npm install` one, `go install` one, or `cargo install` one during a cleanup. Do not add it to the project's dependencies. Invoke every detector without a write flag.

Run the tool at the manifest root it belongs to (workspace root, crate, Go module, Python project). In a monorepo, repeat per manifest. Edit only files inside the scope from step 1 of `SKILL.md`.

The "proves" column is a candidate. [false-alive.md](false-alive.md) still applies.

## JavaScript and TypeScript

Evidence of the ecosystem: `package.json`.

| Need | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Project lint and format | the repo's lint and format scripts | Whatever those tools are configured to report | Unused files across packages |
| Unused files, exports, dependencies | `npx --no-install knip` when Knip is already a dependency | Unreferenced files, exports, and dependencies inside the module graph Knip built | Framework files without a matching Knip plugin. Run a plain report. Do not pass `--fix` or `--allow-remove-files`. When Knip is not installed, use the search in false-alive.md |
| Duplication | `jscpd .` when `jscpd` is already installed | Similar clones, as judgment evidence | That the clones are safe to merge. Ignore clones under dependency and build directories |

Read `knip.json` or the `knip` key in `package.json` before treating a file finding as unused. When the report is mostly framework files, the entry points are wrong: record that and stop deleting files from that report.

ESLint and Biome unused-import rules are the mechanical path. Knip is the cross-file path. `depcheck` and `ts-prune` duplicate Knip on modern repos; use them only when the repo already runs them.

## Python

Evidence: `pyproject.toml`, `setup.cfg`, `requirements.txt`, or `Pipfile`.

| Need | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Unused imports and locals | `ruff check --select F401,F841` | Unused imports and unused locals | Re-exports. Do not `--fix` `__init__.py` |
| Unreachable and high-confidence dead code | `vulture . --min-confidence 100` | Items Vulture marks guaranteed inside the analyzed files | Confidence 60 or 80. Those stay on the ledger |
| Declared dependencies | `deptry .` | DEP002 unused direct dependencies, after life checks | Dev tools invoked as binaries. Plugins named only in settings |

Use the project's `ruff`, `flake8`, or `pylint` config when one exists, by running the project's task. Add `--select` only when invoking Ruff yourself because the project has no lint task.

## Go

Evidence: `go.mod`.

| Need | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Vet | `go vet ./...` | Problems vet prints | Unused exported API |
| Unused unexported code | `staticcheck ./...` when `staticcheck` is installed | U1000 unused code inside a package | A license to install it, or unused exported API |
| Unreachable functions | `deadcode ./...` when `deadcode` is installed | Functions not reachable from `main` or `init` in a program | Library packages. Exported names there are API. A missing `deadcode` binary stays a ledger note |
| Module requirements | `go mod tidy` after an import deletion | Nothing by itself | Review the diff. Keep removals of modules with no remaining import. Revert version changes |

`deadcode -whylive=<name>` explains a function that was expected to be dead. Use it before arguing with a surprising result.

## Rust

Evidence: `Cargo.toml`.

| Need | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Warnings and lint | `cargo clippy --all-targets -- -D warnings` only when the repo already denies warnings. Otherwise `cargo clippy --all-targets` | Compiler dead-code warnings and clippy findings the repo cares about | Unused crates in `Cargo.toml` |
| Unused dependencies, fast | `cargo machete` and, for renamed crates, `cargo machete --with-metadata` | Crate names that appear in no source text | Proc-macro and `build.rs` use. Do not pass `--fix` |
| Unused dependencies, compiled | `cargo +nightly udeps --all-targets` when nightly is installed | Crates the compiler did not use | Doc-test-only crates |

A `pub` item in a library crate is API. A dead-code warning on a private item is a candidate for proof.

## JVM

Evidence: `pom.xml` or `build.gradle` / `build.gradle.kts`.

| Need | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Maven dependencies | `mvn -q dependency:analyze` | Used-undeclared and unused-declared dependencies | Reflection, SPI, and provided-scope containers |
| Project linters | the repo's Checkstyle, Error Prone, SpotBugs, or Detekt task | What that task reports | A reason to add a new linter |

## Other ecosystems

Run the check the repo already configures. The commands below are optional and only when that binary is already installed. Do not add the tool as a dependency.

| Ecosystem | Evidence | Installed-tool command | Limit |
| --- | --- | --- | --- |
| Ruby | `Gemfile` | `rubocop` as the repo configures it | Unused methods still need a search. `debride` is an extra candidate list |
| PHP | `composer.json` | `vendor/bin/composer-unused` | Autoloaded classes and container strings stay live |
| Elixir | `mix.exs` | the repo's `mix` aliases | No `mix` task listed here proves a public module is unused |
| .NET | `*.csproj` or `*.sln` | the repo's `dotnet test` and `dotnet build` | Unused usings are analyzer IDE0005. Delete a using when an analyzer or the compiler reports it |
| Swift | `Package.swift` or an Xcode project | `periphery scan` | Storyboards and previews keep selectors live |
| Shell | scripts in CI or `bin/` | `shellcheck` on scripts this cleanup edits | It does not find dead scripts. Search for the filename |

## No detector

When no detector applies, the search in [false-alive.md](false-alive.md) is the evidence. Say so in the proof citation. A hunch from reading one file is not a detector result.

# False-alive checks

A candidate is **live** when any check below matches. Live candidates are `judgment` or stay untouched. They are not `proven`.

Comment mentions and README prose do not make a symbol live. A string that selects an implementation, a file, or a command does.

## Example

`leftoverHelper` is exported and nothing in source, tests, config, or CI names it. That is a proven delete.

`require("./plugins/" + pluginName)` with `pluginName = "greet"` loads `src/plugins/greet.js`. The file has no static import. It is live.

`console.log("debug loader", pluginName)` inside a function the program calls is a proven deletion of that statement.

A comment that the timeout must stay under the gateway's 30 second limit is a constraint. It stays.

`left-pad` declared in `package.json` and absent from source, config, and CI is a proven removal of that dependency declaration.

`formatInvoice`, exported from a published package entry and never called inside the repo, follows the Exports row in [aspects.md](aspects.md).

## Search

Search the repository for the identifier, the filename without extension, and any path fragment a loader would concatenate. Include source, tests, scripts, CI, Docker, infrastructure, Makefiles, manifests, config, migrations, fixtures, protobuf, GraphQL, and OpenAPI.

Exclude `node_modules`, `dist`, `build`, `vendor`, `target`, `.git`, coverage output, and vendored bundles. Those trees echo the identifier without using it.

A search that was not run is not proof.

## Entry points and manifests

These are live even when no application file imports them:

| Surface | Live files and names |
| --- | --- |
| JavaScript package | `main`, `exports`, `bin`, `types`, script names invoked by CI |
| TypeScript project | `tsconfig` `files` / `include`, bundler input, test setup, Storybook stories |
| Next.js | `app/**/page`, `layout`, `route`, `loading`, `error`, `template`, `default`, `middleware`, `instrumentation`, `pages/**` |
| Other JS frameworks | file-based routes, server actions, and plugin files named by the framework manual |
| Python | `pyproject` scripts and entry points, `__main__.py`, `conftest.py`, `manage.py` commands, Alembic versions |
| Django | `INSTALLED_APPS`, `urls`, settings class paths, Celery task name strings |
| Go | `main`, `init`, `//go:generate`, `//go:embed`, blank imports `_ "pkg"` |
| Rust | `main.rs`, `lib.rs` modules, `[[bin]]`, `build.rs`, feature-gated modules, `include_str!` / `include_bytes!` |
| JVM | `main`, SPI files under `META-INF/services`, Spring stereotypes picked up by component scan |
| Ruby / Rails | `config/routes`, `app/` autoload paths, Rake tasks |
| PHP / Laravel | routes, service providers, artisan command classes |
| .NET | generic host startup, Razor pages, XAML `x:Class`, partial classes |
| Apple | storyboards, nibs, SwiftUI previews, `@objc` entry points |
| CI and ops | workflow `run` steps, Docker `CMD` / `ENTRYPOINT` / `COPY`, systemd units, cron, Kubernetes args |

When a framework convention is unfamiliar, class the conventional file as `judgment` and name the convention. Guessing that a route file is unused is not proof.

## Dynamic dispatch

Treat the target as live when the program builds a name and then loads it:

- `require(expr)`, `import(expr)`, `importlib`, `__import__`, `getattr`, `Method.invoke`, `dlopen` / `dlsym`
- a map from a config value or request field to a function
- a plugin directory whose filename is concatenated
- CLI subcommands registered by name
- tests and fixtures discovered by pattern (`test_*`, `*_test`, `*.spec`, `*.test`, snapshots)
- framework string references in the table above

`commands[tasks.handler]` is a use of every command the config can name, not only the ones a static call graph reaches. A literal config in the repo makes the named handler live. A free-form config makes every exported handler live.

## Side effects

An import, attribute, or function is live when loading it registers something: framework `init`, a blank Go import, a decorator that registers a route or task, a CSS or polyfill import, `reflect.Register`, or a test fixture that runs on collection.

## Generated and embedded files

Files with a generated-code header are owned by their generator. Hand-deleting lines is not a cleanup batch. Regenerate with the project's command, or leave them.

Database migrations that have been applied stay. Deleting a migration rewrites shared history.

Detector output is a candidate until the checks above are clear. What each detector fails to prove is the "Does not prove" column in [detectors.md](detectors.md).

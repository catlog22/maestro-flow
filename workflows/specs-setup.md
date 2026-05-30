---
name: spec-setup
alias: spec-setup
---

# Workflow: spec-setup

System specs initialization -- scan project structure, detect tech stack, generate convention files.

## Trigger

- First `/maestro-init` (automatic)
- Manual `/spec-setup`

## Prerequisites

- Project root must exist
- `.workflow/` directory should exist (create if missing)

## Execution Steps

### Step 1: Ensure Directory Structure

Ensure `.workflow/` and `.workflow/specs/` exist (create if missing).

### Step 2: Scan Project Structure

Scan project root for tech stack indicators:

```
Manifest files → runtime: package.json (Node), tsconfig.json (TS), pyproject.toml/requirements.txt (Python),
  go.mod (Go), Cargo.toml (Rust), pom.xml (Maven), build.gradle (Gradle), composer.json (PHP),
  Gemfile (Ruby), .csproj/.sln (.NET), Dockerfile/docker-compose.yml (containers)

Dependency analysis → frameworks: react/next, vue, angular, express/fastify, django/flask, gin/echo, spring
```

### Step 3: Detect Code Patterns

Scan source files for coding conventions:

```
Detect from first 20 source files: indentation style, naming conventions (camelCase/PascalCase/snake_case),
import style (named/default, aliases, barrels), formatter configs (.prettierrc, .editorconfig, eslint),
file naming pattern (kebab/camel/Pascal)
```

### Step 4: Generate Core Files (always created)

#### 4a: coding-conventions.md

Output: `.workflow/specs/coding-conventions.md`

```markdown
---
title: "Coding Conventions"
category: coding
---
# Coding Conventions

Auto-generated from project analysis. Update manually as patterns evolve.

## Formatting
- Indentation: {detected}
- Line length: {detected or "not configured"}
- Trailing commas: {detected}
- Semicolons: {detected}

## Naming
- Variables/functions: {camelCase | snake_case}
- Classes/types: {PascalCase}
- Constants: {UPPER_SNAKE_CASE | camelCase}
- Files: {kebab-case | camelCase | PascalCase}

## Imports
- Style: {named imports | default imports | mixed}
- Path aliases: {@ | ~ | none}
- Order: {built-in, external, internal, relative}

## Patterns
{list detected patterns from codebase analysis}

## Entries
{empty section for spec-add entries}
```

#### 4b: architecture-constraints.md

Output: `.workflow/specs/architecture-constraints.md`

```markdown
---
title: "Architecture Constraints"
category: arch
---
# Architecture Constraints

Auto-generated from project structure. Update manually as architecture evolves.

## Module Structure
- Type: {monorepo | single-package | multi-package}
- Key modules: {list detected top-level directories with purposes}

## Layer Boundaries
{detected layers: e.g., commands/ -> core/ -> tools/ -> types/}

## Dependency Rules
{detected from imports: which modules import from which}

## Technology Constraints
- Runtime: {Node.js >= X | Python >= X | ...}
- Module system: {ESM | CommonJS | ...}
- Strict mode: {yes | no}

## Entries
{empty section for spec-add entries}
```

#### 4c: learnings.md

Output: `.workflow/specs/learnings.md`

```markdown
---
title: "Learnings"
category: learning
---
# Learnings

Bugs, gotchas, and lessons learned during development.
Add entries with: `/spec-add learning <description>`

## Entries

{empty -- entries added via spec-add}
```

### Step 5: Generate Optional Files (when signals detected)

#### 5a: quality-rules.md (when linter config or CI detected)

Output: `.workflow/specs/quality-rules.md`

```markdown
---
title: "Quality Rules"
category: quality
---
# Quality Rules

## Entries

{empty -- entries added via spec-add}
```

#### 5b: test-conventions.md (when test framework or test files detected)

Scan existing test files for conventions (framework, naming, directory structure, patterns).

Output: `.workflow/specs/test-conventions.md`

```markdown
---
title: "Test Conventions"
category: test
---
# Test Conventions

Auto-generated from project analysis. Update manually as patterns evolve.

## Framework
- Framework: {detected: Jest | Vitest | pytest | Mocha | none}
- Run command: {detected: npm test | pytest | etc.}

## Directory Structure
- Pattern: {detected: __tests__/ | tests/ | co-located | etc.}

## Naming Conventions
- Test files: {detected: *.test.ts | *.spec.ts | test_*.py | etc.}

## Patterns
{detected patterns from existing test files}

## Entries
{empty section for spec-add entries}
```

#### 5c: ui-conventions.md (when frontend framework detected)

Scan for frontend frameworks (React, Vue, Angular, Svelte, etc.) and UI libraries.

Output: `.workflow/specs/ui-conventions.md`

```markdown
---
title: "UI Conventions"
category: ui
---
# UI Conventions

Auto-generated from project analysis. Update manually as patterns evolve.

## Entries

{empty section for spec-add entries}
```

#### 5d: debug-notes.md and review-standards.md

These are NOT created during setup. They are created on demand when `spec-add debug` or `spec-add review` is first used.

### Step 6: Generate Workflow Knowhow Recipes (when signals detected)

Spec files in Step 4-5 capture *conventions*. This step captures *operational workflows* — "how to do X in this project" — as **recipe-type knowhow** so future agents can discover them via `maestro wiki search` and `maestro knowhow list --type recipe`.

Output directory: `.workflow/knowhow/` (knowhow store, NOT `.workflow/specs/`).
Schema: matches `recipe` type defined in `~/.maestro/workflows/knowhow.md` Part B.

**Detection → recipe matrix:**

| Recipe slug | Trigger signals | Step extraction source |
|-------------|----------------|------------------------|
| `test-workflow` | Test framework detected in Step 5b (jest/vitest/pytest/mocha/go test/cargo test) | `package.json` `scripts.test*`, `pytest.ini`/`pyproject.toml [tool.pytest]`, `go test ./...`, test layout from Step 5b |
| `debug-workflow` | `.vscode/launch.json` OR logging lib import (pino/winston/loguru/zap/log) OR error tracker SDK (sentry/bugsnag/rollbar) OR `DEBUG=` env usage in code | launch.json entries, `--inspect` flags in scripts, logger config files, observed `log.debug(...)` / `logger.info(...)` patterns |
| `build-workflow` | `scripts.build` in package.json OR Makefile `build:` target OR `cargo build` OR `gradle build` OR `go build` | Verbatim script chain; multi-step pipelines noted explicitly |
| `dev-workflow` | `scripts.dev`/`scripts.start` OR `manage.py runserver` OR `air`/`reflex` config OR docker-compose dev override | Dev command + detected port from config + hot-reload flag |
| `lint-workflow` | Linter+formatter pair detected: eslint+prettier / ruff+black / golangci-lint+gofmt / rustfmt+clippy | Configured commands, pre-commit hooks from `.pre-commit-config.yaml` or `husky/`, CI lint job |

**Skip rule:** If signals are missing, skip the recipe — do NOT generate placeholders.

**Idempotency rule:** Before writing, glob `.workflow/knowhow/RCP-*-{slug}.md`. If a file matching the slug exists, do NOT overwrite — write `.workflow/knowhow/RCP-{YYYYMMDD-HHMM}-{slug}.proposed.md` instead and mention it in Step 7 summary so the user can diff and merge manually.

**Filename:** `.workflow/knowhow/RCP-{YYYYMMDD-HHMM}-{slug}.md` (timestamp aligns with rest of knowhow store, slug disambiguates).

**Tags rule:** Match content language (English codebase → English tags). Always include `workflow`, the slug, and the detected framework (e.g. `vitest`, `pytest`). Add `auto-generated` so users can identify spec-setup output for later pruning.

**Recipe template** (one file per detected workflow):

```markdown
---
title: "{Project name} — {Workflow name}"
type: recipe
tags: [workflow, {slug}, {framework}, auto-generated]
created: {ISO timestamp}
source: spec-setup
---

# {title}

## Goal
{One sentence stating the operational outcome — "Run the test suite locally and in CI", "Reproduce and inspect a runtime bug with full stack context", etc.}

## Prerequisites
- {Required runtime/version from manifest, e.g. "Node.js >= 18"}
- {Required env vars detected in .env.example or code}
- {Required services if docker-compose detected}

## Steps
1. {Copy-paste-ready command 1 — derived from detected scripts}
2. {Command 2}
3. ...

## Expected Outcome
{Concrete success signal — "All tests green, coverage report at coverage/index.html" / "Dev server reachable at http://localhost:PORT with HMR active"}

## Common Pitfalls
- {Inferred from detected patterns — e.g. "Vitest watch mode locks DB if integration suite is selected"}
- {Generic gotchas: port conflicts, missing env, stale dist/}

## Related
- [[test-conventions]] / [[architecture-constraints]] — convention specs (link when they exist)
```

**Per-recipe extraction guides:**

- **`test-workflow`** — Steps must list: (a) install command if first run, (b) full-suite command, (c) watch/filter command, (d) coverage command. For pytest, include marker selection if `pytest.ini` declares markers. For Go, document `-race` and `-tags` flags if used in CI.
- **`debug-workflow`** — Steps must cover: (a) attach/launch via debugger (cite the exact `launch.json` configuration name), (b) increase log verbosity (cite the env var or config flag actually used in code), (c) reproduce-and-capture pattern (point at the project's logging entry pattern with one file:line example). Mention error-tracker DSN env if Sentry/Bugsnag SDK is wired.
- **`build-workflow`** — Reproduce the `scripts.build` chain verbatim; if it spans multiple commands, number them. Note the output directory (`dist/`, `build/`, `target/`) and any required `prepublishOnly`/`postbuild` side effects.
- **`dev-workflow`** — Dev server command, detected default port, hot-reload flag, and any companion process (e.g. `npm run dev` + `npm run mcp` if both are typically run together — detect this when both appear under `scripts` and one is `dev`).
- **`lint-workflow`** — Linter command, formatter command, fix command (`--fix` / `--write`), pre-commit hook trigger if `husky/_/pre-commit` or `.pre-commit-config.yaml` exists.

**Quality bar:** Every generated recipe must contain at least one runnable command. If signals are present but no concrete command can be extracted with confidence, do NOT write the file — emit `W002: <slug> signals detected but commands ambiguous, skipped` and continue.

**Wiki indexing:** Files in `.workflow/knowhow/` are auto-indexed by WikiIndexer (`type=knowhow`). No separate index step required — they appear in `maestro wiki list --type knowhow` after the next index pass.

### Step 7: Summary

Display list of all created files grouped by destination:

```
## Specs (.workflow/specs/)
- coding-conventions.md
- architecture-constraints.md
- learnings.md
- {optional spec files created}

## Workflow Recipes (.workflow/knowhow/)
- RCP-{ts}-test-workflow.md       (vitest detected)
- RCP-{ts}-debug-workflow.md      (pino + .vscode/launch.json detected)
- {other recipes}

## Skipped (signals missing)
- build-workflow — no build script detected
- {other skips}

## Deferred (created on demand)
- debug-notes.md, review-standards.md — use /spec-add when needed
```

Note that `debug-notes.md` and `review-standards.md` are created on demand via `/spec-add`, and any `.proposed.md` files indicate an existing recipe was not overwritten — review and merge manually.

## Output

All files listed above under `.workflow/specs/` and `.workflow/knowhow/`.

<!-- session-mode: none -->
---
name: spec-add
alias: spec-add
---

# Workflow: spec-add

Add a `<spec-entry>` closed-tag entry to a single target spec file by category.

## Arguments

```
$ARGUMENTS: free-form intent, OR the explicit shortcut form:
            "[--scope <scope>] [--uid <uid>] <category> <content>"

--scope  -- target scope: project (default) | global | team | personal
--uid    -- user id for personal scope (auto-detected from git if omitted)
category -- one of: coding, arch, quality, debug, test, review, learning, ui
content  -- free-text description of the entry
```

## Scope-to-Directory Mapping

| Scope | Target directory | uid needed |
|-------|-----------------|------------|
| `project` (default) | `.workflow/specs/` | no |
| `global` | `~/.maestro/specs/` | no |
| `team` | `.workflow/collab/specs/` | no |
| `personal` | `.workflow/collab/specs/{uid}/` | yes (auto or `--uid`) |

## Category-to-File Mapping (1:1, same filename in every scope)

| Category | Target file |
|----------|------------|
| `coding` | `coding-conventions.md` |
| `arch` | `architecture-constraints.md` |
| `quality` | `quality-rules.md` |
| `debug` | `debug-notes.md` |
| `test` | `test-conventions.md` |
| `review` | `review-standards.md` |
| `learning` | `learnings.md` |
| `ui` | `ui-conventions.md` |

## Prerequisites

- Target specs directory must exist:
  - `project`: `.workflow/specs/` (run `maestro spec init`, or Read `~/.maestro/workflows/specs-setup.md` to also scan the codebase)
  - `global`: `~/.maestro/specs/` (run `maestro spec init --scope global`)
  - `team`: `.workflow/collab/specs/` (run `maestro spec init --scope team`)
  - `personal`: `.workflow/collab/specs/{uid}/` (run `maestro spec init --scope personal`)

## Execution Steps

### Step 1: Parse Intent

```
$ARGUMENTS is free-form intent. Resolve scope / category / content:

1. Extract explicit --scope <value> (default: project) and --uid <value> if present.
2. If the explicit form is used (first remaining word is a known category),
   category = that word, content = remaining text.
3. Otherwise infer from the intent:
   - category from the constraint’s nature, e.g.:
       命名/禁止用 any/代码风格 → coding
       服务间/依赖方向/分层/接口 → arch
       覆盖率/质量/可维护性 → quality
       测试约定/mock → test
       调试/排查规范 → debug
       评审/review 标准 → review
       UI/组件/样式规范 → ui
   - content = the constraint statement itself (strip leading “加一条规范/记录约束” phrasing).
   - scope: “团队/global/个人” hints → team/global/personal, else project.
4. Validate:
   - scope ∈ {project, global, team, personal}
   - category ∈ {coding, arch, quality, debug, test, review, learning, ui}
   - content non-empty
   - personal scope requires uid (resolve from `maestro collab whoami` if --uid not given)
5. Category unclear → AskUserQuestion to pick; content empty → ask for the constraint text.
```

### Step 2: Read-Only Preflight

Resolve the expected target path from scope/category for the confirmation preview only. **Do not create or edit the file.** The canonical CLI owns directory initialization, file routing, stable IDs, formatting, and writes.

- If the scope is not initialized, stop and instruct the user to run the matching `maestro spec init --scope <scope>` command; do not create a header manually.
- Check for near-duplicates without mutation:

```bash
maestro spec search "<distinctive content terms>" --scope <scope> --json
```

### Step 3: Extract Keywords

Auto-extract 3-5 relevant keywords from the content. **Keywords must match the content language:**

- **Chinese content** → generate Chinese keywords (2-4 字词语，如 `设计系统,颜色,组件,布局`)
- **English content** → generate English keywords (lowercase, hyphens for multi-word)
- **Mixed content** → generate bilingual keywords (中英各半，如 `设计,layout,组件,responsive`)

Keyword quality rules:
- Domain-specific terms (not generic words like "code"/"代码", "file"/"文件", "function"/"函数")
- Must be terms a user would naturally type when searching for this knowledge
- Chinese keywords: 2-4 characters, no punctuation (如 `路由,状态管理,权限控制`)
- English keywords: lowercase, no spaces (use hyphens for multi-word terms)
- Prefer concrete nouns/verbs over abstract descriptions

### Step 4: Prepare Canonical Mutation

Derive a concise title from the first meaningful phrase. Prepare, but **do not execute**, this canonical command:

```bash
maestro spec add <category> "<title>" "<content>" \
  --keywords <kw1>,<kw2>,<kw3> --scope <scope> [--uid <uid>] --json
```

The CLI generates the closed `<spec-entry>` block and stable `sid` (`S-YYYYMMDD-xxxx`), selects the canonical file, and performs the write. Never hand-format or append a `<spec-entry>`.

### Step 5: Confirm Before Mutation (Mandatory)

Show the user the resolved category, scope, expected target path, title, content, keywords, and exact command preview. Use `AskUserQuestion` to request explicit approval **before any mutation**. Do not treat the original request, inferred intent, or a previous confirmation as approval for this concrete write.

- Approved → continue to Step 6.
- Declined or changed → stop or revise the preview, then ask again.
- Confirmation unavailable → report `BLOCKED`; do not write.

### Step 6: Execute Canonical CLI

Run the approved `maestro spec add ... --json` command exactly once. Do not use Write/Edit/shell redirection against `.workflow/specs/` (or any other scoped spec directory).

### Step 7: Report and Verify

Use the CLI JSON result—not a predicted path—to display category, scope, actual target file path, keywords, and `sid`. Verify read-only:

```bash
maestro spec load --scope <scope> --keyword <kw1>
```

## Output

One `<spec-entry>` block appended to the target file (with auto-generated sid).

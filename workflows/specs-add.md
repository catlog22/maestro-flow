---
name: spec-add
alias: spec-add
---

# Workflow: spec-add

Add a `<spec-entry>` closed-tag entry to a single target spec file by category.

## Arguments

```
$ARGUMENTS: "[--scope <scope>] [--uid <uid>] <category> <content>"

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
  - `project`: `.workflow/specs/` (run `/spec-setup` or `maestro spec init`)
  - `global`: `~/.maestro/specs/` (run `maestro spec init --scope global`)
  - `team`: `.workflow/collab/specs/` (run `maestro spec init --scope team`)
  - `personal`: `.workflow/collab/specs/{uid}/` (run `maestro spec init --scope personal`)

## Execution Steps

### Step 1: Parse Arguments

```
Parse $ARGUMENTS:
  1. Extract --scope <value> (default: project)
  2. Extract --uid <value> if present
  3. category = first remaining word
  4. content = remaining text
Validate:
  - scope ∈ {project, global, team, personal}
  - category ∈ {coding, arch, quality, debug, test, review, learning, ui}
  - content non-empty
  - personal scope requires uid (resolve from `maestro collab whoami` if --uid not given)
On failure: show usage `/spec-add [--scope <scope>] <category> <content>`, exit
```

### Step 2: Resolve Target File

Resolve directory from scope (see table above), then append `<target_file>` from category mapping.

If file does not exist, create it with a basic header.

Check for near-duplicate entries:
```bash
grep -i "<content_first_10_words>" <resolved_dir>/<target_file> | tail -5
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

### Step 4: Format Entry

```
Entry format (closed-tag), date = YYYY-MM-DD, title = first meaningful phrase:

<spec-entry category="{category}" keywords="{kw1},{kw2},{kw3}" date="{YYYY-MM-DD}" sid="{S-YYYYMMDD-xxxx}" title="{title}" description="{one-line summary}">
### {title}
{content}
</spec-entry>
```

`sid` (stable identity) 由 CLI 自动生成（`S-YYYYMMDD-xxxx`，base36 随机后缀），用于 supersession 演化链。

### Step 5: Append to Target File

Read target file. Append the formatted `<spec-entry>` block at the end. Write file back.

CLI 调用时加 `--json` 可从输出中获取生成的 `sid`（supersession 流程需要）。

### Step 6: Confirm

Display: category, scope, target file path, keywords, sid, and verify command:
```
maestro spec load --scope <scope> --keyword <kw1>
```

## Output

One `<spec-entry>` block appended to the target file (with auto-generated sid).

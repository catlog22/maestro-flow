---
title: "Spec Injection Configuration Guide"
---

Controls which spec entries are injected into the agent context at the keyword granularity level, supporting the association of extra documents, global filtering, and custom agent mappings. Configuration is stored in the `specInjection` key of `.workflow/config.json`.

---

## Table of Contents

- [Overview](#overview)
- [Injection Flow](#injection-flow)
- [Configuration Schema](#configuration-schema)
- [CLI Configuration](#cli-configuration)
- [TUI Configuration](#tui-configuration)
- [Dashboard Configuration](#dashboard-configuration)
- [Use Cases](#use-cases)
- [Reference](#reference)

---

## Overview

The Spec injection system automatically injects project specifications into the context when a session starts and an agent is spawned.

Core capabilities:
- **Keyword-level filtering** — Only inject/exclude spec entries containing specific keywords
- **Extra document association** — Bind extra markdown documents for a category or agent
- **Always inject** — Specify documents to inject regardless of which agent is used
- **Global filtering** — Keyword whitelists/blacklists across all agents

### Default Agent → Category Mapping

| Agent Type | Default Categories |
|------------|-----------------|
| `code-developer` | coding, learning, ui |
| `tdd-developer` | coding, test |
| `workflow-executor` | coding |
| `universal-executor` | coding, ui |
| `test-fix-agent` | coding, test |
| `cli-lite-planning-agent` | arch |
| `action-planning-agent` | arch |
| `workflow-planner` | arch |
| `workflow-reviewer` | review |
| `debug-explore-agent` | debug |
| `workflow-debugger` | debug |
| `general` (session start) | coding, learning |

> Empty seed files containing only markdown titles will be automatically skipped. Only files with substantial content or `<spec-entry>` participate in injection.

---

## Injection Flow

```
Session Start / Agent Spawn
        │
        ▼
loadSpecInjectionConfig()   ← .workflow/config.json
        │
        ▼
resolveCategories()         ← config.mapping overrides default mappings
        │
        ▼
resolveKeywordFilters()     ← Merge agent-level + global-level filters
        │
        ▼
┌─ for each category ────────────────────┐
│  loadSpecs(category, filters)          │
│  loadExtraDocs(categoryDocs[cat])      │
│  loadWikiByCategory(category)          │
└────────────────────────────────────────┘
        │
        ▼
loadExtraDocs(always)  →  maxContentLength truncation → context budget → inject
```

---

## Configuration Schema

Configuration is stored in `.workflow/config.json` → `specInjection`:

<details>
<summary>Complete JSON Schema Example</summary>

```json
{
  "specInjection": {
    "mapping": {
      "<agent-type>": {
        "categories": ["coding", "test"],
        "includeKeywords": ["react", "typescript"],
        "excludeKeywords": ["legacy", "deprecated"],
        "extras": [".workflow/docs/api-guide.md"]
      }
    },
    "categoryDocs": {
      "<category>": {
        "specFiles": ["api-conventions.md"],
        "docs": ["knowhow/AST-patterns.md", ".workflow/docs/style.md"]
      }
    },
    "always": [".workflow/docs/project-overview.md"],
    "keywordFilters": {
      "include": ["react", "hooks"],
      "exclude": ["deprecated"]
    },
    "maxContentLength": 8000
  }
}
```

</details>

### Field Descriptions

| Field | Purpose |
|------|------|
| `mapping.{agent}.categories` | Override default category mapping |
| `mapping.{agent}.includeKeywords` | Only inject entries containing these keywords |
| `mapping.{agent}.excludeKeywords` | Exclude entries containing these keywords |
| `mapping.{agent}.extras` | Extra document paths to inject for this agent |
| `categoryDocs.{cat}.specFiles` | Extended spec files associated with the category |
| `categoryDocs.{cat}.docs` | Extra documents associated with the category |
| `always` | Documents injected for all agents |
| `keywordFilters.include` | Global keyword whitelist |
| `keywordFilters.exclude` | Global keyword blacklist |
| `maxContentLength` | Truncation threshold (character count) |

### Keyword Filtering Priority

1. Agent-level `includeKeywords` overrides global `keywordFilters.include`
2. Agent-level and global `excludeKeywords` are merged (union)
3. Filter with include first, then exclude

### Document Path Resolution

| Path Format | Resolves To |
|----------|--------|
| `knowhow/AST-patterns.md` | `.workflow/knowhow/AST-patterns.md` |
| `.workflow/docs/guide.md` | `<project>/.workflow/docs/guide.md` |
| `docs/architecture.md` | `<project>/docs/architecture.md` |

---

## CLI Configuration

Manage configurations via the `maestro spec injection` command group:

### View Configuration

```bash
maestro spec injection show          # Formatted display
maestro spec injection show --json   # Raw JSON
```

### Configure Agent Mapping

```bash
# Set categories and keyword filters for an agent
maestro spec injection agent code-developer \
  --categories coding,ui \
  --include react,typescript \
  --exclude legacy

# Remove agent mapping (restore defaults)
maestro spec injection agent code-developer --remove
```

### Associate Category Documents

```bash
maestro spec injection category coding \
  --spec-files api-conventions.md \
  --docs knowhow/AST-patterns.md,.workflow/docs/style.md

maestro spec injection category coding --remove
```

### Manage Always Inject

```bash
maestro spec injection always --add .workflow/docs/overview.md
maestro spec injection always --remove .workflow/docs/overview.md
maestro spec injection always --clear
```

### Global Keyword Filtering

```bash
maestro spec injection filter --include react,hooks --exclude deprecated
maestro spec injection filter --clear
```

### Preview Injection Effect

```bash
maestro spec injection preview code-developer
maestro spec injection preview general --json
```

---

## TUI Configuration

Enter the TUI panel via `maestro config specs`:

| Key | Mode | Function |
|------|------|------|
| `v` | View | View spec files and entry counts |
| `b` | Browse | Browse all entries at keyword granularity, filter with `/` |
| `p` | Preview | Select an agent type to preview injection effects |
| `c` | Config | Interactive configuration editor |

### Config Mode

Press `c` to enter, switch between 5 sections using `1-5`:

| Section | Function |
|---------|------|
| 1: Agent Mappings | Edit agent → category mappings, `a` to add, `d` to delete |
| 2: Category Documents | Manage specFiles and docs for a category |
| 3: Always Inject | Manage file paths that are always injected |
| 4: Global Filters | Manage global keyword list, toggle include/exclude with `Tab` |
| 5: Preview | Real-time preview of injection effects, switch agent type with `←/→` |

All modifications are saved instantly to `.workflow/config.json`.

---

## Dashboard Configuration

In the **Settings → Specs** area of the Dashboard:

| Function | Description |
|------|------|
| Keyword Browser | Search keywords, view references, Quick Bind |
| Agent Mappings | Edit category, keyword, extras, preview with Test button |
| Category Documents | Add/remove spec files and documents, Document Finder for path suggestions |
| Always Inject & Filters | Path management, keyword tag editing, maxContentLength |

---

## Use Cases

### Inject only frontend-related specs for a frontend project

```bash
maestro spec injection agent code-developer \
  --categories coding,ui \
  --include react,css,component,hooks \
  --exclude backend,sql,migration
```

### Associate API specification documents for the coding category

```bash
echo "## API Naming Conventions\n\n- REST style..." > .workflow/docs/api-guide.md
maestro spec injection category coding --docs .workflow/docs/api-guide.md
```

### Inject project architecture overview for all agents

```bash
maestro spec injection always --add .workflow/docs/project-overview.md
```

### Exclude deprecated spec entries

```bash
maestro spec injection filter --exclude deprecated,legacy,removed
```

### Fine-tune after previewing

```bash
maestro spec injection preview code-developer
maestro config specs  # Interactive adjustments via TUI
```

---

## Reference

| File | Purpose |
|------|------|
| `src/types/index.ts` | `SpecInjectionConfig` type definitions |
| `src/config/index.ts` | `loadSpecInjectionConfig()` / `saveSpecInjectionConfig()` |
| `src/tools/spec-loader.ts` | `loadSpecs()` keyword filtering, `loadExtraDocs()` |
| `src/hooks/spec-injector.ts` | `evaluateSpecInjection()` injection flow |
| `src/commands/spec.ts` | `maestro spec injection` CLI commands |
| `src/tui/config-ui/SpecPanel.tsx` | TUI four-mode panel |
| `dashboard/.../SpecsSection.tsx` | Dashboard injection configuration UI |
| `.workflow/config.json` | Configuration storage location |

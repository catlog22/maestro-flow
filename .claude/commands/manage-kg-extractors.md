---
name: manage-kg-extractors
description: Analyze codebase patterns and generate .workflow/kg/extractors.yaml for custom symbol extraction
argument-hint: "[--scan-only] [--append] [--language <lang>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<purpose>
Analyze current repository's code patterns to auto-generate `.workflow/kg/extractors.yaml` — a declarative config that teaches MaestroGraph's codegraph extractor to recognize project-specific symbols beyond standard function/class/method declarations.

Detects: builder/factory API registrations, domain constant patterns, custom decorator conventions, framework-specific patterns, module-level constants.
</purpose>

<context>
$ARGUMENTS -- optional flags.

**Flags:**
- `--scan-only` — Only report detected patterns, don't write extractors.yaml
- `--append` — Append new rules to existing extractors.yaml (default: overwrite)
- `--language <lang>` — Limit analysis to specific language (python, typescript, java, etc.)

**Analysis targets (per language):**

| Language | Pattern Types |
|----------|--------------|
| Python | `define_*()` builder APIs, ALL_CAPS constants, `Final[...]` annotations, dataclass/pydantic fields |
| TypeScript | const enum, namespace exports, decorator factories, config objects |
| Java | static final constants, @Bean/@Component annotations, builder patterns |
| Go | exported constants (const blocks), interface registrations |
| All | Custom factory/builder call patterns with string-literal first args |

**Output:** `.workflow/kg/extractors.yaml` — declarative rules for PluginEngine.

**Rule format:**
```yaml
version: 1
defaults:
  onError: warn
  conflictPolicy: merge-metadata
plugins:
  - id: <project>.<pattern>
    languages: [<lang>]
    mode: declarative
    declarative:
      rules:
        - id: <rule-id>
          match:
            type: call | assignment | regex
            pattern: "<pattern>"
            nameRegex: "<optional filter>"
            scope: module | class | any
          extract:
            kind: constant | variable | property | field
            decorators: ["<semantic_tag>"]
            metadata:
              semanticKind: "<domain_kind>"
```
</context>

<execution>

### Phase 1: Discover patterns

Spawn **3 parallel agents** to scan the codebase:

| Agent | Focus | Method |
|-------|-------|--------|
| Agent 1 | **Builder/factory calls** | Grep for patterns like `define_*("`, `register_*("`, `add_*("` where first arg is a string literal |
| Agent 2 | **Constants & annotations** | Grep for ALL_CAPS assignments, Final[], static final, const enum, exported const |
| Agent 3 | **Framework patterns** | Detect framework (from package.json/setup.py/go.mod) → grep framework-specific registration patterns |

Each agent returns: `[{pattern_type, regex_evidence, file_count, sample_matches: [{file, line, code}]}]`

### Phase 2: Generate rules

For each discovered pattern with ≥3 occurrences:
1. Determine match type (call/assignment/regex)
2. Build pattern string and optional nameRegex
3. Assign appropriate kind and semanticKind
4. Generate rule entry

### Phase 3: Validate & write

1. Show discovered patterns summary to user
2. AskUserQuestion: confirm/edit/skip each pattern group
3. Write `.workflow/kg/extractors.yaml`
4. Run `maestro kg index` to verify new symbols are extracted

If `--scan-only`: stop after Phase 2 summary.

</execution>

<completion>
### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Verify new symbols | `maestro kg search "<pattern_name>"` |
| Re-index after changes | `maestro kg index` |
| View KG stats | `maestro kg stats` |
| Edit rules manually | Edit `.workflow/kg/extractors.yaml` |
| Add script plugin | Create `.workflow/kg/extractors/<name>.mjs` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/ not initialized | Run maestro-init first |
| W001 | warning | No patterns detected for language | Try broader scan or different language |
| W002 | warning | Pattern has < 3 occurrences | Skipped by default, include with --min-count 1 |
| W003 | warning | Existing extractors.yaml will be overwritten | Use --append to preserve |
</error_codes>

<success_criteria>
- [ ] At least 1 pattern detected in the codebase
- [ ] extractors.yaml generated with valid rules
- [ ] Each rule has match.type, match.pattern, extract.kind
- [ ] Re-index succeeds with new extractors.yaml active
- [ ] New symbols searchable via `maestro kg search`
</success_criteria>

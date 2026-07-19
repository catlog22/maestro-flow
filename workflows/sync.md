<!-- session-mode: inherited -->

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Workflow: sync

Change detection, impact chain traversal, and codebase doc synchronization. Auto-triggered after execute, or manual via `/workflow:sync`.

## Arguments

| Arg | Description | Default |
|-----|-------------|---------|
| `--full` | Complete resync of all tracked files (ignores git diff, rebuilds all docs) | `false` |
| `--since <ref>` | Git ref for diff baseline (commit hash, `HEAD~N`, branch) | `HEAD~1` |
| `--dry-run` | Show impact analysis without writing changes | `false` |

---

## Workflow Steps

### Step 1: Parse Input and Validate

```
Parse flags: --full (resync all), --since <ref> (diff baseline), --dry-run (preview)
Default: incremental sync since last tracked sync point
Require .workflow/ exists → else abort E001
```

### Step 2: Detect Changed Files

```
--full → collect all files from doc-index.json code_locations
else  → git diff --name-only <since-ref|HEAD~1|--cached>
No files changed → emit W001, exit
```

### Step 3: Load Doc Index

```
Read .workflow/codebase/doc-index.json
Extract: components[], features[], requirements[], architecture_decisions[]

If missing: prompt → (a) MUST run /maestro-manage sync rebuild then re-run
             or    → (b) DEGRADED_MODE: git-diff-only, skip Steps 3-5; flag sync as [LOW CONFIDENCE] (git-diff-only, Steps 3-5 skipped)
```

### Step 4: Impact Chain Traversal

For each `changed_file` in `changed_files[]`:

```
Traverse impact chain: file → components (via code_locations match)
  → features (via component.feature_ids) → requirements (via feature.requirement_ids)
Aggregate deduplicated: { files, components, features, requirements }
```

GATE Step 4→5: impact_chain non-empty BEFORE update index; BLOCKED if impact_chain empty (no affected components/features/requirements identified)

### Step 5: Update Doc Index (skip if --dry-run)

```
Affected components → refresh last_updated, re-scan code_locations for symbols[]
Affected features   → refresh last_updated, update status
Write updated doc-index.json
```

### Step 6: Regenerate Affected Docs (skip if --dry-run)

```
Components → regenerate .workflow/codebase/tech-registry/{component-slug}.md
Features   → regenerate .workflow/codebase/feature-maps/{feature-slug}.md
```

### Step 7: Update State and Specs (skip if --dry-run)

```
state.json → last_sync timestamp, change summary
index.json → update affected phase indexes
Dependency manifests changed + project.md exists → refresh Tech Stack section
```

### Step 8: Create Action Log

```
Write .workflow/codebase/action-logs/{hash}.md:
  date, baseline, files changed, affected components/features/requirements, impact counts
```

### Step 9: Report

```
Display: changed files, affected components/features/requirements, specs updated, action log path
```

---

## Error Handling

| Code | Meaning |
|------|---------|
| E001 | .workflow/ not initialized — suggest `/maestro-init` first |
| W001 | No changes detected since last sync — report clean state, skip updates |

| Error | Action |
|-------|--------|
| .workflow/ missing | Fail with E001 |
| doc-index.json missing | Suggest `/workflow:codebase rebuild` |
| No git repo | Fail with message: "Git repository required for sync" |
| Changed file not in any component | Log as "untracked file" in action log (no impact chain) |
| doc-index.json parse error | Fail with error details |

## Output Files

| File | Action |
|------|--------|
| `.workflow/codebase/doc-index.json` | Updated (timestamps, symbols) |
| `.workflow/codebase/tech-registry/{slug}.md` | Regenerated for affected components |
| `.workflow/codebase/feature-maps/{slug}.md` | Regenerated for affected features |
| `.workflow/codebase/action-logs/{hash}.md` | Created |
| `.workflow/project.md` | Tech Stack section updated if dependency manifests changed |

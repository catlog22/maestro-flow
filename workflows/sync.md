# Workflow: sync

Change detection, impact chain traversal, and codebase documentation synchronization.

## Trigger

- Auto-triggered after `/workflow:execute` completes
- Manual via `/workflow:sync [--since <ref>] [--dry-run]`

## Arguments

| Arg | Description | Default |
|-----|-------------|---------|
| `--full` | Complete resync of all tracked files (ignores git diff, rebuilds all docs) | `false` |
| `--since <ref>` | Git ref for diff baseline (commit hash, `HEAD~N`, branch) | `HEAD~1` |
| `--dry-run` | Show impact analysis without writing changes | `false` |

## Prerequisites

- `.workflow/codebase/doc-index.json` must exist (run `/workflow:codebase rebuild` first if missing)
- Git repository initialized with at least one commit

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
```

### Step 4: Impact Chain Traversal

For each `changed_file` in `changed_files[]`:

```
Traverse impact chain: file → components (via code_locations match)
  → features (via component.feature_ids) → requirements (via feature.requirement_ids)
Aggregate deduplicated: { files, components, features, requirements }
```

### Step 5: Update Doc Index (skip if --dry-run)

```
Affected components → refresh last_updated, re-scan code_locations for exported symbols[]
Affected features   → refresh last_updated, update status from component changes
Write updated doc-index.json
```

### Step 6: Regenerate Affected Docs (skip if --dry-run)

```
Affected components → regenerate .workflow/codebase/tech-registry/{component-slug}.md
  Template: name, id, type, code_locations, feature_ids, symbols list, timestamp

Affected features → regenerate .workflow/codebase/feature-maps/{feature-slug}.md
  Template: name, id, status, phase, component_ids, requirement_ids, component details, timestamp
```

### Step 7: Update State and Specs (skip if --dry-run)

```
state.json → set last_sync timestamp, record change summary, update last_updated
index.json → update affected phase indexes

Spec updates: if patterns/conventions changed → append learnings to relevant spec files

Dependency manifest check (package.json, go.mod, pyproject.toml, Cargo.toml,
  requirements.txt, pom.xml, build.gradle, Gemfile):
  If any changed AND .workflow/project.md exists → refresh Tech Stack section
```

### Step 8: Create Action Log

```
hash = git rev-parse --short HEAD (or since-ref)
Write .workflow/codebase/action-logs/{hash}.md:
  Sections: date, baseline, files changed, components/features/requirements affected, impact counts
```

### Step 9: Report

```
Display: changed files count, affected components/features/requirements (with IDs),
  specs updated, action log path. Note if --dry-run (no writes).
```

---

## Error Handling

| Code | Meaning |
|------|---------|
| E001 | .workflow/ not initialized — suggest running Skill({ skill: "maestro-init" }) first |
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

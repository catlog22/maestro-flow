---
name: maestro-update
description: Detect version, preview changes, apply workflow upgrades
argument-hint: "[--dry-run] [--force]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Detect the current `.workflow/` schema version, show available migrations, and interactively apply them step-by-step. Uses a migration registry that supports incremental version upgrades (e.g., 1.0 → 2.0 → 3.0).

Each migration step is previewed before execution. The user confirms each step in a loop.
</purpose>

<context>
$ARGUMENTS — optional flags.

**Flags:**
- `--dry-run` -- Preview migration plan without executing
- `--force` -- Skip confirmation prompts (apply all pending migrations)

**Migration registry:** `src/migrations/`
- Each migration is a standalone file (e.g., `v1-to-v2.ts`) exporting a `MigrationDef`
- All migrations are registered via `src/migrations/index.ts`
- Registry auto-chains: detects current version → walks chain → applies in order
- To add a new migration: create `src/migrations/v{N}-to-v{N+1}.ts`, register in `index.ts`

**CLI runner:** `src/migrations/run.ts`
- Executable entrypoint: `npx tsx src/migrations/run.ts [root] [--dry-run] [--force] [--json]`
- Outputs JSON (with `--json`) or human-readable text

**State version source:** `.workflow/state.json` → `version` field
</context>

<execution>

### Step 1: Detect Current State

```
1. Read .workflow/state.json
2. Extract version field (default "1.0" if missing)
3. Display:

   === Maestro Workflow Update ===
   Project:  {project_name}
   Version:  {version}
   Location: {.workflow/ path}
```

### Step 2: Dry-Run Preview

Run the migration CLI in dry-run + JSON mode to get the full plan:

```bash
npx tsx src/migrations/run.ts "$(pwd)" --dry-run --json
```

Parse the JSON output. If status is `up-to-date`:
```
Already up to date (v{version})
```
→ EXIT

Otherwise display the migration plan:
```
Pending Migrations ({N} step(s)):

  1. [v{from} → v{to}] {name}
     {description}

  2. [v{from} → v{to}] {name}
     {description}
```

If `--dry-run` flag was passed by user → display plan and EXIT.

### Step 3: Interactive Confirmation Loop

For each migration step (unless `--force`):

```
LOOP for step_index = 1 to N:

  Display:
    --- Step {step_index}/{N}: {name} ---
    Version: v{from} → v{to}

    Changes:
      {description, indented}

  IF NOT --force:
    AskUserQuestion: "Apply this migration?"
    Options: [yes / skip / abort]

    - "yes"   → proceed to Step 4 (execute)
    - "skip"  → WARN "Skipping may break the migration chain"
                 continue to next step
    - "abort" → display summary of what was applied so far → EXIT

  IF --force:
    → proceed to Step 4 (execute)
```

### Step 4: Execute Single Migration

```
1. Create backup:
   Bash: cp .workflow/state.json .workflow/state.json.backup-v{from}-{timestamp}

2. Run migration:
   Bash: npx tsx src/migrations/run.ts "$(pwd)" --json
   
   NOTE: The runner executes ALL pending migrations. For step-by-step control,
   read state.json, call the migration function directly, or use the runner
   which stops on first failure.

3. Parse result JSON and display:

   {status_icon} Step {N} completed: {name}
   Summary: {summary}
   Changes:
     - {change_1}
     - {change_2}
     - ...

4. If failed:
   Display: "Migration failed: {summary}"
   Display: "Backup available at: {backup_path}"
   Display: "Restore with: cp {backup_path} .workflow/state.json"
   → EXIT

5. Continue loop to next step
```

### Step 5: Summary

After all steps completed (or user aborted):

```
=== Migration Complete ===
Applied: {applied_count} / {total_count} migration(s)
Skipped: {skipped_count}
Version: v{original} → v{final}
Backup:  .workflow/state.json.backup-v{original}-{timestamp}

Next steps:
  /manage-status  -- Verify project state
  /maestro        -- Continue workflow
```

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | .workflow/state.json not found | Run /maestro-init first |
| E002 | error | state.json parse error | Check file for corruption |
| E003 | error | Migration function failed | Restore from backup |
| W001 | warning | Skipped migration may break version chain | Re-run /maestro-update later |
| W002 | warning | tsx not available | Install tsx: npm i -D tsx |
</error_codes>

<success_criteria>
- [ ] Current version detected from state.json
- [ ] Dry-run preview shows full migration plan without execution
- [ ] Each step confirmed interactively (unless --force)
- [ ] Backup created before each migration
- [ ] Migration executed and result displayed with change list
- [ ] Abort stops cleanly with partial summary
- [ ] Summary shows applied/skipped counts and version change
</success_criteria>

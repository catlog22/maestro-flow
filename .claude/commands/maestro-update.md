---
name: maestro-update
description: Detect version, preview changes, apply workflow upgrades
argument-hint: "[--dry-run] [--force] [--setup-only]"
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
Detect current version, run schema migration to latest, then follow the version-specific upgrade workflow.
Schema (`src/migrations/`) handles transforms; workflow docs (`~/.maestro/workflows/updates/`) handle setup.
</purpose>

<context>
$ARGUMENTS — optional flags.

**Flags:**
- `--dry-run` -- Preview migration plan without executing
- `--force` -- Skip confirmation prompts (intended for CI/automated contexts). Migration diff is still displayed even with `--force` to maintain audit visibility.
- `--setup-only` -- Skip schema migration, run only the setup for current version

**Version source:** `.workflow/state.json` → `version` field

**Workflow docs:** `~/.maestro/workflows/updates/`
- `update-v{TO}-setup.md` — post-migration setup for version {TO}

**Schema registry:** `src/migrations/` — handles all intermediate version bumps automatically

**Output boundary**: ALL file writes MUST target `.workflow/state.json` (version bump), `.workflow/state.json.backup-*` (backup), and `.workflow/` config files touched by version-specific setup. NEVER modify source code or `src/migrations/` files.
</context>

<invariants>
1. **Backup before migration** — a timestamped backup of `.workflow/state.json` MUST be created before any schema migration runs; NEVER execute migration without backup
2. **Idempotent** — running update when already on latest version MUST be a no-op (display "up to date"); NEVER re-apply migrations
3. **Confirmation before execute** — migration diff MUST be displayed and user MUST confirm via AskUserQuestion before execution (unless `--force`); NEVER silently apply schema changes
4. **Migration diff always visible** — even with `--force`, the migration diff MUST be displayed for audit visibility; NEVER skip diff display
5. **Restore path on failure** — if migration fails, the backup restore command MUST be displayed; NEVER leave user without recovery instructions
6. **Sequential migration** — all intermediate version steps MUST be applied in order by the schema registry; NEVER skip intermediate versions
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Detect → Check**
- REQUIRED: Current version read from `.workflow/state.json`.
- BLOCKED if: state.json missing or unreadable (E001).

**GATE 2: Check → Execute**
- REQUIRED: Dry-run migration check completed; target version identified.
- REQUIRED: User confirmation via AskUserQuestion (unless `--force`).
- BLOCKED if: already up to date (display message and exit) or user cancels.

**GATE 3: Execute → Summary**
- REQUIRED: Backup created at `.workflow/state.json.backup-v{current}-{timestamp}`.
- REQUIRED: Schema migration completed successfully.
- REQUIRED: Version-specific setup doc followed (if exists).
- BLOCKED if: migration failed — display restore command and exit.

### Step 1: Detect Version

```
1. Read .workflow/state.json → extract version (default "1.0" if missing)
2. Display:
   === Maestro Update ===
   Current version: v{version}
```

IF `--setup-only`:
  → Glob: ~/.maestro/workflows/updates/update-v{version}-setup.md
  → IF exists: follow that document completely, then EXIT
  → IF not exists: display "No setup script for v{version}" → EXIT

### Step 2: Check for Updates

```
1. Run: npx tsx src/migrations/run.ts "$(pwd)" --dry-run --json
2. Parse JSON output
3. IF status = "up-to-date":
     Display "Already up to date (v{version})"
     → Glob: ~/.maestro/workflows/updates/update-v{version}-setup.md
     → IF exists: AskUserQuestion "Run setup for v{version}?" → load and follow
     → EXIT

4. Display target:
   Update available: v{current} → v{target}
   Schema migrations: {N} step(s) (handled automatically)
```

IF `--dry-run` → display info and EXIT.

### Step 3: Execute

```
1. Display migration diff (always — even with --force):
   Show schema changes that will be applied.

2. Confirm (unless --force):
   AskUserQuestion: "Upgrade v{current} → v{target}?"
   Options: [执行 / 取消]

3. Create backup:
   Bash: cp .workflow/state.json .workflow/state.json.backup-v{current}-{timestamp}

4. Run schema migration (handles all intermediate steps automatically):
   Bash: npx tsx src/migrations/run.ts "$(pwd)" --json
   Parse result, display changes.

5. IF failed → display backup restore command → EXIT

6. Load version-specific setup:
   Read: ~/.maestro/workflows/updates/update-v{target}-setup.md
   IF exists → follow completely (hooks, deps, knowledge system config)

7. Display: "v{current} → v{target}: done"
```

### Step 4: Summary

```
=== Update Complete ===
Version: v{current} → v{target}
Backup:  .workflow/state.json.backup-v{current}-{timestamp}

Next steps:
  /manage-status  -- Verify project state
  /maestro        -- Continue workflow
```

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/state.json` not found or unreadable | Run `/maestro-init` first |
| E002 | error | Schema migration failed (npx tsx returned error) | Display backup restore command: `cp .workflow/state.json.backup-* .workflow/state.json` |
| E003 | error | Version-specific setup doc failed to execute | Manual setup: read `~/.maestro/workflows/updates/update-v{target}-setup.md` |
| W001 | warning | No version-specific setup doc found for target version | Proceed without setup; schema migration alone is sufficient |
| W002 | warning | `--setup-only` but no setup script exists for current version | Display message and exit |
</error_codes>

<success_criteria>
- [ ] Current version detected from state.json
- [ ] Schema migrations run automatically (no manual intermediate steps)
- [ ] Backup created before migration
- [ ] Version-specific setup doc loaded and followed (if exists)
- [ ] --setup-only runs only setup for current version
- [ ] --dry-run previews without executing
- [ ] Summary shows version change and backup path
</success_criteria>

<completion>
### Next-step routing
| Condition | Suggestion |
|-----------|-----------|
| Update complete | `/manage-status` to verify project state |
| Want to continue workflow | `/maestro` |
</completion>

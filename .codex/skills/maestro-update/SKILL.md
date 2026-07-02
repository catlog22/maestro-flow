---
name: maestro-update
description: Detect version, preview changes, apply workflow upgrades
argument-hint: "[--dry-run] [--force] [--setup-only]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
---
<purpose>
Version router — detect current version, run schema migration to latest, then follow the version-specific smart upgrade workflow.

Migration scripts live in two layers:
- **Schema** (`src/migrations/`): code-level state.json transforms, auto-chained by registry
- **Workflow** (`~/.maestro/workflows/updates/`): version-specific upgrade guides with environment setup

Schema migrations handle the mechanical version bump. Workflow docs handle the smart part — what the user needs to know, configure, or verify for that version. The router runs schema first, then loads the matching workflow doc.
</purpose>

<required_reading>
@~/.maestro/workflows/updates/README.md
</required_reading>

<context>
$ARGUMENTS — optional flags.

**Flags:**
- `--dry-run` -- Preview migration plan without executing
- `--force` -- Skip confirmation prompts
- `--setup-only` -- Skip schema migration, run only the setup for current version

**Version source:** `.workflow/state.json` → `version` field

**Output boundary**: ALL file writes MUST target `.workflow/state.json` (version bump), `.workflow/state.json.backup-*` (backup), and `.workflow/` config files touched by version-specific setup. NEVER modify source code or `src/migrations/` files.
</context>

<invariants>
1. **Backup before migration** — a timestamped backup of `.workflow/state.json` MUST be created before any schema migration runs; NEVER execute migration without backup
2. **Idempotent** — running update when already on latest version MUST be a no-op (display "up to date"); NEVER re-apply migrations
3. **Confirmation before execute** — migration diff MUST be displayed and user MUST confirm via request_user_input before execution (unless `--force`); NEVER silently apply schema changes
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
- REQUIRED: User confirmation via request_user_input (unless `--force`).
- BLOCKED if: already up to date (display message and exit) or user cancels.

**GATE 3: Execute → Summary**
- REQUIRED: Backup created at `.workflow/state.json.backup-v{current}-{timestamp}`.
- REQUIRED: Schema migration completed successfully.
- REQUIRED: Version-specific setup doc followed (if exists).
- BLOCKED if: migration failed — display restore command and exit.

### Step 1: Detect Version

```
1. Read .workflow/state.json → extract version (default "1.0" if missing)
2. Display current version
```

IF `--setup-only`:
  → Load `~/.maestro/workflows/updates/update-v{version}-setup.md`
  → IF exists: follow completely, then EXIT
  → IF not exists: display "No setup script for v{version}" → EXIT

### Step 2: Check for Updates

```
1. Run: npx tsx src/migrations/run.ts "$(pwd)" --dry-run --json
2. IF up-to-date → offer setup if available → EXIT
3. Display target version
```

IF `--dry-run` → EXIT.

### Step 3: Execute

```
1. Confirm (unless --force)
2. Backup state.json
3. Run schema migration (auto-chains all intermediate steps)
4. Load update-v{target}-setup.md → follow completely
```

### Step 4: Summary

Display version change, backup path, next steps.

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/state.json` missing or unreadable | Run `$maestro-init` first |
| E002 | error | Migration script execution failed | Display backup restore command |
| E003 | error | Version-specific setup doc not found | Skip setup, display manual steps |
| W001 | warning | Already up to date | No action needed |
| W002 | warning | Setup doc unavailable for target version | Continue without setup |
</error_codes>

<success_criteria>
- [ ] Version detected, schema migration run, setup doc followed
- [ ] --setup-only, --dry-run, --force flags handled
</success_criteria>

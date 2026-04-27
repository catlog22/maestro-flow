---
name: spec-remove
description: Remove a spec entry from a specs file by entry ID using maestro wiki remove-entry
argument-hint: "<entry-id>"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

<purpose>
Remove a `<spec-entry>` block from a specs container file. Symmetric with `spec-add`.
Uses `maestro wiki remove-entry` for atomic removal with automatic index update.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-remove.md
</required_reading>

<context>
$ARGUMENTS — entry ID to remove (e.g., `spec-learnings-003`)

**Entry ID format**: `spec-{file-stem}-{NNN}` — sub-node ID from WikiIndexer atomic indexing.

**Discovery**:
- `maestro wiki list --type spec --json` — list all spec entries
- `/spec-load --keyword <term>` — find by keyword
- `maestro wiki search "<query>"` — BM25 search
</context>

<execution>

### Step 1: Parse Input

Extract entry ID from arguments.
- Validate non-empty (E001 if missing)
- Validate `.workflow/specs/` exists (E002 if not)

### Step 2: Lookup Entry

Run `maestro wiki get <entry-id> --json`. Validate: entry exists (E003), is spec sub-node with `type="spec"` and `parent` set (E004). Extract title, category, keywords, container path.

### Step 3: Confirm

Display entry details. Ask user to confirm unless `-y` flag present.

### Step 4: Remove

Run `maestro wiki remove-entry <entry-id>`. WikiIndexer auto-updates `wiki-index.json`.

### Step 5: Verify & Report

Confirm removal via `maestro wiki get <entry-id>` (should return not-found). Display removed ID, source file, and commands for verify/re-add.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Entry ID is required -- usage: `/spec-remove <entry-id>` |
| E002 | fatal | `.workflow/specs/` not initialized -- run `/spec-setup` first |
| E003 | fatal | Entry ID not found in wiki index |
| E004 | fatal | Entry is not a spec sub-node (wrong type or no parent) |
</error_codes>

<success_criteria>
- [ ] Entry ID parsed and validated
- [ ] Entry found in wiki index (type=spec, has parent)
- [ ] User confirmed removal
- [ ] Entry removed via `maestro wiki remove-entry`
- [ ] Wiki index auto-updated
- [ ] Confirmation displayed
</success_criteria>

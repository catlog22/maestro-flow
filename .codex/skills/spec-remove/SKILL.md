---
name: spec-remove
description: Remove spec entry by ID
argument-hint: <entry-id> [--cascade] [-y]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, request_user_input
session-mode: none
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
- `maestro search --type spec --json` — list all spec entries
- `$spec-load --keyword <term>` — find by keyword
- `maestro search "<query>"` — BM25 search

**Flags:**
- `--cascade` — When the target spec has a `ref` attribute linking to a knowhow document, also delete the referenced knowhow file. Without this flag, removal leaves an orphan knowhow file. Cascade checks the entry's `ref` attribute in the `<spec-entry>` tag.
- `-y` — Skip confirmation prompt and proceed with removal immediately.

**Output boundary**: File modifications MUST target ONLY the spec container file (.workflow/specs/*.md) and optionally the referenced knowhow file (.workflow/knowhow/*) when --cascade is used. NEVER modify source code or files outside these paths.
</context>

<invariants>
1. **Confirmation required** — MUST request_user_input before deletion (unless -y flag); NEVER remove entries silently
2. **Referential integrity** — before removing, check if other spec entries reference the target entry; warn user if references exist
3. **Cascade explicit** — ref-type entries MUST NOT cascade-delete the linked knowhow file unless --cascade is explicitly passed; default leaves orphan knowhow intact
4. **Atomic removal** — use `maestro wiki remove-entry` for atomic operation; NEVER manually edit spec files to remove entries
5. **Index consistency** — wiki index MUST be auto-updated after removal; stale index entries are a hard failure
6. **Output boundary** — file modifications MUST target ONLY the spec container file (.workflow/specs/*.md) and optionally the referenced knowhow file (.workflow/knowhow/*) when --cascade is used. NEVER modify source code or files outside these paths
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Lookup**
- REQUIRED: Entry ID parsed from arguments.
- BLOCKED if: E001 — no entry ID provided.

**GATE 2: Lookup → Confirm**
- REQUIRED: `.workflow/specs/` directory exists.
- REQUIRED: Entry found in wiki index as a spec sub-node.
- REQUIRED: Entry content loaded for user preview.
- BLOCKED if: E002 (specs not initialized), E003 (entry not found), E004 (wrong type).

**GATE 3: Confirm → Remove**
- REQUIRED: User confirmed removal via request_user_input (unless -y flag).
- REQUIRED: If --cascade and entry has ref attribute, user additionally confirmed knowhow file deletion.
- BLOCKED if: user declines — abort without modification.

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

If `--cascade` is set and the entry has a `ref` attribute pointing to a knowhow file, also delete that file to avoid leaving an orphan.

### Step 5: Verify & Report

Confirm removal via `maestro wiki get <entry-id>` (should return not-found). Display removed ID, source file, and commands for verify/re-add.
</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | Entry ID is required -- usage: `$spec-remove <entry-id>` |
| E002 | fatal | `.workflow/specs/` not initialized -- run `$spec-setup` first |
| E003 | fatal | Entry ID not found in wiki index |
| E004 | fatal | Entry is not a spec sub-node (wrong type or no parent) |
</error_codes>

<success_criteria>
- [ ] Entry ID parsed and validated
- [ ] Entry found in wiki index (type=spec, has parent)
- [ ] User confirmed removal
- [ ] Entry removed via `maestro wiki remove-entry`
- [ ] Wiki index auto-updated
- [ ] If `--cascade` and entry has a `ref` attribute: referenced knowhow file deleted, orphan avoided
- [ ] Confirmation displayed (and cascaded knowhow path if applicable)
</success_criteria>

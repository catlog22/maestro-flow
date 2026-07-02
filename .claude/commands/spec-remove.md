---
name: spec-remove
description: Remove spec entry by ID
argument-hint: "<entry-id> [--cascade] [-y]"
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
Remove a `<spec-entry>` from a specs file. Symmetric with `/spec-add`.
Uses `maestro wiki remove-entry` for atomic removal with index auto-update.
</purpose>

<required_reading>
@~/.maestro/workflows/specs-remove.md
</required_reading>

<context>
$ARGUMENTS -- expects `<entry-id>` (e.g., `spec-learnings-003`, `spec-coding-conventions-001`)

**Entry ID format**: `spec-{file-stem}-{NNN}` — the sub-node ID assigned by WikiIndexer when indexing `<spec-entry>` blocks.

**Discovery**: Use `maestro wiki list --type spec --json` or `/spec-load --keyword <term>` to find entry IDs.

**Flags:**
- `--cascade` — When the target spec is a ref-type entry (created via `spec-add --ref` and linked to a knowhow document), also delete the referenced knowhow file. Without this flag, ref-type removal leaves an orphan knowhow file.
</context>

<invariants>
1. **Confirmation required** — MUST AskUserQuestion before deletion (unless -y flag); NEVER remove entries silently
2. **Referential integrity** — before removing, check if other spec entries reference the target entry; warn user if references exist
3. **Cascade explicit** — ref-type entries MUST NOT cascade-delete the linked knowhow file unless --cascade is explicitly passed; default leaves orphan knowhow intact
4. **Atomic removal** — use `maestro wiki remove-entry` for atomic operation; NEVER manually edit spec files to remove entries
5. **Index consistency** — wiki index MUST be auto-updated after removal; stale index entries are a hard failure
6. **Output boundary** — file modifications MUST target ONLY the spec container file (.workflow/specs/*.md) and optionally the referenced knowhow file (.workflow/knowhow/*) when --cascade is used. NEVER modify source code or files outside these paths
</invariants>

<execution>
Follow '~/.maestro/workflows/specs-remove.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Parse → Lookup**
- REQUIRED: Entry ID parsed from arguments.
- BLOCKED if: E001 — no entry ID provided.

**GATE 2: Lookup → Confirm**
- REQUIRED: .workflow/specs/ directory exists.
- REQUIRED: Entry found in wiki index as a spec sub-node.
- REQUIRED: Entry content loaded for user preview.
- BLOCKED if: E002 (specs not initialized), E003 (entry not found), E004 (wrong type).

**GATE 3: Confirm → Remove**
- REQUIRED: User confirmed removal via AskUserQuestion (unless -y flag).
- REQUIRED: If --cascade and entry has ref attribute, user additionally confirmed knowhow file deletion.
- BLOCKED if: user declines — abort without modification.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | fatal | Entry ID is required -- usage: `/spec-remove <entry-id>` | parse_input |
| E002 | fatal | `.workflow/specs/` not initialized -- run `/spec-setup` first | validate |
| E003 | fatal | Entry ID not found in wiki index | lookup |
| E004 | fatal | Entry is not a spec sub-node (wrong type) | validate |
</error_codes>

<success_criteria>
- [ ] Entry ID parsed and validated
- [ ] Entry found in wiki index (type=spec, is sub-node)
- [ ] User confirmed removal (unless -y flag)
- [ ] Entry removed from container file via `maestro wiki remove-entry`
- [ ] Wiki index auto-updated
- [ ] If `--cascade` and entry has a `ref` attribute: referenced knowhow file deleted, orphan avoided
- [ ] Confirmation displayed with removed entry details (and cascaded knowhow path if applicable)
</success_criteria>

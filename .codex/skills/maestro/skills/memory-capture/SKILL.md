---
name: maestro-memory-capture
description: Capture session memory (compact or tip) into .workflow/memory/ with JSON index
argument-hint: "[compact|tip] [description] [--tag tag1,tag2]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# Memory Capture

## Usage

```bash
$maestro-memory-capture
$maestro-memory-capture "compact"
$maestro-memory-capture "tip Always check state.json before phase operations --tag workflow,state"
$maestro-memory-capture "compact Full auth implementation session"
```

**Modes**: `compact` (full session compression) or `tip` (quick note with tags).
No arguments: auto-detect or ask user.

---

## Implementation

### Step 1: Validate

```bash
test -d .workflow || exit 1  # E001: not initialized
```

Create `.workflow/memory/` if it does not exist.

### Step 2: Detect Mode

Parse first token as mode (`compact` or `tip`).
If absent or ambiguous, ask user via AskUserQuestion.

### Step 3: Capture Content

**Compact mode**:
1. Analyze current conversation for: objective, key decisions, modified files, current plan state, pending work
2. Generate entry ID: `MEM-{YYYYMMDD}-{NNN}`
3. Write `.workflow/memory/MEM-{id}.md` with sections:
   - Objective, Key Decisions, Files Modified (absolute paths), Execution Plan (verbatim), Pending Work, Context Notes

**Tip mode**:
1. Extract content (everything after `tip`) and parse `--tag` flag
2. Generate entry ID: `TIP-{YYYYMMDD}-{NNN}`
3. Write `.workflow/memory/TIP-{id}.md` with: content, tags, timestamp, context

### Step 4: Update Index

Read or create `.workflow/memory/memory-index.json`.
Append new entry metadata:

```json
{
  "id": "{entry_id}",
  "type": "compact|tip",
  "date": "{ISO}",
  "title": "{short title}",
  "tags": ["tag1", "tag2"],
  "file": "{filename}"
}
```

### Step 5: Confirm

```
=== MEMORY CAPTURED ===
ID: {entry_id}
Type: {compact|tip}
File: .workflow/memory/{filename}
```

---

## Error Handling

| Code | Severity | Description |
|------|----------|-------------|
| E001 | error | `.workflow/` not initialized -- run `Skill({ skill: "maestro-init" })` first |
| E002 | error | Empty note content in tip mode |
| W001 | warning | No active workflow session -- compact captures conversation only |
| W002 | warning | No explicit plan found -- using inferred plan |

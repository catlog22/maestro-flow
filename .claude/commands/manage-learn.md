---
name: manage-learn
description: Capture, search, and review atomic learning insights and tips into .workflow/learning/lessons.jsonl
argument-hint: "[<text>|tip <text>|list|search|show <id>] [--category ...] [--tag t1,t2] [--phase N] [--confidence ...]"
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
Unified atomic knowledge capture for the workflow learning library. Captures two types of knowledge:
- **Insights**: Timeless "eureka moment" entries (patterns, gotchas, techniques) — the default mode
- **Tips**: Quick contextual notes for cross-session recovery (formerly in `manage-knowhow-capture tip`)

Both types are stored in `.workflow/learning/lessons.jsonl` with auto-detected phase linkage and keyword-based category inference. Tips are distinguished by `source: "tip"` and implicitly tagged `tip`. Same store as retrospective output, so search and list see the entire knowledge corpus.
</purpose>

<required_reading>
@~/.maestro/workflows/learn.md
</required_reading>

<context>
Arguments: $ARGUMENTS

**Modes (auto-detected from first token):**
- `"<insight text>"` (or any non-keyword text) → insight capture mode
- `tip <text>` → tip capture mode (quick contextual note, auto-tagged `tip`)
- `list` → list recent entries (default 20)
- `search <query>` → text search across lessons.jsonl
- `show <INS-id>` → full detail with phase context
- empty → AskUserQuestion to prompt for text

Flags, storage paths, and shared store rationale defined in workflow learn.md.
</context>

<execution>
Follow `~/.maestro/workflows/learn.md` Stages 1–5 in order.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `/maestro-init` first | parse_input |
| E002 | error | Unknown `--category` value (allowed: pattern, antipattern, decision, tool, gotcha, technique, tip) | parse_input |
| E003 | error | `show` mode requires an INS-id argument | show |
| E004 | error | Insight id not found in lessons.jsonl | show |
| W001 | warning | Auto-phase detection found a current_phase but no matching artifact in registry; phase set to null | capture |
| W002 | warning | learning-index.json out of sync with lessons.jsonl (different row count); offer to rebuild | list/search |
</error_codes>

<success_criteria>
- [ ] Mode correctly routed (capture / list / search / show)
- [ ] Capture: `lessons.jsonl` row appended with valid JSON and all required fields
- [ ] Capture: `learning-index.json` updated with matching entry
- [ ] Capture: phase auto-link resolves correctly via artifact registry when `state.json` has `current_phase`
- [ ] Capture: category inference produces a sensible default when `--category` absent
- [ ] List: filters apply, output sorted newest-first, default limit 20
- [ ] Search: results ranked by title (3) > tags (2) > summary (1) match
- [ ] Show: full insight displayed with phase context and routed-artifact link if any
- [ ] No file modifications outside `.workflow/learning/`
- [ ] Confirmation banner displayed with INS-id and next-step hints
- [ ] Next step: `/manage-learn list` to browse, or `/manage-learn search <query>` to find related insights
</success_criteria>

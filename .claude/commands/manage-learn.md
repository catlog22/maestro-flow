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
- **Tips**: Quick contextual notes for cross-session recovery (formerly in `manage-memory-capture tip`)

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

**Capture flags (both insight and tip modes):**
- `--category <name>` — pattern | antipattern | decision | tool | gotcha | technique | tip. Default: inferred from text via keyword heuristics. Tip mode defaults to `tip`.
- `--tag t1,t2` — comma-separated tags. Insight mode implicitly adds `manual`, tip mode implicitly adds `tip`.
- `--phase <N>` — override auto-detected current phase. Use `--phase 0` to force "no phase".
- `--confidence <level>` — high | medium | low. Default: medium (insight), low (tip).

**List/search flags:**
- `--tag t1,t2` — filter by tag
- `--category <name>` — filter by category
- `--phase <N>` — filter by phase
- `--lens <name>` — filter by retrospective lens (technical | process | quality | decision | git). Note: `git` matches `source: "retro-git"` from learn-retro; others match `lens` field from quality-retrospective.
- `--limit <N>` — list mode row limit (default 20)

**Storage:**
- `.workflow/learning/lessons.jsonl` — append-only JSONL row per insight (shared with `quality-retrospective` output)
- `.workflow/learning/learning-index.json` — searchable index (mirrors `memory-index.json` schema)

**Shared store rationale:** Manual captures (`source: "manual"`), tips (`source: "tip"`), retrospective-distilled insights (`source: "retrospective"`, `lens: <name>` from `quality-retrospective`), and learn-retro insights (`source: "retro-git"` or `source: "retro-decision"` from `learn-retro`) all live in the same store so search and list see the entire knowledge corpus. The `source` field disambiguates origin.
</context>

<execution>
Follow `~/.maestro/workflows/learn.md` Stages 1–5 in order. Key invariants:

1. **No agent or CLI calls** — this is a pure file operation: parse → infer → append → confirm. Category inference is keyword-based, not LLM-based.
2. **Auto-link phase** — read `.workflow/state.json` for `current_phase` and resolve the matching directory slug. `--phase 0` forces no link.
3. **Match memory-index pattern** — `learning-index.json` schema mirrors `memory-index.json` from `workflows/memory.md` (entries[] with id, type, timestamp, file, summary, tags, plus learn-specific fields: lens, category, phase, phase_slug, confidence, routed_to, routed_id).
4. **Stable INS ids** — `INS-{8 lowercase hex}` from `hash(insight_text + category + phase)`. Deterministic: same content in same context always produces the same ID.
5. **Append-only lessons.jsonl** — never rewrite existing rows; duplicate detection is the user's job at search time.
6. **Bootstrap on demand** — create `.workflow/learning/`, `lessons.jsonl`, `learning-index.json` on first use; do not require them to exist upfront.
7. **Tip mode** — when first token is `tip`, set `source: "tip"`, `category: "tip"`, `confidence: "low"`, and implicitly add `tip` tag. Everything else follows the same pipeline as insight capture. This replaces the former `manage-memory-capture tip` mode.
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | `.workflow/` not initialized — run `Skill({ skill: "maestro-init" })` first | parse_input |
| E002 | error | Unknown `--category` value (allowed: pattern, antipattern, decision, tool, gotcha, technique, tip) | parse_input |
| E003 | error | `show` mode requires an INS-id argument | show |
| E004 | error | Insight id not found in lessons.jsonl | show |
| W001 | warning | Auto-phase detection found a current_phase but no matching directory; phase set to null | capture |
| W002 | warning | learning-index.json out of sync with lessons.jsonl (different row count); offer to rebuild | list/search |
</error_codes>

<success_criteria>
- [ ] Mode correctly routed (capture / list / search / show)
- [ ] Capture: `lessons.jsonl` row appended with valid JSON and all required fields
- [ ] Capture: `learning-index.json` updated with matching entry
- [ ] Capture: phase auto-link resolves correctly when `state.json` has `current_phase`
- [ ] Capture: category inference produces a sensible default when `--category` absent
- [ ] List: filters apply, output sorted newest-first, default limit 20
- [ ] Search: results ranked by title (3) > tags (2) > summary (1) match
- [ ] Show: full insight displayed with phase context and routed-artifact link if any
- [ ] No file modifications outside `.workflow/learning/`
- [ ] Confirmation banner displayed with INS-id and next-step hints
- [ ] Next step: `Skill({ skill: "manage-learn", args: "list" })` to browse, or `Skill({ skill: "manage-learn", args: "search <query>" })` to find related insights
</success_criteria>

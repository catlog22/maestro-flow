---
name: maestro-analyze
description: Multi-dimensional analysis with CLI exploration, decision extraction, and intent tracking
argument-hint: "[phase|topic] [-y] [-c] [-q]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Perform multi-dimensional analysis of a technical proposal, decision, or architecture choice through iterative CLI-assisted exploration and interactive discussion. Produces a discussion timeline (discussion.md) with evolving understanding, multi-perspective findings, Decision Recording Protocol, Intent Coverage tracking, and a final conclusions package with Go/No-Go recommendation.

Combines structured 6-dimension scoring with iterative deepening and decision extraction. Replaces both analysis and decision-capture workflows — produces analysis.md (scoring) AND context.md (Locked/Free/Deferred decisions for plan).

Use `-q` for quick decision extraction only (skip exploration + scoring).
</purpose>

<required_reading>
@~/.maestro/workflows/analyze.md
</required_reading>

<deferred_reading>
- [state.json](~/.maestro/templates/state.json) — read when registering artifact
</deferred_reading>

<context>
$ARGUMENTS -- phase number for milestone-scoped, topic text for adhoc/standalone mode, no args for milestone-wide.

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive scoping, use recommended defaults, auto-deepen
- `-c` / `--continue`: Resume from existing session (auto-detect session folder + discussion.md)
- `-q` / `--quick`: Quick mode — skip exploration + scoring, go straight to decision extraction (context.md only)

**Scope routing (per architecture):**

| Invocation | Precondition | Scope | Behavior |
|-----------|-------------|-------|----------|
| `analyze` (no args) | init + roadmap | milestone | Analyze current milestone's all phases |
| `analyze 1` | init + roadmap | phase | Analyze phase 1 only |
| `analyze "topic"` (has milestone) | none | adhoc | Analyze topic, affiliated with current milestone |
| `analyze "topic"` (no milestone) | none | standalone | Analyze topic, no milestone affiliation |

**Scope detection rule**: Text argument + `state.json.current_milestone` non-null → adhoc. Text argument + no milestone → standalone. No args + no roadmap → error (need topic or roadmap).

**Output directory**: `scratch/analyze-{slug}-{date}/` (relative to `.workflow/`)

**Artifact registration**: On completion, register artifact in `state.json.artifacts[]`:
```jsonc
{
  "id": "ANL-{NNN}",
  "type": "analyze",
  "milestone": "{current_milestone or null}",
  "phase": "{phase_number or null}",
  "scope": "{milestone|phase|adhoc|standalone}",
  "path": "scratch/analyze-{slug}-{date}",
  "status": "completed",
  "depends_on": null,
  "harvested": false,
  "created_at": "...",
  "completed_at": "..."
}
```

**Output artifacts:**
| Artifact | Mode | Description |
|----------|------|-------------|
| `context.md` | both | Locked/Free/Deferred decisions for downstream plan |
| `discussion.md` | full | Full discussion timeline with TOC, Current Understanding, rounds, decisions, intent coverage |
| `analysis.md` | full | Executive summary with 6-dimension scores and risk matrix |
| `conclusions.json` | full | Final synthesis with recommendations, decision trail, intent coverage |
| `explorations.json` | full | Codebase exploration findings (single perspective) |
| `perspectives.json` | full | Multi-perspective findings with synthesis (if multi-perspective) |
</context>

<execution>
Follow '~/.maestro/workflows/analyze.md' completely.

**Handoff:** context.md is consumed by maestro-plan (loads Locked/Free/Deferred decisions).

**Next-step routing on completion:**

Phase/Milestone scope:
- Go recommendation, UI work needed → `/maestro-ui-design {phase}`
- Go recommendation, ready to plan → `/maestro-plan` or `/maestro-plan {phase}`
- No-Go recommendation → revisit requirements or `/maestro-brainstorm {topic}`

Adhoc/Standalone scope:
- Ready to plan → `/maestro-plan --dir {scratch_dir}`
- Need more exploration → `/maestro-analyze {topic} -c`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No args and no roadmap (cannot determine scope) | Prompt user for topic text or create roadmap first |
| W001 | warning | CLI exploration failed | Continue with available context, note limitation |
| W002 | warning | CLI analysis timeout | Retry with shorter prompt, or skip perspective |
| W003 | warning | Insufficient evidence for scoring dimensions | Note low-confidence dimensions, proceed with available evidence |
| W004 | warning | Max rounds reached (5) | Force synthesis, offer continuation option |
</error_codes>

<success_criteria>
Full mode:
- [ ] CLI exploration completed with code anchors and call chains
- [ ] discussion.md created with full timeline, TOC, Current Understanding
- [ ] analysis.md written with all 6 dimensions scored with evidence
- [ ] conclusions.json created with recommendations and decision trail
- [ ] Intent Coverage tracked and verified (no unresolved ❌ items)

Both modes (full + quick):
- [ ] context.md written with all decisions classified as Locked/Free/Deferred
- [ ] Gray areas identified through phase-specific analysis
- [ ] Decision Recording Protocol applied to all decisions
- [ ] Scope creep redirected to Deferred section
- [ ] Deferred items auto-created as issues (if any)
- [ ] Artifact registered in state.json with correct scope/milestone/phase
- [ ] Next step routed (ui-design/plan for Go, brainstorm for No-Go)
</success_criteria>

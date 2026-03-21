---
name: maestro-analyze
description: Multi-dimensional analysis with CLI exploration, decision extraction, and intent tracking
argument-hint: "<phase|topic> [-y] [-c] [-q]"
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
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
- [index.json](~/.maestro/templates/index.json) — read when operating in phase mode
</deferred_reading>

<context>
$ARGUMENTS -- phase number for phase mode, topic text for scratch mode, with optional flags.

**Flags:**
- `-y` / `--yes`: Auto mode — skip interactive scoping, use recommended defaults, auto-deepen
- `-c` / `--continue`: Resume from existing session (auto-detect session folder + discussion.md)
- `-q` / `--quick`: Quick mode — skip exploration + scoring, go straight to decision extraction (context.md only)

**Phase mode** (number): resolves phase directory from state.json + roadmap, updates index.json status to "exploring".
**Scratch mode** (text): creates `.workflow/scratch/analyze-{slug}-{date}/` with index.json from scratch-index template (type="analyze").

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

**Handoff:** context.md is consumed by maestro-plan (Step 4 loads Locked/Free/Deferred decisions).

**Next-step routing on completion:**

Phase mode:
- Go recommendation, UI work needed → Skill({ skill: "maestro-ui-design", args: "{phase}" })
- Go recommendation, ready to plan → Skill({ skill: "maestro-plan", args: "{phase}" })
- No-Go recommendation → revisit requirements or Skill({ skill: "maestro-brainstorm", args: "{topic}" })

Scratch mode:
- Ready to plan → Skill({ skill: "maestro-plan", args: "--dir {scratch_dir}" })
- Need more exploration → Skill({ skill: "maestro-analyze", args: "{topic} -c" })
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Analysis subject required (no arguments provided) | Prompt user for phase number or topic text |
| E002 | error | Phase directory not found | List available phases, prompt user to select |
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
- [ ] project.md Key Decisions updated with Locked decisions (phase mode)
- [ ] Next step routed (ui-design/plan for Go, brainstorm for No-Go)
- [ ] index.json timestamps updated
</success_criteria>

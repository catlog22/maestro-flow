---
name: maestro-blueprint
description: Generate formal specification package (Product Brief, PRD, Architecture, Epics) through 6-phase document chain
argument-hint: "<idea or @file> [-y] [-c] [--from <source>]"
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
6-phase formal specification chain: Product Brief → PRD → Architecture → Epics. Pure documentation — no code generation.

Pipeline: brainstorm (optional) → **blueprint** → analyze / roadmap / plan.
</purpose>

<required_reading>
@~/.maestro/workflows/blueprint.md
</required_reading>

<deferred_reading>
- [blueprint-config.json](~/.maestro/templates/blueprint-config.json) — read when initializing blueprint configuration
</deferred_reading>

<context>
$ARGUMENTS -- idea text, @file reference, or upstream context source.

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `-y` / `--yes` | Auto mode — skip interactive questions, use recommended defaults | false |
| `-c` / `--continue` | Resume from last checkpoint (reads blueprint-config.json) | false |
| `--from <source>` | Load upstream context package (brainstorm:ID, @file, or path). Consumes context-package.json | — |
| `--from-brainstorm SESSION-ID` | Backward compat alias for `--from brainstorm:ID` | — |

**Input types:**
- Direct text: `"Build a real-time collaboration platform with WebSocket"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` or `--from @requirements.md` or `--from path/`
- Resume: `-c` (resumes from first incomplete phase)

**Output boundary**: ALL file writes MUST target `.workflow/blueprint/BLP-{slug}-{date}/` or `.workflow/state.json` only. NEVER modify source code or files outside these paths.

### Pre-load

1. **Specs**: `maestro load --type spec --category arch` — load architecture constraints for Phase 4 decisions
2. **Wiki search**: `maestro search "{topic keywords}" --json` → prior knowledge context
3. All optional — proceed without if unavailable
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Interaction mode**: convergent menu-driven, depth-first
**Decision tree** (strict depth-first): scope (full product / feature set / single feature) → spec type (service / api / library / platform) → focus areas → whether to run codebase exploration → requirement priorities
**Scope guard**: only specification shape; do not pre-resolve roadmap phases or plan tasks
**Writeback target**: blueprint-config.json (each decision persisted before next question)
**Additional skip conditions**: none beyond standard (-y, -c)
**Exit condition**: all decision points settled → finalize blueprint-config.json, proceed to Phase 1
</interview_protocol>

<execution>
Follow `~/.maestro/workflows/blueprint.md` completely.

### Phase chain

```
P0: Spec Study → P1: Discovery → P1.5: Req Expansion → P2: Product Brief → P3: PRD → P4: Architecture → P5: Epics → P6: Readiness Check
```

P6 gate: Pass (>=80%) → Handoff | Review (60-79%) → Handoff w/caveats | Fail (<60%) → P6.5 Auto-Fix (max 2 iter) → re-check

### Phase Gates (MANDATORY, BLOCKING)

Each phase produces artifacts that are prerequisites for the next. Do NOT advance past a gate without verifying the prior phase's output exists.

**GATE P0 → P1**: `blueprint-config.json` created with session metadata.
**GATE P1 → P1.5**: Discovery context gathered (codebase patterns, upstream context loaded).
**GATE P1.5 → P2**: Requirements expanded from discovery findings.
**GATE P2 → P3**: `product-brief.md` written with vision, goals, scope, multi-perspective synthesis.
**GATE P3 → P4**: `requirements/` directory with `_index.md` + individual `REQ-*.md` + `NFR-*.md` files. All requirements have RFC 2119 keywords and acceptance criteria.
**GATE P4 → P5**: `architecture/` directory with `_index.md` + individual `ADR-*.md` files.
**GATE P5 → P6**: `epics/` directory with `_index.md` + individual `EPIC-*.md` files. Cross-Epic dependency map present.
**GATE P6**: Readiness score computed. Pass (≥80%) or Review (≥60%) required for handoff.

</execution>

<completion>
### Standalone report

```
=== BLUEPRINT READY ===
Session: BLP-{slug}-{date}
Phases completed: P0–P6
Readiness score: {score}%
Gate verdict: {Pass|Review|Fail}
Output: .workflow/blueprint/BLP-{slug}-{date}/
Key artifacts: product-brief.md, requirements/, architecture/, epics/, readiness-report.md
===
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Need codebase analysis | `/maestro-analyze {topic} --from blueprint:BLP-xxx` |
| Ready for roadmap | `/maestro-roadmap --from blueprint:BLP-xxx` |
| Small scope, direct plan | `/maestro-plan --from blueprint:BLP-xxx` |
| Need project setup | `/maestro-init` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Idea text or @file required | Prompt user for input |
| E002 | error | Context source not found (--from) | Show available sessions/sources |
| E006 | error | `.workflow/` not initialized | Run maestro-init first |
| E007 | error | Phase 6 readiness Fail after 2 auto-fix iterations | Present manual fix options |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Codebase exploration failed | Continue without codebase context |
| W003 | warning | Glossary has < 5 terms | Note in readiness check |
| W004 | warning | Review-level readiness score (60-79%) | Proceed with caveats |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
</error_codes>

<success_criteria>
- [ ] Interactive mode: interview decisions persisted in blueprint-config.json
- [ ] `blueprint-config.json` created with session metadata and phase tracking
- [ ] `product-brief.md` with vision, goals, scope, multi-perspective synthesis
- [ ] `glossary.json` with 5+ core terms for cross-document consistency
- [ ] `requirements/` directory with `_index.md` + individual `REQ-*.md` + `NFR-*.md` files
- [ ] All requirements have RFC 2119 keywords and acceptance criteria
- [ ] `architecture/` directory with `_index.md` + individual `ADR-*.md` files
- [ ] Architecture includes state machine, config model, error handling, observability (service type)
- [ ] `epics/` directory with `_index.md` + individual `EPIC-*.md` files
- [ ] Cross-Epic dependency map (Mermaid) and MVP subset tagged
- [ ] `readiness-report.md` with 4-dimension quality scores and traceability matrix
- [ ] `blueprint-summary.md` with one-page executive summary
- [ ] All documents have valid YAML frontmatter with session_id
- [ ] Glossary terms used consistently across all documents
- [ ] Readiness gate: Pass (>=80%) or Review (>=60%) with documented caveats
- [ ] Artifact registered in state.json (type=blueprint)
- [ ] context-package.json generated for downstream consumption
- [ ] On gate Pass/Review: session sealed via finish-work (archive.json + optional spec/knowhow extraction). On Fail: skip — session stays active, excluded from wiki search.
</success_criteria>

<on_complete>
@~/.maestro/workflows/finish-work.md — SESSION_DIR={session_dir}, SESSION_TYPE=blueprint, SESSION_ID={session_id}, LINKED_MILESTONE=null
</on_complete>

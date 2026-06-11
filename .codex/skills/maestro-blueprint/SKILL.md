---
name: maestro-blueprint
description: Generate formal specification package (Product Brief, PRD, Architecture, Epics) through 7-phase document chain (P0 Spec Study → P1 Discovery → P1.5 Req Expansion → P2 Product Brief → P3 PRD → P4 Architecture → P5 Epics → P6 Readiness Check)
argument-hint: "<idea or @file> [-y] [-c] [--from <source>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, spawn_agents_on_csv, request_user_input
---
<purpose>
Formal specification document chain producing a complete specification package through 7 sequential phases (P0–P6, plus P1.5 requirement expansion) with multi-CLI analysis and interactive refinement. Pure documentation — no code generation, no roadmap generation.

Parallel to `brainstorm` as an upstream origin command:
- **brainstorm** = divergent exploration (lightweight, multi-role creative)
- **blueprint** = convergent documentation (heavyweight, 7-phase formal spec chain)

Output: `.workflow/blueprint/BLP-{slug}-{date}/` containing Product Brief, PRD, Architecture, and Epics.
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
- `-y` / `--yes`: Auto mode — skip interactive questions, use recommended defaults
- `-c` / `--continue`: Resume from last checkpoint (reads blueprint-config.json)
- `--from <source>`: Load upstream context package (brainstorm:ID, @file, or path). Consumes context-package.json
- `--from-brainstorm SESSION-ID`: (backward compat alias for `--from brainstorm:ID`)

**Input types:**
- Direct text: `"Build a real-time collaboration platform with WebSocket"`
- File reference: `@requirements.md`
- Context import: `--from brainstorm:BRN-001` or `--from @requirements.md` or `--from path/`
- Resume: `-c` (resumes from first incomplete phase)

**Pipeline position:**
```
maestro-brainstorm (optional upstream)
        ↓ guidance-specification.md / context-package.json
maestro-blueprint
        ↓ .workflow/blueprint/BLP-{slug}-{date}/
maestro-analyze → maestro-roadmap → maestro-plan
```

**Output boundary**: ALL file writes MUST target `.workflow/blueprint/BLP-{slug}-{date}/` or `.workflow/state.json` only. NEVER modify source code or files outside these paths.

### Pre-load specs
1. **Architecture specs**: Run `maestro spec load --category arch` to load architecture constraints. Use as context for architecture decisions (Phase 4).
2. Optional — proceed without if unavailable.
</context>

<interview_protocol>
Interview the user relentlessly about every aspect of the spec until shared understanding is reached. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one; if a question can be answered by exploring the codebase, explore the codebase instead. Active only in interactive mode; skip when `-y/--yes`, `-c/--continue`, or input is already specific (clear idea + scope).

- Ask one question per turn via request_user_input and wait for the user's feedback before continuing; every question must carry a recommended answer marked `(Recommended)`, 2–4 options total. The user controls termination — keep interviewing until convergence; they can interrupt naturally at any time.
- Search-first when uncertain: before asking, resolve via `state.json`, existing artifacts, `maestro spec load`, direct codebase exploration (Glob/Grep/Read), or — for open-ended multi-file scans — `maestro delegate ... --role explore`. Never ask what code or memory can verify; never bounce your own ambiguity back to the user — search first, then ask only what truly needs human judgment.
- Writeback cadence: each settled decision is immediately persisted into `blueprint-config.json` before the next question. Do NOT batch writeback to the end — partial decisions must already be on disk.
- Walk the decision dependency tree depth-first: scope → spec type → focus areas → requirement priorities. Do not open the next branch until the current one is settled.
- Scope guard: only decide the shape of the specification. Do not pre-resolve roadmap phases or plan tasks — those belong to downstream commands.

Decision points: scope (full product / feature set / single feature) → spec type (service / api / library / platform) → focus areas → whether to run codebase exploration.

Exit: on consensus or explicit user signal to proceed, finalize blueprint-config.json (decisions already written incrementally) and proceed to Phase 1.
</interview_protocol>

<execution>
Follow `~/.maestro/workflows/blueprint.md` completely.

### Phase chain

```
P0: Spec Study → P1: Discovery → P1.5: Req Expansion → P2: Product Brief → P3: PRD → P4: Architecture → P5: Epics → P6: Readiness Check
```

P6 gate: Pass (>=80%) → Handoff | Review (60-79%) → Handoff w/caveats | Fail (<60%) → P6.5 Auto-Fix (max 2 iter) → re-check

### Next-step routing on completion

| Condition | Suggestion |
|-----------|-----------|
| Need codebase analysis | $maestro-analyze {topic} --from blueprint:BLP-xxx |
| Ready for roadmap | $maestro-roadmap --from blueprint:BLP-xxx |
| Small scope, direct plan | $maestro-plan --from blueprint:BLP-xxx |
| Need project setup | $maestro-init |
</execution>

<invariants>
1. **Invariant violation = BLOCK** — violating any invariant above blocks the current operation.
2. **Phase gate enforcement** — each phase produces artifacts that are prerequisites for the next. Do NOT advance to phase N+1 without verifying phase N's output exists: P2→product-brief.md, P3→requirements/_index.md, P4→architecture/_index.md, P5→epics/_index.md, P6→readiness-report.md.
3. **Evidence required on ADRs** — Architecture Decision Records (ADR-*.md) MUST cite evidence (code analysis, requirement traceability REQ-xxx, upstream context). Generic rationale without project-specific references is INVALID.
4. **Artifact verification before completion** — verify blueprint-config.json, product-brief.md, glossary.json (≥5 terms), requirements/_index.md, architecture/_index.md, epics/_index.md, readiness-report.md, blueprint-summary.md, context-package.json all exist. If any missing: DO NOT report completion.
</invariants>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Idea text or @file required | Prompt user for input |
| E002 | error | Context source not found (--from) | Show available sessions/sources |
| E006 | error | `.workflow/` not initialized | Run maestro-init first |
| E007 | error | Phase 6 readiness Fail after 2 auto-fix iterations | Present manual fix options |
| W001 | warning | CLI analysis failed | Retry once. If still fails: continue but flag affected phase outputs as LOW CONFIDENCE |
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

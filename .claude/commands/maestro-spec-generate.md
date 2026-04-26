---
name: maestro-spec-generate
description: Generate specification package from idea/requirements through 7-phase document chain producing product brief, PRD, architecture, epics, and interactive roadmap
argument-hint: "<idea or @file> [-y] [-c] [--count N]"
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
Transform an idea, brainstorm output, or user requirements into a complete specification package through a 7-phase document chain: Discovery → Requirement Clarification → Product Brief → PRD → Architecture → Epics & Stories → Readiness Check → Roadmap Generation. Outputs a validated specification package with roadmap in `.workflow/.spec/` and writes `.workflow/roadmap.md` for downstream execution.

This is the heavy-path entry for structured decomposition: idea → spec-generate (spec + roadmap) → init → plan → execute.
</purpose>

<required_reading>
@~/.maestro/workflows/spec-generate.md
</required_reading>

<deferred_reading>
- [spec-config.json](~/.maestro/templates/spec-config.json) — read when initializing spec configuration
</deferred_reading>

<context>
$ARGUMENTS -- idea text, @file reference to requirements document, or brainstorm session reference.

Flags, input types, output location, and pipeline position defined in workflow spec-generate.md.

**Note:** `maestro-init` MUST run before this command. It creates the `.workflow/` directory and project context that spec-generate builds upon.
</context>

<execution>
Follow '~/.maestro/workflows/spec-generate.md' completely.

**Next-step routing on completion:**
- Roadmap generated, ready to plan → /maestro-plan 1
- Need UI design first → /maestro-ui-design 1
- Need analysis before planning → /maestro-analyze 1
- View project dashboard → /manage-status
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Idea/topic text or @file required | Prompt user for input |
| E002 | error | `.workflow/` not initialized (no parent dir) | Create `.workflow/` directory |
| E003 | error | Brainstorm session not found (--from-brainstorm) | Show available sessions |
| E004 | error | Phase 6 readiness Fail after 2 auto-fix iterations | Present manual fix options |
| W001 | warning | CLI analysis failed, using fallback | Continue with available data |
| W002 | warning | Codebase exploration failed | Continue without codebase context |
| W005 | warning | External research agent failed | Continue without apiResearchContext |
| W003 | warning | Glossary has < 5 terms | Note in readiness check |
| W004 | warning | Review-level readiness score (60-79%) | Proceed with caveats |
</error_codes>

<success_criteria>
- [ ] `spec-config.json` created with session metadata and phase tracking
- [ ] `product-brief.md` with vision, goals, scope, multi-perspective synthesis
- [ ] `glossary.json` with 5+ core terms for cross-document consistency
- [ ] `requirements/` directory with `_index.md` + individual `REQ-*.md` + `NFR-*.md` files
- [ ] All requirements have RFC 2119 keywords and acceptance criteria
- [ ] `architecture/` directory with `_index.md` + individual `ADR-*.md` files
- [ ] Architecture includes state machine, config model, error handling, observability (service type)
- [ ] `epics/` directory with `_index.md` + individual `EPIC-*.md` files
- [ ] Cross-Epic dependency map (Mermaid) and MVP subset tagged
- [ ] `readiness-report.md` with 4-dimension quality scores and traceability matrix
- [ ] `spec-summary.md` with one-page executive summary
- [ ] All documents have valid YAML frontmatter with session_id
- [ ] Glossary terms used consistently across all documents
- [ ] Readiness gate: Pass (>=80%) or Review (>=60%) with documented caveats
- [ ] `roadmap.md` generated from Epics with interactive user confirmation
- [ ] `.workflow/roadmap.md` written (if `.workflow/` exists)
</success_criteria>

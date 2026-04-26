---
name: maestro-ui-design
description: Generate UI design prototypes with multiple styles via ui-ux-pro-max, user selects winner, solidify as code reference
argument-hint: "<phase|topic> [--styles N] [--stack <stack>] [--targets <pages>] [--layouts N] [--refine] [--persist] [--full] [-y]"
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
Generate UI design prototypes for a phase or topic. Two workflow paths, auto-selected by skill availability:

1. **Primary (ui-style.md):** Delegates design to ui-ux-pro-max skill. Generates multiple style variants via `--design-system`, user selects, solidifies as code reference. Lightweight and fast.
2. **Fallback (ui-design.md):** Self-contained 4-layer pipeline (style → animation → layout → assembly) with 6D attribute space, OKLCH tokens, layout templates, and full prototype matrix. Used when ui-ux-pro-max is unavailable or `--full` is requested.

Both paths produce the same output contract: MASTER.md + design-tokens.json + animation-tokens.json + selection.json for downstream plan/execute consumption.

Position in pipeline: analyze -> **ui-design** -> plan -> execute -> verify
</purpose>

<deferred_reading>
- [ui-style.md](~/.maestro/workflows/ui-style.md) — read when SKILL_PATH found (primary path)
- [ui-design.md](~/.maestro/workflows/ui-design.md) — read when SKILL_PATH empty or --full (fallback path)
- [index.json](~/.maestro/templates/index.json) — read when updating phase metadata
- [scratch-index.json](~/.maestro/templates/scratch-index.json) — read when operating in scratch mode
</deferred_reading>

<context>
$ARGUMENTS — phase number for phase mode, topic text for scratch mode, with optional flags.

Flags, workflow routing, scope modes, and output artifacts defined in the routed workflow (ui-style.md or ui-design.md).

**Phase mode** (number): resolves phase directory, reads context.md/brainstorm for requirements.
**Scratch mode** (text): creates `.workflow/scratch/{YYYYMMDD}-ui-design-{slug}/` for standalone exploration.
</context>

<execution>
## Workflow Routing

Detect ui-ux-pro-max skill availability and route to the appropriate workflow:

- **`--full` flag present** → Follow '~/.maestro/workflows/ui-design.md' completely (forced full pipeline)
- **ui-ux-pro-max found** → Follow '~/.maestro/workflows/ui-style.md' completely (lightweight delegation)
- **ui-ux-pro-max not found** → Follow '~/.maestro/workflows/ui-design.md' completely (self-contained fallback)

Skill detection logic, report format, and complete pipeline steps defined in the routed workflow file.

**Next-step routing on completion:**
- Plan with design reference → /maestro-plan {phase}
- Refine selected design → /maestro-ui-design {phase} --refine
- Analyze before planning → /maestro-analyze {phase}
</execution>

<error_codes>
| Code | Severity | Description | Stage |
|------|----------|-------------|-------|
| E001 | error | Phase or topic argument required | parse_input |
| E002 | error | Phase directory not found | parse_input |
| E003 | error | Python not available (both paths need Python for ui-ux-pro-max or agent fallback) | setup |
| E004 | error | --refine requires existing design-ref/ | parse_input |
| W001 | warning | Design system generation returned partial results | generate |
| W002 | warning | Prototype rendering failed for one variant | render |
| W003 | warning | No context.md found, using phase goal only | context |
| W004 | warning | ui-ux-pro-max not found, falling back to full pipeline | routing |
</error_codes>

<success_criteria>
**Both paths (common):**
- [ ] Requirements extracted from phase context (context.md, brainstorm, spec, or user input)
- [ ] N style variants generated with contrasting design directions
- [ ] User selected preferred variant (or auto-selected in -y mode)
- [ ] MASTER.md written with complete design system specification
- [ ] design-tokens.json written with production-ready tokens (OKLCH colors, component_styles)
- [ ] animation-tokens.json written (duration, easing, transitions, keyframes)
- [ ] selection.json recorded with choice metadata
- [ ] index.json updated with design_ref status

**ui-style.md path (primary):**
- [ ] ui-ux-pro-max --design-system called with product/industry/style keywords
- [ ] Tokens extracted from ui-ux-pro-max output into structured JSON

**ui-design.md path (--full or fallback):**
- [ ] 6D attribute space used for maximum contrast between variants
- [ ] Layout templates generated per target (dom_structure + css_layout_rules)
- [ ] HTML prototypes assembled: styles x layouts x targets
- [ ] compare.html generated as interactive matrix viewer
</success_criteria>
</output>

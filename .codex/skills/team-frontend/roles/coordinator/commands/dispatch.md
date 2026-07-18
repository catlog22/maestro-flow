
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From team-session.json `pipeline_mode` | Yes |
| Industry | From team-session.json `industry` | Yes |
| Constraints | From team-session.json `constraints` | No |

1. Load user requirement and scope from team-session.json
2. Load pipeline mode (page / feature / system) from team-session.json
3. Load industry and constraints for task descriptions

## Phase 3: Task Chain Creation

### Task Description Template

Every task description uses structured format:

```
update_plan({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: {run_dir}/work/team
  - Industry: <industry>
  - Scope: <scope>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Task Chain |
|------|------------|
| `page` | ANALYZE-001 -> ARCH-001 -> DEV-001 -> QA-001 |
| `feature` | ANALYZE-001 -> ARCH-001 -> QA-001 -> DEV-001 -> QA-002 |
| `system` | ANALYZE-001 -> ARCH-001 -> QA-001 -> [ARCH-002 &#124;&#124; DEV-001] -> QA-002 -> DEV-002 -> QA-003 |

---

### Page Mode Task Chain (4 tasks)

**ANALYZE-001** (analyst):
```
update_plan({
  subject: "ANALYZE-001",
  description: "PURPOSE: Analyze frontend requirements and retrieve design intelligence | Success: design-intelligence.json produced with industry-specific recommendations
TASK:
  - Detect tech stack and existing design system
  - Retrieve design intelligence via ui-ux-pro-max (or LLM fallback)
  - Analyze existing codebase patterns
  - Compile design-intelligence.json and requirements.md
CONTEXT:
  - Session: {run_dir}/work/team
  - Industry: <industry>
  - Scope: <scope>
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/analysis/design-intelligence.json + requirements.md | Structured design data
CONSTRAINTS: Read-only analysis | No code modifications"
})
update_plan({ taskId: "ANALYZE-001", owner: "analyst" })
```

**ARCH-001** (architect):
```
update_plan({
  subject: "ARCH-001",
  description: "PURPOSE: Define design token system and component architecture | Success: design-tokens.json + component specs produced
TASK:
  - Load design intelligence from analyst output
  - Generate design token system (colors, typography, spacing, shadows)
  - Define component architecture and specs
  - Generate project structure
CONTEXT:
  - Session: {run_dir}/work/team
  - Industry: <industry>
  - Scope: full
  - Upstream artifacts: design-intelligence.json, requirements.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/architecture/design-tokens.json + component-specs/ + project-structure.md
CONSTRAINTS: Use ui-ux-pro-max recommendations for token values | Support light/dark mode"
})
update_plan({ taskId: "ARCH-001", addBlockedBy: ["ANALYZE-001"], owner: "architect" })
```

**DEV-001** (developer):
```
update_plan({
  subject: "DEV-001",
  description: "PURPOSE: Implement frontend page/components from architecture artifacts | Success: All planned files implemented with design token usage
TASK:
  - Load design tokens, component specs, project structure
  - Generate CSS custom properties from design tokens
  - Implement components following specs and coding standards
  - Self-validate: no hardcoded colors, cursor-pointer, focus styles, responsive
CONTEXT:
  - Session: {run_dir}/work/team
  - Industry: <industry>
  - Scope: full
  - Upstream artifacts: design-tokens.json, component-specs/, project-structure.md
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: src/styles/tokens.css + component files | Design-token compliant code
CONSTRAINTS: Use CSS variables from tokens | Mobile-first responsive | WCAG AA"
})
update_plan({ taskId: "DEV-001", addBlockedBy: ["ARCH-001"], owner: "developer" })
```

**QA-001** (qa):
```
update_plan({
  subject: "QA-001",
  description: "PURPOSE: Execute 5-dimension quality audit on implementation | Success: Score >= 8 with 0 critical issues
TASK:
  - Load design intelligence and tokens for compliance checks
  - Execute 5-dimension audit (code quality, accessibility, design compliance, UX, pre-delivery)
  - Calculate weighted score and determine verdict
  - Write audit report
CONTEXT:
  - Session: {run_dir}/work/team
  - Industry: <industry>
  - Review type: code-review
  - Upstream artifacts: design-intelligence.json, design-tokens.json, src/**
  - Shared memory: {run_dir}/work/team/.msg/meta.json
EXPECTED: {run_dir}/outputs/qa/audit-001.md | Weighted score + verdict + categorized issues
CONSTRAINTS: Read-only review | No code modifications"
})
update_plan({ taskId: "QA-001", addBlockedBy: ["DEV-001"], owner: "qa" })
```

---

### Feature Mode Task Chain (5 tasks)

Create ANALYZE-001 and ARCH-001 as page mode above, then:

**QA-001** (qa, architecture review):
- blockedBy: ["ARCH-001"]
- Review type: architecture-review
- Reviews architecture artifacts before developer starts

**DEV-001** (developer):
- blockedBy: ["QA-001"] (waits for arch review to pass)

**QA-002** (qa, code review):
- blockedBy: ["DEV-001"]
- Review type: code-review

---

### System Mode Task Chain (7 tasks)

Create ANALYZE-001, ARCH-001, QA-001 as feature mode above, then:

**ARCH-002** (architect, parallel with DEV-001):
- blockedBy: ["QA-001"]
- Scope: components (refined specs after QA feedback)

**DEV-001** (developer, parallel with ARCH-002):
- blockedBy: ["QA-001"]
- Scope: tokens (CSS generation)

**QA-002** (qa):
- blockedBy: ["ARCH-002"]
- Review type: component-review

**DEV-002** (developer):
- blockedBy: ["QA-002"]
- Scope: components

**QA-003** (qa, final review):
- blockedBy: ["DEV-002"]
- Review type: final

## Phase 4: Validation

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | list_agents count | page: 4, feature: 5, system: 7 |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| Structured descriptions | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |
| Owner assignments correct | Role matches task prefix | ANALYZE->analyst, ARCH->architect, DEV->developer, QA->qa |

If validation fails, fix the specific task and re-validate.

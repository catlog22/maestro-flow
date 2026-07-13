
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User requirement | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From session.json `pipeline` | Yes |
| Industry config | From session.json `industry` | Yes |

1. Load user requirement and design scope from session.json
2. Load pipeline stage definitions from specs/pipelines.md
3. Read `pipeline` and `industry` from session.json

## Phase 3: Task Chain Creation (Mode-Branched)

### Task Description Template

Every task description uses structured format:

```
TaskCreate({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <measurable completion criteria>
TASK:
  - <step 1: specific action>
  - <step 2: specific action>
  - <step 3: specific action>
CONTEXT:
  - Session: <session-folder>
  - Scope: <design-scope>
  - Industry: <industry>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>"
})
TaskUpdate({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `component` | Create 4 tasks: RESEARCH -> DESIGN -> AUDIT -> BUILD |
| `system` | Create 7 tasks: dual-track with 2 sync points |
| `full-system` | Create 8 tasks: dual-track with 3 sync points (final audit) |

---

### Component Pipeline Task Chain

**RESEARCH-001** (researcher):
```
TaskCreate({
  subject: "RESEARCH-001",
  description: "PURPOSE: Analyze existing design system, build component inventory, assess accessibility baseline | Success: 4 research artifacts produced with valid data
TASK:
  - Analyze existing design tokens and styling patterns
  - Build component inventory with props and states
  - Assess accessibility baseline (WCAG level, ARIA coverage)
  - Retrieve design intelligence via ui-ux-pro-max
CONTEXT:
  - Session: <session-folder>
  - Scope: <design-scope>
  - Industry: <industry>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/research/*.json | All 4 research files with valid JSON
CONSTRAINTS: Read-only analysis | Focus on <design-scope>"
})
TaskUpdate({ taskId: "RESEARCH-001", owner: "researcher" })
```

**DESIGN-001** (designer):
```
TaskCreate({
  subject: "DESIGN-001",
  description: "PURPOSE: Define component design with tokens and specifications | Success: Design tokens + component spec with all states defined
TASK:
  - Define design tokens consuming research findings
  - Create component specification with all 5 interactive states
  - Ensure accessibility spec (role, ARIA, keyboard, focus)
  - Reference design intelligence recommendations
CONTEXT:
  - Session: <session-folder>
  - Scope: <design-scope>
  - Industry: <industry>
  - Upstream artifacts: research/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/design/design-tokens.json + component-specs/*.md | Complete token system + spec
CONSTRAINTS: Follow W3C Design Tokens Format | All color tokens need light/dark"
})
TaskUpdate({ taskId: "DESIGN-001", addBlockedBy: ["RESEARCH-001"], owner: "designer" })
```

**AUDIT-001** (reviewer):
```
TaskCreate({
  subject: "AUDIT-001",
  description: "PURPOSE: Audit design for consistency, accessibility, and quality | Success: Audit score >= 8 with 0 critical issues
TASK:
  - Score 5 dimensions: consistency, accessibility, completeness, quality, industry compliance
  - Check token naming, theme completeness, contrast ratios
  - Verify component states and ARIA spec
  - Check against design intelligence anti-patterns
CONTEXT:
  - Session: <session-folder>
  - Scope: <design-scope>
  - Industry: <industry>
  - Upstream artifacts: design/design-tokens.json, design/component-specs/*.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/audit/audit-001.md | 5-dimension scored report
CONSTRAINTS: Read-only analysis | GC convergence: score >= 8 and 0 critical"
})
TaskUpdate({ taskId: "AUDIT-001", addBlockedBy: ["DESIGN-001"], owner: "reviewer" })
```

**BUILD-001** (implementer):
```
TaskCreate({
  subject: "BUILD-001",
  description: "PURPOSE: Implement component code from design specs | Success: Production code with token consumption and accessibility
TASK:
  - Generate CSS custom properties from design tokens
  - Implement component with all 5 states
  - Add ARIA attributes and keyboard navigation
  - Validate no hardcoded values
CONTEXT:
  - Session: <session-folder>
  - Scope: <design-scope>
  - Industry: <industry>
  - Upstream artifacts: design/design-tokens.json, design/component-specs/*.md, audit/audit-001.md
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/build/**/* | Component + tokens CSS/TS + tests
CONSTRAINTS: Use var(--token-name) only | Follow project patterns"
})
TaskUpdate({ taskId: "BUILD-001", addBlockedBy: ["AUDIT-001"], owner: "implementer" })
```

---

### System Pipeline Task Chain (Dual-Track)

Create tasks in dependency order:

| Task | Role | blockedBy | Description |
|------|------|-----------|-------------|
| RESEARCH-001 | researcher | (none) | Design system analysis |
| DESIGN-001 | designer | RESEARCH-001 | Token system design |
| AUDIT-001 | reviewer | DESIGN-001 | Token audit [Sync Point 1] |
| DESIGN-002 | designer | AUDIT-001 | Component specification |
| BUILD-001 | implementer | AUDIT-001 | Token code implementation |
| AUDIT-002 | reviewer | DESIGN-002 | Component audit [Sync Point 2] |
| BUILD-002 | implementer | AUDIT-002, BUILD-001 | Component code implementation |

Task descriptions follow same template as component pipeline, with subject-specific content for tokens vs components and appropriate upstream artifacts.

---

### Full-System Pipeline Task Chain

Same as System Pipeline, plus:

| Task | Role | blockedBy | Description |
|------|------|-----------|-------------|
| AUDIT-003 | reviewer | BUILD-002 | Final integrated audit (cross-cutting) |

---

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | TaskList count | component: 4, system: 7, full-system: 8 |
| Dependencies correct | Trace dependency graph | Acyclic, correct blockedBy |
| No circular dependencies | Trace dependency graph | Acyclic |
| Task IDs use correct prefixes | Pattern check | RESEARCH/DESIGN/AUDIT/BUILD |
| Structured descriptions complete | Each has PURPOSE/TASK/CONTEXT/EXPECTED/CONSTRAINTS | All present |

If validation fails, fix the specific task and re-validate.

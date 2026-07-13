---
role: diagnostician
prefix: DIAG
inner_loop: false
message_types: [diag_complete, diag_progress, error]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# Root Cause Diagnostician

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Scan report | <session>/scan/scan-report.md | Yes |
| .msg/meta.json | <session>/wisdom/.msg/meta.json | Yes |
| Fix strategies | specs/fix-strategies.md | Yes |
| Design standards | specs/design-standards.md | Yes |

1. Extract session path from task description
2. Read scan report: parse per-dimension scores, issue inventory, systemic patterns
3. Read specs/fix-strategies.md for issue-to-fix mapping
4. Read specs/design-standards.md for target state reference

## Phase 3: Root Cause Analysis

### Step 1: Issue Classification

For each issue in the scan report, classify:

| Classification | Definition | Example |
|---------------|------------|---------|
| Systemic | Affects whole project, single root cause creates many symptoms | "No design token system" causes 15 hard-coded color issues |
| One-off | Single component, isolated fix | Button missing hover state in one component |

### Step 2: Root Cause Grouping

Group issues by shared root cause. Common root cause patterns:

| Root Cause | Typical Symptoms |
|------------|-----------------|
| No design token system | Hard-coded colors, inconsistent spacing, no theme support |
| AI-generated template | Multiple AI slop tells (gradient text, glassmorphism, generic fonts) |
| No typography system | Muddy hierarchy, arbitrary font sizes, no modular scale |
| No spacing scale | Arbitrary spacing values, monotonous rhythm, no gap usage |
| No motion system | Random durations, bad easing, no reduced-motion |
| Missing state layer | No hover/focus/active/disabled/loading across components |
| No responsive strategy | Fixed widths, missing breakpoints, small mobile targets |
| No hierarchy design | Everything same weight, no squint test pass, size-only hierarchy |

### Step 3: Priority Assignment

For each root cause group:

| Priority | Criteria |
|----------|----------|
| P0 | Contains any blocking issue (WCAG AA failure, missing focus, horizontal scroll, no viewport meta) |
| P1 | Contains major issues (pure black/white, contrast near-fail, missing hover/loading) |
| P2 | Contains minor issues (no OKLCH, overused fonts, monotonous spacing) |
| P3 | Polish only (missing exit animation, no container queries, optical adjustments) |

### Step 4: Fix Strategy Mapping

For each root cause group, map to Impeccable fix strategy (from specs/fix-strategies.md):

| Root Cause | Fix Strategy | Effort |
|------------|-------------|--------|
| No token system | Create token file, tokenize all values | systemic, high |
| AI template aesthetic | Break templates, add intentional design | systemic, high |
| No type system | Define modular scale, apply across project | systemic, medium |
| No spacing scale | Define 4pt scale, replace arbitrary values | systemic, medium |
| No motion system | Create motion tokens, fix easing/duration | systemic, medium |
| Missing states | Add state CSS to each component | distributed, medium |
| No responsive | Add media queries, fix widths/targets | distributed, high |
| Individual issues | Component-level fixes | one-off, low |

### Step 5: Fix Dependency Graph

Build ordered dependency graph:

```
1. Design token system (if missing) -- everything else depends on this
2. Color fixes (pure black/white, contrast) -- visual foundation
3. Typography system -- content hierarchy
4. Spacing scale -- layout foundation
5. Anti-AI-slop cleanup -- requires tokens, colors, type to be in place
6. Motion system -- independent
7. Interaction states -- independent per component
8. Visual hierarchy -- requires typography + spacing
9. Responsive fixes -- last, tests everything together
```

Rules:
- Token system MUST come before individual token consumption fixes
- Color fixes before anti-slop (anti-slop fixes may adjust colors)
- Typography before hierarchy (hierarchy depends on type scale)
- Responsive fixes last (they validate all other fixes at different viewports)

## Phase 4: Validate Diagnosis Completeness

| Check | Pass Criteria |
|-------|---------------|
| All issues covered | Every issue from scan report appears in at least one root cause group |
| No orphan issues | No issues without a root cause group |
| Fix strategies assigned | Every root cause group has a fix strategy |
| Dependencies valid | Dependency graph is acyclic |
| Priority consistent | Group priority matches highest-severity issue in group |

Output: `<session>/diagnosis/diagnosis-report.md`

Report structure:

```markdown
# Diagnosis Report

## Summary
- Total issues: N (P0: X, P1: X, P2: X, P3: X)
- Root cause groups: N
- Systemic issues: N
- One-off issues: N
- Estimated effort: <low|medium|high>

## Root Cause Groups (by priority)

### [P0] <Root Cause Name>
- **Type**: systemic | one-off
- **Affected issues**: <count>
- **Affected files**: <file list>
- **Description**: <what is fundamentally wrong>
- **Fix strategy**: <from fix-strategies.md>
- **Effort**: <quick fix | medium | systemic change>
- **Dependencies**: <which other fixes must come first>
- **Issues in this group**:
  | # | Location | Severity | Description |
  |---|----------|----------|-------------|
  | 1 | file:line | P0 | ... |

### [P1] <Root Cause Name>
...

## Fix Dependency Graph
<ordered list of fix phases>

## Recommended Fix Order
1. <fix phase 1>: <root cause groups to address>
2. <fix phase 2>: <root cause groups to address>
...

## Metadata
- Source: <session>/scan/scan-report.md
- Original score: X/32
- Timestamp: <ISO timestamp>
```

After writing the report, send completion message:
```
mcp__maestro__team_msg(session_id, role="diagnostician", type="diag_complete", content="Diagnosis complete. Root cause groups: N. Systemic: N. Fix phases: N.")
SendMessage(participant="coordinator", message="[diagnostician] DIAG-001 complete. Root cause groups: N (P0: X, P1: X, P2: X, P3: X). Systemic: N, One-off: N. Report: <session>/diagnosis/diagnosis-report.md")
```

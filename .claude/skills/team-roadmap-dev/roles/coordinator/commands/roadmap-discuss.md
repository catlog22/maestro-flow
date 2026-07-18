# Command: roadmap-discuss

## Purpose

Discuss project roadmap with the user using project-tech.json + specs/*.md as context. Elicit phases, requirements, success criteria, and execution preferences. Produces `roadmap.md` and `config.json` as session artifacts.

## When to Use

- Phase 2 of coordinator lifecycle (after init prerequisites, before dispatch)
- Called exactly once per session (re-entry updates existing roadmap)

## Strategy

Direct interaction via AskUserQuestion. No delegation to workers or CLI tools. Coordinator handles this entirely.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `sessionFolder` | From coordinator Phase 1 | Canonical `{run_dir}` root |
| `taskDescription` | From coordinator Phase 1 | User's original task description |
| `projectTech` | Loaded in Phase 1 | Parsed project-tech.json |
| `projectGuidelines` | Loaded in Phase 1 | Parsed specs/*.md (nullable) |
| `autoYes` | From -y/--yes flag | Skip interactive prompts, use defaults |

## Execution Steps

### Step 1: Load Project Context

```javascript
// Already loaded by coordinator Phase 1, but verify availability
const projectTech = JSON.parse(Read('.workflow/project-tech.json'))
let projectGuidelines = null
try {
  projectGuidelines = JSON.parse(Read('.workflow/specs/*.md'))
} catch {}
```

### Step 2: Present Project Overview to User

```javascript
// Summarize what we know about the project
const overview = `[coordinator] Project context loaded.
- Project: ${projectTech.project_name}
- Tech Stack: ${projectTech.tech_stack?.join(', ')}
- Task: ${taskDescription}
${projectGuidelines ? `- Guidelines: ${projectGuidelines.conventions?.length || 0} conventions loaded` : '- Guidelines: not configured'}`

// Display overview (via direct output, not AskUserQuestion)
```

### Step 3: Confirm Project Goal and Scope

```javascript
// Skip if taskDescription is already detailed enough, or autoYes
if (!autoYes && !taskDescription) {
  AskUserQuestion({
    questions: [{
      question: "What is the project goal and scope for this session?",
      header: "Goal",
      multiSelect: false,
      options: [] // Free-form text input
    }]
  })
}
// Store response as `projectGoal`
const projectGoal = taskDescription || userResponse
```

### Step 4: Ask Execution Mode

```javascript
if (!autoYes) {
  AskUserQuestion({
    questions: [{
      question: "How should phase transitions be handled?",
      header: "Execution Mode",
      multiSelect: false,
      options: [
        { label: "interactive", description: "Ask for confirmation at each phase transition" },
        { label: "yolo", description: "Auto-execute all phases without stopping" },
        { label: "custom", description: "Choose which gates require confirmation" }
      ]
    }]
  })
} else {
  mode = "yolo"
}

// If "custom" selected, follow up with gate selection:
if (mode === "custom") {
  AskUserQuestion({
    questions: [{
      question: "Which gates should require confirmation?",
      header: "Custom Gates",
      multiSelect: true,
      options: [
        { label: "plan_check", description: "Review plan before execution" },
        { label: "verifier", description: "Review verification results before next phase" },
        { label: "gap_closure", description: "Confirm gap closure before re-execution" }
      ]
    }]
  })
}
```

### Step 5: Ask Analysis Depth

```javascript
if (!autoYes) {
  AskUserQuestion({
    questions: [{
      question: "How thorough should the analysis be?",
      header: "Analysis Depth",
      multiSelect: false,
      options: [
        { label: "quick", description: "Fast scan, minimal context gathering (small tasks)" },
        { label: "standard", description: "Balanced analysis with key context (default)" },
        { label: "comprehensive", description: "Deep analysis, full codebase exploration (large refactors)" }
      ]
    }]
  })
} else {
  depth = "standard"
}
```

### Step 6: Analyze Codebase and Generate Phased Roadmap

```javascript
// Use Agy CLI (or CLI exploration tool) to analyze the codebase
// and generate a phased breakdown based on goal + project context
Bash({
  command: `maestro delegate "PURPOSE: Analyze codebase and generate phased execution roadmap for: ${projectGoal}
TASK: \
  - Scan project structure and identify affected modules \
  - Break goal into sequential phases (max 5) \
  - Each phase: goal, requirements (REQ-IDs), success criteria (2-5 testable behaviors) \
  - Order phases by dependency (foundational first)
MODE: analysis
CONTEXT: @**/* | Memory: Tech stack: ${projectTech.tech_stack?.join(', ')}
EXPECTED: Phased roadmap in markdown with REQ-IDs and testable success criteria
CONSTRAINTS: Max 5 phases | Each phase independently verifiable | No implementation details" \
  --tool agy --mode analysis --rule planning-breakdown-task-steps`,
  run_in_background: false,
  timeout: 300000
})

// Parse the CLI output into structured phases
```

### Step 7: Present Roadmap Draft for Confirmation

```javascript
// Display the generated roadmap to user
// Output the roadmap content directly, then ask for adjustments

AskUserQuestion({
  questions: [{
    question: "Review the roadmap above. Any adjustments needed?",
    header: "Roadmap Review",
    multiSelect: false,
    options: [
      { label: "Looks good, proceed", description: "Accept roadmap as-is" },
      { label: "Adjust phases", description: "I want to modify the phase breakdown" },
      { label: "Add requirements", description: "I want to add missing requirements" },
      { label: "Change scope", description: "Narrow or expand the scope" }
    ]
  }]
})

// If user requests adjustments, incorporate feedback and re-present
// Loop until user confirms "Looks good, proceed"
```

### Step 8: Generate Session Artifacts

#### roadmap.md

```javascript
Write(`${sessionFolder}/outputs/roadmap.md`, roadmapContent)
```

**roadmap.md format**:

```markdown
# Roadmap: {projectGoal}

Generated: {date}
Session: {sessionFolder}
Depth: {depth}

## Phase 1: {phase title}

**Goal**: {one-line goal}

**Requirements**:
- REQ-101: {requirement description}
- REQ-102: {requirement description}

**Success Criteria**:
- [ ] {testable behavior 1}
- [ ] {testable behavior 2}
- [ ] {testable behavior 3}

**Plan Count**: TBD

---

## Phase 2: {phase title}

**Goal**: {one-line goal}

**Requirements**:
- REQ-201: {requirement description}

**Success Criteria**:
- [ ] {testable behavior 1}
- [ ] {testable behavior 2}

**Plan Count**: TBD

---

(... additional phases ...)
```

**REQ-ID Convention**: `REQ-{phase}{seq}` (e.g., REQ-101 = Phase 1, requirement 1)

#### config.json

```javascript
Write(`${sessionFolder}/work/team/config.json`, JSON.stringify({
  mode: mode,           // "interactive" | "yolo" | "custom"
  depth: depth,         // "quick" | "standard" | "comprehensive"
  auto_advance: mode === "yolo",
  gates: {
    plan_check: mode === "interactive" || (mode === "custom" && customGates.includes("plan_check")),
    verifier: mode === "interactive" || (mode === "custom" && customGates.includes("verifier")),
    gap_closure: mode === "interactive" || (mode === "custom" && customGates.includes("gap_closure"))
  }
}, null, 2))
```

**config.json format**:

```json
{
  "mode": "interactive",
  "depth": "standard",
  "auto_advance": false,
  "gates": {
    "plan_check": true,
    "verifier": true,
    "gap_closure": true
  }
}
```

### Step 9: Update state.md

```javascript
// Transition Phase 0 → Phase 1
Edit(`${sessionFolder}/work/team/state.md`, {
  old_string: "- Phase: 0 (Roadmap Discussion)\n- Status: initializing",
  new_string: `- Phase: 1\n- Status: ready_to_dispatch\n- Roadmap: confirmed (${phaseCount} phases)\n- Mode: ${mode}\n- Depth: ${depth}`
})
```

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| roadmap.md | `{sessionFolder}/outputs/roadmap.md` | Phased plan with REQ-IDs and success criteria |
| config.json | `{sessionFolder}/work/team/config.json` | Execution preferences |
| state.md | `{sessionFolder}/work/team/state.md` | Updated with phase transition |

## Error Handling

| Scenario | Resolution |
|----------|------------|
| User provides no goal | Re-prompt with examples |
| CLI analysis fails | Retry with simpler prompt, or ask user to describe phases manually |
| User keeps adjusting roadmap | Max 5 adjustment rounds, then proceed with latest version |
| autoYes flag set | Skip all AskUserQuestion calls, use defaults: mode=yolo, depth=standard |


<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User topic | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From coordinator Phase 1 | Yes |
| Perspectives | From coordinator Phase 1 (dimension detection) | Yes |

1. Load topic, pipeline mode, and selected perspectives from coordinator state
2. Load pipeline stage definitions from SKILL.md Task Metadata Registry
3. Determine depth = number of selected perspectives (Quick: always 1)

## Phase 3: Task Chain Creation

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
  - Topic: <analysis-topic>
  - Perspective: <perspective or 'all'>
  - Upstream artifacts: <artifact-1>, <artifact-2>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits, focus areas>
---
InnerLoop: false"
})
TaskUpdate({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Mode Router

| Mode | Action |
|------|--------|
| `quick` | Create 3 tasks: EXPLORE-001 -> ANALYZE-001 -> SYNTH-001 |
| `standard` | Create N explorers + N analysts + DISCUSS-001 + SYNTH-001 |
| `deep` | Same as standard but omit SYNTH-001 (created after discussion loop) |

---

### Quick Mode Task Chain

**EXPLORE-001** (explorer):
```
TaskCreate({
  subject: "EXPLORE-001",
  description: "PURPOSE: Explore codebase structure for analysis topic | Success: Key files, patterns, and findings collected
TASK:
  - Detect project structure and relevant modules
  - Search for code related to analysis topic
  - Collect file references, patterns, and key findings
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Perspective: general
  - Dimensions: <dimensions>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/explorations/exploration-001.json | Structured exploration with files and findings
CONSTRAINTS: Focus on <topic> scope
---
InnerLoop: false"
})
TaskUpdate({ taskId: "EXPLORE-001", owner: "explorer" })
```

**ANALYZE-001** (analyst):
```
TaskCreate({
  subject: "ANALYZE-001",
  description: "PURPOSE: Deep analysis of topic from technical perspective | Success: Actionable insights with confidence levels
TASK:
  - Load exploration results and build analysis context
  - Analyze from technical perspective across selected dimensions
  - Generate insights, findings, discussion points, recommendations
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Perspective: technical
  - Dimensions: <dimensions>
  - Upstream artifacts: explorations/exploration-001.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/analyses/analysis-001.json | Structured analysis with evidence
CONSTRAINTS: Focus on technical perspective | <dimensions>
---
InnerLoop: false"
})
TaskUpdate({ taskId: "ANALYZE-001", addBlockedBy: ["EXPLORE-001"], owner: "analyst" })
```

**SYNTH-001** (synthesizer):
```
TaskCreate({
  subject: "SYNTH-001",
  description: "PURPOSE: Integrate analysis into final conclusions | Success: Executive summary with recommendations
TASK:
  - Load all exploration, analysis, and discussion artifacts
  - Extract themes, consolidate evidence, prioritize recommendations
  - Write conclusions and update discussion.md
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Upstream artifacts: explorations/*.json, analyses/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/conclusions.json + discussion.md update | Final conclusions with confidence levels
CONSTRAINTS: Pure integration, no new exploration
---
InnerLoop: false"
})
TaskUpdate({ taskId: "SYNTH-001", addBlockedBy: ["ANALYZE-001"], owner: "synthesizer" })
```

---

### Standard Mode Task Chain

Create tasks in dependency order with parallel exploration and analysis windows:

**EXPLORE-001..N** (explorer, parallel): One per perspective. Each receives unique agent name (explorer-1, explorer-2, ...) for task discovery matching.

```
// For each perspective[i]:
TaskCreate({
  subject: "EXPLORE-<NNN>",
  description: "PURPOSE: Explore codebase from <perspective> angle | Success: Perspective-specific files and patterns collected
TASK:
  - Search codebase from <perspective> perspective
  - Collect files, patterns, findings relevant to this angle
  - Generate questions for downstream analysis
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Perspective: <perspective>
  - Dimensions: <dimensions>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/explorations/exploration-<NNN>.json
CONSTRAINTS: Focus on <perspective> angle
---
InnerLoop: false"
})
TaskUpdate({ taskId: "EXPLORE-<NNN>", owner: "explorer-<i+1>" })
```

**ANALYZE-001..N** (analyst, parallel): One per perspective. Each blocked by its corresponding EXPLORE-N.

```
TaskCreate({
  subject: "ANALYZE-<NNN>",
  description: "PURPOSE: Deep analysis from <perspective> perspective | Success: Insights with confidence and evidence
TASK:
  - Load exploration-<NNN> results
  - Analyze from <perspective> perspective
  - Generate insights, discussion points, open questions
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Perspective: <perspective>
  - Dimensions: <dimensions>
  - Upstream artifacts: explorations/exploration-<NNN>.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/analyses/analysis-<NNN>.json
CONSTRAINTS: <perspective> perspective | <dimensions>
---
InnerLoop: false"
})
TaskUpdate({ taskId: "ANALYZE-<NNN>", addBlockedBy: ["EXPLORE-<NNN>"], owner: "analyst-<i+1>" })
```

**DISCUSS-001** (discussant): Blocked by all ANALYZE tasks.

```
TaskCreate({
  subject: "DISCUSS-001",
  description: "PURPOSE: Process analysis results into discussion summary | Success: Convergent themes and discussion points identified
TASK:
  - Aggregate all analysis results across perspectives
  - Identify convergent themes and conflicting views
  - Generate top discussion points and open questions
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Round: 1
  - Type: initial
  - Upstream artifacts: analyses/*.json
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/discussions/discussion-round-001.json + discussion.md update
CONSTRAINTS: Aggregate only, no new exploration
---
InnerLoop: false"
})
TaskUpdate({ taskId: "DISCUSS-001", addBlockedBy: ["ANALYZE-001", ..., "ANALYZE-<N>"], owner: "discussant" })
```

**SYNTH-001** (synthesizer): Blocked by DISCUSS-001.

```
TaskCreate({
  subject: "SYNTH-001",
  description: "PURPOSE: Cross-perspective integration into final conclusions | Success: Executive summary with prioritized recommendations
...same as Quick mode SYNTH-001 but blocked by DISCUSS-001..."
})
TaskUpdate({ taskId: "SYNTH-001", addBlockedBy: ["DISCUSS-001"], owner: "synthesizer" })
```

---

### Deep Mode Task Chain

Same as Standard mode, but **omit SYNTH-001**. It will be created dynamically after the discussion loop completes, blocked by the last DISCUSS-N task.

---

## Discussion Loop Task Creation

Dynamic tasks created during discussion loop:

**DISCUSS-N** (subsequent rounds):
```
TaskCreate({
  subject: "DISCUSS-<NNN>",
  description: "PURPOSE: Process discussion round <N> | Success: Updated understanding with user feedback integrated
TASK:
  - Process user feedback: <feedback>
  - Execute <type> discussion strategy
  - Update discussion timeline
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Round: <N>
  - Type: <deepen|direction-adjusted|specific-questions>
  - User feedback: <feedback>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/discussions/discussion-round-<NNN>.json
---
InnerLoop: false"
})
TaskUpdate({ taskId: "DISCUSS-<NNN>", owner: "discussant" })
```

**ANALYZE-fix-N** (direction adjustment):
```
TaskCreate({
  subject: "ANALYZE-fix-<N>",
  description: "PURPOSE: Supplementary analysis with adjusted focus | Success: New insights from adjusted direction
TASK:
  - Re-analyze from adjusted perspective: <adjusted_focus>
  - Build on previous exploration findings
  - Generate updated discussion points
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Type: direction-fix
  - Adjusted focus: <adjusted_focus>
  - Shared memory: <session>/wisdom/.msg/meta.json
EXPECTED: <session>/analyses/analysis-fix-<N>.json
---
InnerLoop: false"
})
TaskUpdate({ taskId: "ANALYZE-fix-<N>", owner: "analyst" })
```

## Phase 4: Validation

Verify task chain integrity:

| Check | Method | Expected |
|-------|--------|----------|
| Task count correct | TaskList count | quick: 3, standard: 2N+2, deep: 2N+1 |
| Dependencies correct | Trace blockedBy | Acyclic, correct ordering |
| All descriptions have PURPOSE/TASK/CONTEXT/EXPECTED | Pattern check | All present |
| Session path in every task | Check CONTEXT | Session: <folder> present |

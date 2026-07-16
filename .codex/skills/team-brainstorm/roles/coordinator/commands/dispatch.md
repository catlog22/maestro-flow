
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Command: Dispatch

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| User topic | From coordinator Phase 1 | Yes |
| Session folder | From coordinator Phase 2 | Yes |
| Pipeline mode | From session.json pipeline | Yes |
| Angles | From session.json angles | Yes |

1. Load topic, pipeline mode, and angles from session.json
2. Determine task chain from pipeline mode

## Phase 3: Task Chain Creation

### Task Description Template

Every task description uses structured format:

```
update_plan({
  subject: "<TASK-ID>",
  description: "PURPOSE: <what this task achieves> | Success: <completion criteria>
TASK:
  - <step 1>
  - <step 2>
  - <step 3>
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Angles: <angle-list>
  - Upstream artifacts: <artifact-list>
EXPECTED: <deliverable path> + <quality criteria>
CONSTRAINTS: <scope limits>
---
InnerLoop: false"
})
update_plan({ taskId: "<TASK-ID>", addBlockedBy: [<dependency-list>], owner: "<role>" })
```

### Pipeline Router

| Mode | Action |
|------|--------|
| quick | Create 3 tasks (IDEA -> CHALLENGE -> SYNTH) |
| deep | Create 6 tasks (IDEA -> CHALLENGE -> IDEA-fix -> CHALLENGE-2 -> SYNTH -> EVAL) |
| full | Create 7 tasks (3 parallel IDEAs -> CHALLENGE -> IDEA-fix -> SYNTH -> EVAL) |

---

### Quick Pipeline

**IDEA-001** (ideator):
```
update_plan({
  subject: "IDEA-001",
  description: "PURPOSE: Generate multi-angle ideas for brainstorm topic | Success: >= 6 unique ideas across all angles
TASK:
  - Read topic and angles from session context
  - Generate 3+ ideas per angle with title, description, assumption, impact
  - Self-review for coverage and uniqueness
CONTEXT:
  - Session: <session-folder>
  - Topic: <topic>
  - Angles: <angle-list>
EXPECTED: <session>/ideas/idea-001.md with >= 6 ideas
CONSTRAINTS: Divergent thinking only, no evaluation
---
InnerLoop: false"
})
update_plan({ taskId: "IDEA-001", owner: "ideator" })
```

**CHALLENGE-001** (challenger):
```
update_plan({
  subject: "CHALLENGE-001",
  description: "PURPOSE: Challenge assumptions and assess feasibility of generated ideas | Success: Each idea rated by severity
TASK:
  - Read all idea files from ideas/ directory
  - Challenge each idea across 4 dimensions (assumption, feasibility, risk, competition)
  - Assign severity (CRITICAL/HIGH/MEDIUM/LOW) per idea
  - Determine GC signal (REVISION_NEEDED or CONVERGED)
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: ideas/idea-001.md
EXPECTED: <session>/critiques/critique-001.md with severity table and GC signal
CONSTRAINTS: Critical analysis only, do not generate alternative ideas
---
InnerLoop: false"
})
update_plan({ taskId: "CHALLENGE-001", addBlockedBy: ["IDEA-001"], owner: "challenger" })
```

**SYNTH-001** (synthesizer):
```
update_plan({
  subject: "SYNTH-001",
  description: "PURPOSE: Synthesize ideas and critiques into integrated proposals | Success: >= 1 consolidated proposal
TASK:
  - Read all ideas and critiques
  - Extract themes, resolve conflicts, group complementary ideas
  - Generate 1-3 integrated proposals with feasibility and innovation scores
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: ideas/*.md, critiques/*.md
EXPECTED: <session>/synthesis/synthesis-001.md with proposals
CONSTRAINTS: Integration and synthesis only, no new ideas
---
InnerLoop: false"
})
update_plan({ taskId: "SYNTH-001", addBlockedBy: ["CHALLENGE-001"], owner: "synthesizer" })
```

### Deep Pipeline

Creates all 6 tasks. First 2 same as Quick, then:

**IDEA-002** (ideator, GC revision):
```
update_plan({
  subject: "IDEA-002",
  description: "PURPOSE: Revise ideas based on critique feedback (GC Round 1) | Success: HIGH/CRITICAL challenges addressed
TASK:
  - Read critique feedback from critiques/
  - Revise challenged ideas, replace unsalvageable ones
  - Retain unchallenged ideas intact
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: critiques/critique-001.md
EXPECTED: <session>/ideas/idea-002.md with revised ideas
CONSTRAINTS: Address critique only, focused revision
---
InnerLoop: false"
})
update_plan({ taskId: "IDEA-002", addBlockedBy: ["CHALLENGE-001"], owner: "ideator" })
```

**CHALLENGE-002** (challenger, round 2):
```
update_plan({
  subject: "CHALLENGE-002",
  description: "PURPOSE: Validate revised ideas (GC Round 2) | Success: Severity assessment of revised ideas
TASK:
  - Read revised idea files
  - Re-evaluate previously challenged ideas
  - Assess new replacement ideas
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: ideas/idea-002.md
EXPECTED: <session>/critiques/critique-002.md
CONSTRAINTS: Focus on revised/new ideas
---
InnerLoop: false"
})
update_plan({ taskId: "CHALLENGE-002", addBlockedBy: ["IDEA-002"], owner: "challenger" })
```

**SYNTH-001** blocked by CHALLENGE-002. **EVAL-001** blocked by SYNTH-001:

```
update_plan({
  subject: "EVAL-001",
  description: "PURPOSE: Score and rank synthesized proposals | Success: Ranked list with weighted scores
TASK:
  - Read synthesis results
  - Score each proposal across 4 dimensions (Feasibility 30%, Innovation 25%, Impact 25%, Cost 20%)
  - Generate final ranking and recommendation
CONTEXT:
  - Session: <session-folder>
  - Upstream artifacts: synthesis/synthesis-001.md
EXPECTED: <session>/evaluation/evaluation-001.md with scoring matrix
CONSTRAINTS: Evaluation only, no new proposals
---
InnerLoop: false"
})
update_plan({ taskId: "EVAL-001", addBlockedBy: ["SYNTH-001"], owner: "evaluator" })
```

### Full Pipeline

Creates 7 tasks. Parallel ideators:

| Task | Owner | BlockedBy |
|------|-------|-----------|
| IDEA-001 | ideator-1 | (none) |
| IDEA-002 | ideator-2 | (none) |
| IDEA-003 | ideator-3 | (none) |
| CHALLENGE-001 | challenger | IDEA-001, IDEA-002, IDEA-003 |
| IDEA-004 | ideator | CHALLENGE-001 |
| SYNTH-001 | synthesizer | IDEA-004 |
| EVAL-001 | evaluator | SYNTH-001 |

Each parallel IDEA task scoped to a specific angle from the angles list.

## Phase 4: Validation

1. Verify all tasks created with `list_agents()`
2. Check dependency chain integrity:
   - No circular dependencies
   - All blockedBy references exist
   - First task(s) have empty blockedBy
3. Log task count and pipeline mode

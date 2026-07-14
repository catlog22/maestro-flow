---
name: grill
prepare: grill
commands: [maestro-grill]
session-mode: inherited
---

# Workflow: Grill

## Architecture

```
Step 1: Parse & Route (mode, depth, upstream)
Step 2: Discovery (docs + codebase scan)
Step 3: Terminology Alignment (code vs proposal)
Step 4: Branch Walking (Socratic grilling loop)
Step 5: Synthesis (report + terminology)
Step 6: Context Package (context-package.json)
Step 7: Register Artifact + Wrap-up
```

---

## Step 1: Parse & Route

Parse $ARGUMENTS to determine execution mode:

**Mode Detection (ordered by priority)**:
1. `-c` / `--continue` → **Resume Mode** (find latest grill session, continue from last branch)
2. `--session ID` → **Resume Mode** (specific session)
3. `--yes` / `-y` → **Auto Mode** (code exploration replaces human answers)
4. Text provided → **Interactive Mode** (default, full Socratic grilling)
5. No args → error

**Parameter Parsing**:
- `--depth shallow|standard|deep`: branch count 3/5/8, default `standard` (5)
- `--from <source>`: upstream material to grill against
- Missing/empty args without `--from` or `--continue` = error

**Session Resolution**: Runtime handles session resolution, artifact registration, and state updates. Contract inputs are resolved and injected by the runtime via `maestro run create`.

**Output Directory Resolution**:
```
output_dir = {run_dir}/outputs/
```

---

## Step 2: Discovery

### 2.1: Load Project State

```
1. Read .workflow/project.md (if exists) → tech_stack, validated_requirements, active_requirements
2. Read .workflow/state.json (if exists) → accumulated_context, artifacts[]
3. Read .workflow/roadmap.md (if exists) → phase structure
4. specs_content = maestro spec load --category arch  # MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
5. wiki_hits = maestro wiki search "{topic keywords}"  # MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
```

### 2.2: Load Upstream Material

If `--from` specified:
- `--from blueprint:ID` → `state.json.artifacts[type=blueprint, id=ID]` → load spec package
- `--from @file` → read file directly as proposal text
- `--from path/` → read `path/` directory for markdown files

Store as `upstream_material` (in-memory).

### 2.3: Codebase Scan

MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep: spawn `Agent(subagent_type: Explore)` to map the codebase surface relevant to the topic:

```
Agent(
  subagent_type="Explore",
  prompt="""
  Search breadth: medium
  Find code relevant to: {topic}
  Report:
  1. Existing modules/files that overlap with this topic
  2. Naming conventions used (variable names, function names, types)
  3. Patterns already established (error handling, data flow, API style)
  4. Dependencies and integration points
  Return structured findings — file paths, symbol names, pattern descriptions.
  """,
  description="Codebase scan for grill context"
)
```

Store as `codebase_context`. On failure: continue without code grounding; flag grill output as [LOW CONFIDENCE] (no code grounding).

### 2.4: Initialize Report

Write `{output_dir}/grill-report.md` with header:

```markdown
# Grill Report: {topic}

**Session**: {session_id}
**Depth**: {depth} ({branch_count} branches)
**Date**: {ISO-8601}
**Upstream**: {source or "none"}

## Discovery Summary

### Project Context
{summary from Step 2.1}

### Codebase Surface
{summary from Step 2.3}

### Upstream Material
{summary from Step 2.2 or "N/A"}

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|

---
```

---

## Step 3: Terminology Alignment

### 3.1: Extract Candidate Terms

From topic + upstream, identify 5-15 domain terms (entity nouns, operation verbs, property adjectives).

### 3.2: Code Name Collision Check

For each candidate term, search the codebase:
```
Grep(pattern="{term}", output_mode="files_with_matches")
```

Build a collision table:

| Proposed Term | Code Usage | Conflict? | Resolution |
|---------------|------------|-----------|------------|
| "account" | `UserAccount` class (auth module) | Yes — ambiguous | Propose: "Organization" for billing, "UserAccount" for auth |

### 3.3: Challenge Vague Terms

For each term with conflict or ambiguity, challenge the user via AskUserQuestion:

```
AskUserQuestion({
  questions: [{
    question: "You said '{term}' — but the codebase uses '{code_name}' for {code_meaning}. Which do you mean?",
    header: "Terminology",
    options: [
      { label: "Use '{code_name}'", description: "Align with existing codebase naming" },
      { label: "New term: '{proposed}'", description: "Introduce new concept distinct from {code_name}" },
      { label: "Rename existing", description: "The existing code should adopt the new term" }
    ],
    multiSelect: false
  }]
})
```

**Auto mode (`-y`)**: Use CLI exploration to resolve — prefer existing code naming; override only when name is semantically incorrect (verify via symbol lookup).

### 3.4: Write Terminology File

Write `{output_dir}/terminology.md`:

```markdown
# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| {term} | {definition} | `{file:symbol}` or "new" | locked/open |
```

---

## Step 4: Branch Walking (Core Grilling Loop)

One branch at a time, one question per turn. Each branch fully explored before next. → Q&A mechanics follow ref/interview-mechanics.md.

### Branch Categories

| Priority | Branch | Shallow | Standard | Deep |
|----------|--------|---------|----------|------|
| 1 | Scope & Boundaries | ✓ | ✓ | ✓ |
| 2 | Data Model & State | ✓ | ✓ | ✓ |
| 3 | Edge Cases & Failure Modes | ✓ | ✓ | ✓ |
| 4 | Integration & Dependencies | | ✓ | ✓ |
| 5 | Scale & Performance | | ✓ | ✓ |
| 6 | Security & Access Control | | | ✓ |
| 7 | Observability & Operations | | | ✓ |
| 8 | Migration & Rollback | | | ✓ |

### Branch Walking Protocol

**4.1: Open the Branch**
```markdown
## Branch {N}: {branch_name}

**Status**: 🔴 In Progress
**Questions asked**: 0
**Decisions locked**: 0
```

**4.2: Generate Probing Questions**

Generate 3-5 probing questions per branch. MUST: reference code findings, use concrete scenarios, challenge assumptions, escalate from basic to adversarial.

Question patterns per branch:

**Scope & Boundaries**:
- "What is the smallest version of this that delivers value?"
- "You mentioned {feature} — does it need {sub-feature}, or is that a separate concern?"
- "The codebase already has {existing_module} — where does your proposal's boundary end and {existing_module} begin?"

**Data Model & State**:
- "What are the core entities? Walk me through their lifecycle."
- "The code uses {existing_model} — does your {proposed_entity} extend it, replace it, or coexist?"
- "What happens to {entity} when {related_entity} is deleted?"

**Edge Cases & Failure Modes**:
- "What happens when {operation} is called with {extreme_input}?"
- "If {dependency} is unavailable, what does the user see?"
- "Two users do {action} simultaneously — what wins?"

**Integration & Dependencies**:
- "Which existing modules does this touch? Show me the call chain."
- "What contract does this establish with {consumer}? What can they NOT assume?"
- "If {upstream_service} changes its API, how much of this breaks?"

**Scale & Performance**:
- "At 10x current load, which part breaks first?"
- "This query touches {table} — how many rows at steady state? At peak?"
- "What's the cache invalidation strategy? What goes stale?"

**Security & Access Control**:
- "Who can perform {action}? Who explicitly cannot?"
- "What happens if an authenticated user sends a crafted {input}?"
- "Where does PII flow? Where is it stored? Who can access it?"

**Observability & Operations**:
- "How do you know this is working correctly in production?"
- "What alert fires first when this breaks? What's the runbook?"
- "How do you debug a user report of '{symptom}'?"

**Migration & Rollback**:
- "How do you deploy this without downtime?"
- "If this fails in production, what's the rollback procedure?"
- "What data migration is needed? Is it reversible?"

**4.3: Ask One Question at a Time**

For each question in the branch:

```
AskUserQuestion({
  questions: [{
    question: "{probing_question}",
    header: "{branch_name}",
    options: [
      { label: "{option_a}", description: "{implication_a}" },
      { label: "{option_b}", description: "{implication_b}" },
      { label: "Not applicable", description: "This concern doesn't apply to this proposal" }
    ],
    multiSelect: false
  }]
})
```

**Auto mode**: Instead of asking the user, use code exploration to answer:
```
# MANDATORY, NOT SUBSTITUTABLE by manual Read/Grep
maestro delegate "PURPOSE: Answer '{question}' for the proposal '{topic}'
TASK: Search codebase for evidence | Analyze existing patterns | Determine most likely answer
MODE: analysis
CONTEXT: @**/* | Proposal: {topic_summary}
EXPECTED: Direct answer with code evidence (file:line references)
CONSTRAINTS: Answer based on code evidence only, flag uncertainty" --role analyze --mode analysis
```

**4.4: Validate Answer Against Code**

After each answer, verify against codebase:
- "We'll use X pattern" → Grep for existing X usage, confirm consistency
- "This won't affect Y" → Explore call chains to verify isolation
- Contradiction found → immediately challenge with code evidence

**4.5: Record Decision**

After each question is settled, immediately append to `grill-report.md`:

```markdown
### Q{N}.{M}: {question_summary}

**Answer**: {user_answer_or_auto_answer}
**Evidence**: {code_references_or_reasoning}
**Decision**: {locked|open|deferred}
**Constraint**: {if locked, the RFC 2119 statement — e.g., "MUST use event sourcing for audit trail"}
```

**4.6: Branch Completion**

All questions asked (or user signals "enough") → update branch status, update Branch Log table, move to next.

---

## Step 5: Synthesis

### 5.1: Decision Summary

Classify all branch decisions:

| Classification | Criteria | Downstream Use |
|----------------|----------|----------------|
| **Locked** | User confirmed + code-verified | → `constraints[]` in context-package |
| **Open** | User answered but unverified or uncertain | → `open_questions[]` in context-package |
| **Deferred** | Explicitly postponed or "not applicable" | → `non_goals[]` or future work |

### 5.2: Risk Register

```markdown
## Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
```

### 5.3: Finalize Report

Append to `grill-report.md`:

```markdown
## Synthesis

### Decision Summary
| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|

### Verified Constraints
{locked decisions with code evidence}

### Open Questions
{decisions needing further exploration}

### Risk Register
{from 5.2}

### Recommended Next Step
{routing based on findings}
```

### 5.4: Finalize Terminology

Update `{output_dir}/terminology.md` — mark all terms as locked/open based on grilling outcomes. Add any new terms surfaced during branch walking.

---

## Step 6: Generate Context Package

Write `{output_dir}/context-package.json`:

```jsonc
{
  "$schema": "context-package/1.0",
  "source": {
    "type": "grill",
    "artifact_id": "{artifact_id}",
    "session_path": "{output_dir relative to .workflow/}",
    "generated_at": "{ISO-8601}"
  },
  "requirements": [],
  "constraints": [],
  "domain": {
    "problem_statement": "",
    "terminology": [],
    "audience": "",
    "industry": ""
  },
  "non_goals": [],
  "insights": [],
  "open_questions": [],
  "references": []
}
```

**Extraction mapping**:
- `requirements[]`: locked scope decisions from Branch 1 → `{ id: "R-{NNN}", title, description, priority: "must|should|may", ref: "grill-report.md#Branch-1" }`
- `constraints[]`: all locked decisions with RFC 2119 keywords → `{ id: "C-{NNN}", area, constraint, rationale, status: "locked", ref: "grill-report.md#Q{N}.{M}" }`
- `domain.problem_statement`: from topic + synthesis
- `domain.terminology[]`: from `terminology.md` → `{ term, definition, code_ref, status: "locked|open" }`
- `non_goals[]`: deferred decisions + explicit exclusions → `{ title, rationale, ref }`
- `insights[]`: code findings that contradicted or enriched the proposal → `{ area, summary, evidence, ref }`
- `open_questions[]`: open decisions needing brainstorm/analyze exploration → `{ area, question, options[], ref }`
- `references[]`: `{ type: "grill-report", path: "grill-report.md" }`, `{ type: "terminology", path: "terminology.md" }`

---

## Step 6.5: Artifact Verification (before completion)

Verify all required artifacts exist before proceeding to artifact registration:
- `grill-report.md` — Branch Log + Q&A entries + synthesis
- `terminology.md` — ≥5 terms with code refs
- `context-package.json` — schema "context-package/1.0"

If any missing: produce the missing artifact before Step 7. Do NOT register completion without all artifacts present.

---

## Step 7: Wrap-up

### 7.1: Artifact Registration

Artifact registration and state updates are handled by `maestro run complete`.

### 7.2: Domain Knowledge Flow

Domain terms produced by Grill settle into the project knowledge base via the following path:

```
terminology.md (locked terms)  ──→  wrap-up domain extraction  ──→  .workflow/domain/glossary.yaml
context-package.json#domain.terminology[]  ──→  wrap-up domain extraction  ──→  glossary.yaml
```

- During Grill, **do NOT** call `maestro domain add` directly — terms may be modified or overturned during the grilling process
- After all terms are locked via Step 5 synthesis, extraction is automatically triggered by `manage-harvest --auto` at the end of the chain
- Domain extraction always requires interactive confirmation (`-y` has no effect on domain registration)

### 7.3: Completion Report

```
Grill session {artifact_id} completed.
- Branches walked: {N}/{total}
- Decisions locked: {N}
- Open questions: {N}
- Terms defined: {N}
- Risk items: {N}
```

→ Wrap-up follows ref/finish-work.md (SESSION_TYPE=grill, SESSION_ID={artifact_id}).

---

## Error Handling

| Error | Action |
|------|------|
| no topic and no `--from`/`--continue` | abort: missing topic, provide a plan/idea to grill |
| `--continue` but no prior grill session | abort: no session to resume, start a fresh grill |
| codebase scan found no relevant anchors (W001) | warn, proceed with reduced code-grounded challenges, mark affected branches [LOW CONFIDENCE] |
| CLI exploration failed in auto mode | retry once; if still failing, fall back to interactive Q&A for that branch |
| terminology collision unresolved | record as an open question in `grill-report.md`, do not silently pick a term |
| max branch count reached with open contradictions | force synthesis, record unresolved contradictions under Risk Register |

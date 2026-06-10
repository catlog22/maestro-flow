---
name: maestro-companion
description: Knowledge companion — load context, record companion doc, capture insights, route to skills
argument-hint: "[before|note|after|route] [--task <description>] [--type <task_type>] [--category <cat>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Skill
  - AskUserQuestion
---

<purpose>
Task companion command — pairs with any task to provide knowledge context loading,
structured companion document recording, insight capture, and skill routing.

Does not create sessions or modify workflow state. Pure side-car utility.

Four modes:
- **before** — Pre-task: load spec + knowhow index + codebase index, create companion doc
- **note** — Mid-task: append a structured entry to the active companion doc
- **after** — Post-task: review companion doc, promote entries to spec/knowhow, suggest next steps
- **route** — Routing: recommend next skill/command based on intent

No arguments → auto-detect: uncommitted changes → `after`, else → `before`.
</purpose>

<context>
$ARGUMENTS — mode + optional flags.

**Mode detection priority:**
1. Explicit `before` / `note` / `after` / `route`
2. Intent text that is not a mode keyword → `route`
3. No arguments → auto-detect (`git status` has changes → `after`, else → `before`)

**Flags:**
- `--task <description>` — Current task description (for targeted knowledge loading and doc title)
- `--type <task_type>` — Task type for field template selection (see task types below)
- `--category <cat>` — Spec category filter: coding / arch / test / review / debug / learning / ui

**Task types** (determines which recording sections are active):

| Type | Description | Key sections |
|------|-------------|--------------|
| `implement` | Feature development, code writing | working_files, dependencies, decisions, tests_affected |
| `debug` | Bug investigation, root cause analysis | symptoms, hypotheses, evidence, root_cause, fix_applied |
| `analyze` | Code/architecture/performance analysis | scope, findings, risks, recommendations |
| `design` | Architecture/UI/API design | constraints, alternatives, trade_offs, chosen_approach |
| `plan` | Task decomposition, roadmap planning | goals, breakdown, estimates, dependencies |
| `review` | Code review, PR review | files_reviewed, findings, severity_counts, verdict |
| `test` | Test writing, UAT, coverage expansion | coverage_before, coverage_after, gaps, test_files |
| `refactor` | Code restructuring, tech debt | affected_modules, before_after, breaking_changes |
| `learn` | Codebase exploration, knowledge building | questions, answers, mental_model, references |
| `general` | Default / unclassified | (all universal sections) |

Auto-detection: if `--type` not provided, infer from `--task` description keywords.

**Companion document:**
- Path: `.workflow/.scratchpad/companion-{YYYYMMDD-HHmmss}.md`
- Active doc tracking: `.workflow/.scratchpad/.companion-active` (stores path of current companion doc)
- Format: YAML frontmatter (rich metadata) + typed sections + timestamped entries
</context>

<state_machine>

<states>
S_PARSE    — Parse arguments, detect mode, resolve task type
S_BEFORE   — Load knowledge context, create companion doc with typed template
S_NOTE     — Append structured entry to active companion doc
S_AFTER    — Review companion doc, populate outcome, promote entries, suggest next steps
S_ROUTE    — Skill routing via maestro-next
</states>

<transitions>

S_PARSE:
  → S_BEFORE   WHEN: mode == "before" OR (no args AND no uncommitted changes)
  → S_NOTE     WHEN: mode == "note"
  → S_AFTER    WHEN: mode == "after" OR (no args AND has uncommitted changes)
  → S_ROUTE    WHEN: mode == "route" OR intent text present

</transitions>

</state_machine>

<execution>

## S_BEFORE — Knowledge Loading + Companion Doc Creation

Execute in order, skip unavailable steps:

### 1. Load specs

```bash
# With --category: load by category
maestro spec load --category <cat>

# With --task: load by keyword extracted from task description
maestro spec load --keyword <extracted_keyword>

# No flags: load coding (most universal)
maestro spec load --category coding
```

Display loaded rules summary (entry count + key rule names).

### 2. Browse knowhow index

```bash
# List recent knowhow entries
maestro knowhow list --store workflow

# With --task: search relevant entries
maestro search --type knowhow "<task_keyword>"
```

Display available knowhow entries (ID + title). Hint: `maestro wiki load <id>` for details.

### 3. Check codebase index

```bash
ls .workflow/codebase/doc-index.json
```

- Exists → display "Codebase docs ready, last updated: {timestamp}"
- Missing → suggest `/manage-codebase-rebuild`
- Stale (>7 days) → suggest `/quality-sync`

### 4. Create companion document

Create `.workflow/.scratchpad/` if needed. Resolve task type from `--type` flag or infer from `--task` keywords.

Write companion doc with the full field template:

```markdown
---
# === Identity ===
task: "{task_description or 'Untitled task'}"
task_type: "{resolved type: implement|debug|analyze|design|plan|review|test|refactor|learn|general}"
created: "{ISO timestamp}"
status: active

# === Context Loaded ===
specs_loaded: "{category or 'coding'}"
specs_count: {N}
knowhow_searched: "{keyword or 'none'}"
knowhow_available: {M}
codebase_index: "{ready|missing|stale}"
branch: "{current git branch}"
phase: "{current phase from state.json or 'none'}"
milestone: "{current milestone from state.json or 'none'}"

# === Scope ===
working_files: []
dependencies: []
related_artifacts: []

# === Outcome (populated by after mode) ===
outcome: ""
files_changed: []
promoted_specs: 0
promoted_knowhow: 0
follow_up: []
completed: ""
---

# Companion Doc — {task_description}

> `/maestro-companion note "<content>"` — add entries
> `/maestro-companion after` — review, promote, close

## Context

{Type-specific context section — see templates below}

## Entries

## Summary
```

**Type-specific context templates** (written into `## Context`):

**implement:**
```markdown
### Working Files
| File | Role | Status |
|------|------|--------|

### Dependencies
- (modules, APIs, or services this task depends on)

### Decisions
| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|

### Tests Affected
- (test files that need creation or update)
```

**debug:**
```markdown
### Symptoms
- (observable behavior vs expected behavior)

### Hypotheses
| # | Hypothesis | Status | Evidence |
|---|-----------|--------|----------|

### Evidence Trail
| Time | Source | Type | Finding |
|------|--------|------|---------|

### Root Cause
- (populated when identified)

### Fix Applied
- (description of fix, files changed)
```

**analyze:**
```markdown
### Scope
- (what is being analyzed and boundaries)

### Findings
| # | Finding | Severity | Location |
|---|---------|----------|----------|

### Risks
- (identified risks or concerns)

### Recommendations
- (actionable recommendations)
```

**design:**
```markdown
### Constraints
- (hard limits, requirements, compatibility needs)

### Alternatives
| # | Approach | Pros | Cons |
|---|----------|------|------|

### Trade-offs
- (key trade-off decisions and rationale)

### Chosen Approach
- (selected design with justification)
```

**plan:**
```markdown
### Goals
- (what success looks like)

### Breakdown
| # | Task | Estimate | Depends On | Status |
|---|------|----------|------------|--------|

### Dependencies
- (external dependencies, blockers, prerequisites)
```

**review:**
```markdown
### Files Reviewed
| File | Lines | Findings |
|------|-------|----------|

### Findings
| # | Severity | Category | File:Line | Description |
|---|----------|----------|-----------|-------------|

### Verdict
- (pass / pass-with-concerns / fail)
```

**test:**
```markdown
### Coverage
- Before: {%}
- After: {%}
- Target: {%}

### Test Files
| File | Type | Tests Added | Status |
|------|------|------------|--------|

### Gaps
- (uncovered paths or scenarios)
```

**refactor:**
```markdown
### Affected Modules
- (modules being restructured)

### Before / After
| Aspect | Before | After |
|--------|--------|-------|

### Breaking Changes
- (API or behavior changes that affect consumers)
```

**learn:**
```markdown
### Questions
| # | Question | Answered | Source |
|---|----------|----------|--------|

### Mental Model
- (evolving understanding of how it works)

### References
- (files, docs, wiki entries consulted)
```

**general:**
```markdown
### Notes
- (general working notes)
```

Write the companion doc path to `.workflow/.scratchpad/.companion-active`.

### 5. Output summary card

```
Knowledge context loaded
  Spec:     {N} rules ({category})
  Knowhow:  {M} entries available
  Codebase: {status}
  Doc:      {companion_doc_path} [{task_type}]

Mid-task commands:
  /maestro-companion note "finding or decision"
  /maestro-companion note --file src/auth.ts "changed token validation"
  /spec-load --keyword <keyword>
  maestro search "<query>"
```

---

## S_NOTE — Append Structured Entry to Companion Doc

### 1. Locate active companion doc

Read `.workflow/.scratchpad/.companion-active` to get the doc path.
If missing or file not found → create a new companion doc (same as S_BEFORE step 4, minimal — no spec/knowhow loading).

### 2. Parse entry content and flags

Parse $ARGUMENTS after `note` keyword:
- `--file <path>` — associate entry with a specific file (appended to frontmatter `working_files`)
- `--severity <level>` — for findings: critical / high / medium / low
- Remaining text = entry content

### 3. Classify entry type

Auto-classify from content signals:

| Content signal | Type tag |
|---------------|----------|
| "decided/decision/chose/picked/went with" | `decision` |
| "pattern/convention/rule/always/never/must" | `spec-candidate` |
| "pitfall/gotcha/careful/warning/trap/beware" | `pitfall` |
| "learned/realized/discovered/understood/turns out" | `insight` |
| "hypothesis/suspect/might be/could be" | `hypothesis` |
| "found bug/root cause/because of/caused by" | `evidence` |
| "risk/concern/worry/might break" | `risk` |
| "todo/need to/should also/follow up/remaining" | `todo` |
| "question/why does/how does/unclear" | `question` |
| "blocked/stuck/can't/impossible" | `blocker` |
| Default | `note` |

### 4. Append entry

Append to the companion doc under `## Entries`:

```markdown
### [{type}] {HH:mm} — {first line of content}

{full content}

{if --file: **File:** `{path}`}
{if --severity: **Severity:** {level}}
```

### 5. Update frontmatter fields

- If `--file` provided and not already in `working_files` → append to `working_files`
- If type is `decision` → also append row to `### Decisions` table (if implement/design type doc)
- If type is `hypothesis` → also append row to `### Hypotheses` table (if debug type doc)
- If type is `evidence` → also append row to `### Evidence Trail` table (if debug type doc)
- If type is `risk` → also append to `### Risks` list (if analyze/design type doc)
- If type is `question` → also append row to `### Questions` table (if learn type doc)

### 6. Confirm

```
[{type}] entry added to companion doc
  /maestro-companion note "..."  — add more
  /maestro-companion after       — review & promote
```

---

## S_AFTER — Review Companion Doc + Populate Outcome + Promote Entries + Route

### 1. Load companion doc

Read `.workflow/.scratchpad/.companion-active` → read the companion doc.
If no active doc or doc is empty → skip to step 4 (accumulation reminder).

### 2. Populate outcome fields

Collect task outcome data:

```bash
# Detect files changed since companion doc creation
git diff --name-only --since="{companion_created_timestamp}"
```

Update frontmatter:
- `files_changed` — from git diff
- `completed` — current ISO timestamp
- `status` — `completed`

Display entry summary:
```
Companion doc review — {task_type}
  Entries:    {total} ({by type breakdown})
  Files:      {files_changed count} changed
  Duration:   {elapsed since created}

Promotable entries:
  {list of decision/spec-candidate/pitfall/insight entries}
```

### 3. Promote entries

If promotable entries exist, AskUserQuestion:

- Option 1: "Promote to spec" — short coding/arch/test constraint
- Option 2: "Promote to knowhow" — detailed recipe/template/decision/tip
- Option 3: "Promote both" — spec index entry + knowhow document
- Option 4: "Skip — nothing to promote"

**Routing by selection:**

| Selection | Action |
|-----------|--------|
| Spec | `Skill("spec-add", args)` — guide user through category + content |
| Knowhow | `Skill("manage-knowhow-capture", args)` — guide through type + content |
| Both | `Skill("spec-add")` first, then `Skill("manage-knowhow-capture")` |
| Skip | Proceed to step 4 |

Update frontmatter: `promoted_specs`, `promoted_knowhow` counts.

Extract any `todo` entries → write to `follow_up` in frontmatter.

Clear `.workflow/.scratchpad/.companion-active`.

### 4. Output accumulation reminder + routing

```
Knowledge accumulation reminders:
  Reusable pattern found?        /spec-add <category> "title" "content" --description "summary"
  Solved a complex problem?      /manage-knowhow-capture recipe "description"
  Made an architecture decision? /manage-knowhow-capture decision "description"
  Discovered a useful trick?     /manage-knowhow-capture tip "content"

Next steps:
  /maestro-next          — recommend next command
  /maestro "<intent>"    — route intent to full workflow
  /manage-status         — view project dashboard
```

---

## S_ROUTE — Skill Routing

### 1. Parse intent

Extract intent text from $ARGUMENTS after removing the `route` keyword.

### 2. Delegate to maestro-next

```
Skill("maestro-next", "<intent_text>")
```

Reuses maestro-next routing table and scoring logic to recommend the best single command.

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| W001 | warning | `.workflow/specs/` not initialized | Suggest `/spec-setup` |
| W002 | warning | `.workflow/knowhow/` is empty | Normal, skip knowhow index |
| W003 | warning | `.workflow/codebase/` does not exist | Suggest `/manage-codebase-rebuild` |
| W004 | warning | No active companion doc found (note/after mode) | Create new doc or skip |
</error_codes>

<success_criteria>
- [ ] Mode correctly detected (before/note/after/route)
- [ ] Task type resolved from --type flag or inferred from --task keywords
- [ ] before: spec + knowhow + codebase indexes loaded or hints given
- [ ] before: companion doc created with full YAML frontmatter (identity + context + scope + outcome placeholders)
- [ ] before: type-specific context template written (matching task_type)
- [ ] before: active doc path written to `.companion-active`
- [ ] before: summary card output with mid-task command hints
- [ ] note: active companion doc located and entry appended with type tag
- [ ] note: entry type auto-classified from content signals (11 type tags)
- [ ] note: --file flag updates working_files in frontmatter
- [ ] note: typed entries cross-posted to matching context tables (decisions→Decisions, hypothesis→Hypotheses, etc.)
- [ ] after: companion doc entries reviewed and promotable items identified
- [ ] after: outcome fields populated (files_changed, completed, status)
- [ ] after: AskUserQuestion routes to spec-add or manage-knowhow-capture
- [ ] after: todo entries extracted to follow_up field
- [ ] after: companion doc marked completed, active pointer cleared
- [ ] after: accumulation reminder + next-step routing displayed
- [ ] route: intent correctly forwarded to maestro-next
- [ ] No session created, no state.json modified
</success_criteria>

# Tuning Strategies

Fix strategies for each problem category. Implementation patterns + verification methods.

## Usage Context

| Phase | Usage |
|-------|-------|
| action-propose-fixes | Strategy selection + implementation guidance |
| action-apply-fix | Apply implementation pattern |
| action-verify | Run verification method |

---

## Selection Decision Tree

```
Context Explosion?
├── history grows unbounded? → sliding_window
├── full content in prompts? → path_reference
├── no summarization? → context_summarization
└── text-based context? → structured_state

Long-tail Forgetting?
├── constraints not in phases? → constraint_injection
├── no requirements in state? → state_constraints_field
├── no recovery points? → checkpoint_restore
└── goal drift risk? → goal_embedding

Data Flow?
├── multiple state files? → state_centralization
├── no validation? → schema_enforcement
└── inconsistent names? → field_normalization

Agent Coordination?
├── no error handling? → error_wrapping
├── no result validation? → result_validation
└── nested agent calls? → flatten_nesting

Authoring Violation?
├── intermediate files? → eliminate_intermediate_files
├── state bloat (>15 fields)? → minimize_state
├── write→read relay? → context_passing
└── duplicate storage? → deduplicate_storage

Token Consumption?
├── verbose prompts? → prompt_compression
├── full content passing? → lazy_loading
├── verbose output? → output_minimization
├── bloated state? → state_field_reduction
└── multiple output files? → in_memory_consolidation

Documentation?
├── repeated definitions? → consolidate_to_ssot
├── hardcoded configs? → centralize_mapping_config
└── conflicting values? → reconcile_conflicting_definitions
```

---

## Authoring Principles Strategies (P0)

> **Core Principle**: Simplicity → Remove intermediate files → Context passing

### eliminate_intermediate_files

```javascript
// Before: File relay between steps
const step1 = await analyze();
Write(`${workDir}/step1.json`, JSON.stringify(step1));
const step1Data = JSON.parse(Read(`${workDir}/step1.json`));
const step2 = await transform(step1Data);

// After: Direct context passing
const step1 = await analyze();
const step2 = await transform(step1);  // No file
return finalize(step2);                // Only final result persisted
```

**Verification**: `ls ${workDir}` — no temp/intermediate files

### minimize_state

**Rules**: ≤15 fields, delete `debug_*`, `*_cache`, `*_temp`, apply sliding window to `*_history`.

```typescript
// Before: Bloated
interface State { status; target; user_input; parsed_input; intermediate_result; debug_info; analysis_cache; full_history; step1_output; step2_output; final_result; ... }

// After: Minimal
interface State {
  status: 'pending'|'running'|'completed'|'failed';
  target: { name: string; path: string };
  result_path: string;
  error?: string;
}
```

### context_passing

```javascript
async function executeWorkflow(initialContext) {
  let ctx = initialContext;
  ctx = await executePhase1(ctx);   // Pass context directly
  ctx = await executePhase2(ctx);   // Continue passing
  const result = await executePhase3(ctx);
  Write(`${ctx.workDir}/result.json`, JSON.stringify(result));  // Only final
  return result;
}
```

### deduplicate_storage

```javascript
// Before: state.user_request = state.original_request = state.input_text = input
// After:  state.input = input;  // Single source
```

---

## Context Explosion Strategies

### sliding_window

```javascript
const MAX_HISTORY = 5;
function updateHistory(state, newItem) {
  return { ...state, history: [...(state.history || []), newItem].slice(-MAX_HISTORY) };
}
```

### path_reference

```javascript
// Before: const prompt = `Analyze: ${Read('data.json')}`;
// After:  const prompt = `Analyze file at: ${dataPath}. Read it first.`;
```

### context_summarization

```javascript
// Add summarization before passing to next phase
const summary = await Agent({
  subagent_type: 'universal-executor',
  description: 'Summarize content for context compression',
  run_in_background: false,
  prompt: `Summarize in <100 words: ${fullContent}\nReturn JSON: { summary, key_points[] }`
});
nextPhasePrompt = `Previous summary: ${summary.summary}`;
```

---

## Long-tail Forgetting Strategies

### constraint_injection

```javascript
// Add to EVERY phase prompt
const phasePrompt = `
[CONSTRAINTS - FROM ORIGINAL REQUEST]
${state.original_requirements.map(r => `- ${r}`).join('\n')}

[CURRENT TASK]
${taskDescription}

[REMINDER] Output MUST satisfy all constraints above.
`;
```

### state_constraints_field

Add to state-schema + action-init:
```javascript
state.original_requirements = extractRequirements(userInput);
state.goal_summary = summarizeGoal(userInput);
```

### checkpoint_restore

```javascript
function createCheckpoint(state, workDir, name) {
  Write(`${workDir}/checkpoints/${name}.json`, JSON.stringify({
    state, timestamp: new Date().toISOString(), name
  }));
}
// Use at key phase boundaries
```

---

## Data Flow Strategies

### state_centralization

```javascript
// Single state manager — replace all direct writes
const StateManager = {
  read: (dir) => JSON.parse(Read(`${dir}/state.json`)),
  update: (dir, updates) => {
    const next = { ...StateManager.read(dir), ...updates, updated_at: Date.now() };
    Write(`${dir}/state.json`, JSON.stringify(next, null, 2));
    return next;
  }
};
```

### schema_enforcement

```javascript
function validateState(state) {
  const errors = [];
  if (!['pending','running','completed','failed'].includes(state.status))
    errors.push(`Invalid status: ${state.status}`);
  if (typeof state.target_skill?.name !== 'string')
    errors.push('target_skill.name must be string');
  if (errors.length) throw new Error(`Validation failed:\n${errors.join('\n')}`);
}
// Call before every state write
```

### field_normalization

```javascript
const NORMALIZATIONS = { 'title': 'name', 'identifier': 'id', 'state': 'status' };
function normalizeData(data) {
  if (typeof data !== 'object' || !data) return data;
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [NORMALIZATIONS[k] || k, normalizeData(v)])
  );
}
```

---

## Agent Coordination Strategies

### error_wrapping

```javascript
async function safeTask(config, state, updateState) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await Task(config);
      if (!result) throw new Error('Empty result');
      return result;
    } catch (error) {
      if (attempt === 3) {
        updateState({ error_count: state.error_count + 1 });
        throw error;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}
```

### result_validation

```javascript
function validateAgentResult(result, requiredFields) {
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  for (const field of requiredFields) {
    if (!(field in parsed)) throw new Error(`Missing: ${field}`);
  }
  return parsed;
}
```

### flatten_nesting

```javascript
// Before: Agent A's prompt tells it to call Agent({subagent_type: 'B'})
// After: Agent A returns signal, orchestrator handles
// Agent A: return { needs_agent_b: true, context: {...} }
// Orchestrator:
if (parsedA.needs_agent_b) {
  resultB = await Agent({
    subagent_type: 'B',
    description: 'Handle delegated task from Agent A',
    run_in_background: false,
    prompt: `Context: ${parsedA.context}`
  });
}
```

---

## Token Consumption Strategies

### prompt_compression

```javascript
// Before: Long inline prompt with role, detailed instructions, full code
// After: Key instructions only
const prompt = `Analyze ${codePath} for: patterns, security, performance.
Return JSON: { issues: [], severity: string }`;
```

### lazy_loading

```javascript
// Before: const prompt = `Analyze:\n${Read(filePath)}`;
// After:  const prompt = `Analyze file at: ${filePath}\n(Read if needed)\nReturn: { summary, issues[] }`;
```

### output_minimization

```javascript
const prompt = `
Analyze the code. Return ONLY this JSON:
{ "status": "pass|review|fail", "issues": [{"id","severity","file","line"}], "summary": "one sentence" }
Do not include explanations.
`;
```

### state_field_reduction

Audit checklist:
```javascript
function auditStateFields(schema) {
  const candidates = Object.keys(schema).filter(k =>
    k.startsWith('debug_') || k.endsWith('_cache') ||
    k.endsWith('_temp') || k.includes('intermediate')
  );
  return { total: Object.keys(schema).length, removable: candidates };
}
```

### in_memory_consolidation

```javascript
// Before: Multiple files — diagnosis-report.md, summary.json, tuning-report.md
// After: Single state.json with final_report rendered on demand
const consolidated = { ...state, final_report: { summary, generated_at: Date.now() } };
Write(`${workDir}/state.json`, JSON.stringify(consolidated, null, 2));
```

---

## Documentation Strategies

### consolidate_to_ssot

```javascript
// 1. Identify canonical source (priority: specs/ > phases/ > SKILL.md)
// 2. Ensure canonical has full definition
// 3. Replace other locations with reference links
//    e.g., "See [state-schema.md](phases/state-schema.md)"
```

### centralize_mapping_config

```javascript
// 1. Extract hardcoded mappings → specs/category-mappings.json
// 2. Runtime loads config: const map = JSON.parse(Read('specs/category-mappings.json'));
// 3. Replace all inline definitions with config lookup
```

### reconcile_conflicting_definitions

```javascript
// 1. Present conflict to user via AskUserQuestion
// 2. Apply chosen version across all files
// 3. Verify no remaining conflicts
```

---

## General Optimization Areas (via Agy CLI)

For issues in these categories, use Agy CLI for custom analysis:

| Category | Issues | Agy Analysis |
|----------|--------|-----------------|
| Prompt Engineering | Vague instructions, format drift | prompt optimization, structured output |
| Architecture | Phase overlap, tight coupling | phase_decomposition, interface_contracts |
| Performance | Slow execution, high tokens | token_budgeting, parallel_execution |
| Error Handling | Silent failures, no degradation | graceful_degradation, error_propagation |
| Output Quality | Inconsistent results | quality_gates, output_validation |
| User Experience | No progress visibility | progress_tracking, interactive_checkpoints |

**Agy CLI Template**:
```bash
maestro delegate "
PURPOSE: [optimization goal for skill at ${skillPath}]
TASK: • [specific analysis steps]
MODE: analysis
CONTEXT: @${skillPath}/**/*
EXPECTED: [specific deliverable]
" --tool agy --mode analysis
```

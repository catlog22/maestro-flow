

# Problem Taxonomy

Classification of skill execution issues with detection patterns and severity criteria.

## Quick Reference

| Category | Priority | Detection | Fix Strategy |
|----------|----------|-----------|--------------|
| Authoring Violation | P0 | Intermediate files, state bloat, file relay | eliminate_intermediate, minimize_state |
| Data Flow Disruption | P1 | Scattered state, inconsistent formats | state_centralization, schema_enforcement |
| Agent Coordination | P2 | Fragile chains, no error handling | error_wrapping, result_validation |
| Context Explosion | P3 | Unbounded history, full content passing | sliding_window, path_reference |
| Long-tail Forgetting | P4 | Early constraint loss | constraint_injection, checkpoint_restore |
| Token Consumption | P5 | Verbose prompts, redundant I/O | prompt_compression, lazy_loading |
| Doc Redundancy | P6 | Repeated definitions | consolidate_to_ssot |
| Doc Conflict | P7 | Inconsistent definitions | reconcile_definitions |

---

## 0. Authoring Principles Violation (P0)

**Definition**: Violates skill authoring principles (simplicity, no intermediate files, context passing).

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| APV-001 | `/Write\([^)]*temp-\|intermediate-/` | Intermediate file writes |
| APV-002 | `/Write\([^)]+\)[\s\S]{0,50}Read\([^)]+\)/` | Write-then-read relay |
| APV-003 | State schema > 15 fields | Excessive state fields |
| APV-004 | `/_history\s*[.=].*push\|concat/` | Unbounded array growth |
| APV-005 | `/debug_\|_cache\|_temp/` in state | Debug/cache field residue |
| APV-006 | Same data in multiple fields | Duplicate storage |

**Impact**: Critical (>5 intermediate files), High (>20 state fields), Medium (debug fields), Low (naming issues)

---

## 1. Context Explosion (P3)

**Definition**: Unbounded token accumulation causing prompt size growth.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| CTX-001 | `/history\s*[.=].*push\|concat/` | History array growth |
| CTX-002 | `/JSON\.stringify\s*\(\s*state\s*\)/` | Full state serialization |
| CTX-003 | `/Read\([^)]+\)\s*[\+,]/` | Multiple file content concatenation |
| CTX-004 | `/return\s*\{[^}]*content:/` | Agent returning full content |
| CTX-005 | File > 5000 chars without summarization | Long prompts |

**Impact**: Critical (>128K tokens), High (>50K per iteration), Medium (10%+ growth), Low (manageable)

---

## 2. Long-tail Forgetting (P4)

**Definition**: Loss of early instructions/constraints in long chains.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| MEM-001 | Later phases missing constraint reference | Constraint not forwarded |
| MEM-002 | `/\[TASK\][^[]*(?!\[CONSTRAINTS\])/` | Task without constraints section |
| MEM-003 | Key phases without checkpoint | Missing state preservation |
| MEM-004 | State lacks `original_requirements` | No constraint persistence |
| MEM-005 | No verification phase | Output not checked against intent |

**Impact**: Critical (goal lost), High (constraints ignored), Medium (some missing), Low (minor drift)

---

## 3. Data Flow Disruption (P1)

**Definition**: Inconsistent state management causing data loss/corruption.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| DF-001 | Multiple state file writes | Scattered state storage |
| DF-002 | Same concept, different names | Field naming inconsistency |
| DF-003 | JSON.parse without validation | Missing schema validation |
| DF-004 | Files written but never read | Orphaned outputs |
| DF-005 | Autonomous skill without state-schema | Undefined state structure |

**Impact**: Critical (data loss), High (state inconsistency), Medium (potential inconsistency), Low (naming)

---

## 4. Agent Coordination Failure (P2)

**Definition**: Fragile agent call patterns causing cascading failures.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| AGT-001 | Task without try-catch | Missing error handling |
| AGT-002 | Result used without validation | No return value check |
| AGT-003 | >3 different agent types | Agent type proliferation |
| AGT-004 | Nested Task in prompt | Agent calling agent |
| AGT-005 | Task used but not in allowed-tools | Tool declaration mismatch |
| AGT-006 | Multiple return formats | Inconsistent agent output |

**Impact**: Critical (crash on failure), High (unpredictable behavior), Medium (occasional issues), Low (minor)

---

## 5. Documentation Redundancy (P6)

**Definition**: Same definition (State Schema, mappings, types) repeated across files.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| DOC-RED-001 | Cross-file semantic comparison | State Schema duplication |
| DOC-RED-002 | Code block vs spec comparison | Hardcoded config duplication |
| DOC-RED-003 | `/interface\s+(\w+)/` same-name scan | Interface/type duplication |

**Impact**: High (core definitions), Medium (type definitions), Low (example code)

---

## 6. Token Consumption (P5)

**Definition**: Excessive token usage from verbose prompts, large state, inefficient I/O.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| TKN-001 | File size > 4KB | Verbose prompt files |
| TKN-002 | State fields > 15 | Excessive state schema |
| TKN-003 | `/Read\([^)]+\)\s*[\+,]/` | Full content passing |
| TKN-004 | `/.push\|concat(?!.*\.slice)/` | Unbounded array growth |
| TKN-005 | `/Write\([^)]+\)[\s\S]{0,100}Read\([^)]+\)/` | Write-then-read pattern |

**Impact**: High (multiple TKN-003/004), Medium (verbose files), Low (minor optimization)

---

## 7. Documentation Conflict (P7)

**Definition**: Same concept defined inconsistently across files.

**Detection Patterns**:

| Pattern ID | Check | Description |
|------------|-------|-------------|
| DOC-CON-001 | Key-value consistency check | Same key, different values |
| DOC-CON-002 | Implementation vs docs comparison | Hardcoded vs documented mismatch |

**Impact**: Critical (priority/category conflicts), High (strategy mapping inconsistency), Medium (example mismatch)

---

## Severity Calculation

```javascript
function calculateSeverity(issue) {
  const weights = { execution: 40, data_integrity: 30, frequency: 20, complexity: 10 };
  let score = 0;

  if (issue.blocks_execution) score += weights.execution;
  if (issue.causes_data_loss) score += weights.data_integrity;
  if (issue.occurs_every_run) score += weights.frequency;
  if (issue.fix_complexity === 'low') score += weights.complexity;

  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}
```

---

## Fix Mapping

| Problem | Strategies (priority order) |
|---------|---------------------------|
| Authoring Violation | eliminate_intermediate_files, minimize_state, context_passing |
| Context Explosion | sliding_window, path_reference, context_summarization |
| Long-tail Forgetting | constraint_injection, state_constraints_field, checkpoint |
| Data Flow Disruption | state_centralization, schema_enforcement, field_normalization |
| Agent Coordination | error_wrapping, result_validation, flatten_nesting |
| Token Consumption | prompt_compression, lazy_loading, output_minimization, state_field_reduction |
| Doc Redundancy | consolidate_to_ssot, centralize_mapping_config |
| Doc Conflict | reconcile_conflicting_definitions |

---

## Cross-Category Dependencies

```
Context Explosion → Long-tail Forgetting
  (Large context pushes important info out)

Data Flow Disruption → Agent Coordination Failure
  (Inconsistent data causes agent failures)

Agent Coordination Failure → Context Explosion
  (Failed retries add to context)
```

**Fix Order**: P1 Data Flow → P2 Agent → P3 Context → P4 Memory

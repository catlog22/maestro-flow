---
role: scanner
prefix: TDSCAN
inner_loop: false
message_types: [state_update]
---

# Tech Debt Scanner

Multi-dimension tech debt scanner. Scan codebase across 5 dimensions (code, architecture, testing, dependency, documentation), produce structured debt inventory with severity rankings.

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Scan scope | task description (regex: `scope:\s*(.+)`) | No (default: `**/*`) |
| Session path | task description (regex: `session:\s*(.+)`) | Yes |
| .msg/meta.json | <session>/.msg/meta.json | Yes |

1. Extract session path and scan scope from task description
2. Load debug specs: Run `ccw spec load --category debug` for known issues, workarounds, and root-cause notes
3. Read .msg/meta.json for team context
3. Detect project type and framework:

| Signal File | Project Type |
|-------------|-------------|
| package.json + React/Vue/Angular | Frontend Node |
| package.json + Express/Fastify/NestJS | Backend Node |
| pyproject.toml / requirements.txt | Python |
| go.mod | Go |
| No detection | Generic |

4. Determine scan dimensions (default: code, architecture, testing, dependency, documentation)
5. Detect perspectives from task description:

| Condition | Perspective |
|-----------|-------------|
| `security\|auth\|inject\|xss` | security |
| `performance\|speed\|optimize` | performance |
| `quality\|clean\|maintain\|debt` | code-quality |
| `architect\|pattern\|structure` | architecture |
| Default | code-quality + architecture |

6. Assess complexity:

| Score | Complexity | Strategy |
|-------|------------|----------|
| >= 4 | High | Triple Fan-out: CLI explore + CLI 5 dimensions + multi-perspective Gemini |
| 2-3 | Medium | Dual Fan-out: CLI explore + CLI 3 dimensions |
| 0-1 | Low | Inline: ACE search + Grep |

## Phase 3: Multi-Dimension Scan

**Low Complexity** (inline):
- Use `mcp__ace-tool__search_context` for code smells, TODO/FIXME, deprecated APIs, complex functions, dead code, missing tests
- Classify findings into dimensions

**Medium/High Complexity** (Fan-out):
- Fan-out A: CLI exploration (structure, patterns, dependencies angles) via `maestro delegate --role explore --mode analysis`
- Fan-out B: CLI dimension analysis (parallel per dimension -- code, architecture, testing, dependency, documentation) via `--role analyze`
- Fan-out C (High only): Multi-perspective analysis (security, performance, code-quality, architecture) via `--role analyze`
- Fan-in: Merge results, cross-deduplicate by file:line, boost severity for multi-source findings

**Standardize each finding**:

| Field | Description |
|-------|-------------|
| `id` | `TD-NNN` (sequential) |
| `dimension` | code, architecture, testing, dependency, documentation |
| `severity` | critical, high, medium, low |
| `file` | File path |
| `line` | Line number |
| `description` | Issue description |
| `suggestion` | Fix suggestion |
| `estimated_effort` | small, medium, large, unknown |

### Tech Profile Scan

After multi-dimension scan, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check debt dimensions → signals (`legacy_patterns`, `test_gap`, `perf_sensitive`)
2. Check detected patterns → risk signals (`sql_detected`, `auth_detected`, `scaling_concern`, `injection_risk`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Aggregate & Save

1. Deduplicate findings across Fan-out layers (file:line key), merge cross-references
2. Sort by severity (cross-referenced items boosted)
3. Write `<session>/scan/debt-inventory.json` with scan_date, dimensions, total_items, by_dimension, by_severity, items
4. Update .msg/meta.json with `debt_inventory` array and `debt_score_before` count

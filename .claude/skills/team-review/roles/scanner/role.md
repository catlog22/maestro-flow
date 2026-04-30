---
role: scanner
prefix: SCAN
inner_loop: false
message_types:
  success: scan_complete
  error: error
---

# Code Scanner

Toolchain + LLM semantic scan producing structured findings. Static analysis tools in parallel, then LLM for issues tools miss. Read-only -- never modifies source code. 4-dimension system: security (SEC), correctness (COR), performance (PRF), maintainability (MNT).

## Phase 2: Context & Toolchain Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | <session>/.msg/meta.json | No |

1. Extract session path, target, dimensions, quick flag from task description
2. Resolve target files (glob pattern or directory -> `**/*.{ts,tsx,js,jsx,py,go,java,rs}`)
3. If no source files found -> report empty, complete task cleanly
4. Detect toolchain availability:

| Tool | Detection | Dimension |
|------|-----------|-----------|
| tsc | `tsconfig.json` exists | COR |
| eslint | `.eslintrc*` or `eslint` in package.json | COR/MNT |
| semgrep | `.semgrep.yml` exists | SEC |
| ruff | `pyproject.toml` + ruff available | SEC/COR/MNT |
| mypy | mypy available + `pyproject.toml` | COR |
| npmAudit | `package-lock.json` exists | SEC |

5. Load wisdom files from `<session>/wisdom/` if they exist

## Phase 3: Scan Execution

**Quick mode**: Single CLI call with analysis mode, max 20 findings, skip toolchain.

**Standard mode** (sequential):

### 3A: Toolchain Scan
Run detected tools in parallel via Bash backgrounding. Each tool writes to `<session>/scan/tmp/<tool>.{json|txt}`. After `wait`, parse each output into normalized findings:
- tsc: `file(line,col): error TSxxxx: msg` -> dimension=correctness, source=tool:tsc
- eslint: JSON array -> severity 2=correctness/high, else=maintainability/medium
- semgrep: `{results[]}` -> dimension=security, severity from extra.severity
- ruff: `[{code,message,filename}]` -> S*=security, F*/B*=correctness, else=maintainability
- mypy: `file:line: error: msg [code]` -> dimension=correctness
- npm audit: `{vulnerabilities:{}}` -> dimension=security, category=dependency

Write `<session>/scan/toolchain-findings.json`.

### 3B: Semantic Scan (LLM via CLI)
Build prompt with target file patterns, toolchain dedup summary, and per-dimension focus areas:
- SEC: Business logic vulnerabilities, privilege escalation, sensitive data flow, auth bypass
- COR: Logic errors, unhandled exception paths, state management bugs, race conditions
- PRF: Algorithm complexity, N+1 queries, unnecessary sync, memory leaks, missing caching
- MNT: Architectural coupling, abstraction leaks, convention violations, dead code

Execute via `maestro delegate --role review --mode analysis --rule analysis-review-code-quality`. Parse JSON array response, validate required fields (dimension, title, location.file), enforce per-dimension limit (max 5 each), filter minimum severity (medium+). Write `<session>/scan/semantic-findings.json`.

### Tech Profile Scan

After scan execution, emit context-aware trigger signals (based on detected codebase characteristics):

1. Check security findings → signals (`injection_risk`, `eval_usage`, `sql_detected`, `auth_detected`)
2. Check quality findings → risk signals (`legacy_patterns`, `test_gap`, `perf_sensitive`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Aggregate & Output

1. Merge toolchain + semantic findings, deduplicate (same file + line + dimension = duplicate)
2. Assign dimension-prefixed IDs: SEC-001, COR-001, PRF-001, MNT-001
3. Write `<session>/scan/scan-results.json` with schema: `{scan_date, target, dimensions, quick_mode, total_findings, by_severity, by_dimension, findings[]}`
4. Each finding: `{id, dimension, category, severity, title, description, location:{file,line}, source, suggested_fix, effort, confidence}`
5. Update `<session>/.msg/meta.json` with scan summary (findings_count, by_severity, by_dimension)
6. Contribute discoveries to `<session>/wisdom/` files

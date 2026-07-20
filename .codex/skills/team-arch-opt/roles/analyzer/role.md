---
role: analyzer
prefix: ANALYZE
inner_loop: false
message_types: "[state_update]"
---

# Architecture Analyzer

## Phase 2: Context & Environment Detection

| Input | Source | Required |
|-------|--------|----------|
| Task description | From task subject/description | Yes |
| Session path | Extracted from task description | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | No |

1. Extract session path and target scope from task description
2. Detect project type by scanning for framework markers:

| Signal File | Project Type | Analysis Focus |
|-------------|-------------|----------------|
| package.json + React/Vue/Angular | Frontend | Component tree, prop drilling, state management, barrel exports |
| package.json + Express/Fastify/NestJS | Backend Node | Service layer boundaries, middleware chains, DB access patterns |
| Cargo.toml / go.mod / pom.xml | Native/JVM Backend | Module boundaries, trait/interface usage, dependency injection |
| Mixed framework markers | Full-stack / Monorepo | Cross-package dependencies, shared types, API contracts |
| CLI entry / bin/ directory | CLI Tool | Command structure, plugin architecture, configuration layering |
| No detection | Generic | All architecture dimensions |

3. Use `explore` CLI tool to map module structure, dependency graph, and layer boundaries within target scope
4. Detect available analysis tools (linters, dependency analyzers, build tools)

## Phase 3: Architecture Analysis

Execute analysis based on detected project type:

**Dependency analysis**:
- Build import/require graph across modules
- Detect circular dependencies (direct and transitive cycles)
- Identify layering violations (e.g., UI importing from data layer, utils importing from domain)
- Calculate fan-in/fan-out per module (high fan-out = fragile hub, high fan-in = tightly coupled)

**Structural analysis**:
- Identify God Classes / God Modules (> 500 LOC, > 10 public methods, too many responsibilities)
- Calculate coupling metrics (afferent/efferent coupling per module)
- Calculate cohesion metrics (LCOM -- Lack of Cohesion of Methods)
- Detect code duplication (repeated logic blocks, copy-paste patterns)
- Identify missing abstractions (repeated conditionals, switch-on-type patterns)

**API surface analysis**:
- Count exported symbols per module (export bloat detection)
- Identify dead exports (exported but never imported elsewhere)
- Detect dead code (unreachable functions, unused variables, orphan files)
- Check for pattern inconsistencies (mixed naming conventions, inconsistent error handling)

**All project types**:
- Collect quantified architecture baseline metrics (dependency count, cycle count, coupling scores, LOC distribution)
- Rank top 3-7 architecture issues by severity (Critical / High / Medium)
- Record evidence: file paths, line numbers, measured values

### Tech Profile Scan

After analysis, scan findings for context-aware trigger signals (based on detected codebase characteristics):

1. Check dependency analysis → signals (`sql_detected`, `auth_detected`, `ml_detected`)
2. Check structural analysis → risk signals (`perf_sensitive`, `legacy_patterns`, `scaling_concern`)
3. Include `tech_profile` in Phase 5 state_update data

## Phase 4: Report Generation

1. Write architecture baseline to `{run_dir}/outputs/architecture-baseline.json`:
   - Module count, dependency count, cycle count, average coupling, average cohesion
   - God Class candidates with LOC and method count
   - Dead code file count, dead export count
   - Timestamp and project type details

2. Write architecture report to `{run_dir}/outputs/architecture-report.md`:
   - Ranked list of architecture issues with severity, location (file:line or module), measured impact
   - Issue categories: CYCLE, COUPLING, COHESION, GOD_CLASS, DUPLICATION, LAYER_VIOLATION, DEAD_CODE, API_BLOAT
   - Evidence summary per issue
   - Detected project type and analysis methods used

3. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `analyzer` namespace:
   - Read existing -> merge `{ "analyzer": { project_type, issue_count, top_issue, scope, categories } }` -> write back

# Swarm Result — Session/Run File System Schema & Lifecycle Review

## Best Solution

**Path**: `run_schemas` → `session_schemas` → `authority_and_lifecycle`
**Verified Score**: 0.98
**Iteration**: 1 of 3
**Ant**: ANT-1-3

### Summary
The best solution proposes a comprehensive set of improvements to the Session/Run model, addressing high-severity concurrency gaps in sequence allocation, pointer resolution issues with JSON Pointer array length, and lack of transaction locking or journaling. It covers `run_schemas` (locking/lease protocols for sequence allocation, errors in runs, aref array pointer resolution), `session_schemas` (Revision database/CAS protocol details, gate naming convention improvements, relative path definition), and `authority_and_lifecycle` (transactional journaling via intents, and disk pruning policies for session archives). These concrete recommendations ensure type safety, robust recovery, and concurrent execution safety without compromising performance.

### Evidence Chain
- [guide/session-run-structure-guide.md:292](file:///D:/maestro2/guide/session-run-structure-guide.md#L292) — Highlights sequence allocation concurrency conflicts: `NNN 三位，与 run.json 创建同一事务分配（否则并行只读 Run 取到相同序号）`.
- [guide/session-run-structure-guide.md:295](file:///D:/maestro2/guide/session-run-structure-guide.md#L295) — Identifies lack of structured error info in `CommandRun`: `status: 'created' | 'running' | 'blocked' | 'failed' | 'completed' | 'sealed';`.
- [guide/session-run-structure-guide.md:346](file:///D:/maestro2/guide/session-run-structure-guide.md#L346) — Shows lack of context-specific flags/args in handoffs: `next: Array<{ command; reason; required_artifact_refs }>;`.
- [guide/session-run-structure-guide.md:360](file:///D:/maestro2/guide/session-run-structure-guide.md#L360) — Highlights JSON Pointer `-` syntax violation of RFC 6901 for value retrieval: `覆盖 {{aref:current-plan#/task_ids/-}} 个任务`.
- [guide/session-run-structure-guide.md:154](file:///D:/maestro2/guide/session-run-structure-guide.md#L154) — Identifies need for filesystem CAS protocol description: `activity_revision: 运行态变更 +1（CAS 基准）`.
- [guide/session-run-structure-guide.md:193](file:///D:/maestro2/guide/session-run-structure-guide.md#L193) — Shows gate naming constraints: `gates: Record<string /*gate_id = GATE-{run-seq}-{NN}*...*`.
- [guide/session-run-structure-guide.md:223](file:///D:/maestro2/guide/session-run-structure-guide.md#L223) — Highlights ambiguity in `relative_path` base directory: `producer_run_id: string; relative_path: string;`.
- [guide/session-run-structure-guide.md:424](file:///D:/maestro2/guide/session-run-structure-guide.md#L424) — Shows lack of rollback/journaling mechanics: `session.json gates.json artifacts.json evidence.json 权威（Protected Data Store + 批量事务）`.
- [guide/session-run-structure-guide.md:447](file:///D:/maestro2/guide/session-run-structure-guide.md#L447) — Highlights risk of disk bloat without compression or pruning: `Session archived: 仅生命周期归档，不移动目录`.

### Candidate Artifact
The best ant (`ANT-1-3`) candidate solution details key gaps and recommendations:
1. **Run Schemas (`run_schemas`)**:
   - **Gaps**: Lack of clear lock/lease protocol in `CommandRun` or `ProjectState` for sequence allocation (`NNN`) and state updates. Missing structured error payload in `CommandRun`. Handoff next array lacks parameter support. Incompatible JSON Pointer syntax (`#/task_ids/-`) used for array length.
   - **Recommendations**:
     - Introduce a file-locking lockfile (`.workflow/locks/session.lock`) or an atomic lease field in `ProjectState`: `lease: { holder: string; expires_at: string } | null`.
     - Add an optional error field: `error?: { code: string; message: string; stack?: string }` to `CommandRun`.
     - Update next array to support parameters: `next: Array<{ command; reason; required_artifact_refs; args?: string[]; params?: Record<string, any> }>;`.
     - Correct the JSON Pointer to return length using a parser operator or extension (e.g., `current-plan#/task_ids#length`).
2. **Session Schemas (`session_schemas`)**:
   - **Gaps**: CAS implementation on dual revisions is prone to race conditions without OS/filesystem synchronization primitives. Gate registry keys enforce run sequence prefixing, making session-level gates ambiguous. Ambiguity in `relative_path` in `artifacts.json`.
   - **Recommendations**:
     - Detail the filesystem CAS protocol: read-lock, check revision, write, release lock; include fallback strategies for Windows file locking limits.
     - Expand gate naming rules to support session-level prefixing: `GATE-session-entry-{NN}` and `GATE-session-exit-{NN}`.
     - Explicitly state: "relative_path must be relative to the project workspace root for cross-session portability".
3. **Authority and Lifecycle (`authority_and_lifecycle`)**:
   - **Gaps**: No transactional journaling or WAL mechanism for writing the four core session JSON files concurrently, risking corruption on crash. Archived session directories do not move and are never purged, risking disk space exhaustion.
   - **Recommendations**:
     - Implement a transactional intent directory (`.workflow/txn/{txn_id}.intent`) containing pre-write state backups or atomic moves for final writes.
     - Define a compression/consolidation policy for archived sessions: zip the `runs/` directory (excluding `outputs/` and `report.md`).

---

## Why This Path Won

| Decision | Pheromone-guided? | Why it mattered |
|----------|-------------------|-----------------|
| start = `run_schemas` | weighted | Analyzing the foundational runtime execution unit first surfaced crucial concurrency bugs (like sequence allocation races) and validation bugs (JSON Pointer `-` syntax mismatch). |
| `run_schemas` → `session_schemas` | yes (heuristic) | Transitioning to session schemas tied the run runtime to the broader session-level coordination, identifying CAS state revision concurrency bottlenecks and scope gaps in gates. |
| `session_schemas` → `authority_and_lifecycle` | yes (heuristic) | Evaluated file system persistence, transaction journaling (`.intent` transaction logs), and lifecycle states (archiving bloat risks). |

---

## Runner-Up Solutions

| Rank | Ant | Path | Score | Diff from best |
|------|-----|------|-------|----------------|
| 1 | `ANT-1-3` | `run_schemas` → `session_schemas` → `authority_and_lifecycle` | 0.98 | Best; most detailed TS definitions and RFC analysis. |
| 2 | `ANT-1-2` | `run_schemas` → `session_schemas` → `authority_and_lifecycle` | 0.94 | -0.04; focused on TypeScript typing ambiguities, mutable alias history, performance metrics in `run.json`, and the projection paradox of `report.md`. |
| 3 | `ANT-1-1` | `implementation_feasibility` → `authority_and_lifecycle` → `session_state_json` | 0.92 | -0.06; focused on initial-run auditing (`maestro-init` in a system-owned session), run retries (`retry_of_run_id`), promotion locking, and parallel active run bottlenecks (e.g. replacing `active_run_id` with `active_run_ids` and `active_session_id` with `active_sessions`). |
| 4 | `ANT-1-4` | `directory_mapping` → `session_schemas` → `run_schemas` | 0.91 | -0.07; focused on temporary directories, zip retention policies for `runs/*/work/` on seal, `.gitignore` guidelines, gate registry operator extensions (e.g. `not_equals`, `contains`), and task dependency hierarchy (`child_run_ids` in `run.json`). |

---

## Convergence Story

Iterations: 1 of 3 max.
Trigger: All ants completed Iteration 1 exploration. The best ant (`ANT-1-3`) immediately hit a verified score of 0.98, which is above the high quality threshold and near-optimum, causing convergence/stagnation check to complete.

Entropy curve:
- iter 1: 4.515 (High exploration across 28 active edges; 4 ants evaluated).

---

## Synthesized Improvements & Recommendations (Swarm-wide Integration)

To deliver a high-quality best solution, we synthesize findings across all ants into a unified set of actionable recommendations for the Session/Run File System Change Plan:

### 1. Directory Mapping & temporary areas (`ANT-1-4`)
- **Zip Retention Policy**: Instead of deleting `runs/*/work/` completely on Seal, compress it to `work.tar.gz` or provide a configuration parameter to retain it for debugging failed runs.
- **Gitignore Guidelines**: Provide a default `.gitignore` inside the `sessions/` template folder that explicitly ignores the `work/` directory to prevent accidental commits of draft files.

### 2. Session Schema Enhancements (`ANT-1-1`, `ANT-1-2`, `ANT-1-4`)
- **TypeScript Interface Clarification**: Explicitly type sub-properties in `SessionState.orchestration` and `SessionState.requests` structures (e.g., typing the `chain` array items fully).
- **Auditability & Traceability**: Add a `created_at` timestamp field to all items in `SessionState.requests` and `EvidenceStore.records` to allow chronological timeline reconstruction.
- **Support Parallel Execution**:
  - Replace the single `active_session_id` in `ProjectState` with `active_sessions: Record<string, string>` (worktree/branch/env -> session_id) to allow parallel session execution across different worktrees.
  - Replace the single `active_run_id` in `SessionState` with `active_run_ids: string[]` to support parallel active runs.
- **Flexible Gate Registry Operators**: Expand comparison operators in `GateRegistry` check union beyond equality to support operators like `not_equals`, `greater_than`, `less_than`, or `contains`.
- **Historical Alias Lineage**: Track artifact alias mapping history under a `history` array inside `artifacts.json` to enable rollbacks or reproducible lineage analysis.

### 3. Run Schema Enhancements (`ANT-1-1`, `ANT-1-2`, `ANT-1-4`)
- **Performance Metrics**: Include an `output.metrics` block in `run.json` to capture run-level performance and resource consumption metrics (token cost, latency, etc.).
- **Dependency Hierarchy**: Add `child_run_ids: string[]` or parent pointers in `run.json` to represent parent/child hierarchy of concurrently executed run tasks.
- **Run Retry Linkage**: Introduce a `retry_of_run_id` field in the run/orchestration schema to track retried execute-verify cycles.
- **aref Integrity Verification**: Require that the seal processor verifies all `aref` pointers in `report.md` resolve correctly before sealing a Run; block sealing if any aref is broken.

### 4. Authority, Lifecycle & Implementation Feasibility (`ANT-1-1`, `ANT-1-2`)
- **Initialization Auditing**: Require that when `maestro-init` is run on an existing project, it runs in a system-owned session and records a corresponding run (e.g., `000-init`) in the session ledger for audit trails.
- **Transactional intent WAL Schema**: Detail the schema structure and verification recovery protocol for `tmp/txn/*.intent` files.
- **Report.md Paradox Resolution**: Decouple narrative prose by saving human discussion/reflection to a primary JSON file (e.g., `outputs/narrative.json`) and render `report.md` as a pure projection.
- **Artifact Dirty Read Prevention**: Explicitly forbid downstream runs from consuming unsealed draft artifacts. If an upstream run's gate verification fails, downstream runs must be blocked.

---

## Caveats

- **Search space scope limitation**: The swarm completed only 1 iteration of search; additional iterations might explore less-travelled paths like `migration_and_mapping` or `scope_and_principles`.
- **Verified LLM scoring bias**: The evaluations were done using a verified LLM score, which might have small scoring biases.
- **Validation feasibility**: Some recommendations (like Windows filesystem CAS locking fallbacks and compressed run work directory archiving) require manual performance/feasibility profiling before final code changes.
- **Automated validation**: The `aref` pointer validation must be integrated as an automated lint check in the toolchain.

---

## Reproducibility

- Config: `D:/maestro2/.workflow/.team/TS-session-run-structure-review-20260712/swarm-config.json`
- Best path: `D:/maestro2/.workflow/.team/TS-session-run-structure-review-20260712/best.json`
- Full trails: `D:/maestro2/.workflow/.team/TS-session-run-structure-review-20260712/trails/1.jsonl`
- Random seed: none / default.

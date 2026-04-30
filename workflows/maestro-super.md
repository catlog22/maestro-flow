# Super Mode (`--super`)

Goal: deliver a production-ready, complete software system from user requirements. No user decisions needed — maestro autonomously expands, refines, and implements until the system meets mainstream quality standards.

Super mode implies `-y` (all auto flags propagated) plus these additional behaviors:

## 1. Requirement Expansion

On receiving user intent, autonomously expand incomplete requirements into a complete product scope. Delegate to Gemini (`maestro delegate --to gemini --mode analysis`) for requirement completeness analysis and gap-filling. Accept requirements that add real user value; discard noise.

## 2. Progressive Document Loading

Read execution documents (workflow maestro.md, chain steps) incrementally per-phase rather than loading all upfront. Each milestone loads only the relevant section to preserve context window.

## 3. Autonomous Decision-Making

All design/architecture/scope decisions are made via Gemini delegate (`--mode analysis`). No AskUserQuestion calls. Decision criteria: mainstream industry standards, pragmatism, simplicity.

## 4. Auto-Advance Milestones

After each milestone completes and passes verification, automatically advance to the next milestone without user confirmation. Run `maestro-milestone-complete` → next milestone chain automatically.

## 5. Quality Gate Scoring

Each milestone must pass a readiness score before advancing. Prevents premature exit.

| Dimension | Weight | Minimum |
|-----------|--------|---------|
| Code completeness (features implemented vs planned) | 25% | 90% |
| Test coverage (lines + branches) | 20% | 70% |
| Build & run success (clean build, app starts) | 20% | 100% |
| Code quality (lint clean, no ts errors) | 15% | 90% |
| Integration coherence (cross-module contracts) | 10% | 80% |
| Documentation (API docs, README, setup guide) | 10% | 60% |
| **Weighted total** | | **≥ 80%** |

Score is computed via `maestro-verify` + Gemini analysis. If score < 80%, generate fix plan and re-execute until threshold is met (max 3 retries per milestone, then report blockers).

## 6. Completion Criteria

Super mode only terminates when:
- All roadmap milestones completed and scored ≥ 80%
- Final system builds, starts, and passes all tests
- Gemini confirms the system is production-ready via final audit

## 7. State Tracking

Super mode extends the standard session `status.json` (`.workflow/.maestro/{session_id}/status.json`). No extra files — all state in one place.

### 7a. status.json 扩展字段

```json
{
  "session_id": "...",
  "status": "running",
  "super": true,
  "super_state": "expanding|planning|executing|scoring|advancing|completed|blocked",
  "current_milestone": 1,
  "total_milestones": 3,
  "expanded_requirements": "...",
  "milestones": [
    {
      "index": 1,
      "name": "...",
      "status": "pending|executing|scoring|completed|blocked",
      "chain_session_id": null,
      "retries": 0,
      "max_retries": 3,
      "scores": {
        "code_completeness": null,
        "test_coverage": null,
        "build_success": null,
        "code_quality": null,
        "integration_coherence": null,
        "documentation": null,
        "weighted_total": null
      },
      "score_history": [],
      "decisions": []
    }
  ],
  "decision_log": [],
  "steps": [ ... ]
}
```

`super_state` values:
- `expanding` — requirement expansion via Gemini
- `planning` — roadmap/spec/plan generation
- `executing` — milestone chain execution (plan → execute → verify)
- `scoring` — quality gate evaluation
- `advancing` — milestone-complete + next milestone setup
- `completed` — all milestones passed
- `blocked` — max retries exceeded, needs user intervention

### 7b. State transitions

```
[start] → expanding → planning → executing(M1) → scoring(M1)
  → score ≥ 80% → advancing → executing(M2) → ...
  → score < 80% → retries < 3 → executing(M1) (retry)
  → score < 80% → retries = 3 → blocked
  → all milestones completed → completed
```

### 7c. Resume (`-c` or `continue`)

On resume, read `status.json`:
1. Check `super: true` → enter super mode resume
2. Read `super_state` + `current_milestone` → determine resume point
3. Read milestone's `status` → resume from exact phase (e.g., interrupted during `scoring` → re-run scoring)
4. Load `decision_log` for Gemini continuity

### 7d. State update discipline

Update `status.json` at every state transition:
- Before milestone chain → set milestone `status: "executing"`, increment retries if retry
- After scoring → write scores to milestone, append to `score_history`
- After advancing → set previous milestone `status: "completed"`, bump `current_milestone`
- On block → set milestone `status: "blocked"`, set `super_state: "blocked"`

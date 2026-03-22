# Roadmap: {{PROJECT_NAME}}

## Overview

{{One paragraph describing the journey from start to finish}}

## Phases

**Minimum-phase principle:** Default 1 phase. Only add phases for hard dependencies (runtime + not parallelizable + full barrier). Wave DAG inside each phase handles task ordering.

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases count toward the total phase limit.

- [ ] **Phase 1: {{PHASE_1_TITLE}}** - {{ONE_LINE_DESCRIPTION}}

## Phase Details

### Phase 1: {{PHASE_1_TITLE}}
**Goal**: {{WHAT_THIS_PHASE_DELIVERS}}
**Depends on**: Nothing (first phase)
**Requirements**: {{REQ_IDS}}
**Success Criteria** (what must be TRUE):
  1. {{OBSERVABLE_BEHAVIOR_FROM_USER_PERSPECTIVE}}
  2. {{OBSERVABLE_BEHAVIOR_FROM_USER_PERSPECTIVE}}

## Scope Decisions

- **In scope**: {{INCLUDED}}
- **Deferred**: {{LATER_MILESTONES}}
- **Out of scope**: {{EXCLUDED}}

## Progress

| Phase | Status | Completed |
|-------|--------|-----------|
| 1. {{PHASE_1_TITLE}} | Not started | - |

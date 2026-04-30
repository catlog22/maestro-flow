---
name: quality-business-test
description: PRD-forward business testing with requirement traceability, fixture generation, and multi-layer execution
argument-hint: "<phase> [--spec SPEC-xxx] [--layer L1|L2|L3] [--gen-code] [--dry-run] [--re-run] [--auto]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Validate built features against PRD acceptance criteria through automated multi-layer business testing. Unlike quality-test (interactive UAT from code gaps) and quality-test-gen (generate tests from coverage gaps), this command starts from REQ-*.md acceptance criteria and works forward to verify business rules are satisfied.

Key mechanisms:
- **PRD-forward extraction**: Parse REQ-*.md acceptance criteria with RFC 2119 priority mapping
- **Three-tier fixture generation**: Schema-derived (valid/invalid/boundary), criteria-derived (expected outcomes), scenario-derived (multi-entity packs)
- **Progressive L1-L3 layers**: Interface Contract -> Business Rule -> Business Scenario (fail-fast on critical)
- **Generator-Critic loop**: Max 3 iterations per layer to distinguish test defects from code defects
- **Requirement traceability**: Every failure traces back to REQ-NNN:AC-N
- **Degraded mode**: Falls back to success_criteria + plan.json when no spec package exists
</purpose>

<required_reading>
@~/.maestro/workflows/business-test.md
</required_reading>

<context>
Phase: $ARGUMENTS (required -- phase number)

**Flags:**
- `--spec SPEC-xxx` -- Explicit spec reference (default: auto-detect from index.json.spec_ref)
- `--layer L1|L2|L3` -- Run only specific layer (default: progressive L1->L2->L3)
- `--gen-code` -- Generate framework-specific test classes (JUnit/RestAssured, supertest/vitest, pytest/httpx)
- `--dry-run` -- Extract scenarios and fixtures only, don't execute
- `--re-run` -- Re-run only previously failed/blocked scenarios
- `--auto` -- Skip interactive confirmations

**Layer definitions:**

| Layer | Name | Tests | Source |
|-------|------|-------|--------|
| L1 | Interface Contract | Single endpoint request/response, input validation, schema compliance | Architecture API endpoints + REQ AC |
| L2 | Business Rule | Multi-step logic, state transitions, business constraints, edge cases | REQ acceptance criteria + NFR |
| L3 | Business Scenario | Full user flows, multi-service chains, error propagation | Epic user stories |

**Priority mapping (RFC 2119):**

| Keyword | Priority | Failure = |
|---------|----------|-----------|
| MUST / SHALL | critical | blocker |
| SHOULD / RECOMMENDED | high | major |
| MAY / OPTIONAL | medium | minor |

Context files:
- `.workflow/.spec/SPEC-xxx/requirements/REQ-*.md` -- Functional requirements + acceptance criteria
- `.workflow/.spec/SPEC-xxx/requirements/NFR-*.md` -- Non-functional requirements
- `.workflow/.spec/SPEC-xxx/architecture/_index.md` -- API endpoints, data model, state machines
- `.workflow/.spec/SPEC-xxx/epics/EPIC-*.md` -- User stories for E2E scenarios
- Phase artifacts (resolve via `state.json.artifacts[]` → `.workflow/scratch/` paths):
  - plan.json -- Task overview (degraded mode)
  - verification.json -- Cross-reference for must_haves
  - .tests/business/ -- Previous business test artifacts
</context>

<execution>
Follow '~/.maestro/workflows/business-test.md' completely.

**Next-step routing on completion:**
- All requirements verified → `/maestro-milestone-audit`
- Failures found → `/quality-debug --from-business-test {phase}`
- Re-run all pass → `/maestro-verify {phase}`
- Low coverage → `/quality-test-gen {phase}`
- Need integration tests → `/quality-integration-test {phase}`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase number required | Prompt user for phase number |
| E002 | error | Phase artifacts not found | Verify phase has artifacts in state.json |
| E003 | error | No spec package AND no success_criteria (can't extract scenarios) | Run maestro-roadmap --mode full or maestro-plan first |
| E004 | error | L1 critical failures block L2/L3 progression | Fix blockers first via quality-debug |
| W001 | warning | Degraded mode (no spec package, using success_criteria) | Consider running maestro-roadmap --mode full for full coverage |
| W002 | warning | Some requirements have no testable acceptance criteria | Note in report, suggest spec refinement |
| W003 | warning | Generator-Critic loop exhausted (3 iterations) without full convergence | Accept current state, proceed with known defects |
| W004 | warning | Mock services not available for L3 scenarios | Skip L3 or run with --gen-code for TestContainers |
</error_codes>

<success_criteria>
- [ ] Phase resolved and spec package loaded (or degraded mode activated)
- [ ] Business test scenarios extracted from REQ acceptance criteria
- [ ] RFC 2119 keywords mapped to test priorities
- [ ] Test fixtures generated (valid/invalid/boundary per REQ data model)
- [ ] business-test-plan.json written with layer distribution
- [ ] User confirmed plan (or --auto skipped confirmation)
- [ ] Test code generated if --gen-code (framework-appropriate)
- [ ] L1 executed with Generator-Critic loop (max 3 iterations)
- [ ] L2 executed if no L1 critical failures
- [ ] L3 executed if no L2 critical failures
- [ ] Traceability matrix built (every result -> REQ-NNN:AC-N)
- [ ] business-test-report.json written with requirement_coverage
- [ ] business-test-summary.md written (human-readable)
- [ ] index.json updated with business_test section
- [ ] Issues auto-created for failures (ISS-* in issues.jsonl with req_ref)
- [ ] Next step routed based on results
</success_criteria>

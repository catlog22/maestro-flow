export const meta = {
  name: 'wf-milestone-audit',
  description: 'Parallel milestone audit with adversarial challenge and 3-vote verdict',
  whenToUse: 'Milestone audit acceleration (via /maestro-ralph --engine swarm) with parallel dimension checks + adversarial challenge + 3-vote verdict',
  phases: [
    { title: 'Audit', detail: 'Parallel 4-dimension milestone audit' },
    { title: 'Challenge', detail: 'Adversarial challenge of each audit dimension' },
    { title: 'Report', detail: '3-vote adversarial verdict (strict/lenient/objective)' },
  ],
}

const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    check_type: { type: 'string' },
    passed: { type: 'boolean' },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phase: { type: 'string' },
          has_plan: { type: 'boolean' },
          has_execute: { type: 'boolean' },
          has_verify: { type: 'boolean' },
          plan_artifact_id: { type: 'string' },
          execute_artifact_id: { type: 'string' },
          status: { type: 'string', enum: ['complete', 'partial', 'missing'] },
        },
        required: ['phase', 'has_plan', 'has_execute', 'status'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['check_type', 'passed', 'phases', 'summary'],
}

const EXECUTION_SCHEMA = {
  type: 'object',
  properties: {
    check_type: { type: 'string' },
    passed: { type: 'boolean' },
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          plan_id: { type: 'string' },
          plan_dir: { type: 'string' },
          total_tasks: { type: 'number' },
          completed_tasks: { type: 'number' },
          failed_tasks: { type: 'number' },
          pending_tasks: { type: 'number' },
          incomplete_task_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['plan_id', 'total_tasks', 'completed_tasks'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['check_type', 'passed', 'plans', 'summary'],
}

const INTEGRATION_SCHEMA = {
  type: 'object',
  properties: {
    check_type: { type: 'string' },
    passed: { type: 'boolean' },
    interfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          interface_name: { type: 'string' },
          producer_phase: { type: 'string' },
          consumer_phase: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'warning'] },
          issue: { type: 'string' },
        },
        required: ['interface_name', 'producer_phase', 'consumer_phase', 'status'],
      },
    },
    data_contract_issues: { type: 'array', items: { type: 'object', properties: { contract: { type: 'string' }, mismatch: { type: 'string' }, affected_phases: { type: 'array', items: { type: 'string' } } }, required: ['contract', 'mismatch'] } },
    circular_dependencies: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['check_type', 'passed', 'interfaces', 'summary'],
}

const CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    original_passed: { type: 'boolean' },
    challenge_result: { type: 'string', enum: ['confirmed', 'overturned-to-fail', 'overturned-to-pass'] },
    counter_evidence: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, evidence: { type: 'string' } }, required: ['point', 'evidence'] } },
    reasoning: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['dimension', 'original_passed', 'challenge_result', 'reasoning', 'confidence'],
}

const VERDICT_VOTE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    rationale: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    next_step: { type: 'string', enum: ['session-seal', 'plan-gaps', 'execute', 'verify'] },
  },
  required: ['perspective', 'verdict', 'rationale', 'confidence', 'next_step'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    adversarial_outcome: {
      type: 'object',
      properties: {
        strict: { type: 'string' },
        lenient: { type: 'string' },
        objective: { type: 'string' },
        challenges_overturned: { type: 'number' },
        decisive_factor: { type: 'string' },
      },
      required: ['strict', 'lenient', 'objective', 'decisive_factor'],
    },
    dimension_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: { type: 'string' },
          original_passed: { type: 'boolean' },
          post_challenge_passed: { type: 'boolean' },
          issue_count: { type: 'number' },
        },
        required: ['dimension', 'original_passed', 'post_challenge_passed'],
      },
    },
    blocking_issues: { type: 'array', items: { type: 'object', properties: { dimension: { type: 'string' }, description: { type: 'string' }, remediation: { type: 'string' } }, required: ['dimension', 'description', 'remediation'] } },
    next_step: { type: 'string', enum: ['session-seal', 'plan-gaps', 'execute', 'verify'] },
    summary: { type: 'string' },
  },
  required: ['verdict', 'confidence', 'adversarial_outcome', 'dimension_results', 'blocking_issues', 'next_step', 'summary'],
}

const milestone = args?.milestone || ''
const isAdhoc = args?.is_adhoc || false

// Phase 1: Parallel audit dimensions
phase('Audit')

const checks = [
  () => agent(
    `Phase Coverage Audit${isAdhoc ? ' (ADHOC — skip roadmap phase checks, only verify artifact chain PLN→EXC exists)' : ''}.
${milestone ? 'Milestone: ' + milestone : 'Use current_milestone from .workflow/state.json'}

${isAdhoc ? `Adhoc milestone: skip roadmap.md parsing. Only check:
1. At least one PLN artifact exists for this milestone
2. Each PLN has a corresponding EXC artifact
3. All are status=completed` : `Standard milestone:
1. Read .workflow/roadmap.md to get milestone → phase mapping
2. Read .workflow/state.json artifacts[] filtered by this milestone
3. For each phase in the milestone:
   - Check: has plan artifact (type=plan, status=completed)?
   - Check: has execute artifact (type=execute, status=completed)?
   - Check: has verify artifact (type=verify)? (optional but noted)
4. Report each phase as complete/partial/missing`}

Set check_type="phase-coverage" in output.`,
    { label: 'audit:coverage', phase: 'Audit', schema: COVERAGE_SCHEMA }
  ),
  () => agent(
    `Execution Completeness Audit.
${milestone ? 'Milestone: ' + milestone : 'Use current_milestone from .workflow/state.json'}

1. Read .workflow/state.json — find all execute artifacts for this milestone
2. For each execute artifact:
   - Resolve its plan directory (artifact.path)
   - Read all .task/TASK-*.json files in that directory
   - Count: total, completed, failed, pending
   - List any incomplete task IDs
3. Passed only if ALL tasks across ALL plans are completed (no pending/failed)

Set check_type="execution-completeness" in output.`,
    { label: 'audit:execution', phase: 'Audit', schema: EXECUTION_SCHEMA }
  ),
  () => agent(
    `Cross-Phase Integration Audit.
${milestone ? 'Milestone: ' + milestone : 'Use current_milestone from .workflow/state.json'}

Check that phases compose correctly:
1. Scan for shared interfaces, types, APIs across phase boundaries
2. Verify contract compliance:
   - Type definitions match usage across phases
   - API request/response schemas are consistent
   - Event names and payloads align between producer and consumer
3. Check dependency health:
   - Cross-phase imports resolve correctly
   - No circular dependencies across phase boundaries
   - Shared dependency versions are compatible
4. Trace data flow across boundaries:
   - Input/output formats match
   - Error propagation is handled at boundaries

Report each interface check as pass/fail/warning with specific issues.
Set check_type="integration" in output.`,
    { label: 'audit:integration', phase: 'Audit', schema: INTEGRATION_SCHEMA, agentType: 'workflow-integration-checker' }
  ),
]

log(`Running ${checks.length} audit dimensions in parallel...`)
const results = await parallel(checks)
const validResults = results.filter(Boolean)

const coverage = validResults.find(r => r.check_type === 'phase-coverage')
const execution = validResults.find(r => r.check_type === 'execution-completeness')
const integration = validResults.find(r => r.check_type === 'integration')

const auditDigest = `Phase Coverage: ${coverage ? (coverage.passed ? 'PASS' : 'FAIL') + ' — ' + coverage.summary : 'NOT RUN'}

Execution Completeness: ${execution ? (execution.passed ? 'PASS' : 'FAIL') + ' — ' + execution.summary : 'NOT RUN'}
${execution && !execution.passed ? 'Incomplete: ' + execution.plans.filter(p => p.pending_tasks > 0 || p.failed_tasks > 0).map(p => p.plan_id + ' (' + p.pending_tasks + ' pending, ' + p.failed_tasks + ' failed)').join('; ') : ''}

Integration: ${integration ? (integration.passed ? 'PASS' : 'FAIL') + ' — ' + integration.summary : 'NOT RUN'}
${integration && !integration.passed ? 'Failed: ' + integration.interfaces.filter(i => i.status === 'fail').map(i => i.interface_name + ': ' + i.issue).join('; ') : ''}`

// Phase 2: Adversarial challenge of each audit dimension
phase('Challenge')
log('Adversarial challenge of audit dimension results...')

const dimensionData = [
  { name: 'coverage', result: coverage },
  { name: 'execution', result: execution },
  { name: 'integration', result: integration },
].filter(d => d.result)

const challengeResults = await parallel(
  dimensionData.map(dim => () =>
    agent(
      `ADVERSARIAL CHALLENGE of the "${dim.name}" audit dimension.

Original result: ${dim.result.passed ? 'PASS' : 'FAIL'}
Summary: ${dim.result.summary}

${dim.name === 'coverage' && dim.result.phases ? 'Phase details:\n' + dim.result.phases.map(p => `  ${p.phase}: ${p.status} (plan:${p.has_plan} execute:${p.has_execute})`).join('\n') : ''}
${dim.name === 'execution' && dim.result.plans ? 'Plan details:\n' + dim.result.plans.map(p => `  ${p.plan_id}: ${p.completed_tasks}/${p.total_tasks} complete`).join('\n') : ''}
${dim.name === 'integration' && dim.result.interfaces ? 'Interface details:\n' + dim.result.interfaces.map(i => `  ${i.interface_name}: ${i.status}`).join('\n') : ''}

Your job: Try to OVERTURN the result.
- If it PASSED: find evidence it should have FAILED (missed checks, false passes, overlooked issues)
- If it FAILED: find evidence it should have PASSED (issues are minor, not blocking, or already resolved)

Challenge the audit's thoroughness:
1. Did it check everything it should?
2. Were the checks actually verifying what they claim?
3. Is the evidence genuine or superficial?

challenge_result:
- "confirmed": the original result stands after challenge
- "overturned-to-fail": was PASS, should be FAIL (found missed issues)
- "overturned-to-pass": was FAIL, should be PASS (issues are not blocking)

Default to "confirmed" only if you genuinely cannot find counter-evidence.`,
      { label: `challenge:${dim.name}`, phase: 'Challenge', schema: CHALLENGE_SCHEMA }
    )
  )
)

const validChallenges = challengeResults.filter(Boolean)
const overturnedCount = validChallenges.filter(c => c.challenge_result !== 'confirmed').length

const challengeDigest = validChallenges.map(c =>
  `${c.dimension}: ${c.original_passed ? 'PASS' : 'FAIL'} → ${c.challenge_result} (confidence: ${c.confidence}%)\n  ${c.reasoning}`
).join('\n\n')

log(`Challenges: ${overturnedCount}/${validChallenges.length} dimensions overturned`)

// Phase 3: 3-vote adversarial verdict
phase('Report')
log('3-vote adversarial verdict (strict / lenient / objective)...')

const fullContext = `=== ORIGINAL AUDIT ===\n${auditDigest}\n\n=== ADVERSARIAL CHALLENGES ===\n${challengeDigest}`

const verdictVotes = await parallel([
  () => agent(
    `STRICT VOTER: Apply the highest quality bar for milestone completion.

${fullContext}

Your philosophy: A milestone is complete ONLY when everything is truly done.
- If any challenge overturned a PASS to FAIL → FAIL
- If any dimension was originally FAIL and not overturned → FAIL
- PASS only if all dimensions pass AND all challenges confirm

Vote with next_step recommendation.`,
    { label: 'vote:strict', phase: 'Report', schema: VERDICT_VOTE_SCHEMA }
  ),
  () => agent(
    `LENIENT VOTER: Apply a practical bar for milestone completion.

${fullContext}

Your philosophy: Milestones should move forward when substantially complete.
- If challenges overturned FAILs to PASs → good, count them
- Minor coverage/execution gaps are acceptable if integration is solid
- PASS if the core functionality works even with minor gaps

Vote with next_step recommendation.`,
    { label: 'vote:lenient', phase: 'Report', schema: VERDICT_VOTE_SCHEMA }
  ),
  () => agent(
    `OBJECTIVE VOTER: Apply evidence-based judgment for milestone completion.

${fullContext}

Your philosophy: Follow the evidence, weigh challenge confidence.
- High-confidence challenges (>80%) override original results
- Low-confidence challenges (<50%) are noise
- If the post-challenge picture shows all dimensions pass → PASS
- If any dimension genuinely fails after challenge → FAIL

Vote with next_step recommendation.`,
    { label: 'vote:objective', phase: 'Report', schema: VERDICT_VOTE_SCHEMA }
  ),
])

const validVotes = verdictVotes.filter(Boolean)
const voteCounts = { PASS: 0, FAIL: 0 }
validVotes.forEach(v => { voteCounts[v.verdict] = (voteCounts[v.verdict] || 0) + 1 })

const voteDigest = validVotes.map(v =>
  `${v.perspective}: ${v.verdict} → ${v.next_step} (confidence: ${v.confidence}%)\n  ${v.rationale}`
).join('\n\n')

log(`Verdict votes: PASS=${voteCounts.PASS} FAIL=${voteCounts.FAIL}`)

const report = await agent(
  `Generate final milestone audit report from adversarial deliberation.

=== VOTES ===
${voteDigest}

Vote tally: PASS=${voteCounts.PASS}, FAIL=${voteCounts.FAIL}

=== CHALLENGE RESULTS ===
${challengeDigest}

=== ORIGINAL AUDIT ===
${auditDigest}

RESOLVE:
1. Majority vote wins. Tie: go with OBJECTIVE voter.
2. Record adversarial_outcome with each voter's position and challenges_overturned count
3. Build dimension_results with original AND post-challenge status
4. Compile blocking_issues from dimensions that FAIL after challenges
5. Determine next_step by majority vote (tie: go with objective)
6. Write summary including challenge and deliberation outcomes`,
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA }
)

return {
  coverage: coverage,
  execution: execution,
  integration: integration,
  challenges: validChallenges,
  votes: validVotes,
  report: report,
  metadata: {
    milestone: milestone,
    is_adhoc: isAdhoc,
    dimensions_checked: validResults.length,
    dimensions_overturned: overturnedCount,
    coverage_passed: coverage ? coverage.passed : null,
    execution_passed: execution ? execution.passed : null,
    integration_passed: integration ? integration.passed : null,
    vote_counts: voteCounts,
    verdict: report ? report.verdict : 'UNKNOWN',
    next_step: report ? report.next_step : null,
  },
}

export const meta = {
  name: 'wf-execute',
  description: 'Wave-based parallel execution with adversarial convergence verification and 3-vote status determination',
  whenToUse: 'Accelerate the execute step with parallel task implementation + adversarial convergence checks + 3-vote report',
  phases: [
    { title: 'Load', detail: 'Load plan and resolve task dependencies' },
    { title: 'Execute', detail: 'Wave-based parallel task execution via workflow-executor' },
    { title: 'VerifyConvergence', detail: 'Adversarial spot-check of convergence claims' },
    { title: 'Report', detail: '3-vote status determination (optimist/pessimist/realist)' },
  ],
}

const TASK_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed', 'blocked'] },
    files_changed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    convergence_met: { type: 'boolean' },
    unmet_criteria: { type: 'array', items: { type: 'string' } },
    commit_hash: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['task_id', 'status', 'summary'],
}

const CONVERGENCE_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    claimed_complete: { type: 'boolean' },
    actually_complete: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          claimed: { type: 'boolean' },
          verified: { type: 'boolean' },
          evidence: { type: 'string' },
          discrepancy: { type: 'string' },
        },
        required: ['criterion', 'claimed', 'verified', 'evidence'],
      },
    },
    trust_score: { type: 'number', minimum: 0, maximum: 100 },
    assessment: { type: 'string' },
  },
  required: ['task_id', 'claimed_complete', 'actually_complete', 'checks', 'trust_score'],
}

const STATUS_VOTE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_RETRY'] },
    rationale: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    blocking_concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['perspective', 'status', 'rationale', 'confidence'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_RETRY'] },
    total_tasks: { type: 'number' },
    completed: { type: 'number' },
    failed: { type: 'number' },
    blocked: { type: 'number' },
    waves_executed: { type: 'number' },
    files_changed: { type: 'array', items: { type: 'string' } },
    adversarial_outcome: {
      type: 'object',
      properties: {
        optimist: { type: 'string' },
        pessimist: { type: 'string' },
        realist: { type: 'string' },
        convergence_trust: { type: 'number' },
        decisive_factor: { type: 'string' },
      },
      required: ['optimist', 'pessimist', 'realist', 'decisive_factor'],
    },
    convergence_discrepancies: { type: 'array', items: { type: 'object', properties: { task_id: { type: 'string' }, criterion: { type: 'string' }, discrepancy: { type: 'string' } }, required: ['task_id', 'criterion'] } },
    failed_tasks: { type: 'array', items: { type: 'object', properties: { task_id: { type: 'string' }, error: { type: 'string' }, unmet_criteria: { type: 'array', items: { type: 'string' } } }, required: ['task_id'] } },
    summary: { type: 'string' },
  },
  required: ['status', 'total_tasks', 'completed', 'failed', 'adversarial_outcome', 'summary'],
}

const planDir = args?.plan_dir || ''
const specs = args?.specs || ''
const codebaseContext = args?.codebase_context || ''
const wikiContext = args?.wiki_context || ''
const autoCommit = args?.auto_commit !== false

// Phase 1: Load plan
phase('Load')
log('Loading plan and resolving task dependency waves...')

const planLoad = await agent(
  `Load the execution plan and resolve task waves.

Plan directory: ${planDir || 'Find the most recent pending plan in .workflow/scratch/'}

Steps:
1. Read plan.json to get task_ids[], waves[], approach
2. Read each .task/TASK-{NNN}.json to get: description, scope, focus_paths, depends_on, convergence.criteria, files[], implementation[], read_first[], test.commands
3. Verify dependency order
4. Filter: only tasks with status="pending"
5. Return the wave structure with full task context`,
  {
    label: 'load:plan',
    phase: 'Load',
    schema: {
      type: 'object',
      properties: {
        plan_dir: { type: 'string' },
        plan_summary: { type: 'string' },
        waves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              wave_index: { type: 'number' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    task_id: { type: 'string' },
                    description: { type: 'string' },
                    scope: { type: 'string' },
                    focus_paths: { type: 'array', items: { type: 'string' } },
                    depends_on: { type: 'array', items: { type: 'string' } },
                    convergence_criteria: { type: 'array', items: { type: 'string' } },
                    test_commands: { type: 'array', items: { type: 'string' } },
                    files_to_create: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['task_id', 'description'],
                },
              },
            },
            required: ['wave_index', 'tasks'],
          },
        },
        total_pending: { type: 'number' },
      },
      required: ['plan_dir', 'waves', 'total_pending'],
    },
    agentType: 'workflow-planner',
  }
)

if (!planLoad || !planLoad.waves || planLoad.waves.length === 0) {
  log('No pending tasks found')
  return { report: { status: 'DONE', total_tasks: 0, completed: 0, failed: 0, summary: 'No pending tasks.' }, metadata: { waves_executed: 0 } }
}

log(`Plan loaded: ${planLoad.total_pending} pending tasks across ${planLoad.waves.length} waves`)

// Phase 2: Execute waves
phase('Execute')

const allResults = []
let waveIndex = 0

for (const wave of planLoad.waves) {
  waveIndex++
  log(`Wave ${waveIndex}/${planLoad.waves.length}: executing ${wave.tasks.length} tasks in parallel...`)

  const waveResults = await parallel(
    wave.tasks.map(task => () =>
      agent(
        `Execute task: ${task.task_id}
Description: ${task.description}
Scope: ${task.scope || 'project root'}
Focus paths: ${(task.focus_paths || []).join(', ') || 'see task JSON'}
Plan directory: ${planLoad.plan_dir}

${specs ? 'Project specs (MUST comply):\n' + specs : ''}
${codebaseContext ? 'Codebase architecture:\n' + codebaseContext : ''}
${wikiContext ? 'Wiki knowledge:\n' + wikiContext : ''}

Process:
1. Read the full task JSON at ${planLoad.plan_dir}/.task/${task.task_id}.json
2. Read all files in read_first[] before any modification
3. Read reference.files for patterns to follow
4. Implement changes following implementation[] steps in order
5. Verify every convergence criterion: ${(task.convergence_criteria || []).join('; ') || 'see task JSON'}
6. Run test commands: ${(task.test_commands || []).join('; ') || 'none defined'}
${autoCommit ? '7. Create atomic git commit with message referencing ' + task.task_id : ''}
8. Write summary to ${planLoad.plan_dir}/.summaries/${task.task_id}-summary.md
9. Update task status to "completed" in the task JSON

Stay within scope.`,
        { label: `exec:${task.task_id}`, phase: 'Execute', schema: TASK_RESULT_SCHEMA, agentType: 'workflow-executor', isolation: 'worktree' }
      )
    )
  )

  allResults.push(...waveResults.filter(Boolean))

  const waveFailed = waveResults.filter(r => r && r.status === 'failed')
  if (waveFailed.length > 0) {
    log(`Wave ${waveIndex}: ${waveFailed.length} tasks failed — ${waveFailed.map(f => f.task_id).join(', ')}`)
  }
}

const completed = allResults.filter(r => r.status === 'completed')
const failed = allResults.filter(r => r.status === 'failed')
const blocked = allResults.filter(r => r.status === 'blocked')

// Phase 3: Adversarial convergence verification
phase('VerifyConvergence')

const tasksToVerify = completed.slice(0, Math.min(completed.length, 5))

if (tasksToVerify.length > 0) {
  log(`Adversarial convergence spot-check of ${tasksToVerify.length} completed tasks...`)

  const convergenceChecks = await parallel(
    tasksToVerify.map(task => () => {
      const waveTask = planLoad.waves.flatMap(w => w.tasks).find(t => t.task_id === task.task_id)
      return agent(
        `ADVERSARIAL convergence verification for: ${task.task_id}

The executor claims this task is COMPLETED.
Claimed summary: ${task.summary}
Files changed: ${(task.files_changed || []).join(', ')}

Convergence criteria to verify:
${(waveTask ? waveTask.convergence_criteria : []).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Your job: VERIFY each criterion independently.
- Read the actual files that were supposedly changed
- Run any grep/search commands to verify claims
- Check if the implementation actually satisfies the criterion
- Do NOT trust the executor's self-assessment

For each criterion:
- claimed: what the executor says (true/false)
- verified: what YOU find after checking (true/false)
- evidence: your proof
- discrepancy: if claimed != verified, explain what's wrong

Set actually_complete=true ONLY if ALL criteria are genuinely met.
trust_score: 100 = perfect match, 0 = complete fabrication.`,
        { label: `verify:${task.task_id}`, phase: 'VerifyConvergence', schema: CONVERGENCE_CHECK_SCHEMA, agentType: 'workflow-verifier' }
      )
    })
  )

  var validConvergenceChecks = convergenceChecks.filter(Boolean)
  var discrepancies = validConvergenceChecks.flatMap(c =>
    c.checks.filter(ch => ch.claimed !== ch.verified).map(ch => ({
      task_id: c.task_id,
      criterion: ch.criterion,
      discrepancy: ch.discrepancy || 'claimed ' + ch.claimed + ' but verified ' + ch.verified,
    }))
  )
  var avgTrust = validConvergenceChecks.length > 0
    ? Math.round(validConvergenceChecks.reduce((s, c) => s + c.trust_score, 0) / validConvergenceChecks.length)
    : 100

  log(`Convergence verification: ${discrepancies.length} discrepancies found, avg trust: ${avgTrust}%`)
} else {
  var validConvergenceChecks = []
  var discrepancies = []
  var avgTrust = 100
}

// Phase 4: 3-vote status determination
phase('Report')

const executionSummary = `Results: ${completed.length} completed, ${failed.length} failed, ${blocked.length} blocked out of ${planLoad.total_pending} total.

Completed tasks:
${completed.map(r => `- ${r.task_id}: ${r.summary} (${(r.files_changed || []).length} files)`).join('\n') || 'None'}

Failed tasks:
${failed.map(r => `- ${r.task_id}: ${r.error || r.summary}\n  Unmet: ${(r.unmet_criteria || []).join(', ') || 'unknown'}`).join('\n') || 'None'}

Convergence verification:
- Tasks spot-checked: ${validConvergenceChecks.length}
- Discrepancies: ${discrepancies.length}
- Average trust score: ${avgTrust}%
${discrepancies.map(d => `- ${d.task_id}: ${d.criterion} — ${d.discrepancy}`).join('\n')}`

log('3-vote status determination (optimist / pessimist / realist)...')

const statusVotes = await parallel([
  () => agent(
    `OPTIMIST: Vote on execution status.

${executionSummary}

Your lens: Focus on progress made. Discount minor convergence discrepancies. Trust high trust scores.
- DONE: if majority completed, failures are minor, trust is >70%
- DONE_WITH_CONCERNS: if some failures but not blocking
- NEEDS_RETRY: only if critical failures make the whole execution invalid`,
    { label: 'vote:optimist', phase: 'Report', schema: STATUS_VOTE_SCHEMA }
  ),
  () => agent(
    `PESSIMIST: Vote on execution status.

${executionSummary}

Your lens: Focus on failures and convergence discrepancies. Low trust = unreliable results.
- NEEDS_RETRY: if any failures exist or trust < 80%
- DONE_WITH_CONCERNS: if all tasks completed but trust < 90%
- DONE: only if zero failures AND zero discrepancies AND trust > 95%`,
    { label: 'vote:pessimist', phase: 'Report', schema: STATUS_VOTE_SCHEMA }
  ),
  () => agent(
    `REALIST: Vote on execution status.

${executionSummary}

Your lens: Evidence-based judgment. No bias.
- DONE: all tasks completed, convergence verified, no critical discrepancies
- DONE_WITH_CONCERNS: completed with minor issues that don't block downstream
- NEEDS_RETRY: critical failures or convergence trust below 60%`,
    { label: 'vote:realist', phase: 'Report', schema: STATUS_VOTE_SCHEMA }
  ),
])

const validVotes = statusVotes.filter(Boolean)
const voteCounts = {}
validVotes.forEach(v => { voteCounts[v.status] = (voteCounts[v.status] || 0) + 1 })

const voteDigest = validVotes.map(v =>
  `${v.perspective}: ${v.status} (confidence: ${v.confidence}%)\n  ${v.rationale}`
).join('\n\n')

log(`Status votes: ${Object.entries(voteCounts).map(([k, v]) => k + '=' + v).join(', ')}`)

const report = await agent(
  `Generate execution report from 3-vote adversarial determination.

=== VOTES ===
${voteDigest}

Vote tally: ${Object.entries(voteCounts).map(([k, v]) => k + '=' + v).join(', ')}

=== EXECUTION DATA ===
${executionSummary}

RESOLVE:
1. Majority vote wins. Tie-break: go with REALIST.
2. Record adversarial_outcome with each vote and convergence_trust
3. Include convergence_discrepancies in report
4. List failed_tasks with errors and unmet criteria
5. Compile all files_changed across completed tasks
6. Summarize execution including adversarial deliberation outcome`,
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA }
)

return {
  report: report,
  results: allResults,
  convergence_checks: validConvergenceChecks,
  status_votes: validVotes,
  metadata: {
    plan_dir: planLoad.plan_dir,
    waves_executed: waveIndex,
    total_tasks: planLoad.total_pending,
    completed: completed.length,
    failed: failed.length,
    blocked: blocked.length,
    convergence_trust: avgTrust,
    discrepancy_count: discrepancies.length,
    vote_counts: voteCounts,
    all_files_changed: completed.flatMap(r => r.files_changed || []),
  },
}

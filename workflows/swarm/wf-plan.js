export const meta = {
  name: 'wf-plan',
  description: 'Parallel context + 3-proposal judge panel planning + 3-critic adversarial verification',
  whenToUse: 'Accelerate the plan step with parallel context + competing plan proposals + multi-critic adversarial check',
  phases: [
    { title: 'Context', detail: 'Parallel context exploration from multiple sources' },
    { title: 'Compete', detail: '3 independent plan proposals from competing strategies' },
    { title: 'Select', detail: 'Judge panel scores proposals and selects best' },
    { title: 'Check', detail: '3 specialized critics (dependency/scope/quality) challenge the selected plan' },
  ],
}

const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, decision: { type: 'string' }, status: { type: 'string', enum: ['locked', 'free', 'deferred'] }, rationale: { type: 'string' } }, required: ['decision', 'status'] } },
    requirements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, objective: { type: 'string' }, acceptance_criteria: { type: 'string' }, priority: { type: 'string' }, target_files: { type: 'array', items: { type: 'string' } } }, required: ['objective'] } },
    constraints: { type: 'array', items: { type: 'string' } },
    existing_patterns: { type: 'array', items: { type: 'object', properties: { pattern: { type: 'string' }, file: { type: 'string' }, usage: { type: 'string' } }, required: ['pattern', 'file'] } },
    dependencies: { type: 'array', items: { type: 'string' } },
  },
  required: ['source', 'decisions', 'requirements'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    strategy: { type: 'string' },
    summary: { type: 'string' },
    approach: { type: 'string' },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
    waves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          wave_index: { type: 'number' },
          rationale: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task_id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                scope: { type: 'string' },
                focus_paths: { type: 'array', items: { type: 'string' } },
                depends_on: { type: 'array', items: { type: 'string' } },
                convergence_criteria: { type: 'array', items: { type: 'string' } },
                files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['create', 'modify', 'delete'] }, change: { type: 'string' } }, required: ['path', 'action'] } },
                issue_id: { type: 'string' },
              },
              required: ['task_id', 'title', 'description', 'convergence_criteria'],
            },
          },
        },
        required: ['wave_index', 'tasks'],
      },
    },
    total_tasks: { type: 'number' },
    trade_offs: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['strategy', 'summary', 'approach', 'waves', 'total_tasks', 'confidence'],
}

const PLAN_SCORE_SCHEMA = {
  type: 'object',
  properties: {
    proposal_strategy: { type: 'string' },
    scores: {
      type: 'object',
      properties: {
        coverage: { type: 'number', minimum: 1, maximum: 5 },
        parallelism: { type: 'number', minimum: 1, maximum: 5 },
        risk_mitigation: { type: 'number', minimum: 1, maximum: 5 },
        convergence_quality: { type: 'number', minimum: 1, maximum: 5 },
        simplicity: { type: 'number', minimum: 1, maximum: 5 },
      },
      required: ['coverage', 'parallelism', 'risk_mitigation', 'convergence_quality', 'simplicity'],
    },
    total_score: { type: 'number' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['proposal_strategy', 'scores', 'total_score', 'strengths', 'weaknesses'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    critic_type: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'pass-with-notes', 'needs-revision'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'note'] },
          category: { type: 'string' },
          description: { type: 'string' },
          affected_tasks: { type: 'array', items: { type: 'string' } },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'category', 'description'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    summary: { type: 'string' },
  },
  required: ['critic_type', 'verdict', 'issues', 'confidence', 'summary'],
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass-with-notes', 'needs-revision'] },
    adversarial_outcome: {
      type: 'object',
      properties: {
        dependency_verdict: { type: 'string' },
        scope_verdict: { type: 'string' },
        quality_verdict: { type: 'string' },
        decisive_factor: { type: 'string' },
      },
      required: ['dependency_verdict', 'scope_verdict', 'quality_verdict', 'decisive_factor'],
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'note'] },
          category: { type: 'string' },
          description: { type: 'string' },
          affected_tasks: { type: 'array', items: { type: 'string' } },
          suggestion: { type: 'string' },
          source_critic: { type: 'string' },
        },
        required: ['severity', 'category', 'description'],
      },
    },
    metrics: {
      type: 'object',
      properties: {
        task_count: { type: 'number' },
        wave_count: { type: 'number' },
        avg_convergence_criteria: { type: 'number' },
        dependency_depth: { type: 'number' },
        estimated_parallelism: { type: 'number' },
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'adversarial_outcome', 'issues', 'summary'],
}

const contextDir = args?.context_dir || ''
const fromSource = args?.from || ''
const phaseNum = args?.phase || null
const scope = args?.scope || ''
const specs = args?.specs || ''
const gaps = args?.gaps || false
const quick = args?.quick || false

// Phase 1: Parallel context exploration
phase('Context')
log('Gathering context from multiple sources in parallel...')

const contextSources = [
  () => agent(
    `Load analysis context for planning.
${contextDir ? 'Context directory: ' + contextDir + ' — read context.md and context-package.json' : ''}
${fromSource ? 'Upstream source: ' + fromSource + ' — resolve and load context-package.json' : ''}
${phaseNum ? 'Phase: ' + phaseNum + ' — read roadmap.md for phase definition' : ''}
${gaps ? 'Gap-fix mode: load issues from .workflow/issues/issues.jsonl with analysis records' : ''}

Extract:
1. Locked/Free/Deferred decisions from context.md
2. Requirements with acceptance criteria from context-package.json or conclusions.json
3. Constraints from upstream analysis
4. Dependencies identified`,
    { label: 'ctx:analysis', phase: 'Context', schema: CONTEXT_SCHEMA }
  ),
  () => agent(
    `Explore existing codebase patterns relevant to the planned work.
${scope ? 'Scope: ' + scope : phaseNum ? 'Phase ' + phaseNum + ' scope from roadmap' : 'Full project'}
${specs ? 'Specs to respect: ' + specs : 'Load via: maestro spec load --category arch'}

Find:
1. Existing patterns in the target area (how similar features are implemented)
2. File organization conventions
3. Test patterns used
4. Import/export conventions
5. Error handling patterns

Report as existing_patterns[] with file references.`,
    { label: 'ctx:patterns', phase: 'Context', schema: CONTEXT_SCHEMA, agentType: 'cli-explore-agent' }
  ),
]

const contexts = await parallel(contextSources)
const validContexts = contexts.filter(Boolean)

const mergedDecisions = validContexts.flatMap(c => c.decisions || [])
const mergedRequirements = validContexts.flatMap(c => c.requirements || [])
const mergedPatterns = validContexts.flatMap(c => c.existing_patterns || [])
const mergedConstraints = validContexts.flatMap(c => c.constraints || [])

log(`Context gathered: ${mergedDecisions.length} decisions, ${mergedRequirements.length} requirements, ${mergedPatterns.length} patterns`)

const contextDigest = `Decisions (${mergedDecisions.length}):
${mergedDecisions.map(d => `- [${d.status}] ${d.decision}${d.rationale ? ' — ' + d.rationale : ''}`).join('\n')}

Requirements (${mergedRequirements.length}):
${mergedRequirements.map(r => `- ${r.objective}${r.acceptance_criteria ? ' (done when: ' + r.acceptance_criteria + ')' : ''}${r.target_files ? ' [' + r.target_files.join(', ') + ']' : ''}`).join('\n')}

Constraints: ${mergedConstraints.join('; ') || 'none'}

Existing patterns:
${mergedPatterns.map(p => `- ${p.pattern} @ ${p.file}`).join('\n') || 'none found'}`

// Phase 2: 3 competing plan proposals from different strategies
phase('Compete')
log('Launching 3 competing plan proposals...')

const planProposals = await parallel([
  () => agent(
    `Create an execution plan using BREADTH-FIRST strategy.
${phaseNum ? 'Phase: ' + phaseNum : ''}
${scope ? 'Scope: ' + scope : ''}
${quick ? 'QUICK mode: minimize tasks' : ''}
${gaps ? 'GAP-FIX mode: tasks fix identified issues' : ''}

Context:\n${contextDigest}

Strategy: BREADTH-FIRST
- Maximize parallelism: put as many tasks as possible in wave 1
- Minimize dependencies between tasks
- Prefer many small independent tasks over fewer large sequential ones
- Trade off: may have more integration work later but faster early progress

Set strategy="breadth-first" in output.

Rules:
1. Feature-level tasks (one feature = one task)
2. Each task needs >=2 testable convergence criteria
3. Include focus_paths and files[] with specific paths
4. Respect Locked decisions
5. Task IDs: TASK-001, TASK-002, etc.`,
    { label: 'plan:breadth', phase: 'Compete', schema: PLAN_SCHEMA, agentType: 'workflow-planner' }
  ),
  () => agent(
    `Create an execution plan using DEPTH-FIRST strategy.
${phaseNum ? 'Phase: ' + phaseNum : ''}
${scope ? 'Scope: ' + scope : ''}
${quick ? 'QUICK mode: minimize tasks' : ''}
${gaps ? 'GAP-FIX mode: tasks fix identified issues' : ''}

Context:\n${contextDigest}

Strategy: DEPTH-FIRST
- Build foundation first: core infrastructure in wave 1, features on top in wave 2+
- Strong dependency chains ensure solid base before building up
- Fewer tasks per wave but each fully tested before moving on
- Trade off: slower start but less rework and integration issues

Set strategy="depth-first" in output.

Rules:
1. Feature-level tasks (one feature = one task)
2. Each task needs >=2 testable convergence criteria
3. Include focus_paths and files[] with specific paths
4. Respect Locked decisions
5. Task IDs: TASK-001, TASK-002, etc.`,
    { label: 'plan:depth', phase: 'Compete', schema: PLAN_SCHEMA, agentType: 'workflow-planner' }
  ),
  () => agent(
    `Create an execution plan using RISK-FIRST strategy.
${phaseNum ? 'Phase: ' + phaseNum : ''}
${scope ? 'Scope: ' + scope : ''}
${quick ? 'QUICK mode: minimize tasks' : ''}
${gaps ? 'GAP-FIX mode: tasks fix identified issues' : ''}

Context:\n${contextDigest}

Strategy: RISK-FIRST
- Tackle highest-risk items first (complex integrations, uncertain requirements, new patterns)
- Wave 1 = risk spikes and proof-of-concepts
- Wave 2+ = validated features building on proven foundations
- Trade off: may seem slow early but catches showstoppers before heavy investment

Set strategy="risk-first" in output.

Rules:
1. Feature-level tasks (one feature = one task)
2. Each task needs >=2 testable convergence criteria
3. Include focus_paths and files[] with specific paths
4. Respect Locked decisions
5. Task IDs: TASK-001, TASK-002, etc.`,
    { label: 'plan:risk', phase: 'Compete', schema: PLAN_SCHEMA, agentType: 'workflow-planner' }
  ),
])

const validProposals = planProposals.filter(Boolean)
log(`${validProposals.length} competing plans generated`)

// Judge panel scores each proposal
phase('Select')
log('Judge panel scoring proposals...')

const judgeScores = await parallel(
  validProposals.map(proposal => () =>
    agent(
      `Score this plan proposal objectively.

Strategy: ${proposal.strategy}
Summary: ${proposal.summary}
Approach: ${proposal.approach}
Complexity: ${proposal.complexity}
Tasks: ${proposal.total_tasks} across ${proposal.waves.length} waves
Trade-offs: ${proposal.trade_offs || 'not stated'}

Wave breakdown:
${proposal.waves.map(w => `Wave ${w.wave_index} (${w.tasks.length} tasks): ${w.tasks.map(t => t.task_id + ': ' + t.title).join(', ')}`).join('\n')}

Requirements to cover:
${mergedRequirements.map(r => r.objective).join('\n')}

Score each dimension 1-5:
- coverage: do tasks cover all requirements?
- parallelism: how much work can run concurrently?
- risk_mitigation: are high-risk items addressed early?
- convergence_quality: are criteria specific and testable?
- simplicity: is the plan as simple as possible?

Calculate total_score = sum of all dimensions.
List specific strengths and weaknesses.`,
      { label: `judge:${proposal.strategy}`, phase: 'Select', schema: PLAN_SCORE_SCHEMA }
    )
  )
)

const validJudges = judgeScores.filter(Boolean)
const bestIdx = validJudges.reduce((best, score, idx) => score.total_score > (validJudges[best] ? validJudges[best].total_score : 0) ? idx : best, 0)
const selectedPlan = validProposals[bestIdx]

const scoreDigest = validJudges.map((s, i) =>
  `${validProposals[i].strategy}: ${s.total_score}/25 (cov:${s.scores.coverage} par:${s.scores.parallelism} risk:${s.scores.risk_mitigation} conv:${s.scores.convergence_quality} sim:${s.scores.simplicity})`
).join('\n')

log(`Selected: ${selectedPlan.strategy} (${validJudges[bestIdx].total_score}/25)\n${scoreDigest}`)

// Phase 4: 3 specialized critics challenge the selected plan
phase('Check')
log('3 specialized critics challenging the selected plan...')

const criticResults = await parallel([
  () => agent(
    `You are the DEPENDENCY CRITIC. Challenge the task dependency structure.

Selected plan (${selectedPlan.strategy}):
${selectedPlan.waves.map(w => `Wave ${w.wave_index}: ${w.tasks.map(t => t.task_id + ': ' + t.title + ' [depends: ' + (t.depends_on || []).join(',') + ']').join(', ')}`).join('\n')}

Focus:
1. Are depends_on relationships correct? Any missing dependencies?
2. Could more tasks be parallelized (false dependencies)?
3. Are there circular or impossible dependency chains?
4. Do later waves actually need ALL prior wave completions?
5. Are file modification conflicts between parallel tasks?

Set critic_type="dependency" in output.
Be adversarial — assume dependencies are WRONG until proven correct.`,
    { label: 'critic:dependency', phase: 'Check', schema: CRITIC_SCHEMA, agentType: 'workflow-plan-checker' }
  ),
  () => agent(
    `You are the SCOPE CRITIC. Challenge the plan's coverage and boundaries.

Selected plan (${selectedPlan.strategy}):
${selectedPlan.waves.map(w => `Wave ${w.wave_index}: ${w.tasks.map(t => t.task_id + ': ' + t.title).join(', ')}`).join('\n')}

Requirements:
${mergedRequirements.map(r => `- ${r.objective}`).join('\n')}

Focus:
1. Are there requirements without corresponding tasks?
2. Are there tasks that don't map to any requirement (scope creep)?
3. Is each task properly scoped (not too large, not too granular)?
4. Are edge cases and error paths covered?
5. Does the plan handle the Free decisions appropriately?

Set critic_type="scope" in output.
Be adversarial — assume requirements are NOT fully covered.`,
    { label: 'critic:scope', phase: 'Check', schema: CRITIC_SCHEMA, agentType: 'workflow-plan-checker' }
  ),
  () => agent(
    `You are the QUALITY CRITIC. Challenge the convergence criteria and testability.

Selected plan (${selectedPlan.strategy}):
${selectedPlan.waves.map(w => `Wave ${w.wave_index}: ${w.tasks.map(t => t.task_id + ': ' + t.title + ' [criteria: ' + (t.convergence_criteria || []).join(' | ') + ']').join('\n')}`).join('\n')}

Focus:
1. Are convergence criteria SPECIFIC and TESTABLE (grep-verifiable or command-runnable)?
2. Would a robot be able to verify each criterion unambiguously?
3. Are there vague criteria ("works correctly", "properly implemented")?
4. Is each task's convergence achievable within that task's scope?
5. Are there criteria that should exist but don't?

Set critic_type="quality" in output.
Be adversarial — assume criteria are VAGUE until proven specific.`,
    { label: 'critic:quality', phase: 'Check', schema: CRITIC_SCHEMA, agentType: 'workflow-plan-checker' }
  ),
])

const validCritics = criticResults.filter(Boolean)
const criticDigest = validCritics.map(c =>
  `${c.critic_type}: ${c.verdict} (confidence: ${c.confidence}%)\n${c.issues.map(i => `  [${i.severity}] ${i.category}: ${i.description}`).join('\n')}`
).join('\n\n')

log('Synthesizing critic feedback into final verdict...')

const check = await agent(
  `Synthesize 3 critic assessments into a final plan verdict.

Selected plan: ${selectedPlan.strategy}

=== CRITIC ASSESSMENTS ===
${criticDigest}

=== PLAN COMPETITION SCORES ===
${scoreDigest}

RESOLVE:
1. Merge all issues from all critics, tagged with source_critic
2. Verdict rules:
   - Any critic has critical issues → "needs-revision"
   - All critics pass → "pass"
   - Only warnings/notes → "pass-with-notes"
3. Record adversarial_outcome with each critic's verdict and decisive_factor
4. Calculate metrics: task_count, wave_count, avg_convergence_criteria, dependency_depth, estimated_parallelism
5. Summarize the competition outcome and critic feedback`,
  { label: 'check:synthesize', phase: 'Check', schema: CHECK_SCHEMA }
)

return {
  contexts: validContexts,
  proposals: validProposals,
  scores: validJudges,
  selected_plan: selectedPlan,
  critics: validCritics,
  check: check,
  metadata: {
    phase: phaseNum,
    scope: scope,
    decision_count: mergedDecisions.length,
    requirement_count: mergedRequirements.length,
    proposals_generated: validProposals.length,
    selected_strategy: selectedPlan.strategy,
    selected_score: validJudges[bestIdx] ? validJudges[bestIdx].total_score : null,
    total_tasks: selectedPlan.total_tasks,
    wave_count: selectedPlan.waves.length,
    check_verdict: check ? check.verdict : 'unknown',
    critical_issues: check ? check.issues.filter(i => i.severity === 'critical').length : 0,
  },
}

export const meta = {
  name: 'wf-swarm-explore',
  description: 'Parallel ant exploration — N ants explore task space concurrently guided by pheromone hints',
  whenToUse: 'Single ACO iteration: spawn N ants in parallel, each builds a path through the task space',
  phases: [
    { title: 'Explore', detail: 'N ants explore task space in parallel' },
    { title: 'Validate', detail: 'Cross-validate ant paths for node validity and evidence' },
  ],
}

const ANT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ant_id: { type: 'string' },
    iteration: { type: 'number' },
    path: { type: 'array', items: { type: 'string' } },
    path_decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          rationale: { type: 'string' },
          guided_by: { type: 'string', enum: ['pheromone', 'heuristic', 'evidence'] },
          pheromone_weight: { type: 'number' },
          deviation_from_hint: { type: 'boolean' },
        },
        required: ['from', 'to', 'rationale', 'guided_by'],
      },
    },
    self_score: { type: 'number', minimum: 0, maximum: 1 },
    self_confidence: { type: 'number', minimum: 0, maximum: 1 },
    candidate_solution: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['string', 'object', 'file_ref'] },
        summary: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['summary'],
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          finding: { type: 'string' },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        },
        required: ['source', 'finding'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['ant_id', 'iteration', 'path', 'path_decisions', 'self_score', 'self_confidence', 'candidate_solution', 'evidence'],
}

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    ant_id: { type: 'string' },
    valid: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    evidence_verified: { type: 'number' },
    evidence_total: { type: 'number' },
  },
  required: ['ant_id', 'valid', 'issues'],
}

const iteration = args?.iteration || 1
const assignments = args?.assignments || []
const objective = args?.objective || ''
const session = args?.session || ''
const config = args?.config || {}
const taskSpace = args?.task_space || []
const wisdom = args?.wisdom || ''

// Phase 1: Parallel ant exploration
phase('Explore')
log(`Iteration ${iteration}: launching ${assignments.length} ants in parallel...`)

const antResults = await parallel(
  assignments.map((assignment, idx) => () =>
    agent(
      `You are ANT-${iteration}-${idx + 1} in an ant colony optimization swarm.

## Objective
${objective}

## Your Assignment
Start node: ${assignment.start_node}
Edge preferences (pheromone-derived weights):
${JSON.stringify(assignment.edge_preferences || {}, null, 2)}
Max path length: ${assignment.max_path_length || 5}

## Task Space
Valid nodes: ${JSON.stringify(taskSpace.slice(0, 50))}${taskSpace.length > 50 ? '... (' + taskSpace.length + ' total)' : ''}

## Session
Session path: ${session}
${wisdom ? 'Prior iteration learnings:\n' + wisdom : ''}

## Instructions
1. Read the task space to understand what each node represents
2. Start from your assigned start_node
3. At each step, evaluate candidate next nodes:
   - Use edge_preferences as pheromone guidance (higher = more explored/promising)
   - BUT use your OWN judgment — deviate when evidence supports a different path
   - Record whether each decision was guided by pheromone, heuristic, or evidence
4. Build a path of 1..${assignment.max_path_length || 5} nodes (no revisiting)
5. Gather EVIDENCE along your path (file:line references, code snippets, test results)
6. Self-evaluate: score (0-1) how well your path achieves the objective
7. Extract a candidate_solution from your exploration

Be thorough in evidence gathering. Read actual source files, run greps, verify claims.
${config.evidence_requirements ? 'Evidence requirements: ' + config.evidence_requirements : ''}`,
      {
        label: `ant:${iteration}-${idx + 1}`,
        phase: 'Explore',
        schema: ANT_RESULT_SCHEMA,
        agentType: 'cli-explore-agent',
      }
    )
  )
)

const validAnts = antResults.filter(Boolean)
log(`${validAnts.length}/${assignments.length} ants completed exploration`)

// Phase 2: Cross-validate ant paths
phase('Validate')

if (validAnts.length > 0) {
  log(`Validating ${validAnts.length} ant paths...`)

  const validations = await parallel(
    validAnts.map(ant => () =>
      agent(
        `Validate this ant's exploration results.

Ant: ${ant.ant_id}
Path: ${ant.path.join(' → ')}
Self-score: ${ant.self_score} (confidence: ${ant.self_confidence})
Evidence count: ${ant.evidence.length}
Solution summary: ${ant.candidate_solution.summary}

Task space nodes: ${JSON.stringify(taskSpace.slice(0, 30))}
Session: ${session}

Validate:
1. Every node in path exists in the task space
2. Path has no cycles (no repeated nodes)
3. path_decisions length == path length - 1
4. At least 1 evidence item exists
5. If evidence references files — verify they exist (Read/Glob)
6. self_score > 0.9 requires ≥3 evidence items

Report issues found. Set valid=true only if no blocking issues.`,
        { label: `validate:${ant.ant_id}`, phase: 'Validate', schema: VALIDATION_SCHEMA }
      )
    )
  )

  const validResults = validations.filter(Boolean)
  const validCount = validResults.filter(v => v.valid).length
  log(`Validation: ${validCount}/${validResults.length} ants passed`)

  return {
    iteration: iteration,
    ant_results: validAnts.map((ant, i) => ({
      ...ant,
      validation: validResults[i] || null,
    })),
    metadata: {
      total_ants: assignments.length,
      completed_ants: validAnts.length,
      valid_ants: validCount,
      avg_self_score: validAnts.length > 0
        ? Math.round(validAnts.reduce((s, a) => s + a.self_score, 0) / validAnts.length * 100) / 100
        : 0,
      avg_path_length: validAnts.length > 0
        ? Math.round(validAnts.reduce((s, a) => s + a.path.length, 0) / validAnts.length * 10) / 10
        : 0,
    },
  }
}

return {
  iteration: iteration,
  ant_results: [],
  metadata: { total_ants: assignments.length, completed_ants: 0, valid_ants: 0 },
}

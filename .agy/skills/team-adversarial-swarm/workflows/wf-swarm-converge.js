export const meta = {
  name: 'wf-swarm-converge',
  description: 'Adversarial convergence decision — prosecutor(continue) vs defender(stop) vs judge resolves',
  whenToUse: 'After each ACO iteration: adversarial debate on whether swarm has converged or should continue',
  phases: [
    { title: 'Argue', detail: 'Prosecutor argues to continue, Defender argues to stop' },
    { title: 'Judge', detail: 'Judge resolves debate with evidence-weighted verdict' },
  ],
}

const ARGUMENT_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['prosecutor', 'defender'] },
    stance: { type: 'string', enum: ['continue', 'stop'] },
    argument: { type: 'string' },
    key_points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          evidence: { type: 'string' },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        },
        required: ['point', 'evidence', 'strength'],
      },
    },
    concessions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['role', 'stance', 'argument', 'key_points', 'confidence'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    converged: { type: 'boolean' },
    reason: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    adversarial_outcome: {
      type: 'object',
      properties: {
        prosecutor_confidence: { type: 'number' },
        defender_confidence: { type: 'number' },
        decisive_factor: { type: 'string' },
        prosecutor_concessions: { type: 'array', items: { type: 'string' } },
        defender_concessions: { type: 'array', items: { type: 'string' } },
      },
      required: ['prosecutor_confidence', 'defender_confidence', 'decisive_factor'],
    },
    recommendation: { type: 'string' },
  },
  required: ['converged', 'reason', 'confidence', 'adversarial_outcome'],
}

const iteration = args?.iteration || 1
const best = args?.best || {}
const history = args?.history || []
const config = args?.config || {}
const patience = config.patience || 2
const minImprovement = config.min_improvement || 0.01
const maxIterations = config.max_iterations || 5

const historyDigest = history.map((h, i) =>
  `Iter ${i + 1}: best=${h.best_score} mean=${h.mean_score} delta=${h.delta || 'n/a'} ants=${h.completed_ants || 'n/a'}`
).join('\n')

const improvementTrend = history.length >= 2
  ? history.slice(-patience).map(h => h.delta || 0)
  : []
const stagnating = improvementTrend.length >= patience && improvementTrend.every(d => Math.abs(d) < minImprovement)

// Phase 1: Adversarial Debate
phase('Argue')
log(`Iteration ${iteration}: adversarial convergence debate...`)

const debate = await parallel([
  () => agent(
    `You are the PROSECUTOR. Argue that the swarm should CONTINUE exploring.

## Current State
Iteration: ${iteration} of ${maxIterations}
Best score: ${best.score || 'unknown'}
Best ant: ${best.ant_id || 'unknown'}

## Score History
${historyDigest || 'No history yet'}

## Convergence Config
Patience: ${patience} (stop if no improvement for this many iterations)
Min improvement: ${minImprovement}
Max iterations: ${maxIterations}

## Stagnation Signal
${stagnating ? 'YES — last ' + patience + ' iterations show < ' + minImprovement + ' improvement' : 'NO — improvement still occurring or not enough data'}

## Your Job: Argue to CONTINUE
Build the strongest case that the swarm should keep going:
- Best score isn't good enough yet (absolute quality)
- Score variance across ants suggests unexplored promising regions
- Pheromone entropy is still high (many paths competitive)
- Budget allows more iterations
- Recent deviations from pheromone hints produced discoveries

Acknowledge when stopping would be reasonable — concessions add credibility.
Your confidence reflects how genuinely strong your case is.`,
    { label: 'prosecutor:continue', phase: 'Argue', schema: ARGUMENT_SCHEMA }
  ),
  () => agent(
    `You are the DEFENDER. Argue that the swarm should STOP and declare convergence.

## Current State
Iteration: ${iteration} of ${maxIterations}
Best score: ${best.score || 'unknown'}
Best ant: ${best.ant_id || 'unknown'}

## Score History
${historyDigest || 'No history yet'}

## Convergence Config
Patience: ${patience} (stop if no improvement for this many iterations)
Min improvement: ${minImprovement}
Max iterations: ${maxIterations}

## Stagnation Signal
${stagnating ? 'YES — last ' + patience + ' iterations show < ' + minImprovement + ' improvement' : 'NO — improvement still occurring or not enough data'}

## Your Job: Argue to STOP
Build the strongest case that the swarm has converged:
- Best score is stable across recent iterations
- Multiple ants converging on similar paths (low entropy)
- Diminishing returns — each iteration yields less improvement
- Best solution quality is sufficient for the objective
- Further iterations would waste budget without meaningful gain

Acknowledge when continuing might help — concessions add credibility.
Your confidence reflects how genuinely strong your case is.`,
    { label: 'defender:stop', phase: 'Argue', schema: ARGUMENT_SCHEMA }
  ),
])

const validDebate = debate.filter(Boolean)
const prosecutor = validDebate.find(a => a.role === 'prosecutor')
const defender = validDebate.find(a => a.role === 'defender')

const debateDigest = validDebate.map(a =>
  `### ${a.role.toUpperCase()} (stance: ${a.stance}, confidence: ${a.confidence}%)\n${a.argument}\nKey points:\n${a.key_points.map(p => '- [' + p.strength + '] ' + p.point).join('\n')}\nConcessions: ${a.concessions.join('; ') || 'none'}`
).join('\n\n---\n\n')

log(`Prosecutor: ${prosecutor ? prosecutor.confidence : '?'}% for continue | Defender: ${defender ? defender.confidence : '?'}% for stop`)

// Phase 2: Judge resolves
phase('Judge')
log('Judge resolving convergence debate...')

const verdict = await agent(
  `You are the JUDGE. Two advocates debated whether this swarm should continue or stop.

=== DEBATE ===
${debateDigest}

=== OBJECTIVE DATA ===
Iteration: ${iteration} of ${maxIterations}
Best score: ${best.score || 'unknown'}
Score history: ${historyDigest || 'none'}
Stagnation signal: ${stagnating ? 'YES' : 'NO'}

=== DECISION RULES ===
1. If iteration >= max_iterations → MUST converge (safety net)
2. If iteration == 1 → MUST NOT converge (need at least 2 iterations)
3. If stagnation signal AND defender confidence > 60% → converge
4. If prosecutor confidence > 80% AND best score < 0.5 → continue (insufficient quality)
5. If defender concedes major points → likely should continue
6. If prosecutor concedes major points → likely should stop
7. Otherwise → weigh evidence quality from both sides

Record the adversarial_outcome with both confidences, concessions, and the decisive factor.
Provide a recommendation for what to focus on if continuing.`,
  { label: 'judge', phase: 'Judge', schema: VERDICT_SCHEMA }
)

return {
  iteration: iteration,
  converged: verdict ? verdict.converged : (iteration >= maxIterations),
  reason: verdict ? verdict.reason : 'max_iterations_reached',
  confidence: verdict ? verdict.confidence : 100,
  adversarial_outcome: verdict ? verdict.adversarial_outcome : null,
  debate: { prosecutor: prosecutor, defender: defender },
  metadata: {
    best_score: best.score,
    stagnation_signal: stagnating,
    iteration_of_max: iteration + '/' + maxIterations,
    prosecutor_confidence: prosecutor ? prosecutor.confidence : null,
    defender_confidence: defender ? defender.confidence : null,
  },
}

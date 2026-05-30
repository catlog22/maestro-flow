export const meta = {
  name: 'wf-swarm-score',
  description: 'Adversarial 3-vote scoring — prosecutor/defender/judge per ant for verified scores',
  whenToUse: 'Score ant results from one iteration using adversarial 3-vote pattern instead of single scorer',
  phases: [
    { title: 'Score', detail: '3-vote adversarial scoring per ant (prosecutor/defender/judge)' },
    { title: 'Calibrate', detail: 'Cross-ant calibration and hallucination detection' },
  ],
}

const VOTE_SCHEMA = {
  type: 'object',
  properties: {
    ant_id: { type: 'string' },
    role: { type: 'string', enum: ['prosecutor', 'defender', 'judge'] },
    score: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
    evidence_verified: { type: 'number' },
    evidence_total: { type: 'number' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['ant_id', 'role', 'score', 'reasoning', 'confidence'],
}

const CALIBRATION_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          verified_score: { type: 'number' },
          rationale: { type: 'string' },
          votes: { type: 'object' },
          hallucination_flag: { type: 'boolean' },
          self_vs_verified_delta: { type: 'number' },
        },
        required: ['verified_score', 'rationale'],
      },
    },
    calibration: {
      type: 'object',
      properties: {
        mean: { type: 'number' },
        std: { type: 'number' },
        min: { type: 'number' },
        max: { type: 'number' },
        hallucination_rate: { type: 'number' },
      },
      required: ['mean', 'min', 'max'],
    },
    ranking: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['scores', 'calibration', 'ranking'],
}

const iteration = args?.iteration || 1
const antResults = args?.ant_results || []
const objective = args?.objective || ''
const rubric = args?.rubric || ''

if (antResults.length === 0) {
  log('No ant results to score')
  return { scores: {}, calibration: { mean: 0, min: 0, max: 0 }, ranking: [] }
}

// Phase 1: 3-vote adversarial scoring per ant
phase('Score')
log(`Adversarial 3-vote scoring of ${antResults.length} ants...`)

const allVotes = await pipeline(
  antResults,
  (ant) => parallel([
    () => agent(
      `PROSECUTOR: Score this ant's result HARSHLY. Find flaws.

Objective: ${objective}
${rubric ? 'Rubric: ' + rubric : 'Default rubric: path_relevance(0.35) + evidence_strength(0.30) + solution_quality(0.25) + path_coherence(0.10)'}

Ant: ${ant.ant_id}
Path: ${ant.path.join(' → ')} (${ant.path.length} nodes)
Decisions: ${ant.path_decisions.map(d => d.from + '→' + d.to + ' [' + d.guided_by + '] ' + d.rationale).join('; ')}
Self-score: ${ant.self_score} (DO NOT anchor on this — score blind first)
Evidence: ${ant.evidence.map(e => e.source + ': ' + e.finding + ' [' + (e.strength || 'unknown') + ']').join('\n')}
Solution: ${ant.candidate_solution.summary}

Your job: MINIMIZE the score. Find every weakness.
- Does the path actually address the objective?
- Is the evidence real and strong, or vague/unverifiable?
- Is the solution actionable or hand-wavy?
- Are there logical gaps in the path decisions?

Score 0.0-1.0. Verify evidence count if possible. Be harsh but fair.`,
      { label: `prosecutor:${ant.ant_id}`, phase: 'Score', schema: VOTE_SCHEMA }
    ),
    () => agent(
      `DEFENDER: Score this ant's result GENEROUSLY. Find strengths.

Objective: ${objective}
${rubric ? 'Rubric: ' + rubric : 'Default rubric: path_relevance(0.35) + evidence_strength(0.30) + solution_quality(0.25) + path_coherence(0.10)'}

Ant: ${ant.ant_id}
Path: ${ant.path.join(' → ')} (${ant.path.length} nodes)
Decisions: ${ant.path_decisions.map(d => d.from + '→' + d.to + ' [' + d.guided_by + '] ' + d.rationale).join('; ')}
Self-score: ${ant.self_score} (DO NOT anchor on this — score blind first)
Evidence: ${ant.evidence.map(e => e.source + ': ' + e.finding + ' [' + (e.strength || 'unknown') + ']').join('\n')}
Solution: ${ant.candidate_solution.summary}

Your job: MAXIMIZE the score. Find every strength.
- Does the path show creative or insightful exploration?
- Is the evidence concrete even if limited?
- Does the solution provide actionable value?
- Are path deviations from pheromone justified?

Score 0.0-1.0. Be generous but honest. Don't inflate without basis.`,
      { label: `defender:${ant.ant_id}`, phase: 'Score', schema: VOTE_SCHEMA }
    ),
    () => agent(
      `JUDGE: Score this ant's result OBJECTIVELY. No bias.

Objective: ${objective}
${rubric ? 'Rubric: ' + rubric : 'Default rubric: path_relevance(0.35) + evidence_strength(0.30) + solution_quality(0.25) + path_coherence(0.10)'}

Ant: ${ant.ant_id}
Path: ${ant.path.join(' → ')} (${ant.path.length} nodes)
Decisions: ${ant.path_decisions.map(d => d.from + '→' + d.to + ' [' + d.guided_by + '] ' + d.rationale).join('; ')}
Self-score: ${ant.self_score} (DO NOT anchor on this — score blind first)
Evidence: ${ant.evidence.map(e => e.source + ': ' + e.finding + ' [' + (e.strength || 'unknown') + ']').join('\n')}
Solution: ${ant.candidate_solution.summary}

Your job: Score PURELY on evidence. No default bias.
- Apply rubric dimensions systematically
- Weight each dimension, compute total
- Verify evidence references if possible (Read files cited)
- Compare path coherence objectively

Score 0.0-1.0. Confidence reflects evidence coverage.`,
      { label: `judge:${ant.ant_id}`, phase: 'Score', schema: VOTE_SCHEMA }
    ),
  ])
)

log(`${allVotes.filter(Boolean).length}/${antResults.length} ants scored by 3-vote panel`)

// Phase 2: Calibrate across all ants
phase('Calibrate')
log('Cross-ant calibration and hallucination detection...')

const voteDigest = antResults.map((ant, i) => {
  const votes = allVotes[i]
  if (!votes) return `${ant.ant_id}: no votes`
  const validVotes = votes.filter(Boolean)
  const scores = validVotes.map(v => v.score)
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  return `${ant.ant_id}: self=${ant.self_score} | prosecutor=${validVotes.find(v => v.role === 'prosecutor')?.score || '?'} defender=${validVotes.find(v => v.role === 'defender')?.score || '?'} judge=${validVotes.find(v => v.role === 'judge')?.score || '?'} | avg=${Math.round(avgScore * 100) / 100} | delta=${Math.round(Math.abs(ant.self_score - avgScore) * 100) / 100}`
}).join('\n')

const calibration = await agent(
  `Calibrate adversarial scores across ${antResults.length} ants.

Per-ant votes:
${voteDigest}

Tasks:
1. For each ant: compute verified_score as weighted average (prosecutor 0.25, defender 0.25, judge 0.50)
2. Compare self_score vs verified_score — flag hallucination if delta > 0.3
3. If all scores within ±0.05 (compressed range) — force differentiation by re-ranking
4. Compute calibration stats (mean, std, min, max, hallucination_rate)
5. Produce ranking (best to worst by verified_score)
6. Warnings: flag if >50% ants are hallucinating, if range is too compressed, etc.

Return the complete calibrated scoring result.`,
  { label: 'calibrate', phase: 'Calibrate', schema: CALIBRATION_SCHEMA }
)

return {
  iteration: iteration,
  votes: allVotes,
  calibration: calibration,
  metadata: {
    ants_scored: antResults.length,
    hallucination_rate: calibration ? calibration.calibration.hallucination_rate : null,
    best_ant: calibration ? calibration.ranking[0] : null,
    score_range: calibration ? [calibration.calibration.min, calibration.calibration.max] : null,
  },
}

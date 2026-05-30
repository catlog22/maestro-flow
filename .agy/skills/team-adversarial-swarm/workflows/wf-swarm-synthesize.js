export const meta = {
  name: 'wf-swarm-synthesize',
  description: 'Adversarial 3-perspective synthesis of swarm results with arbitrator',
  whenToUse: 'After swarm converges: synthesize best solution via 3 perspectives + arbitrated final report',
  phases: [
    { title: 'Analyze', detail: '3 parallel analysts: why-it-won, stability, caveats' },
    { title: 'Arbitrate', detail: 'Arbitrator synthesizes perspectives into best-solution report' },
  ],
}

const PERSPECTIVE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    assessment: { type: 'string' },
    key_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string' },
          evidence: { type: 'string' },
          significance: { type: 'string', enum: ['critical', 'important', 'minor'] },
        },
        required: ['finding', 'evidence', 'significance'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    verdict: { type: 'string' },
  },
  required: ['perspective', 'assessment', 'key_findings', 'confidence', 'verdict'],
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    best_solution: {
      type: 'object',
      properties: {
        path: { type: 'array', items: { type: 'string' } },
        score: { type: 'number' },
        iteration: { type: 'number' },
        ant_id: { type: 'string' },
        summary: { type: 'string' },
        evidence_chain: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, finding: { type: 'string' } }, required: ['source', 'finding'] } },
      },
      required: ['summary'],
    },
    why_it_won: { type: 'string' },
    pivotal_decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          decision: { type: 'string' },
          pheromone_guided: { type: 'boolean' },
          impact: { type: 'string' },
        },
        required: ['decision', 'impact'],
      },
    },
    runner_ups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ant_id: { type: 'string' },
          path: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' },
          diff_from_best: { type: 'string' },
        },
        required: ['ant_id', 'score', 'diff_from_best'],
      },
    },
    convergence_story: { type: 'string' },
    caveats: { type: 'array', items: { type: 'string' } },
    adversarial_assessment: {
      type: 'object',
      properties: {
        stability_verdict: { type: 'string' },
        caveat_severity: { type: 'string', enum: ['none', 'minor', 'significant', 'critical'] },
        confidence_in_result: { type: 'number' },
        decisive_perspective: { type: 'string' },
      },
      required: ['stability_verdict', 'caveat_severity', 'confidence_in_result'],
    },
    executive_summary: { type: 'string' },
  },
  required: ['title', 'best_solution', 'why_it_won', 'runner_ups', 'convergence_story', 'caveats', 'adversarial_assessment', 'executive_summary'],
}

const best = args?.best || {}
const topK = args?.top_k || []
const convergenceStory = args?.convergence_story || ''
const objective = args?.objective || ''
const totalIterations = args?.total_iterations || 0
const totalAnts = args?.total_ants || 0

const bestDigest = `Best solution:
  Ant: ${best.ant_id || 'unknown'}
  Path: ${(best.path || []).join(' → ')}
  Score: ${best.score || 'unknown'}
  Iteration: ${best.iteration || 'unknown'}
  Summary: ${best.summary || 'none'}
  Evidence: ${(best.evidence || []).map(e => e.source + ': ' + e.finding).join('; ') || 'none'}`

const topKDigest = topK.map((t, i) =>
  `#${i + 1}: ${t.ant_id} score=${t.score} path=${(t.path || []).join('→')}`
).join('\n')

// Phase 1: 3 parallel perspective analysts
phase('Analyze')
log('Launching 3-perspective adversarial analysis...')

const perspectives = await parallel([
  () => agent(
    `You are the WHY-IT-WON analyst. Explain why the best solution won.

Objective: ${objective}
${bestDigest}

Runner-ups:
${topKDigest || 'None available'}

Convergence: ${convergenceStory}
Total iterations: ${totalIterations}, Total ants: ${totalAnts}

Focus:
1. Which path decisions were PIVOTAL — where did best diverge from runner-ups?
2. Which decisions followed pheromone hints vs deviated? Were deviations the key?
3. Is the evidence chain compelling or circumstantial?
4. Compare best vs #2: what SPECIFIC factor gave best the edge?

Verdict: one sentence on the quality of the winning strategy.`,
    { label: 'analyst:why-won', phase: 'Analyze', schema: PERSPECTIVE_SCHEMA }
  ),
  () => agent(
    `You are the STABILITY analyst. Assess whether this result is robust or lucky.

Objective: ${objective}
${bestDigest}

Runner-ups:
${topKDigest || 'None available'}

Convergence: ${convergenceStory}
Total iterations: ${totalIterations}, Total ants: ${totalAnts}

Focus:
1. Did MULTIPLE ants find similar solutions? (convergence = robust)
2. Is the best a lone outlier? (divergence from pack = possibly lucky)
3. Score gap between #1 and #2: large gap = clear winner, small gap = could flip
4. If the same swarm ran again, would it find the same answer?
5. Was convergence triggered by genuine consensus or just timeout?

Verdict: "robust" / "fragile" / "uncertain" — with evidence.`,
    { label: 'analyst:stability', phase: 'Analyze', schema: PERSPECTIVE_SCHEMA }
  ),
  () => agent(
    `You are the CAVEATS analyst. Find every limitation and risk in this result.

Objective: ${objective}
${bestDigest}

Runner-ups:
${topKDigest || 'None available'}

Convergence: ${convergenceStory}
Total iterations: ${totalIterations}, Total ants: ${totalAnts}

Focus:
1. Search space coverage: was the task space well-explored or did ants cluster?
2. Evidence quality: single-source claims vs multi-source verification?
3. Hallucination risk: how many ants were flagged for score inflation?
4. Solution actionability: can the result be directly applied, or needs more work?
5. What the swarm DIDN'T explore: are there obvious nodes/paths it missed?
6. Scaling: would a larger swarm / more iterations have found something better?

Be THOROUGH — every result has caveats. Honest caveats are more valuable than false confidence.
Verdict: overall risk level of relying on this result.`,
    { label: 'analyst:caveats', phase: 'Analyze', schema: PERSPECTIVE_SCHEMA }
  ),
])

const validPerspectives = perspectives.filter(Boolean)
const perspectiveDigest = validPerspectives.map(p =>
  `### ${p.perspective} (confidence: ${p.confidence}%)\n${p.assessment}\nKey findings:\n${p.key_findings.map(f => '- [' + f.significance + '] ' + f.finding).join('\n')}\nVerdict: ${p.verdict}`
).join('\n\n---\n\n')

log(`${validPerspectives.length} perspective analyses completed`)

// Phase 2: Arbitrator synthesizes
phase('Arbitrate')
log('Arbitrator synthesizing final report...')

const synthesis = await agent(
  `You are the ARBITRATOR. Synthesize 3 analyst perspectives into a definitive swarm result report.

=== OBJECTIVE ===
${objective}

=== BEST SOLUTION ===
${bestDigest}

=== RUNNER-UPS ===
${topKDigest || 'None'}

=== 3 ANALYST PERSPECTIVES ===
${perspectiveDigest}

=== CONVERGENCE ===
${convergenceStory}
Iterations: ${totalIterations}, Ants: ${totalAnts}

SYNTHESIZE:
1. Build the best_solution record with full evidence chain
2. Write why_it_won from the first analyst's pivotal decision analysis
3. Extract pivotal_decisions with pheromone guidance flags
4. Format runner_ups with diff_from_best
5. Write convergence_story narrative
6. Compile ALL caveats from the caveats analyst — don't soften them
7. adversarial_assessment:
   - stability_verdict from stability analyst
   - caveat_severity: none/minor/significant/critical based on caveats count and severity
   - confidence_in_result: weighted from all 3 perspectives
   - decisive_perspective: which analyst's findings had the most impact
8. Write executive_summary (3-4 sentences): what was found, how confident, what to watch out for
9. Title: concise result title

Max 150 lines in the generated content. Be sharp, not verbose.`,
  { label: 'arbitrate', phase: 'Arbitrate', schema: SYNTHESIS_SCHEMA }
)

return {
  perspectives: validPerspectives,
  synthesis: synthesis,
  metadata: {
    objective: objective,
    best_score: best.score,
    best_ant: best.ant_id,
    total_iterations: totalIterations,
    total_ants: totalAnts,
    stability_verdict: synthesis ? synthesis.adversarial_assessment.stability_verdict : null,
    caveat_severity: synthesis ? synthesis.adversarial_assessment.caveat_severity : null,
    confidence: synthesis ? synthesis.adversarial_assessment.confidence_in_result : null,
  },
}

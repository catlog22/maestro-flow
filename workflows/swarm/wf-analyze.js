export const meta = {
  name: 'wf-analyze',
  description: 'Multi-dimensional analysis with adversarial score verification and 3-way advocacy synthesis',
  whenToUse: 'Accelerate the analyze step with parallel exploration + scoring + adversarial cross-verify + judge panel Go/No-Go',
  phases: [
    { title: 'Explore', detail: '3-layer codebase exploration via cli-explore-agent' },
    { title: 'Score', detail: 'Parallel 6-dimension scoring via workflow-analyzer' },
    { title: 'CrossVerify', detail: 'Adversarial skeptic challenges each dimension score' },
    { title: 'Synthesize', detail: '3-way adversarial advocacy (go/no-go/conditional) + referee verdict' },
  ],
}

const DIMENSIONS = [
  { key: 'feasibility', focus: 'Technical difficulty, team capability, time constraints, tooling availability, infrastructure readiness' },
  { key: 'impact', focus: 'User value, business value, tech debt reduction, developer experience improvement, ecosystem contribution' },
  { key: 'risk', focus: 'Failure modes, security vulnerabilities, scalability limits, regression potential, data integrity threats' },
  { key: 'complexity', focus: 'Integration points, dependency count, learning curve, testing difficulty, migration path complexity' },
  { key: 'dependencies', focus: 'External services, internal module coupling, data dependencies, infrastructure requirements, third-party stability' },
  { key: 'alternatives', focus: 'Compare 2+ approaches with tradeoffs, evaluate build-vs-buy, assess migration paths, weigh technology options' },
]

const EXPLORATION_SCHEMA = {
  type: 'object',
  properties: {
    relevant_files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, role: { type: 'string' }, relevance: { type: 'string' } }, required: ['path', 'role'] } },
    call_chains: { type: 'array', items: { type: 'object', properties: { entry: { type: 'string' }, chain: { type: 'array', items: { type: 'string' } }, purpose: { type: 'string' } }, required: ['entry', 'chain'] } },
    data_flows: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, sink: { type: 'string' }, transforms: { type: 'array', items: { type: 'string' } } }, required: ['source', 'sink'] } },
    code_anchors: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, snippet: { type: 'string' }, significance: { type: 'string' } }, required: ['file', 'significance'] } },
    module_boundaries: { type: 'array', items: { type: 'object', properties: { module: { type: 'string' }, exports: { type: 'array', items: { type: 'string' } }, depends_on: { type: 'array', items: { type: 'string' } } }, required: ['module'] } },
  },
  required: ['relevant_files', 'code_anchors'],
}

const DIMENSION_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    score: { type: 'number', minimum: 1, maximum: 5 },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    evidence: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, source: { type: 'string' }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] } }, required: ['claim', 'source', 'strength'] } },
    risks: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, probability: { type: 'string', enum: ['high', 'medium', 'low'] }, impact: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, mitigation: { type: 'string' } }, required: ['risk', 'probability', 'impact'] } },
    summary: { type: 'string' },
  },
  required: ['dimension', 'score', 'confidence', 'evidence', 'summary'],
}

const SCORE_CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    original_score: { type: 'number' },
    challenge_result: { type: 'string', enum: ['confirmed', 'inflated', 'deflated'] },
    adjusted_score: { type: 'number', minimum: 1, maximum: 5 },
    counter_evidence: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, source: { type: 'string' } }, required: ['claim', 'source'] } },
    reasoning: { type: 'string' },
  },
  required: ['dimension', 'original_score', 'challenge_result', 'adjusted_score', 'reasoning'],
}

const ADVOCACY_SCHEMA = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: ['go', 'conditional-go', 'no-go'] },
    argument: { type: 'string' },
    key_evidence: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, source: { type: 'string' }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] } }, required: ['point', 'source'] } },
    weaknesses_acknowledged: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['stance', 'argument', 'key_evidence', 'confidence'],
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: { type: 'number', minimum: 1, maximum: 5 },
    overall_confidence: { type: 'number', minimum: 0, maximum: 100 },
    recommendation: { type: 'string', enum: ['go', 'conditional-go', 'no-go'] },
    scope_verdict: { type: 'string', enum: ['large', 'medium', 'small'] },
    adversarial_outcome: { type: 'object', properties: { winning_stance: { type: 'string' }, go_confidence: { type: 'number' }, nogo_confidence: { type: 'number' }, conditional_confidence: { type: 'number' }, decisive_factor: { type: 'string' } }, required: ['winning_stance', 'decisive_factor'] },
    risk_matrix: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, probability: { type: 'string' }, impact: { type: 'string' }, dimension: { type: 'string' } }, required: ['risk', 'probability', 'impact', 'dimension'] } },
    decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, decision: { type: 'string' }, status: { type: 'string', enum: ['locked', 'free', 'deferred'] }, rationale: { type: 'string' }, options_considered: { type: 'array', items: { type: 'string' } } }, required: ['id', 'decision', 'status', 'rationale'] } },
    implementation_scope: { type: 'array', items: { type: 'object', properties: { objective: { type: 'string' }, acceptance_criteria: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, target_files: { type: 'array', items: { type: 'string' } } }, required: ['objective', 'priority'] } },
    executive_summary: { type: 'string' },
  },
  required: ['overall_score', 'overall_confidence', 'recommendation', 'scope_verdict', 'adversarial_outcome', 'risk_matrix', 'decisions', 'executive_summary'],
}

const target = args?.target || 'the current codebase'
const scope = args?.scope || ''
const context = args?.context || ''
const phaseArg = args?.phase || null
const selectedDimensions = args?.dimensions
  ? DIMENSIONS.filter(d => args.dimensions.includes(d.key))
  : DIMENSIONS

// Phase 1: Codebase Exploration via cli-explore-agent
phase('Explore')
log('Launching 3-layer codebase exploration via cli-explore-agent...')

const exploration = await agent(
  `Perform 3-layer codebase exploration for: ${target}
${scope ? 'File scope: ' + scope : 'Explore the full project structure.'}
${context ? 'Additional context: ' + context : ''}
${phaseArg ? 'Phase context: ' + phaseArg : ''}

Layer 1 — Module Discovery (Breadth):
  Search by topic keywords, identify ALL relevant files, map module boundaries.

Layer 2 — Structure Tracing (Depth):
  Top 3-5 key files: trace call chains 2-3 levels deep, identify data flow.

Layer 3 — Code Anchor Extraction (Detail):
  Each key finding: extract code snippet (20-50 lines) with file:line reference.

Return structured exploration results.`,
  { label: 'explore:codebase', phase: 'Explore', schema: EXPLORATION_SCHEMA, agentType: 'cli-explore-agent' }
)

const explorationContext = exploration
  ? `Relevant files: ${exploration.relevant_files.map(f => f.path).join(', ')}
Call chains: ${(exploration.call_chains || []).map(c => c.entry + ' → ' + c.chain.join(' → ')).join('; ')}
Code anchors: ${exploration.code_anchors.map(a => a.file + ':' + (a.line || '?') + ' — ' + a.significance).join('\n')}`
  : 'No exploration results available.'

log(`Exploration complete: ${exploration ? exploration.relevant_files.length : 0} files, ${exploration ? exploration.code_anchors.length : 0} anchors`)

// Phase 2: Parallel 6-Dimension Scoring via workflow-analyzer
phase('Score')
log(`Scoring ${selectedDimensions.length} dimensions in parallel via workflow-analyzer...`)

const scores = await parallel(
  selectedDimensions.map(dim => () =>
    agent(
      `Evaluate dimension: ${dim.key}
Focus areas: ${dim.focus}
Target: ${target}
${phaseArg ? 'Phase: ' + phaseArg : ''}

Codebase exploration context:
${explorationContext}

Score this dimension on a 1-5 scale with specific evidence from the codebase:
- 1: Critical issues, blocks progress
- 2: Significant concerns, requires major effort
- 3: Manageable, standard effort required
- 4: Good position, minor concerns only
- 5: Excellent, minimal risk

Every score must have specific file:line evidence, not general impressions.
Include confidence percentage (0-100) based on evidence strength.
For Risk dimension: include probability × impact matrix entries.`,
      { label: `score:${dim.key}`, phase: 'Score', schema: DIMENSION_SCHEMA, agentType: 'workflow-analyzer' }
    )
  )
)

const validScores = scores.filter(Boolean)
log(`${validScores.length}/${selectedDimensions.length} dimensions scored`)

// Phase 3: Adversarial CrossVerify — skeptic challenges each dimension score
phase('CrossVerify')
log(`Adversarial challenge of ${validScores.length} dimension scores...`)

const challenges = await pipeline(
  validScores,
  (score) => agent(
    `You are an adversarial SKEPTIC. Your job is to REFUTE this dimension score.

Dimension: ${score.dimension}
Original Score: ${score.score}/5 (confidence: ${score.confidence}%)
Evidence cited:
${score.evidence.map(e => '- ' + e.claim + ' [' + e.strength + '] @ ' + e.source).join('\n')}
Risks identified: ${(score.risks || []).map(r => r.risk + ' (' + r.probability + '/' + r.impact + ')').join('; ') || 'none'}
Summary: ${score.summary}

Target: ${target}
${explorationContext}

CHALLENGE the score by:
1. Read the ACTUAL source files cited as evidence — does the code actually support the claim?
2. Search for counter-evidence the scorer missed (contradictory patterns, hidden complexity)
3. Check for cognitive biases: anchoring to first impression, confirmation bias, optimism bias
4. Evaluate if the confidence level is justified by evidence quantity and strength

Challenge result:
- "confirmed": evidence holds, score is fair (only if you genuinely cannot find counter-evidence)
- "inflated": score should be LOWER — evidence is weak, cherry-picked, or missing key risks
- "deflated": score should be HIGHER — scorer was too pessimistic, missed positive signals

DEFAULT to "inflated" if uncertain — skeptics err on the side of caution.
Provide your adjusted_score and specific counter_evidence.`,
    { label: `challenge:${score.dimension}`, phase: 'CrossVerify', schema: SCORE_CHALLENGE_SCHEMA, agentType: 'workflow-analyzer' }
  )
)

const adjustedScores = validScores.map((score, i) => {
  const challenge = challenges[i]
  if (!challenge) return score
  return {
    ...score,
    original_score: score.score,
    score: challenge.adjusted_score,
    challenge_result: challenge.challenge_result,
    challenge_reasoning: challenge.reasoning,
    counter_evidence: challenge.counter_evidence,
  }
})

const challengedCount = challenges.filter(Boolean).filter(c => c.challenge_result !== 'confirmed').length
log(`${challengedCount}/${validScores.length} scores adjusted by adversarial challenge`)

// Phase 4: 3-way Adversarial Advocacy Panel + Referee
phase('Synthesize')

const scoreDigest = adjustedScores.map(s =>
  `${s.dimension}: ${s.score}/5${s.original_score !== undefined && s.original_score !== s.score ? ' (was ' + s.original_score + '/5, ' + s.challenge_result + ')' : ''} (confidence: ${s.confidence}%)\n  ${s.summary}${s.challenge_reasoning ? '\n  Skeptic: ' + s.challenge_reasoning : ''}\n  Evidence: ${s.evidence.slice(0, 3).map(e => e.claim + ' [' + e.strength + ']').join('; ')}\n  Risks: ${(s.risks || []).map(r => r.risk + ' (' + r.probability + '/' + r.impact + ')').join('; ') || 'none identified'}`
).join('\n\n')

log('Launching 3-way adversarial advocacy panel (go / no-go / conditional)...')

const advocacies = await parallel([
  () => agent(
    `You are the GO ADVOCATE. Argue that this project SHOULD proceed immediately.

Target: ${target}
${phaseArg ? 'Phase: ' + phaseArg : ''}

Dimension Scores (after adversarial challenge):
${scoreDigest}

Codebase: ${explorationContext}

Make the STRONGEST possible case for GO:
- Highlight favorable scores and strong evidence
- Reframe manageable risks with concrete mitigation strategies
- Emphasize opportunity cost of NOT proceeding (market window, tech debt accumulation)
- Acknowledge weaknesses honestly — admitted weaknesses strengthen credibility

You MUST argue for "go". Your confidence reflects how strong your case actually is, not how much you want it to succeed.`,
    { label: 'advocate:go', phase: 'Synthesize', schema: ADVOCACY_SCHEMA }
  ),
  () => agent(
    `You are the NO-GO ADVOCATE. Argue that this project should NOT proceed.

Target: ${target}
${phaseArg ? 'Phase: ' + phaseArg : ''}

Dimension Scores (after adversarial challenge):
${scoreDigest}

Codebase: ${explorationContext}

Make the STRONGEST possible case for NO-GO:
- Highlight unfavorable scores, especially where skeptics adjusted downward
- Emphasize cascading failure risks and evidence gaps
- Point out where confidence is low but implications are high
- Acknowledge strengths honestly — admitted strengths strengthen credibility

You MUST argue for "no-go". Your confidence reflects how strong your case actually is.`,
    { label: 'advocate:no-go', phase: 'Synthesize', schema: ADVOCACY_SCHEMA }
  ),
  () => agent(
    `You are the CONDITIONAL-GO ADVOCATE. Argue this should proceed ONLY under specific conditions.

Target: ${target}
${phaseArg ? 'Phase: ' + phaseArg : ''}

Dimension Scores (after adversarial challenge):
${scoreDigest}

Codebase: ${explorationContext}

Make the case for CONDITIONAL-GO:
- Identify which risks are blocking vs manageable with mitigation
- Define SPECIFIC, MEASURABLE conditions that must be met before proceeding
- Propose staged approach that limits downside (MVP → iterate)
- Specify non-negotiable prerequisites vs nice-to-haves

You MUST argue for "conditional-go". List concrete conditions in the conditions[] field.`,
    { label: 'advocate:conditional', phase: 'Synthesize', schema: ADVOCACY_SCHEMA }
  ),
])

const validAdvocacies = advocacies.filter(Boolean)
const advocacyDigest = validAdvocacies.map(a =>
  `### ${a.stance.toUpperCase()} ADVOCATE (confidence: ${a.confidence}%)\n${a.argument}\nKey evidence: ${a.key_evidence.map(e => e.point + ' [' + e.strength + ']').join('; ')}\nWeaknesses admitted: ${(a.weaknesses_acknowledged || []).join('; ') || 'none'}\nConditions: ${(a.conditions || []).join('; ') || 'n/a'}`
).join('\n\n')

log('Referee resolving adversarial debate...')

const synthesis = await agent(
  `You are the REFEREE. Three advocates have argued their positions on this project.

Target: ${target}
${phaseArg ? 'Phase: ' + phaseArg : ''}

=== ADVERSARIAL DEBATE ===
${advocacyDigest}

=== ADJUSTED DIMENSION SCORES ===
${scoreDigest}

=== CODEBASE EXPLORATION ===
${explorationContext}

RESOLVE the debate:
1. Evaluate each advocate's argument strength + acknowledged weaknesses
2. Cross-reference evidence claims against actual dimension scores
3. Higher confidence + stronger evidence = more weight
4. Record the adversarial_outcome: which stance won and the decisive factor

Decision rules:
- Any adjusted dimension at 1/5 with confirmed evidence → no-go
- Average adjusted score < 2.5 → no-go
- No-go confidence > 80% AND go confidence < 50% → no-go
- Go confidence > 80% AND no-go confidence < 40% → go
- If go and no-go are BOTH high-confidence (>60%) → conditional-go (genuine controversy)
- Otherwise → weigh by evidence strength

Then:
5. Calculate weighted overall score (Feasibility .25, Impact .20, Risk .20, Complexity .15, Dependencies .15, Alternatives .05)
6. Build risk_matrix from all dimensions
7. Extract decisions (locked/free/deferred)
8. Define implementation_scope
9. Write executive summary including adversarial debate outcome`,
  { label: 'referee', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA, agentType: 'workflow-analyzer' }
)

return {
  exploration: exploration,
  dimensions: adjustedScores,
  advocacies: validAdvocacies,
  synthesis: synthesis,
  metadata: {
    target: target,
    scope: scope,
    phase: phaseArg,
    dimension_count: selectedDimensions.length,
    completed_count: validScores.length,
    scores_challenged: challengedCount,
    overall_score: synthesis ? synthesis.overall_score : null,
    recommendation: synthesis ? synthesis.recommendation : null,
    scope_verdict: synthesis ? synthesis.scope_verdict : null,
    adversarial_outcome: synthesis ? synthesis.adversarial_outcome : null,
  },
}

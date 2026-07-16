export const meta = {
  name: 'wf-brainstorm',
  description: 'Multi-role brainstorm with 3-specialist cross-review and adversarial guidance arbitration',
  whenToUse: 'Accelerate the brainstorm step with parallel roles + 3-specialist cross-review + adversarial guidance synthesis',
  phases: [
    { title: 'Analyze', detail: 'Parallel multi-role analysis via role-design-author' },
    { title: 'CrossReview', detail: '3 specialized reviewers (conflict-hunter, synergy-finder, gap-detector) in parallel' },
    { title: 'Compete', detail: '3 independent guidance proposals from competing philosophies' },
    { title: 'Arbitrate', detail: 'Adversarial arbitrator resolves competing proposals into unified guidance' },
  ],
}

const VALID_ROLES = [
  { key: 'system-architect', focus: 'System design, scalability, maintainability, module boundaries, technical debt, design patterns, infrastructure' },
  { key: 'product-manager', focus: 'User value, market fit, MVP scope, prioritization, success metrics, stakeholder management, feature ROI' },
  { key: 'test-strategist', focus: 'Testability, quality assurance, test pyramid, coverage strategy, risk-based testing, regression prevention' },
  { key: 'ux-expert', focus: 'User experience, interaction patterns, accessibility, cognitive load, information architecture, user flows' },
  { key: 'subject-matter-expert', focus: 'Domain knowledge, business rules, industry standards, compliance requirements, edge cases from domain' },
  { key: 'data-architect', focus: 'Data modeling, storage strategy, query patterns, migration paths, data integrity, caching, consistency' },
  { key: 'ui-designer', focus: 'Visual design, component hierarchy, design tokens, responsive layout, motion, color and typography' },
  { key: 'product-owner', focus: 'Business priorities, backlog management, acceptance criteria, stakeholder value, sprint planning' },
  { key: 'scrum-master', focus: 'Process efficiency, team dynamics, impediment removal, delivery cadence, continuous improvement' },
]

const ROLE_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    decision_digest: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          feature: { type: 'string' },
          stance: { type: 'string' },
          priority: { type: 'string', enum: ['must-have', 'should-have', 'nice-to-have'] },
          rationale: { type: 'string' },
        },
        required: ['id', 'feature', 'stance', 'priority'],
      },
    },
    interfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          contract: { type: 'string' },
          consumers: { type: 'array', items: { type: 'string' } },
          provider: { type: 'string' },
        },
        required: ['contract', 'consumers'],
      },
    },
    cross_cutting_positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          position: { type: 'string' },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        },
        required: ['topic', 'position', 'strength'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string' },
          impact: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['finding', 'impact'],
      },
    },
    key_insight: { type: 'string' },
  },
  required: ['role', 'decision_digest', 'cross_cutting_positions', 'findings', 'key_insight'],
}

const CROSS_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviewer_type: { type: 'string' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' } },
          topic: { type: 'string' },
          stances: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, stance: { type: 'string' } }, required: ['role', 'stance'] } },
          resolution_suggestion: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'significant', 'minor'] },
        },
        required: ['id', 'roles', 'topic', 'stances', 'severity'],
      },
    },
    synergies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          roles: { type: 'array', items: { type: 'string' } },
          topic: { type: 'string' },
          combined_value: { type: 'string' },
        },
        required: ['roles', 'topic', 'combined_value'],
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          missing_perspective: { type: 'string' },
          impact: { type: 'string' },
        },
        required: ['area', 'missing_perspective'],
      },
    },
  },
  required: ['reviewer_type', 'conflicts', 'synergies', 'gaps'],
}

const GUIDANCE_PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    philosophy: { type: 'string' },
    guidelines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          guideline: { type: 'string' },
          category: { type: 'string', enum: ['must', 'must-not', 'should', 'should-not', 'may'] },
          source_roles: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
          resolved_conflict: { type: 'string' },
        },
        required: ['id', 'guideline', 'category', 'rationale'],
      },
    },
    conflict_resolutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          conflict_id: { type: 'string' },
          resolution: { type: 'string' },
          rationale: { type: 'string' },
          winner_role: { type: 'string' },
        },
        required: ['conflict_id', 'resolution', 'rationale'],
      },
    },
    trade_off_summary: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['philosophy', 'guidelines', 'conflict_resolutions', 'confidence'],
}

const GUIDANCE_SCHEMA = {
  type: 'object',
  properties: {
    guidelines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          guideline: { type: 'string' },
          category: { type: 'string', enum: ['must', 'must-not', 'should', 'should-not', 'may'] },
          source_roles: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
          resolved_conflict: { type: 'string' },
          source_proposal: { type: 'string' },
        },
        required: ['id', 'guideline', 'category', 'source_roles', 'rationale'],
      },
    },
    resolved_conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          conflict_id: { type: 'string' },
          resolution: { type: 'string' },
          rationale: { type: 'string' },
          winner_role: { type: 'string' },
          dissenting_proposal: { type: 'string' },
        },
        required: ['conflict_id', 'resolution', 'rationale'],
      },
    },
    arbitration_notes: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' } },
    executive_summary: { type: 'string' },
  },
  required: ['guidelines', 'resolved_conflicts', 'arbitration_notes', 'executive_summary'],
}

const topic = args?.topic || 'the proposed system'
const context = args?.context || ''
const roleCount = args?.count || 3
const selectedRoles = args?.roles
  ? VALID_ROLES.filter(r => args.roles.includes(r.key))
  : VALID_ROLES.slice(0, roleCount)

// Phase 1: Parallel multi-role analysis via role-design-author
phase('Analyze')
log(`Launching ${selectedRoles.length} role analyses in parallel via role-design-author...`)

const analyses = await parallel(
  selectedRoles.map(role => () =>
    agent(
      `You are the ${role.key} role analyzing: ${topic}
${context ? 'Context: ' + context : ''}

Your focus areas: ${role.focus}

Produce a structured role analysis with:
1. Decision Digest — your stances on each feature/aspect (id, feature, stance, priority, rationale)
2. Interfaces — contracts you propose/consume (contract, consumers, provider)
3. Cross-Cutting Positions — your stance on shared topics (topic, position, strength)
4. Findings — discoveries with impact and evidence
5. Key Insight — your single most important observation

Read relevant source files if needed to ground your analysis in reality.
Be specific and opinionated — take clear stances with rationale.`,
      { label: `role:${role.key}`, phase: 'Analyze', schema: ROLE_ANALYSIS_SCHEMA, agentType: 'role-design-author' }
    )
  )
)

const validAnalyses = analyses.filter(Boolean)
log(`${validAnalyses.length}/${selectedRoles.length} role analyses completed`)

const analysesDigest = validAnalyses.map(a => {
  const decisions = a.decision_digest.map(d => `  ${d.id}: [${d.priority}] ${d.feature} — ${d.stance}`).join('\n')
  const positions = a.cross_cutting_positions.map(p => `  ${p.topic}: ${p.position} [${p.strength}]`).join('\n')
  const findings = a.findings.map(f => `  - ${f.finding} (impact: ${f.impact})`).join('\n')
  return `## ${a.role}\nKey insight: ${a.key_insight}\n\nDecisions:\n${decisions}\n\nPositions:\n${positions}\n\nFindings:\n${findings}`
}).join('\n\n---\n\n')

// Phase 2: 3 specialized cross-reviewers in parallel
phase('CrossReview')
log('Launching 3 specialized cross-reviewers in parallel...')

const crossReviews = await parallel([
  () => agent(
    `You are the CONFLICT HUNTER. Your sole mission is to find contradictions between roles.

${validAnalyses.length} role analyses:
${analysesDigest}

Focus EXCLUSIVELY on:
1. Same feature/topic with CONTRADICTORY stances between roles
2. Incompatible priorities (one role says must-have, another says not needed)
3. Conflicting cross-cutting positions
4. Interface mismatches (one produces X, another expects Y)

Classify each conflict:
- blocking: fundamental disagreement that prevents progress
- significant: meaningful disagreement but can be resolved
- minor: style/preference difference

For each conflict, suggest a resolution direction.
Set reviewer_type="conflict-hunter".
Be AGGRESSIVE — surface every possible contradiction, even subtle ones.`,
    { label: 'review:conflicts', phase: 'CrossReview', schema: CROSS_REVIEW_SCHEMA, agentType: 'cross-role-reviewer' }
  ),
  () => agent(
    `You are the SYNERGY FINDER. Your sole mission is to find reinforcing alignments between roles.

${validAnalyses.length} role analyses:
${analysesDigest}

Focus EXCLUSIVELY on:
1. Compatible positions that create MORE value when combined
2. Shared priorities that validate importance
3. Complementary interfaces (one provides exactly what another needs)
4. Cross-cutting alignments that reveal strong consensus

For each synergy, explain the combined value — how the combination is more than the sum.
Set reviewer_type="synergy-finder".
Be GENEROUS — surface every alignment, including implicit ones.`,
    { label: 'review:synergies', phase: 'CrossReview', schema: CROSS_REVIEW_SCHEMA, agentType: 'cross-role-reviewer' }
  ),
  () => agent(
    `You are the GAP DETECTOR. Your sole mission is to find MISSING perspectives and blind spots.

${validAnalyses.length} role analyses:
${analysesDigest}

Focus EXCLUSIVELY on:
1. Topics addressed by one role but IGNORED by others who should care
2. Missing role perspectives entirely (security not represented? operations?)
3. Unstated assumptions that no role challenged
4. Edge cases and failure modes no one considered
5. Integration points that fall between role responsibilities

For each gap, identify what perspective is missing and the impact of that blindspot.
Set reviewer_type="gap-detector".
Be THOROUGH — missing perspectives are the most dangerous type of oversight.`,
    { label: 'review:gaps', phase: 'CrossReview', schema: CROSS_REVIEW_SCHEMA, agentType: 'cross-role-reviewer' }
  ),
])

const validReviews = crossReviews.filter(Boolean)
const allConflicts = validReviews.flatMap(r => r.conflicts)
const allSynergies = validReviews.flatMap(r => r.synergies)
const allGaps = validReviews.flatMap(r => r.gaps)

log(`Cross-review: ${allConflicts.length} conflicts, ${allSynergies.length} synergies, ${allGaps.length} gaps`)

const crossReviewDigest = `Conflicts (${allConflicts.length}):
${allConflicts.map(c => `[${c.severity}] ${c.topic}: ${c.stances.map(s => s.role + '→' + s.stance).join(' vs ')}\n  Suggestion: ${c.resolution_suggestion || 'none'}`).join('\n')}

Synergies (${allSynergies.length}):
${allSynergies.map(s => `${s.roles.join(' + ')}: ${s.topic} — ${s.combined_value}`).join('\n')}

Gaps (${allGaps.length}):
${allGaps.map(g => `${g.area} — missing: ${g.missing_perspective}${g.impact ? ' (impact: ' + g.impact + ')' : ''}`).join('\n')}`

// Phase 3: 3 competing guidance proposals from different philosophies
phase('Compete')
log('Launching 3 competing guidance proposals...')

const proposals = await parallel([
  () => agent(
    `You are the CONSERVATIVE proposal author. Generate guidance that MINIMIZES RISK.

Topic: ${topic}
Role Analyses:\n${analysesDigest}

Cross-Review:\n${crossReviewDigest}

Your philosophy: SAFETY FIRST
- Resolve conflicts in favor of stability and backward compatibility
- MUST/MUST-NOT for anything with risk, SHOULD for everything else
- Prefer proven patterns over innovative approaches
- When in doubt, require explicit approval (deferred decision)
- Gaps should be addressed before proceeding

Generate guidelines using RFC-2119 (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY).
Resolve each conflict with your conservative lens.
Report trade_off_summary: what you sacrifice for safety.`,
    { label: 'proposal:conservative', phase: 'Compete', schema: GUIDANCE_PROPOSAL_SCHEMA }
  ),
  () => agent(
    `You are the PROGRESSIVE proposal author. Generate guidance that MAXIMIZES VELOCITY.

Topic: ${topic}
Role Analyses:\n${analysesDigest}

Cross-Review:\n${crossReviewDigest}

Your philosophy: SHIP FAST, ITERATE
- Resolve conflicts in favor of speed and user value
- Use MAY/SHOULD liberally, reserve MUST only for safety-critical items
- Prefer pragmatic solutions, accept tech debt if it unblocks progress
- Gaps can be addressed incrementally post-launch
- Favor the role closest to the user (PM, UX) in conflict resolution

Generate guidelines using RFC-2119 (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY).
Resolve each conflict with your progressive lens.
Report trade_off_summary: what risks you accept for velocity.`,
    { label: 'proposal:progressive', phase: 'Compete', schema: GUIDANCE_PROPOSAL_SCHEMA }
  ),
  () => agent(
    `You are the BALANCED proposal author. Generate guidance that OPTIMIZES FOR SUSTAINABILITY.

Topic: ${topic}
Role Analyses:\n${analysesDigest}

Cross-Review:\n${crossReviewDigest}

Your philosophy: SUSTAINABLE EXCELLENCE
- Resolve conflicts by weighing evidence strength from all perspectives
- Priority: security > correctness > user experience > performance > convenience
- "must-have" from multiple roles > "must-have" from single role
- Strong evidence > moderate > weak, regardless of role seniority
- Address critical gaps, defer minor ones
- Balance speed and quality based on risk level

Generate guidelines using RFC-2119 (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY).
Resolve each conflict with your balanced lens.
Report trade_off_summary: what you optimize for and what you deprioritize.`,
    { label: 'proposal:balanced', phase: 'Compete', schema: GUIDANCE_PROPOSAL_SCHEMA }
  ),
])

const validProposals = proposals.filter(Boolean)
const proposalDigest = validProposals.map(p =>
  `### ${p.philosophy} (confidence: ${p.confidence}%)\nGuidelines: ${p.guidelines.length}\nConflict resolutions: ${p.conflict_resolutions.length}\nTrade-offs: ${p.trade_off_summary}\nKey guidelines:\n${p.guidelines.slice(0, 5).map(g => `  [${g.category.toUpperCase()}] ${g.guideline}`).join('\n')}`
).join('\n\n')

log(`${validProposals.length} competing proposals generated`)

// Phase 4: Adversarial Arbitration
phase('Arbitrate')
log('Adversarial arbitrator resolving competing proposals...')

const guidance = await agent(
  `You are the ARBITRATOR. Three competing guidance proposals approach the same problem differently.

Topic: ${topic}

=== COMPETING PROPOSALS ===
${proposalDigest}

=== FULL PROPOSALS ===
${validProposals.map(p => `## ${p.philosophy}\n${p.guidelines.map(g => `[${g.category}] ${g.id}: ${g.guideline} — ${g.rationale}`).join('\n')}\n\nConflict resolutions:\n${p.conflict_resolutions.map(r => `${r.conflict_id}: ${r.resolution} (winner: ${r.winner_role || 'compromise'})`).join('\n')}`).join('\n\n---\n\n')}

=== CROSS-REVIEW DATA ===
${crossReviewDigest}

ARBITRATE:
1. For each guideline topic, compare how all 3 proposals handle it
2. Select the BEST resolution for each conflict — not always the same philosophy
3. Cherry-pick the strongest guidelines from each proposal
4. When proposals agree → high-confidence MUST/MUST-NOT
5. When proposals split 2-1 → go with the 2, note the dissent
6. When all 3 disagree → evaluate evidence depth and pick the best-argued position
7. List remaining open_questions that genuinely need user input
8. Write arbitration_notes explaining your meta-reasoning
9. Write executive_summary (2-3 paragraphs)

Tag each output guideline with source_proposal to trace its origin.`,
  { label: 'arbitrate', phase: 'Arbitrate', schema: GUIDANCE_SCHEMA }
)

return {
  analyses: validAnalyses,
  crossReviews: validReviews,
  proposals: validProposals,
  guidance: guidance,
  metadata: {
    topic: topic,
    role_count: selectedRoles.length,
    completed_count: validAnalyses.length,
    conflict_count: allConflicts.length,
    blocking_conflicts: allConflicts.filter(c => c.severity === 'blocking').length,
    synergy_count: allSynergies.length,
    gap_count: allGaps.length,
    proposal_count: validProposals.length,
    guideline_count: guidance ? guidance.guidelines.length : 0,
  },
}

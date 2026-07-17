export const meta = {
  name: 'wf-grill',
  description: 'Adversarial stress-testing with meta-skeptic challenge and 3-vote verdict',
  whenToUse: 'Accelerate the grill step with parallel branch probing + meta-adversarial synthesis + 3-vote verdict',
  phases: [
    { title: 'Explore', detail: 'Codebase evidence gathering via cli-explore-agent' },
    { title: 'Stress', detail: 'Parallel adversarial branch probing' },
    { title: 'MetaChallenge', detail: 'Meta-skeptic challenges the stress-test findings themselves' },
    { title: 'Synthesize', detail: '3-vote adversarial verdict (optimist/pessimist/realist)' },
  ],
}

const BRANCHES = [
  { key: 'scope', focus: 'Scope & Boundaries — What is explicitly in/out? Where are the edges? Challenge vague boundaries with concrete code symbols.' },
  { key: 'data-model', focus: 'Data Model & State — How does data flow? What state transitions exist? Challenge naming conflicts with codebase terminology.' },
  { key: 'edge-cases', focus: 'Edge Cases & Failure Modes — What breaks at scale? What happens on invalid input? What if dependent services fail?' },
  { key: 'integration', focus: 'Integration & Dependencies — What existing systems are touched? What contracts must be honored? What breaks if we change X?' },
  { key: 'scale', focus: 'Scale & Performance — At 10x/100x current load, what breaks first? Which queries degrade? Where are the O(n^2) risks?' },
  { key: 'security', focus: 'Security & Access Control — What is the attack surface? Who can access what? Where is trust assumed but not verified?' },
  { key: 'operations', focus: 'Observability & Operations — How do we know it is working? What alerts fire? How do we debug production issues?' },
  { key: 'migration', focus: 'Migration & Rollback — What is the rollback path? Can we do a zero-downtime deploy? What data migration is needed?' },
]

const EXPLORATION_SCHEMA = {
  type: 'object',
  properties: {
    relevant_symbols: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' }, type: { type: 'string' } }, required: ['symbol', 'file'] } },
    existing_terminology: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, usage_location: { type: 'string' }, context: { type: 'string' } }, required: ['term', 'usage_location'] } },
    data_flows: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, data_shape: { type: 'string' } }, required: ['from', 'to'] } },
    integration_points: { type: 'array', items: { type: 'object', properties: { system: { type: 'string' }, interface: { type: 'string' }, contract: { type: 'string' } }, required: ['system', 'interface'] } },
  },
  required: ['relevant_symbols', 'existing_terminology'],
}

const BRANCH_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    challenges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          code_evidence: { type: 'string' },
          contradiction: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'significant', 'minor'] },
          proposed_resolution: { type: 'string' },
        },
        required: ['question', 'severity'],
      },
    },
    terminology_conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          proposed_term: { type: 'string' },
          codebase_term: { type: 'string' },
          location: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['proposed_term', 'codebase_term', 'recommendation'],
      },
    },
    assumptions_challenged: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['sound', 'needs-clarification', 'fundamentally-flawed'] },
  },
  required: ['branch', 'challenges', 'terminology_conflicts', 'assumptions_challenged', 'verdict'],
}

const META_CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    overblown_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          finding: { type: 'string' },
          why_overblown: { type: 'string' },
          actual_severity: { type: 'string', enum: ['blocking', 'significant', 'minor', 'non-issue'] },
        },
        required: ['branch', 'finding', 'why_overblown', 'actual_severity'],
      },
    },
    missed_issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          missed_issue: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'significant', 'minor'] },
          evidence: { type: 'string' },
        },
        required: ['area', 'missed_issue', 'severity'],
      },
    },
    stress_test_quality: { type: 'number', minimum: 1, maximum: 5 },
    meta_assessment: { type: 'string' },
  },
  required: ['overblown_findings', 'missed_issues', 'stress_test_quality', 'meta_assessment'],
}

const VERDICT_VOTE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    verdict: { type: 'string', enum: ['ready-for-brainstorm', 'needs-refinement', 'back-to-drawing-board'] },
    argument: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    key_reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['perspective', 'verdict', 'argument', 'confidence'],
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    overall_verdict: { type: 'string', enum: ['ready-for-brainstorm', 'needs-refinement', 'back-to-drawing-board'] },
    adversarial_outcome: { type: 'object', properties: { optimist: { type: 'string' }, pessimist: { type: 'string' }, realist: { type: 'string' }, decisive_factor: { type: 'string' } }, required: ['optimist', 'pessimist', 'realist', 'decisive_factor'] },
    blocking_issues: { type: 'array', items: { type: 'object', properties: { branch: { type: 'string' }, issue: { type: 'string' }, must_resolve_before: { type: 'string' } }, required: ['branch', 'issue'] } },
    terminology: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, definition: { type: 'string' }, code_alignment: { type: 'string' } }, required: ['term', 'definition'] } },
    contradictions: { type: 'array', items: { type: 'object', properties: { between_branches: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, resolution: { type: 'string' } }, required: ['between_branches', 'description'] } },
    constraints_discovered: { type: 'array', items: { type: 'object', properties: { constraint: { type: 'string' }, source: { type: 'string' }, impact: { type: 'string' }, status: { type: 'string', enum: ['locked', 'free', 'deferred'] } }, required: ['constraint', 'source', 'status'] } },
    executive_summary: { type: 'string' },
  },
  required: ['overall_verdict', 'adversarial_outcome', 'blocking_issues', 'terminology', 'contradictions', 'constraints_discovered', 'executive_summary'],
}

const topic = args?.topic || ''
const context = args?.context || ''
const depth = args?.depth || 'standard'
const branchCount = depth === 'shallow' ? 3 : depth === 'deep' ? 8 : 5
const selectedBranches = BRANCHES.slice(0, branchCount)

// Phase 1: Codebase evidence gathering
phase('Explore')
log('Gathering codebase evidence for stress-testing...')

const exploration = await agent(
  `Explore the codebase to gather evidence for stress-testing this proposal:
Topic: ${topic}
${context ? 'Context: ' + context : ''}

Find:
1. Relevant symbols — functions, classes, types, variables related to this topic
2. Existing terminology — how the codebase names things in this domain (for conflict detection)
3. Data flows — how data moves through the system in this area
4. Integration points — external systems, internal modules, APIs touched

This evidence will be used to challenge assumptions and detect contradictions.`,
  { label: 'explore:evidence', phase: 'Explore', schema: EXPLORATION_SCHEMA, agentType: 'cli-explore-agent' }
)

const evidenceContext = exploration
  ? `Codebase evidence:
Symbols: ${exploration.relevant_symbols.map(s => s.symbol + ' @ ' + s.file).join(', ')}
Terminology: ${exploration.existing_terminology.map(t => t.term + ' (' + t.usage_location + ')').join(', ')}
Data flows: ${(exploration.data_flows || []).map(d => d.from + ' → ' + d.to).join(', ')}
Integration: ${(exploration.integration_points || []).map(i => i.system + ':' + i.interface).join(', ')}`
  : ''

// Phase 2: Parallel adversarial branch probing
phase('Stress')
log(`Stress-testing ${selectedBranches.length} branches in parallel...`)

const branchResults = await parallel(
  selectedBranches.map(branch => () =>
    agent(
      `You are an adversarial stress-tester for the "${branch.key}" branch.

Proposal being tested: ${topic}
${context ? 'Proposal context: ' + context : ''}
${evidenceContext}

Your focus: ${branch.focus}

Your job is to BREAK this proposal by:
1. Finding contradictions with existing code (cite file:line)
2. Detecting terminology conflicts (proposed names vs codebase names)
3. Challenging unstated assumptions with concrete counter-scenarios
4. Probing for cases the proposal hasn't considered

For each challenge:
- Ground it in code evidence (file paths, symbol names, data shapes)
- Classify severity: blocking (must fix before proceeding), significant (should address), minor (nice to clarify)
- Propose a resolution direction

Be adversarial but fair — only raise real issues backed by evidence.`,
      { label: `stress:${branch.key}`, phase: 'Stress', schema: BRANCH_SCHEMA }
    )
  )
)

const validBranches = branchResults.filter(Boolean)
log(`${validBranches.length}/${selectedBranches.length} branches probed`)

const branchDigest = validBranches.map(b => {
  const blocking = b.challenges.filter(c => c.severity === 'blocking')
  return `## ${b.branch} [${b.verdict}]
Challenges: ${b.challenges.length} (${blocking.length} blocking)
${blocking.map(c => `  ! ${c.question}${c.contradiction ? ' — ' + c.contradiction : ''}`).join('\n')}
Terminology conflicts: ${b.terminology_conflicts.map(t => t.proposed_term + ' vs ' + t.codebase_term).join(', ') || 'none'}
Assumptions challenged: ${b.assumptions_challenged.join('; ') || 'none'}`
}).join('\n\n')

// Phase 3: Meta-skeptic challenges the stress-test findings
phase('MetaChallenge')
log('Meta-skeptic challenging the stress-test findings themselves...')

const metaChallenge = await agent(
  `You are the META-SKEPTIC — the devil's advocate OF the devil's advocates.

The stress-testers above tried to break this proposal:
Topic: ${topic}

Their findings:
${branchDigest}

${evidenceContext}

Your job is to challenge THE STRESS-TESTERS:
1. OVERBLOWN FINDINGS: Which challenges are exaggerated, based on unlikely scenarios, or missing context?
   - Check if the "blocking" issues are actually blocking
   - See if the code evidence actually supports the claimed contradiction
   - Identify where stress-testers assumed worst-case without justification
2. MISSED ISSUES: What did the stress-testers NOT catch that they should have?
   - Blind spots across all branches
   - Interactions between branches that no single branch tested
   - Real risks that were obscured by focus on minor issues
3. Rate the overall stress_test_quality (1-5): how thorough and fair were the findings?

Be ruthlessly honest. Some stress-test findings ARE real; confirm those. But call out any that are theatrical rather than substantive.`,
  { label: 'meta-skeptic', phase: 'MetaChallenge', schema: META_CHALLENGE_SCHEMA }
)

const metaDigest = metaChallenge
  ? `Meta-skeptic assessment (quality: ${metaChallenge.stress_test_quality}/5):
Overblown: ${metaChallenge.overblown_findings.length} findings downgraded
${metaChallenge.overblown_findings.map(f => `  ${f.branch}: "${f.finding}" → ${f.actual_severity} — ${f.why_overblown}`).join('\n')}
Missed: ${metaChallenge.missed_issues.length} new issues surfaced
${metaChallenge.missed_issues.map(m => `  [${m.severity}] ${m.area}: ${m.missed_issue}`).join('\n')}
Assessment: ${metaChallenge.meta_assessment}`
  : 'Meta-challenge not available.'

// Phase 4: 3-vote adversarial verdict
phase('Synthesize')
log('Launching 3-vote adversarial verdict (optimist / pessimist / realist)...')

const votes = await parallel([
  () => agent(
    `You are the OPTIMIST. Vote on the proposal's readiness.

Proposal: ${topic}
Stress-test findings:\n${branchDigest}
Meta-skeptic review:\n${metaDigest}

Your lens: Focus on what IS working. Discount overblown findings. Trust proposed resolutions.
- "ready-for-brainstorm": blocking issues are addressable, proceed with awareness
- "needs-refinement": some issues need attention but proposal has merit
- "back-to-drawing-board": only if genuinely unfixable (you should almost never vote this)

Vote with your confidence level.`,
    { label: 'vote:optimist', phase: 'Synthesize', schema: VERDICT_VOTE_SCHEMA }
  ),
  () => agent(
    `You are the PESSIMIST. Vote on the proposal's readiness.

Proposal: ${topic}
Stress-test findings:\n${branchDigest}
Meta-skeptic review:\n${metaDigest}

Your lens: Focus on what is BROKEN. Amplify blocking issues. Question proposed resolutions.
- "back-to-drawing-board": if there are fundamental flaws or too many blocking issues
- "needs-refinement": if issues are real but fixable
- "ready-for-brainstorm": only if stress-testing found almost nothing (you should almost never vote this)

Vote with your confidence level.`,
    { label: 'vote:pessimist', phase: 'Synthesize', schema: VERDICT_VOTE_SCHEMA }
  ),
  () => agent(
    `You are the REALIST. Vote on the proposal's readiness.

Proposal: ${topic}
Stress-test findings:\n${branchDigest}
Meta-skeptic review:\n${metaDigest}

Your lens: Evidence-based, no bias. Weigh the meta-skeptic's corrections. Discount both theatrical threats and wishful thinking.
- "ready-for-brainstorm": if blocking issues are few, well-understood, and have clear resolutions
- "needs-refinement": if real issues exist but are tractable
- "back-to-drawing-board": if fundamental assumptions are wrong

Vote with your confidence level.`,
    { label: 'vote:realist', phase: 'Synthesize', schema: VERDICT_VOTE_SCHEMA }
  ),
])

const validVotes = votes.filter(Boolean)
const voteDigest = validVotes.map(v =>
  `${v.perspective}: ${v.verdict} (confidence: ${v.confidence}%)\n  ${v.argument}`
).join('\n\n')

const verdictCounts = {}
validVotes.forEach(v => { verdictCounts[v.verdict] = (verdictCounts[v.verdict] || 0) + 1 })
log(`Votes: ${Object.entries(verdictCounts).map(([k, v]) => k + '=' + v).join(', ')}`)

log('Synthesizing final verdict from adversarial votes...')

const synthesis = await agent(
  `Synthesize the final stress-test verdict from 3 adversarial voters.

Proposal: ${topic}

=== VOTES ===
${voteDigest}

Vote tally: ${Object.entries(verdictCounts).map(([k, v]) => k + '=' + v).join(', ')}

=== META-SKEPTIC REVIEW ===
${metaDigest}

=== BRANCH FINDINGS ===
${branchDigest}

RESOLVE:
1. Majority vote wins. Tie-break: go with the REALIST.
2. Record adversarial_outcome with each voter's verdict and the decisive factor
3. Compile blocking_issues from branches BUT exclude any the meta-skeptic downgraded to non-issue
4. Add any missed_issues from meta-skeptic as additional blocking if severity is blocking
5. Build unified terminology list
6. Detect cross-branch contradictions
7. Extract discovered constraints (locked/free/deferred)
8. Write executive summary including the adversarial debate and meta-challenge outcomes`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS_SCHEMA }
)

return {
  exploration: exploration,
  branches: validBranches,
  metaChallenge: metaChallenge,
  votes: validVotes,
  synthesis: synthesis,
  metadata: {
    topic: topic,
    depth: depth,
    branch_count: selectedBranches.length,
    completed_count: validBranches.length,
    meta_overblown: metaChallenge ? metaChallenge.overblown_findings.length : 0,
    meta_missed: metaChallenge ? metaChallenge.missed_issues.length : 0,
    stress_test_quality: metaChallenge ? metaChallenge.stress_test_quality : null,
    blocking_count: synthesis ? synthesis.blocking_issues.length : 0,
    contradiction_count: synthesis ? synthesis.contradictions.length : 0,
    verdict_votes: verdictCounts,
    overall_verdict: synthesis ? synthesis.overall_verdict : 'unknown',
  },
}

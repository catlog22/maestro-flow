export const meta = {
  name: 'wf-review',
  description: 'Multi-dimension code review with 3-vote adversarial verification and multi-perspective verdict',
  whenToUse: 'Accelerate the review step with parallel scanning + 3-vote finding verification + 3-perspective verdict arbitration',
  phases: [
    { title: 'Scan', detail: 'Parallel dimension scanning via workflow-reviewer' },
    { title: 'Verify', detail: '3-vote adversarial verification per critical finding (majority wins)' },
    { title: 'Report', detail: '3-perspective reporters (strict/lenient/objective) + arbitrated verdict' },
  ],
}

const REVIEW_DIMENSIONS = [
  { key: 'correctness', prefix: 'COR', prompt: 'Dimension: correctness. Focus: Logic errors, off-by-one, null handling, missing error propagation, type mismatches, unhandled edge cases, broken invariants, incorrect conditions.' },
  { key: 'security', prefix: 'SEC', prompt: 'Dimension: security. Focus: Injection vectors (SQL/command/XSS), auth bypass, hardcoded secrets, missing input validation, data exposure in logs/errors, SSRF, IDOR, insecure crypto.' },
  { key: 'performance', prefix: 'PRF', prompt: 'Dimension: performance. Focus: O(n^2+) algorithms, N+1 queries, missing pagination, resource leaks (unclosed handles/streams), synchronous blocking, missing caching, bundle size impact.' },
  { key: 'architecture', prefix: 'ARC', prompt: 'Dimension: architecture. Focus: Layer violations (UI calling DB directly), circular dependencies, god classes/functions, inconsistent patterns, tight coupling, missing abstractions.' },
  { key: 'maintainability', prefix: 'MNT', prompt: 'Dimension: maintainability. Focus: Functions >50 lines, cyclomatic complexity >10, duplicated logic, unclear naming, dead code, missing error context, poor separation of concerns.' },
  { key: 'best-practices', prefix: 'BPR', prompt: 'Dimension: best-practices. Focus: Deprecated API usage, framework anti-patterns, inconsistent style with codebase, missing TypeScript strict checks, raw `any` types, missing documentation for public APIs.' },
]

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          dimension: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['id', 'dimension', 'severity', 'title', 'file', 'description'],
      },
    },
  },
  required: ['dimension', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    finding_id: { type: 'string' },
    is_real: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    reasoning: { type: 'string' },
    adjusted_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'false-positive'] },
  },
  required: ['finding_id', 'is_real', 'confidence', 'reasoning'],
}

const PERSPECTIVE_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'BLOCK'] },
    overall_quality: { type: 'number', minimum: 1, maximum: 5 },
    rationale: { type: 'string' },
    blocking_issues: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, severity: { type: 'string' } }, required: ['id', 'title'] } },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['perspective', 'verdict', 'overall_quality', 'rationale', 'confidence'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'BLOCK'] },
    overall_quality: { type: 'number', minimum: 1, maximum: 5 },
    dimension_summary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: { type: 'string' },
          finding_count: { type: 'number' },
          max_severity: { type: 'string' },
          assessment: { type: 'string' },
        },
        required: ['dimension', 'finding_count'],
      },
    },
    blocking_issues: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, severity: { type: 'string' }, suggestion: { type: 'string' } }, required: ['id', 'title', 'file', 'severity'] } },
    adversarial_verdict: { type: 'object', properties: { strict: { type: 'string' }, lenient: { type: 'string' }, objective: { type: 'string' }, decisive_factor: { type: 'string' } }, required: ['strict', 'lenient', 'objective', 'decisive_factor'] },
    summary: { type: 'string' },
  },
  required: ['verdict', 'overall_quality', 'dimension_summary', 'blocking_issues', 'adversarial_verdict', 'summary'],
}

const target = args?.target || 'changed files on current branch'
const scope = args?.scope || ''
const specs = args?.specs || ''
const tier = args?.tier || 'standard'
const dimensions = args?.dimensions
  ? REVIEW_DIMENSIONS.filter(d => args.dimensions.includes(d.key))
  : (tier === 'quick' ? REVIEW_DIMENSIONS.slice(0, 3) : REVIEW_DIMENSIONS)

// Phase 1: Parallel dimension scanning
phase('Scan')
log(`Scanning ${dimensions.length} dimensions in parallel via workflow-reviewer...`)

const scans = await parallel(
  dimensions.map(dim => () =>
    agent(
      `${dim.prompt}

Review target: ${target}
${scope ? 'Files to review: ' + scope : 'Find changed files via git diff and review them.'}
${specs ? 'Project specs/conventions: ' + specs : ''}

Process:
1. Read the target files (use git diff if no explicit file list)
2. Perform structural scan — imports, exports, function signatures, complexity indicators
3. Apply dimension-specific analysis rules
4. Classify severity: Critical (security vuln, data corruption, crash) / High (logic bug, resource leak) / Medium (code smell, maintainability) / Low (style, minor optimization)
5. Return only real, actionable findings with specific file paths, line numbers, and evidence

Finding IDs use format: ${dim.prefix}-{NNN}`,
      { label: `scan:${dim.key}`, phase: 'Scan', schema: FINDING_SCHEMA, agentType: 'workflow-reviewer' }
    )
  )
)

const validScans = scans.filter(Boolean)
const allFindings = validScans.flatMap(s => s.findings)
const criticalHigh = allFindings.filter(f => f.severity === 'critical' || f.severity === 'high')

log(`Found ${allFindings.length} total (${criticalHigh.length} critical/high across ${validScans.length} dimensions)`)

// Phase 2: 3-vote adversarial verification per critical/high finding
phase('Verify')

const confirmedFindings = []
const falsePositives = []

if (criticalHigh.length > 0) {
  log(`3-vote adversarial verification of ${criticalHigh.length} critical/high findings...`)

  const verified = await pipeline(
    criticalHigh,
    (finding) => parallel([
      () => agent(
        `VOTE 1 — PROSECUTOR: Argue this finding IS REAL and the severity is justified.

Finding: [${finding.severity}] ${finding.id}: ${finding.title}
File: ${finding.file}${finding.line ? ':' + finding.line : ''}
Description: ${finding.description}
Evidence: ${finding.evidence || 'none provided'}

Read the actual source code. Build the case that this is a genuine issue:
- Show the exact code path that triggers the bug/vulnerability
- Demonstrate the impact with a concrete scenario
- Argue why the severity rating is correct or should be higher

Default to is_real=true. Only say false if the code clearly doesn't have this issue.`,
        { label: `vote1:${finding.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ),
      () => agent(
        `VOTE 2 — DEFENSE: Argue this finding is a FALSE POSITIVE or overstated.

Finding: [${finding.severity}] ${finding.id}: ${finding.title}
File: ${finding.file}${finding.line ? ':' + finding.line : ''}
Description: ${finding.description}
Evidence: ${finding.evidence || 'none provided'}

Read the actual source code. Build the case AGAINST this finding:
- Show handling elsewhere that mitigates the issue
- Demonstrate why the severity is overstated
- Find framework guarantees or type safety that prevents the claimed scenario

Default to is_real=false. Only confirm if you genuinely cannot find any defense.`,
        { label: `vote2:${finding.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ),
      () => agent(
        `VOTE 3 — INDEPENDENT JUDGE: Evaluate this finding objectively, without bias.

Finding: [${finding.severity}] ${finding.id}: ${finding.title}
File: ${finding.file}${finding.line ? ':' + finding.line : ''}
Description: ${finding.description}
Evidence: ${finding.evidence || 'none provided'}

Read the actual source code. Make an independent, evidence-based assessment:
- Verify the claimed behavior exists in the code
- Check if there are mitigations the reporter missed
- Assess the actual severity based on real-world impact

No default bias. Judge purely on evidence. Confidence should reflect evidence strength.`,
        { label: `vote3:${finding.id}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ),
    ])
  )

  verified.filter(Boolean).forEach((votes, i) => {
    const finding = criticalHigh[i]
    const validVotes = votes.filter(Boolean)
    const realVotes = validVotes.filter(v => v.is_real)
    const isConfirmed = realVotes.length >= 2

    if (isConfirmed) {
      const avgConfidence = Math.round(realVotes.reduce((s, v) => s + v.confidence, 0) / realVotes.length)
      const maxSeverity = validVotes.reduce((max, v) => {
        const order = ['false-positive', 'low', 'medium', 'high', 'critical']
        return order.indexOf(v.adjusted_severity || finding.severity) > order.indexOf(max) ? (v.adjusted_severity || finding.severity) : max
      }, 'low')
      confirmedFindings.push({
        ...finding,
        vote_count: `${realVotes.length}/${validVotes.length}`,
        avg_confidence: avgConfidence,
        adjusted_severity: maxSeverity,
        verdicts: validVotes,
      })
    } else {
      falsePositives.push({
        ...finding,
        vote_count: `${realVotes.length}/${validVotes.length}`,
        verdicts: validVotes,
      })
    }
  })

  log(`Verified: ${confirmedFindings.length} confirmed, ${falsePositives.length} false-positives (3-vote majority)`)
}

const lowMedFindings = allFindings.filter(f => f.severity === 'medium' || f.severity === 'low')

// Phase 3: 3-perspective report generation + arbitrated verdict
phase('Report')

const findingsDigest = `Confirmed findings (${confirmedFindings.length}, adversarially verified by 3-vote majority):
${confirmedFindings.map(f => `- [${f.adjusted_severity}] ${f.id}: ${f.title} @ ${f.file}:${f.line || '?'} (votes: ${f.vote_count}, confidence: ${f.avg_confidence}%)`).join('\n') || 'None'}

False positives filtered (${falsePositives.length}):
${falsePositives.map(f => `- ${f.id}: ${f.title} (votes: ${f.vote_count})`).join('\n') || 'None'}

Low/medium findings (${lowMedFindings.length}, not individually verified):
${lowMedFindings.map(f => `- [${f.severity}] ${f.id}: ${f.title} @ ${f.file}`).join('\n') || 'None'}`

log('Launching 3-perspective reporters (strict / lenient / objective)...')

const perspectives = await parallel([
  () => agent(
    `You are the STRICT REVIEWER. Apply the highest quality bar.

${findingsDigest}

Your philosophy: ANY confirmed critical/high finding warrants BLOCK. Any confirmed finding warrants REQUEST_CHANGES. Only APPROVE if zero findings exist.
- Rate quality conservatively
- List ALL confirmed findings as blocking
- Consider unverified medium findings as potential risks

Be strict but fair. Provide your verdict and rationale.`,
    { label: 'report:strict', phase: 'Report', schema: PERSPECTIVE_REPORT_SCHEMA }
  ),
  () => agent(
    `You are the LENIENT REVIEWER. Apply a practical, ship-focused bar.

${findingsDigest}

Your philosophy: Only BLOCK for confirmed critical findings with >80% confidence. REQUEST_CHANGES for confirmed high findings. APPROVE for everything else — medium/low findings can be addressed in follow-ups.
- Rate quality generously (good code is the norm)
- Only list truly blocking issues
- Unverified medium/low findings are informational

Be practical but honest. Provide your verdict and rationale.`,
    { label: 'report:lenient', phase: 'Report', schema: PERSPECTIVE_REPORT_SCHEMA }
  ),
  () => agent(
    `You are the OBJECTIVE REVIEWER. Apply evidence-based judgment.

${findingsDigest}

Your philosophy: Follow the evidence. No default bias.
- BLOCK: confirmed critical findings exist
- REQUEST_CHANGES: confirmed high findings but no critical
- APPROVE: no confirmed critical/high findings
- Quality rating based on finding density and severity distribution
- Weight findings by vote confidence

Be analytical and evidence-driven. Provide your verdict and rationale.`,
    { label: 'report:objective', phase: 'Report', schema: PERSPECTIVE_REPORT_SCHEMA }
  ),
])

const validPerspectives = perspectives.filter(Boolean)
const verdictCounts = { APPROVE: 0, REQUEST_CHANGES: 0, BLOCK: 0 }
validPerspectives.forEach(p => { verdictCounts[p.verdict] = (verdictCounts[p.verdict] || 0) + 1 })

const perspectiveDigest = validPerspectives.map(p =>
  `${p.perspective}: ${p.verdict} (quality: ${p.overall_quality}/5, confidence: ${p.confidence}%)\n  ${p.rationale}`
).join('\n\n')

log(`Perspective votes: APPROVE=${verdictCounts.APPROVE} REQUEST_CHANGES=${verdictCounts.REQUEST_CHANGES} BLOCK=${verdictCounts.BLOCK}`)
log('Arbitrating final verdict...')

const report = await agent(
  `Generate the final review report by arbitrating 3 reviewer perspectives.

=== 3 REVIEWER PERSPECTIVES ===
${perspectiveDigest}

Vote tally: APPROVE=${verdictCounts.APPROVE}, REQUEST_CHANGES=${verdictCounts.REQUEST_CHANGES}, BLOCK=${verdictCounts.BLOCK}

=== FINDING DATA ===
${findingsDigest}

ARBITRATE:
1. The final verdict follows MAJORITY VOTE among the 3 perspectives
2. Tie-break rule: if split 3 ways (1-1-1), go with the OBJECTIVE reviewer
3. If strict and objective agree → use their verdict regardless of lenient
4. Calculate overall_quality as weighted average (strict .25, lenient .25, objective .50)
5. Record adversarial_verdict with each perspective's vote and the decisive_factor
6. Compile dimension_summary from scan phase data
7. List blocking_issues = confirmed findings with adjusted_severity critical or high
8. Write summary including the adversarial deliberation outcome`,
  { label: 'arbitrate', phase: 'Report', schema: REPORT_SCHEMA }
)

return {
  report: report,
  confirmed: confirmedFindings,
  false_positives: falsePositives,
  low_findings: lowMedFindings,
  perspectives: validPerspectives,
  metadata: {
    target: target,
    dimensions_scanned: dimensions.length,
    total_findings: allFindings.length,
    verified_count: criticalHigh.length,
    confirmed_count: confirmedFindings.length,
    false_positive_count: falsePositives.length,
    verdict_votes: verdictCounts,
    verdict: report ? report.verdict : 'UNKNOWN',
  },
}

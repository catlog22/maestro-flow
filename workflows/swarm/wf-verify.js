export const meta = {
  name: 'wf-verify',
  description: 'Three-layer verification with prosecutor/defender/judge adversarial aggregation',
  whenToUse: 'Accelerate the execute step verification gate with parallel layer checks + adversarial pass/fail determination',
  phases: [
    { title: 'Check', detail: 'Parallel 3-layer verification + anti-pattern scan via workflow-verifier' },
    { title: 'Argue', detail: 'Prosecutor argues FAIL, Defender argues PASS — adversarial positions' },
    { title: 'Judge', detail: 'Judge resolves adversarial debate into final verdict' },
  ],
}

const LAYER_SCHEMA = {
  type: 'object',
  properties: {
    layer: { type: 'string', enum: ['existence', 'substance', 'connection'] },
    passed: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          goal: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'partial', 'skip'] },
          evidence: { type: 'string' },
          file: { type: 'string' },
          gap: { type: 'string' },
        },
        required: ['goal', 'status', 'evidence'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['layer', 'passed', 'checks', 'summary'],
}

const CONVERGENCE_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    criteria_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string' },
          verification_command: { type: 'string' },
          command_output: { type: 'string' },
        },
        required: ['criterion', 'met', 'evidence'],
      },
    },
    overall_converged: { type: 'boolean' },
  },
  required: ['task_id', 'criteria_results', 'overall_converged'],
}

const ANTIPATTERN_SCHEMA = {
  type: 'object',
  properties: {
    clean: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['stub', 'placeholder', 'todo', 'fixme', 'empty-return', 'empty-catch', 'ts-ignore', 'skip-test', 'hardcoded-secret', 'not-implemented'] },
          file: { type: 'string' },
          line: { type: 'number' },
          content: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'warning'] },
        },
        required: ['type', 'file', 'content', 'severity'],
      },
    },
  },
  required: ['clean', 'findings'],
}

const ARGUMENT_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['prosecutor', 'defender'] },
    stance: { type: 'string', enum: ['pass', 'fail'] },
    argument: { type: 'string' },
    key_points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          evidence: { type: 'string' },
          layer: { type: 'string' },
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

const AGGREGATE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'fail'] },
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
    layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          layer: { type: 'string' },
          passed: { type: 'boolean' },
          total_checks: { type: 'number' },
          passed_checks: { type: 'number' },
          failed_checks: { type: 'number' },
        },
        required: ['layer', 'passed', 'total_checks', 'passed_checks'],
      },
    },
    convergence_summary: {
      type: 'object',
      properties: {
        total_tasks: { type: 'number' },
        converged_tasks: { type: 'number' },
        unmet_criteria: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, criterion: { type: 'string' } }, required: ['task', 'criterion'] } },
      },
      required: ['total_tasks', 'converged_tasks'],
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          source_layer: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          remediation: { type: 'string' },
          affected_files: { type: 'array', items: { type: 'string' } },
        },
        required: ['description', 'source_layer', 'severity', 'remediation'],
      },
    },
    antipattern_blockers: { type: 'number' },
    executive_summary: { type: 'string' },
  },
  required: ['status', 'confidence', 'adversarial_outcome', 'layers', 'gaps', 'executive_summary'],
}

const goals = args?.goals || ''
const planDir = args?.plan_dir || ''
const scope = args?.scope || ''
const taskFiles = args?.task_files || []
const skipTests = args?.skip_tests || false
const skipAntipattern = args?.skip_antipattern || false
const mustHaves = args?.must_haves || ''

// Phase 1: Parallel 3-layer + anti-pattern + convergence checks
phase('Check')

const checks = [
  () => agent(
    `Layer 1 — EXISTENCE verification.
Goals: ${goals}
${planDir ? 'Plan directory: ' + planDir + ' — read task JSONs for expected files[]' : ''}
${scope ? 'Scope: ' + scope : ''}
${mustHaves ? 'Must-haves (artifacts): ' + mustHaves : ''}

Verify all expected artifacts EXIST:
1. Read task JSON files in plan directory to find files[].path where action="create"
2. Check each expected file exists on disk (Glob/Read)
3. Verify functions/classes/modules are present at files[].target
4. Check configuration entries are added
5. Report pass/fail with evidence (actual file paths found or missing)

Set layer="existence" in output.`,
    { label: 'layer:existence', phase: 'Check', schema: LAYER_SCHEMA, agentType: 'workflow-verifier' }
  ),
  () => agent(
    `Layer 2 — SUBSTANCE verification.
Goals: ${goals}
${planDir ? 'Plan directory: ' + planDir : ''}
${scope ? 'Scope: ' + scope : ''}

Verify artifacts contain REAL SUBSTANCE (not stubs):
1. Read implementation files — check for meaningful logic (not empty bodies, not pass-through)
2. Verify functions have real implementations (not "throw new Error('not implemented')")
3. Check tests actually test behavior (not empty test cases or skipped tests)
4. Verify configuration values are real (not placeholder/TODO values)
5. Check error handling is substantive (not empty catch blocks)

Set layer="substance" in output.`,
    { label: 'layer:substance', phase: 'Check', schema: LAYER_SCHEMA, agentType: 'workflow-verifier' }
  ),
  () => agent(
    `Layer 3 — CONNECTION verification.
Goals: ${goals}
${planDir ? 'Plan directory: ' + planDir : ''}
${scope ? 'Scope: ' + scope : ''}
${mustHaves ? 'Must-haves (key_links): ' + mustHaves : ''}

Verify artifacts are properly WIRED together:
1. Check imports resolve correctly (no broken import paths)
2. Verify new modules are registered/exported from index files
3. Check routes are mounted, handlers connected
4. Verify event handlers and callbacks are wired
5. Check database models are used consistently across layers
6. Verify dependency injection and configuration loading

Set layer="connection" in output.`,
    { label: 'layer:connection', phase: 'Check', schema: LAYER_SCHEMA, agentType: 'workflow-verifier' }
  ),
]

if (!skipAntipattern) {
  checks.push(() => agent(
    `Anti-pattern scan for modified files.
${scope ? 'Scope: ' + scope : 'Scan recently modified files (use git diff --name-only).'}

Search for code quality anti-patterns using grep:
- TODO / FIXME comments that indicate incomplete work
- Empty catch blocks: catch (e) {} or catch { }
- Empty returns in functions that should return values
- @ts-ignore / @ts-expect-error without explanatory comment
- Skipped tests: .skip, xit, xdescribe, test.skip
- Hardcoded secrets: password=, api_key=, secret= with literal values
- Placeholder text: "lorem ipsum", "test123", "TODO", "PLACEHOLDER"
- Not-implemented stubs: throw new Error("not implemented"), pass, ...

Use Grep tool to find these patterns. Report each with exact file and line number.
Severity: "blocker" for stubs/not-implemented/hardcoded-secrets, "warning" for TODO/FIXME.`,
    { label: 'antipattern', phase: 'Check', schema: ANTIPATTERN_SCHEMA, agentType: 'workflow-verifier' }
  ))
}

if (taskFiles.length > 0) {
  checks.push(...taskFiles.map((taskFile, idx) => () => agent(
    `Per-task convergence validation for: ${taskFile}

1. Read the task JSON file at: ${taskFile}
2. Find convergence.criteria[] — each item is a condition that must be true
3. If convergence.verification command exists, run it via Bash
4. Check each criterion individually (pass/fail with specific evidence)
5. Cross-reference with task summaries in .summaries/ if they exist

Report overall_converged=true only if ALL criteria are met.`,
    { label: `convergence:task-${idx}`, phase: 'Check', schema: CONVERGENCE_SCHEMA, agentType: 'workflow-verifier' }
  )))
}

log(`Running ${checks.length} parallel verification checks...`)
const results = await parallel(checks)
const validResults = results.filter(Boolean)

const layers = validResults.filter(r => r.layer)
const antipatterns = validResults.find(r => r.clean !== undefined) || { clean: true, findings: [] }
const convergenceResults = validResults.filter(r => r.task_id)

const layerDigest = layers.map(l => {
  const passCount = l.checks.filter(c => c.status === 'pass').length
  const failCount = l.checks.filter(c => c.status === 'fail').length
  return `Layer: ${l.layer} — ${l.passed ? 'PASS' : 'FAIL'} (${passCount} pass, ${failCount} fail)\n${l.summary}\nFailed checks:\n${l.checks.filter(c => c.status === 'fail').map(c => `  - ${c.goal}: ${c.gap || c.evidence}`).join('\n') || '  none'}`
}).join('\n\n')

const convergenceDigest = convergenceResults.length > 0
  ? `Convergence: ${convergenceResults.filter(c => c.overall_converged).length}/${convergenceResults.length} tasks converged\nUnmet criteria:\n${convergenceResults.filter(c => !c.overall_converged).flatMap(c => c.criteria_results.filter(cr => !cr.met).map(cr => `  - ${c.task_id}: ${cr.criterion}`)).join('\n') || '  none'}`
  : 'No convergence criteria checked (no task files provided).'

const antipatternDigest = antipatterns.clean
  ? 'Anti-pattern scan: CLEAN'
  : `Anti-pattern scan: ${antipatterns.findings.length} issues (${antipatterns.findings.filter(f => f.severity === 'blocker').length} blockers)\n${antipatterns.findings.map(f => `  [${f.severity}] ${f.type} @ ${f.file}:${f.line || '?'}: ${f.content}`).join('\n')}`

const evidencePackage = `${layerDigest}\n\n${convergenceDigest}\n\n${antipatternDigest}`

// Phase 2: Adversarial Arguments — Prosecutor vs Defender
phase('Argue')
log('Launching adversarial debate: Prosecutor (FAIL) vs Defender (PASS)...')

const arguments_ = await parallel([
  () => agent(
    `You are the PROSECUTOR. Argue that this verification should FAIL.

=== VERIFICATION EVIDENCE ===
${evidencePackage}

Build the STRONGEST case for FAILURE:
1. Magnify every failed check — explain the downstream consequences
2. Connect antipattern findings to substance/connection failures
3. Challenge "pass" checks — are they truly passing or just not checking hard enough?
4. Highlight convergence gaps as unfinished work
5. Argue that partial passes are effectively failures

Your job is to convince the Judge that quality is insufficient.
Concede points where the evidence genuinely supports a pass — admitted concessions strengthen your credibility.
Confidence reflects how strong your FAIL case actually is.`,
    { label: 'prosecutor', phase: 'Argue', schema: ARGUMENT_SCHEMA }
  ),
  () => agent(
    `You are the DEFENDER. Argue that this verification should PASS.

=== VERIFICATION EVIDENCE ===
${evidencePackage}

Build the STRONGEST case for PASSING:
1. Emphasize passed checks and their coverage
2. Contextualize failures — are they truly blocking or just minor gaps?
3. Argue that antipattern warnings don't indicate real quality issues
4. Show that the core goals are met even if some checks are partial
5. Demonstrate that failed checks have low real-world impact

Your job is to convince the Judge that quality is sufficient.
Concede points where the evidence genuinely supports a fail — admitted concessions strengthen your credibility.
Confidence reflects how strong your PASS case actually is.`,
    { label: 'defender', phase: 'Argue', schema: ARGUMENT_SCHEMA }
  ),
])

const validArguments = arguments_.filter(Boolean)
const prosecutorArg = validArguments.find(a => a.role === 'prosecutor')
const defenderArg = validArguments.find(a => a.role === 'defender')

const debateDigest = validArguments.map(a =>
  `### ${a.role.toUpperCase()} (stance: ${a.stance}, confidence: ${a.confidence}%)\n${a.argument}\n\nKey points:\n${a.key_points.map(p => `- [${p.strength}] ${p.point} (evidence: ${p.evidence})`).join('\n')}\n\nConcessions:\n${a.concessions.map(c => `- ${c}`).join('\n') || '  none'}`
).join('\n\n---\n\n')

log(`Prosecutor: ${prosecutorArg ? prosecutorArg.confidence : '?'}% confident FAIL | Defender: ${defenderArg ? defenderArg.confidence : '?'}% confident PASS`)

// Phase 3: Judge resolves the adversarial debate
phase('Judge')
log('Judge resolving adversarial verification debate...')

const aggregate = await agent(
  `You are the JUDGE. Two advocates have argued for and against passing this verification.

=== ADVERSARIAL DEBATE ===
${debateDigest}

=== RAW EVIDENCE ===
${evidencePackage}

JUDGE the debate:
1. Evaluate each advocate's key points against the raw evidence
2. Weigh point strength: strong > moderate > weak
3. Points conceded by the opposing side have extra weight
4. Check for arguments NOT backed by evidence (rhetoric without substance)

Decision rules:
- If ALL layers truly pass AND antipattern clean AND convergence met → PASS
- If any layer has >50% failed checks → FAIL regardless of defense
- If antipattern has blockers → FAIL unless defender proves they're false positives
- If prosecutor confidence > 80% AND defender concedes major points → FAIL
- If defender confidence > 80% AND prosecutor only has weak points → PASS
- Otherwise → weigh evidence strength on both sides

Record adversarial_outcome with both confidences, concessions, and the decisive_factor.
Compile layers, convergence_summary, gaps, and executive_summary.`,
  { label: 'judge', phase: 'Judge', schema: AGGREGATE_SCHEMA }
)

return {
  layers: layers,
  convergence: convergenceResults,
  antipatterns: antipatterns,
  debate: { prosecutor: prosecutorArg, defender: defenderArg },
  aggregate: aggregate,
  metadata: {
    layer_count: layers.length,
    total_checks: layers.reduce((sum, l) => sum + l.checks.length, 0),
    passed_checks: layers.reduce((sum, l) => sum + l.checks.filter(c => c.status === 'pass').length, 0),
    failed_checks: layers.reduce((sum, l) => sum + l.checks.filter(c => c.status === 'fail').length, 0),
    convergence_tasks: convergenceResults.length,
    converged_tasks: convergenceResults.filter(c => c.overall_converged).length,
    antipattern_count: antipatterns.findings.length,
    blocker_count: antipatterns.findings.filter(f => f.severity === 'blocker').length,
    prosecutor_confidence: prosecutorArg ? prosecutorArg.confidence : null,
    defender_confidence: defenderArg ? defenderArg.confidence : null,
    overall_status: aggregate ? aggregate.status : 'unknown',
    confidence: aggregate ? aggregate.confidence : 0,
  },
}

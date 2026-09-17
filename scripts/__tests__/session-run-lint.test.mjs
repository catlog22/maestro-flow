import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  classifySessionRunProfile,
  RUN_MODE_LITE_REF,
  RUN_MODE_REF,
} from '../session-run-profiles.mjs';
import { lintSessionRunMirrors } from '../lint-session-run-mirrors.mjs';
import {
  canonicalBranch,
  validateExecutionPromptSemantics,
} from '../session-execution-prompt-semantics.mjs';
import {
  validateCompanionSelfStart,
  validateConsumesSchema,
  validateExecutorLifecycleBoundary,
  validateProducesAliases,
  validateRunCreateArgumentChannels,
  validateTeamCoordinatorSelfStart,
} from '../lint-session-run-prompts.mjs';

const fm = (mode, body = '', extra = '') => `---\nname: demo\nsession-mode: ${mode}\n${extra}---\n${body}`;

test('classifies the full/lite/inherited/child/canonical/neutral profile matrix', () => {
  const rows = [
    { path: '.claude/commands/demo.md', kind: 'command', text: fm('run', RUN_MODE_REF), profile: 'full' },
    { path: '.claude/skills/team-demo/SKILL.md', kind: 'skill', text: fm('run', RUN_MODE_LITE_REF), profile: 'lite' },
    { path: '.claude/skills/team-demo/roles/x.md', kind: 'skill-child', text: '# child', profile: 'child-neutral' },
    { path: '.claude/skills/demo/phases/x.md', kind: 'skill-child', text: RUN_MODE_REF, profile: 'inherited-neutral' },
    { path: 'workflows/run-mode.md', kind: 'workflow', text: '<!-- session-mode: inherited -->', profile: 'canonical-full' },
    { path: 'workflows/run-mode-lite.md', kind: 'workflow', text: '<!-- session-mode: inherited -->', profile: 'canonical-lite' },
    { path: 'workflows/task-tracking.md', kind: 'workflow', text: '<!-- session-mode: none -->', profile: 'neutral' },
    { path: 'workflows/odyssey-debug.md', kind: 'workflow', text: fm('inherited', '# workflow', 'prepare: odyssey-debug\n'), profile: 'inherited-neutral' },
  ];
  for (const row of rows) {
    const result = classifySessionRunProfile(row);
    assert.equal(result.profile, row.profile, row.path);
    assert.deepEqual(result.errors, [], row.path);
  }
});

test('rejects missing and mixed lifecycle ownership with stable diagnostic families', () => {
  const missing = classifySessionRunProfile({
    path: '.claude/commands/demo.md', kind: 'command', text: fm('run', '# no reference'),
  });
  assert.match(missing.errors.join('\n'), /missing canonical workflow reference/);
  const mixed = classifySessionRunProfile({
    path: '.claude/skills/team-demo/SKILL.md', kind: 'skill', text: fm('run', `${RUN_MODE_REF}\n${RUN_MODE_LITE_REF}`),
  });
  assert.match(mixed.errors.join('\n'), /both full and lite/);
});

test('canonical direct Run creation uses positional domain text and Artifact-only inputs', () => {
  const complete = [
    'maestro run create step "<task text>" --session {session_id} --run {run_id} --step {step_id}',
    '--input <ART-id> --participant {actor_id} --actor {actor_id} --request-id {create_request_id}',
    '--reason "create Run" --expected-orchestration-revision {step_orchestration_revision} --json',
    '`--input` accepts only a sealed same-Session Artifact ID.',
  ].join(' ');
  assert.deepEqual(validateRunCreateArgumentChannels(complete, 'fixture.md'), []);

  const missing = validateRunCreateArgumentChannels(
    complete.replace('--step {step_id}', '').replace('--input <ART-id>', '--input "<task text>"'),
    'fixture.md',
  );
  assert.ok(missing.includes('fixture.md: missing direct Run create contract token: --step'));
  assert.ok(missing.includes('fixture.md: missing direct Run create contract token: --input <ART-id>'));
  assert.ok(missing.includes('fixture.md: raw domain text must not be passed through --input'));
});

test('Companion self-start lint requires open, positional chain arg, and fenced next', () => {
  const complete = [
    'maestro session open "<intent>" --participant {actor_id} --actor {actor_id} --request-id {open_request_id}',
    'maestro session chain insert --command companion --arg "<intent>" --request-id {insert_request_id}',
    '--expected-orchestration-revision {open_orchestration_revision}',
    'maestro run next --request-id {next_request_id} --expected-orchestration-revision {insert_orchestration_revision}',
    'structured `continuation`',
  ].join('\n');
  assert.deepEqual(validateCompanionSelfStart(complete, 'fixture.md'), []);

  const missing = validateCompanionSelfStart(
    complete.replace('--arg "<intent>"', '--input "<intent>"'),
    'fixture.md',
  );
  assert.ok(missing.includes('fixture.md: missing Companion self-start token: --arg "<intent>"'));
  assert.ok(missing.includes('fixture.md: Companion intent must be positional, not --input'));
});

test('team coordinator self-start lint requires receipt-chained actor-equal mutations', () => {
  const complete = [
    'maestro session open "<task summary>" --participant {actor_id} --actor {actor_id} --request-id {open_request_id}',
    'maestro session chain insert --command team-demo --arg "<task summary>" --request-id {insert_request_id}',
    '--expected-orchestration-revision {open_orchestration_revision}',
    'maestro run next --request-id {next_request_id} --expected-orchestration-revision {insert_orchestration_revision}',
    'structured `continuation`',
  ].join('\n');
  assert.deepEqual(validateTeamCoordinatorSelfStart(complete, 'fixture.md', 'team-demo'), []);
});

test('Run executor lint keeps completion ownership with the orchestrator', () => {
  const complete = [
    'maestro run brief <run-id>',
    'maestro run check <run-id>',
    'Do not call `maestro run complete` — completion is handled by the orchestrator',
  ].join('\n');
  assert.deepEqual(validateExecutorLifecycleBoundary(complete, 'executor.md'), []);

  const missing = validateExecutorLifecycleBoundary(
    'maestro run brief <run-id>\nmaestro run check <run-id>',
    'executor.md',
  );
  assert.ok(missing.includes('executor.md: missing Do not call `maestro run complete`'));
  assert.ok(missing.includes('executor.md: missing handled by the orchestrator'));
});

test('mirror lint reports a deterministic missing-root diagnostic', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-run-mirror-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(root, '.agy', 'skills'), { recursive: true });
    mkdirSync(join(root, '.codex', 'skills'), { recursive: true });
    const errors = lintSessionRunMirrors(root);
    assert.ok(errors.includes('.agents/skills: missing mirror root'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mirror lint detects lifecycle profile divergence', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-run-profile-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
    const source = fm('run', RUN_MODE_REF, 'contract:\n  consumes: []\n  produces: []\n  gates:\n    entry: []\n    exit: []\n');
    writeFileSync(join(root, '.claude', 'commands', 'demo.md'), source);
    for (const mirror of ['.agy', '.agents', '.codex']) {
      const dir = join(root, mirror, 'skills', 'demo');
      mkdirSync(dir, { recursive: true });
      const target = mirror === '.codex'
        ? fm('run', RUN_MODE_LITE_REF, 'version: 1.0.0\ncontract:\n  consumes: []\n  produces: []\n  gates:\n    entry: []\n    exit: []\n')
        : source;
      writeFileSync(join(dir, 'SKILL.md'), target);
    }
    assert.ok(lintSessionRunMirrors(root).some(error => error.includes('lifecycle profile lite diverges from full')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source lint passes after the Odyssey alias migration', () => {
  const repoRoot = process.cwd();
  const lint = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'lint-session-run-prompts.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(lint.status, 0);
  assert.equal(lint.stderr, '');
  assert.deepEqual(validateExecutionPromptSemantics(repoRoot), []);
  for (const mode of ['debug', 'improve', 'planex', 'review', 'ui']) {
    const text = readFileSync(join(repoRoot, 'workflows', `odyssey-${mode}.md`), 'utf8');
    assert.match(text, new RegExp(`prepare:\\s*odyssey-${mode}`));
    assert.doesNotMatch(text, /^commands:/m);
  }

  const teamSkillRoot = join(repoRoot, '.claude', 'skills');
  const teamStateReferences = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md') && /team-state\.json|(?<!team-)session\.json/.test(readFileSync(path, 'utf8'))) {
        teamStateReferences.push(path);
      }
    }
  };
  for (const entry of readdirSync(teamSkillRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('team-')) walk(join(teamSkillRoot, entry.name));
  }
  assert.deepEqual(teamStateReferences, []);

  const lite = readFileSync(join(repoRoot, 'workflows', 'run-mode-lite.md'), 'utf8');
  assert.match(lite, /team-session\.json.*single coordinator-owned state file/);
  assert.match(lite, /complete top-level `_meta` object/);
  assert.match(lite, /`kind` and `schema` are required together/);
  assert.match(lite, /maestro knowledge stage knowhow/);
  assert.match(lite, /--signal cited\|validated\|contradicted --signal-ids <comma-separated ids>/);
  assert.match(lite, /maestro knowledge review <session_id>/);
  assert.match(lite, /maestro run complete.*--advance/);
  assert.match(lite, /resolved `task`/);
  assert.match(lite, /structured executable `continuation`/);
  assert.match(lite, /--input.*sealed same-Session Artifact IDs/);
  assert.match(lite, /does \*\*not\*\* require Session completion/);

  const full = readFileSync(join(repoRoot, 'workflows', 'run-mode.md'), 'utf8');
  assert.match(full, /complete top-level `_meta` object/);
  assert.match(full, /`kind` and `schema` are required together/);
  assert.match(full, /A Session .* is a durable \*\*topic grouping\/index\*\*/);
  assert.match(full, /same Session.*canonical `upstream`\/Artifact Registry map/);
  assert.match(full, /Historical similarity is read-only evidence/);
  assert.match(full, /completion atomically validates and publishes `outputs\/` into the artifact registry, seals the Run, completes the chain step/);
  assert.match(full, /deprecated admin-only compatibility commands/);
  assert.match(full, /knowledge_context/);
  assert.match(full, /birth packet exposes the resolved `task`/);
  assert.match(full, /resolved `task`/);
  assert.match(full, /structured executable `continuation`/);
  assert.match(full, /--input.*sealed Artifact from the same Session/);
  assert.match(full, /--expected-identity-revision/);
  assert.match(full, /--expected-activity-revision/);
  assert.match(full, /--expected-revisions/);
  assert.doesNotMatch(canonicalBranch(full), /done-with-concerns/);
  assert.match(full, /`brief-result\/3\.0` Resume Packet/);
  assert.match(full, /knowledge-candidate-receipt\/1\.0/);
  assert.match(full, /Routine Run completion MUST NOT call `maestro spec add` or `maestro knowhow add` directly/);
  assert.match(full, /maestro capabilities --json/);
  assert.match(full, /maestro execution seal/);
  assert.match(full, /does \*\*not\*\* require Session completion/);
  assert.doesNotMatch(full, /same normalized intent/);

  const manage = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro-session-manage.md'), 'utf8');
  assert.match(manage, /maestro knowledge review \{session_id\} --json/);
  assert.match(manage, /maestro knowledge promote \{session_id\} --candidate/);
  assert.doesNotMatch(manage, /Scan session artifacts|recommend `\/maestro-spec add/);

  const maestro = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro.md'), 'utf8');
  assert.match(maestro, /argument-hint: "<intent> \[-y\] \[-c\] \[--amend\]"/);
  assert.match(maestro, /Compatibility commands are out of band/);
  assert.match(maestro, /Historical similarity remains read-only evidence/);
  assert.doesNotMatch(maestro, /resolved paused Session.*maestro session resume/);
  assert.doesNotMatch(maestro, /offer confirmation-token fork\/import/);

  const ralph = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro-ralph.md'), 'utf8');
  assert.match(ralph, /argument-hint: "<intent> \[-y\] \[-c\] \[--amend\]"/);
  assert.match(ralph, /Session owns chain and lifecycle/);
  assert.match(ralph, /Legacy compatibility is out of band/);
  assert.match(ralph, /Canonical upstream map/);
  assert.doesNotMatch(ralph, /Read state\.json\.artifacts/);
  for (const prompt of [maestro, ralph]) {
    assert.doesNotMatch(prompt, /maestro ralph\s/);
  }

  const codexMaestro = readFileSync(join(repoRoot, '.codex', 'skills', 'Maestro', 'SKILL.md'), 'utf8');
  const codexRalph = readFileSync(join(repoRoot, '.codex', 'skills', 'maestro-ralph', 'SKILL.md'), 'utf8');
  for (const prompt of [codexMaestro, codexRalph]) {
    assert.match(prompt, /argument-hint: <intent> \[-y\] \[-c\] \[--amend\]/);
    assert.doesNotMatch(prompt, /maestro ralph\s/);
  }
  for (const prompt of [ralph, codexRalph]) {
    for (const token of [
      'S_INFER → S_DECOMPOSE → S_ASSESS → S_BUILD → S_CREATE',
      '### A_INFER',
      '### A_DECOMPOSE',
      '### A_ASSESS',
      'confidence_score',
      'risk ≠ high AND confidence_score ≥ 60',
      'Confidence below 60 cannot enter S_RUN_LOOP',
      'at least 2 independently releasable milestones',
      '--platform {target_platform}',
      'pi-maestro-flow',
    ]) {
      assert.match(prompt, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(prompt, /maestro skills --steps --json --platform claude/);
  }

  const orchestratorLoop = readFileSync(join(repoRoot, 'workflows', 'orchestrator-run-loop.md'), 'utf8');
  for (const token of [
    '## Continuation Router',
    'Turn 终止不变量',
    'authority=automatic',
    'authority=auto_mode_only',
    'authority=user_required',
    'assessment.acceptance_status=accepted',
    '`QUALITY_MEDIUM`',
    'handoff `next[]`',
    '### `complete` / `decide` 闭环',
    'run_already_created=true',
    'maestro run decide',
    'continuation.action',
  ]) {
    assert.match(orchestratorLoop, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(ralph, /Decision is mandatory/);
  assert.match(ralph, /every Ralph-created Session chain/);
  assert.match(ralph, /run decide --json/);
  assert.match(ralph, /run complete --json/);
  const amendFlow = readFileSync(join(repoRoot, 'workflows', 'ralph-amend-goal.md'), 'utf8');
  assert.match(amendFlow, /maestro capabilities --json/);
  assert.match(amendFlow, /maestro run next/);
  assert.match(amendFlow, /maestro run complete \{run_id\}.*--session \{session_id\}/);
  assert.match(amendFlow, /maestro execution status\/resolve\/resume\/seal/);
  assert.doesNotMatch(canonicalBranch(amendFlow), /maestro session (?:meta|next|done|seal)/);
  const ralphPrepare = readFileSync(join(repoRoot, 'prepare', 'ralph.md'), 'utf8');
  assert.match(ralphPrepare, /\| init \| `init` \|/);
  assert.match(ralphPrepare, /\| specs-setup \| `specs-setup` \|/);
  assert.match(ralphPrepare, /--platform \{target_platform\}/);
  assert.match(ralphPrepare, /package\.json#pi\.skills/);
  assert.doesNotMatch(ralphPrepare, /maestro skills --steps --json --platform claude/);
  const maestroPrepare = readFileSync(join(repoRoot, 'prepare', 'maestro.md'), 'utf8');
  assert.match(maestroPrepare, /--platform \{target_platform\}/);
  assert.match(maestroPrepare, /package\.json#pi\.skills/);
  assert.doesNotMatch(maestroPrepare, /maestro skills --steps --json --platform claude/);
  for (const workflow of [full, lite, orchestratorLoop, amendFlow]) {
    assert.doesNotMatch(workflow, /maestro ralph\s/);
    assert.doesNotMatch(workflow, /\bralph next\b/);
    assert.doesNotMatch(
      canonicalBranch(workflow),
      /maestro session (?:start|next|done|decide|resolve|resume(?!-view)|seal|meta)\b/,
    );
  }
});

test('package release gate orders source lint, generation, freshness, then parity', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('.codex/agent-overrides'));
  const build = pkg.scripts['build:mirrors'];
  const ordered = [
    'lint-session-execution-prompts.mjs',
    'lint-session-run-prompts.mjs',
    'convert-claude-to-agy.mjs',
    'build-agents-standard.mjs',
    'sync-codex-run-mode.mjs --write',
    'sync-codex-run-mode.mjs --check',
    'sync-codex-agents.mjs --check',
    'lint-session-run-mirrors.mjs',
  ];
  let cursor = -1;
  for (const token of ordered) {
    const next = build.indexOf(token, cursor + 1);
    assert.ok(next > cursor, `${token} must appear in safe order`);
    cursor = next;
  }
  assert.match(
    pkg.scripts.prepublishOnly,
    /^npm run build:arch-kb && npm run check:instructions && node scripts\/lint-invocation-policy\.mjs && node scripts\/lint-session-execution-prompts\.mjs && node scripts\/lint-session-run-prompts\.mjs/,
  );
});

test('validateConsumesSchema rejects v2.1 consumes missing schema/role and versionless contracts', () => {
  const missingSchemaRole = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', required: true }] },
    'prepare/review.md',
  );
  assert.deepEqual(missingSchemaRole, [
    'prepare/review.md: consumes[0] kind=execution: missing schema or schema_range (declare the producer artifact schema, or schema_range \'<kind>/<major>.x\' for major-compatible reuse, so reuse binds without a manual REVIEW)',
    'prepare/review.md: consumes[0] kind=execution: missing role for contract_version 2.1',
  ]);

  const versionless = validateConsumesSchema(
    { consumes: [{ kind: 'execution', required: true }] },
    'prepare/legacy.md',
  );
  assert.deepEqual(versionless, [
    'prepare/legacy.md: consumes without contract_version 2/2.1 parse as v1 where schema/role are metadata-only; declare contract_version: 2.1',
  ]);

  const v2SchemaOnly = validateConsumesSchema(
    { contract_version: 2, consumes: [{ kind: 'execution', alias: 'current-execution', schema: 'execution/1.0', required: true }] },
    'prepare/v2.md',
  );
  assert.deepEqual(v2SchemaOnly, []);

  const v21Complete = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', schema: 'execution/1.0', role: 'primary', required: true }] },
    'prepare/review.md',
  );
  assert.deepEqual(v21Complete, []);

  assert.deepEqual(validateConsumesSchema({ contract_version: 2.1, consumes: [] }, 'prepare/empty.md'), []);
});

test('validateProducesAliases requires an explicit alias on primary produces', () => {
  const missing = validateProducesAliases(
    { contract_version: 2.1, produces: [{ kind: 'result', path: 'outputs/r.json', role: 'primary', required: true, schema: 'result/1.0' }] },
    'prepare/demo.md',
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0], /primary but declares no alias/);

  const explicit = validateProducesAliases(
    { contract_version: 2.1, produces: [{ kind: 'result', path: 'outputs/r.json', alias: 'current-result', role: 'primary', required: true, schema: 'result/1.0' }] },
    'prepare/demo.md',
  );
  assert.deepEqual(explicit, []);

  const attachment = validateProducesAliases(
    { contract_version: 2.1, produces: [{ kind: 'note', path: 'outputs/n.json', role: 'attachment', required: false, schema: 'note/1.0' }] },
    'prepare/demo.md',
  );
  assert.deepEqual(attachment, []);
});

test('validateConsumesSchema enforces schema/schema_range exclusivity and range format', () => {
  const both = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', schema: 'execution/1.0', schema_range: 'execution/1.x', role: 'primary', required: true }] },
    'prepare/demo.md',
  );
  assert.deepEqual(both, ['prepare/demo.md: consumes[0] kind=execution: declares both schema and schema_range; pick exactly one']);

  const badRange = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', schema_range: 'execution/01.x', role: 'primary', required: true }] },
    'prepare/demo.md',
  );
  assert.match(badRange[0], /schema_range must match/);

  const wrongKind = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', schema_range: 'plan/1.x', role: 'primary', required: true }] },
    'prepare/demo.md',
  );
  assert.match(wrongKind[0], /schema_range must match/);

  const okRange = validateConsumesSchema(
    { contract_version: 2.1, consumes: [{ kind: 'execution', alias: 'current-execution', schema_range: 'execution/1.x', role: 'primary', required: true }] },
    'prepare/demo.md',
  );
  assert.deepEqual(okRange, []);
});

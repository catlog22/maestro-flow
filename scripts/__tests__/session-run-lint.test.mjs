import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  classifySessionRunProfile,
  RUN_MODE_LITE_REF,
  RUN_MODE_REF,
} from '../session-run-profiles.mjs';
import { lintSessionRunMirrors } from '../lint-session-run-mirrors.mjs';
import {
  validateCompanionRunCreate,
  validateRunCreateArgumentChannels,
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

test('canonical Run creation lint separates Session metadata from command inputs', () => {
  const complete = '--intent is Session metadata only; use --arg <value> or -- <args...>.';
  assert.deepEqual(validateRunCreateArgumentChannels(complete, 'fixture.md'), []);

  const missing = validateRunCreateArgumentChannels(
    '--intent is Session metadata only; command inputs are positional.',
    'fixture.md',
  );
  assert.ok(missing.includes('fixture.md: missing --arg <value>'));
  assert.ok(missing.includes('fixture.md: missing -- <args...>'));
});

test('Companion creation lint requires intent in both metadata and command args', () => {
  const complete = 'maestro run create companion --intent "<intent>" --arg "<intent>"; required command arguments are validated.';
  assert.deepEqual(validateCompanionRunCreate(complete, 'fixture.md'), []);

  const missing = validateCompanionRunCreate(
    'maestro run create companion --intent "<intent>"; required command arguments are validated.',
    'fixture.md',
  );
  assert.ok(missing.includes('fixture.md: missing --arg "<intent>"'));
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

test('source lint accepts alias-free Odyssey workflows while enforcing prepare associations', () => {
  const repoRoot = process.cwd();
  const output = execFileSync(process.execPath, [join(repoRoot, 'scripts', 'lint-session-run-prompts.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(output, /session-run prompt lint passed/);
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

  const full = readFileSync(join(repoRoot, 'workflows', 'run-mode.md'), 'utf8');
  assert.match(full, /complete top-level `_meta` object/);
  assert.match(full, /`kind` and `schema` are required together/);
  assert.match(full, /Session is a durable \*\*topic grouping\/index\*\*/);
  assert.match(full, /same Session.*canonical `upstream`\/Artifact Registry map/);
  assert.match(full, /Historical similarity is read-only evidence/);
  assert.match(full, /Completion may return a structured `suggest_only` next action, but it never executes that action or creates another Run/);
  assert.match(full, /deprecated admin-only compatibility commands/);
  assert.doesNotMatch(full, /same normalized intent/);

  const maestro = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro.md'), 'utf8');
  assert.match(maestro, /Compatibility commands are out of band/);
  assert.match(maestro, /Historical similarity remains read-only evidence/);
  assert.doesNotMatch(maestro, /resolved paused Session.*maestro session resume/);
  assert.doesNotMatch(maestro, /offer confirmation-token fork\/import/);

  const ralph = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro-ralph.md'), 'utf8');
  assert.match(ralph, /Sessions are topic grouping\/indexes/);
  assert.match(ralph, /Compatibility commands are out of band/);
  assert.match(ralph, /canonical upstream map/);
  assert.doesNotMatch(ralph, /Read state\.json\.artifacts/);
});

test('package release gate orders source lint, generation, freshness, then parity', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('.codex/agent-overrides'));
  const build = pkg.scripts['build:mirrors'];
  const ordered = [
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
    /^node scripts\/lint-invocation-policy\.mjs && node scripts\/lint-session-run-prompts\.mjs/,
  );
});

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_CLOSEOUT_ENTRIES,
  KNOWLEDGE_CLOSEOUT_REF,
  inspectKnowledgeCloseoutMirrors,
  validateExecutionPromptSemantics,
} from '../session-execution-prompt-semantics.mjs';

const repoRoot = process.cwd();
const fixtureFiles = [
  'ref/knowledge-closeout.md',
  'ref/finish-work.md',
  '.claude/commands/maestro-knowledge.md',
  '.claude/commands/maestro-companion.md',
  '.claude/commands/maestro-session-manage.md',
  'workflows/run-mode.md',
  'workflows/run-mode-lite.md',
  'workflows/orchestrator-run-loop.md',
  'workflows/ralph.md',
  'workflows/ralph-amend-goal.md',
  'workflows/codex-run-mode.md',
  'workflows/claude-instructions.md',
  'workflows/agy-instructions.md',
  'workflows/codex-instructions.md',
  'prepare/ralph.md',
  '.claude/commands/maestro-ralph.md',
  '.claude/skills/skill-generator/SKILL.md',
  '.claude/skills/skill-generator/phases/02-structure-generation.md',
  '.claude/skills/skill-iter-tune/SKILL.md',
  '.claude/skills/skill-iter-tune/phases/05-report.md',
  '.claude/skills/skill-tuning/SKILL.md',
  '.claude/skills/skill-tuning/phases/actions/action-complete.md',
  '.claude/skills/team-coordinate/SKILL.md',
  '.claude/skills/team-coordinate/roles/coordinator/commands/monitor.md',
  '.claude/skills/team-swarm/SKILL.md',
  '.claude/skills/team-swarm/roles/coordinator/commands/converge.md',
  'src/core/entry-command-generator.ts',
  'src/run/runtime.ts',
];
const tempRoots = [];

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'session-execution-prompts-'));
  tempRoots.push(root);
  for (const relativePath of fixtureFiles) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), target);
  }
  // Every counterexample starts with a complete, independently green source fixture.
  expect(validateExecutionPromptSemantics(root)).toEqual([]);
  return root;
}

function replace(root, relativePath, before, after, all = false) {
  const path = join(root, relativePath);
  const text = readFileSync(path, 'utf8');
  expect(text).toContain(before);
  writeFileSync(path, all ? text.replaceAll(before, after) : text.replace(before, after));
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('shared knowledge closeout guards', () => {
  const entryPaths = [...KNOWLEDGE_CLOSEOUT_ENTRIES, 'ref/finish-work.md'];
  it.each(entryPaths)('requires the shared reference in %s', path => {
    const root = createFixture();
    replace(root, path, KNOWLEDGE_CLOSEOUT_REF, '@~/.maestro/ref/missing-closeout.md', true);
    expect(validateExecutionPromptSemantics(root)).toContain(`${path}: missing knowledge closeout reference/load token: ${KNOWLEDGE_CLOSEOUT_REF}`);
  });

  it.each(entryPaths)('requires the explicit context-loss Read fallback in %s', path => {
    const root = createFixture();
    replace(root, path, 'no longer in context', 'already available', true);
    expect(validateExecutionPromptSemantics(root)).toContain(`${path}: missing knowledge closeout reference/load token: no longer in context`);
  });

  it.each(entryPaths)('cannot replace the fallback with an unrelated Read token in %s', path => {
    const root = createFixture();
    replace(root, path, `Read ${KNOWLEDGE_CLOSEOUT_REF} explicitly before`, 'Assume it is available before');
    // Unrelated reads must not stand in for loading the referenced protocol.
    replace(root, path, '\n', '\nRead unrelated documentation.\n');
    expect(validateExecutionPromptSemantics(root)).toContain(`${path}: missing explicit knowledge closeout Read-before-use fallback`);
  });

  it.each(entryPaths)('rejects reading the wrong file in the same fallback paragraph: %s', path => {
    const root = createFixture();
    replace(root, path, `Read ${KNOWLEDGE_CLOSEOUT_REF} explicitly before`, 'Read unrelated documentation explicitly before');
    expect(validateExecutionPromptSemantics(root)).toContain(`${path}: missing explicit knowledge closeout Read-before-use fallback`);
  });

  it('requires the referenced file to exist, not merely a path token', () => {
    const root = createFixture();
    rmSync(join(root, 'ref/knowledge-closeout.md'));
    expect(validateExecutionPromptSemantics(root)).toContain('ref/knowledge-closeout.md: missing shared knowledge closeout source');
  });

  it('rejects moving execution before authorization', () => {
    const root = createFixture();
    const path = join(root, 'ref/knowledge-closeout.md');
    const text = readFileSync(path, 'utf8');
    const start = text.indexOf('### 4. Authorize');
    const execute = text.indexOf('### 5. Execute');
    const verify = text.indexOf('### 6. Verify');
    writeFileSync(path, text.slice(0, start) + text.slice(execute, verify) + text.slice(start, execute) + text.slice(verify));
    expect(validateExecutionPromptSemantics(root).join('\n')).toMatch(/must order Review → Refresh → Present → Authorize → Execute → Verify/);
  });

  it('rejects unconditional refresh even when the required keywords remain', () => {
    const root = createFixture();
    const condition = 'Only when review reports **missing/stale** reconciliation receipts, and the caller permits receipt repair, run';
    replace(root, 'ref/knowledge-closeout.md', condition,
      'Always refresh all reconciliation receipts, including fresh ones, when the caller permits receipt repair; missing/stale receipts are one possible reason. Run');
    expect(validateExecutionPromptSemantics(root)).toContain(`ref/knowledge-closeout.md: missing knowledge closeout Refresh token: ${condition}`);
  });

  const omissions = [
    ['Refresh', 'caller permits receipt repair'],
    ['Refresh', 'missing/stale'],
    ...['exact ID', 'title', 'content', 'source/evidence anchors', 'freshness/eligibility', 'matches', 'relationship choices', 'recommended', 'rationale'].map(token => ['Present', token]),
    ['Authorize', 'ask-user-question'],
    ['Authorize', 'exact candidate set'],
    ['Authorize', 'does not authorize writes'],
    ['Authorize', 'defer and report'],
    ['Authorize', 'Do not fabricate `duplicate`'],
    ['Execute', '**after** explicit confirmation'],
    ['Execute', '`promote --resolve` is the preferred'],
    ['Execute', 'deprecated `review --resolve` compatibility'],
    ['Execute', 'only relationship adjudication was authorized'],
    ['Execute', 'one candidate at a time'],
    ['Execute', 'Do not widen selection with `--all`'],
    ['Execute', '`unique` has **no `--target`**'],
    ['Execute', 'current evidence-backed `matches`'],
    ['Verify', 'Read each execution result'],
    ['Verify', 're-read `maestro knowledge review {session_id} --json`'],
    ['Verify', 'actual publication outcomes/knowledge IDs'],
    ['Verify', 're-present and re-confirm'],
    ['Verify', 'does **not** require Session completion'],
  ];
  it.each(omissions)('detects missing %s contract: %s', (step, token) => {
    const root = createFixture();
    const path = join(root, 'ref/knowledge-closeout.md');
    const text = readFileSync(path, 'utf8');
    const start = text.indexOf(`. ${step}\n`);
    const end = text.indexOf('\n### ', start);
    const section = text.slice(start, end < 0 ? text.length : end);
    expect(section).toContain(token);
    writeFileSync(path, text.slice(0, start) + section.replaceAll(token, '[removed]') + (end < 0 ? '' : text.slice(end)));
    expect(validateExecutionPromptSemantics(root)).toContain(`ref/knowledge-closeout.md: missing knowledge closeout ${step} token: ${token}`);
  });

  it.each([
    ['-y grants knowledge publication approval.', 'automatic publication approval'],
    ['Importance is knowledge publication approval.', 'automatic publication approval'],
    ['Machine recommendations are knowledge publication approval.', 'automatic publication approval'],
    ['Execute promotion before asking the human.', 'execution before authorization'],
    ['Resolve the candidate then confirm publication.', 'execution before authorization'],
    ['Canonical knowledge path uses session/2.0.', 'canonical v2 main path'],
    ['maestro knowledge promote {session_id} --all --json', 'executable bulk promotion'],
    ['maestro knowledge promote {session_id} \\\n  --all --json', 'executable bulk promotion'],
    ['maestro knowledge promote {session_id} \\\r\n  --all --json', 'executable bulk promotion'],
    ['A session-source candidate requires Session completion.', 'Session completion promotion prerequisite'],
    ['Unrelated Session activity alone invalidates the snapshot.', 'unrelated activity invalidates source snapshot'],
  ])('rejects contradictory positive instructions: %s', (instruction, diagnostic) => {
    const root = createFixture();
    replace(root, '.claude/commands/maestro-knowledge.md', '\n</dispatch>', `\n${instruction}\n</dispatch>`);
    expect(validateExecutionPromptSemantics(root)).toContain(`.claude/commands/maestro-knowledge.md: unsafe knowledge closeout: ${diagnostic}`);
  });

  it('permits negative warnings, CLI --all documentation and explicit legacy compatibility', () => {
    const root = createFixture();
    replace(root, '.claude/commands/maestro-knowledge.md', '\n</dispatch>', '\nNever execute promotion before asking the human.\n-y does not grant knowledge publication approval.\nImportance is not knowledge publication approval.\nMachine recommendations are not knowledge publication approval.\nDo not use canonical knowledge path session/2.0.\nNever assume a session-source candidate requires Session completion.\nNever assume unrelated Session activity alone invalidates the snapshot.\n## Legacy `session/1.x/2.x` Compatibility Branch\nCanonical knowledge path uses session/2.0.\nmaestro knowledge promote legacy --all --json\n</dispatch>');
    expect(validateExecutionPromptSemantics(root)).toEqual([]);
  });

  it('retains staging-only finish-work ownership', () => {
    const root = createFixture();
    replace(root, 'ref/finish-work.md', 'finish-work does not perform resolution, promotion, or canonical completion', 'finish-work performs publication');
    expect(validateExecutionPromptSemantics(root).join('\n')).toMatch(/ref\/finish-work\.md: missing staging-only boundary/);
  });

  it('tests mirrors from current sources in temporary fixtures only', () => {
    const root = createFixture();
    for (const platform of ['.agy', '.agents', '.codex']) {
      for (const name of ['maestro-knowledge', 'maestro-companion', 'maestro-session-manage']) {
        const target = join(root, platform, 'skills', name, 'SKILL.md');
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, '.claude/commands', `${name}.md`), target);
      }
    }
    expect(inspectKnowledgeCloseoutMirrors(root).flatMap(result => result.errors)).toEqual([]);
  });
});

describe('Session identity plus bounded Execution prompt semantics', () => {
  it('passes independently of unrelated prepare contract lint', () => {
    expect(validateExecutionPromptSemantics(repoRoot)).toEqual([]);
  });

  it('fails focused mutations that remove or regress Execution authority', () => {
    const cases = [
      {
        name: 'full capability negotiation',
        path: 'workflows/run-mode.md',
        before: 'maestro capabilities --json',
        after: 'maestro legacy-capabilities --json',
        expected: /workflows\/run-mode\.md: missing Execution semantic token: maestro capabilities --json/,
      },
      {
        name: 'lite Run completion',
        path: 'workflows/run-mode-lite.md',
        before: 'maestro run complete',
        after: 'maestro legacy complete',
        all: true,
        expected: /workflows\/run-mode-lite\.md: missing Execution semantic token: maestro run complete/,
      },
      {
        name: 'orchestrator revision fence',
        path: 'workflows/orchestrator-run-loop.md',
        before: '--expected-orchestration-revision',
        after: '--expected-session-revision',
        all: true,
        expected: /workflows\/orchestrator-run-loop\.md: missing Execution semantic token: --expected-orchestration-revision/,
      },
      {
        name: 'Ralph v3 resume packet',
        path: 'prepare/ralph.md',
        before: 'brief-result/3.0',
        after: 'brief-result/1.1',
        all: true,
        expected: /prepare\/ralph\.md: missing Execution semantic token: brief-result\/3\.0/,
      },
      {
        name: 'Ralph amendment Session mutation',
        path: 'workflows/ralph-amend-goal.md',
        before: '## 4. Commit the Amendment',
        after: 'maestro session meta update --session {session_id}\n\n## 4. Commit the Amendment',
        expected: /workflows\/ralph-amend-goal\.md: canonical new-runtime path contains canonical Session amendment mutation/,
      },
      {
        name: 'session-source sealed Session regression',
        path: 'workflows/run-mode.md',
        before: 'A `session/3.0` session-source candidate does **not** require Session completion.',
        after: 'A session-source candidate requires the Session itself sealed.',
        expected: /workflows\/run-mode\.md: canonical new-runtime path contains Session seal promotion prerequisite/,
      },
    ];

    for (const testCase of cases) {
      const root = createFixture();
      replace(root, testCase.path, testCase.before, testCase.after, testCase.all);
      const errors = validateExecutionPromptSemantics(root).join('\n');
      expect(errors, testCase.name).toMatch(testCase.expected);
    }
  }, 30_000);

  it('rejects abbreviated canonical v3 Run completion examples without their executable option set', () => {
    const root = createFixture();
    replace(
      root,
      'workflows/run-mode.md',
      'maestro run complete {run_id} --session {session_id} --actor {actor_id} [--evidence <ref> ...] --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --verdict {done|done_with_concerns} [--summary "<summary>"] --advance --json',
      'maestro run complete {run_id} --session {session_id} ... --json',
    );
    expect(validateExecutionPromptSemantics(root).join('\n')).toMatch(
      /workflows\/run-mode\.md: executable canonical maestro run complete is missing required options:/,
    );
  });

  it('recursively rejects nested legacy Session lifecycle commands owned by active importers', () => {
    for (const relativePath of [
      '.claude/skills/skill-generator/phases/02-structure-generation.md',
      '.claude/skills/skill-iter-tune/phases/05-report.md',
      '.claude/skills/skill-tuning/phases/actions/action-complete.md',
      '.claude/skills/team-coordinate/roles/coordinator/commands/monitor.md',
      '.claude/skills/team-swarm/roles/coordinator/commands/converge.md',
    ]) {
      const root = createFixture();
      replace(root, relativePath, '\n', '\nmaestro session done {run_id}\n');
      expect(validateExecutionPromptSemantics(root).join('\n'), relativePath).toMatch(
        new RegExp(`${relativePath.replaceAll('.', '\\.').replaceAll('/', '\\/')}: canonical new-runtime path contains Session lifecycle mutation command`),
      );
    }
  });

  it('preserves labeled legacy branches and ignores an inactive odyssey-ui alias', () => {
    const root = createFixture();
    replace(
      root,
      '.claude/skills/skill-generator/phases/02-structure-generation.md',
      '\n',
      '\n## Legacy `session/1.x` Compatibility Branch\n\nmaestro session done {run_id}\n',
    );
    mkdirSync(join(root, 'workflows'), { recursive: true });
    writeFileSync(
      join(root, 'workflows/odyssey-ui.md'),
      '<!-- session-mode: inherited -->\nmaestro session done dead-alias\n',
    );
    expect(validateExecutionPromptSemantics(root)).toEqual([]);
  });

  it('rejects Session lifecycle commands in the canonical branch but permits the labeled legacy branch', () => {
    const cleanRoot = createFixture();
    expect(validateExecutionPromptSemantics(cleanRoot)).toEqual([]);

    const regressedRoot = createFixture();
    replace(
      regressedRoot,
      'workflows/orchestrator-run-loop.md',
      '## Lifecycle',
      'maestro session seal {session_id} --summary "regression"\n\n## Lifecycle',
    );
    expect(validateExecutionPromptSemantics(regressedRoot).join('\n')).toMatch(
      /workflows\/orchestrator-run-loop\.md: canonical new-runtime path contains Session lifecycle mutation command/,
    );
  });
});

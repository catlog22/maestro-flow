import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const gatePath = join(repoRoot, 'scripts', 'check-session-run-contract-parity.mjs');
const fixtureFiles = [
  'package.json',
  'src/run/schemas.ts',
  'src/run/defaults.ts',
  'src/run/protocol-schemas.ts',
  'src/run/runtime.ts',
  'src/commands/capabilities.ts',
  'src/commands/execution.ts',
  'src/commands/execution-cli-shared.ts',
  'src/commands/run.ts',
  'src/commands/plan.ts',
  'src/cli.ts',
  'scripts/check-session-run-release-machine.mjs',
  'scripts/session-execution-prompt-semantics.mjs',
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
  'src/core/entry-command-generator.ts',
  'dashboard/src/server/wiki/virtual-wiki-adapters.ts',
  'dashboard/src/server/wiki/wiki-indexer.ts',
  'guide/search-system-guide.md',
  'guide/search-system-guide.en.md',
  'guide/session-run-architecture.md',
  'guide/session-run-structure-guide.md',
  'guide/cli-commands-guide.md',
  'guide/cli-commands-guide.en.md',
  'docs/knowledge-system-architecture.md',
];
const tempRoots = [];

function runGate(root = null) {
  return spawnSync(process.execPath, root === null ? [gatePath] : [gatePath, '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'session-run-contract-parity-'));
  tempRoots.push(root);
  for (const relativePath of fixtureFiles) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), target);
  }
  return root;
}

function replaceOnce(root, relativePath, before, after) {
  const path = join(root, relativePath);
  const text = readFileSync(path, 'utf8');
  expect(text).toContain(before);
  writeFileSync(path, text.replace(before, after));
}

function replacePattern(root, relativePath, pattern, replacement) {
  const path = join(root, relativePath);
  const text = readFileSync(path, 'utf8');
  expect(pattern.test(text)).toBe(true);
  writeFileSync(path, text.replace(pattern, replacement));
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe('Session Run contract parity release gate', () => {
  it('passes the current repository contract', () => {
    const result = runGate();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('PASS writer.session.current');
    expect(result.stdout).toContain('PASS prompt.execution.full');
    expect(result.stdout).toContain('PASS prompt.execution.lite');
    expect(result.stdout).toContain('PASS prompt.execution.orchestrator');
    expect(result.stdout).toContain('PASS prompt.execution.ralph');
    expect(result.stdout).toContain('PASS prompt.execution.support-sources');
    expect(result.stdout).toContain('PASS writer.session.statusless-explicit');
    expect(result.stdout).toContain('PASS writer.session.selection-default');
    expect(result.stdout).toContain('PASS writer.command-run.legacy-default');
    expect(result.stdout).toContain('PASS writer.execution.strict');
    expect(result.stdout).toContain('PASS writer.execution-lease.strict');
    expect(result.stdout).toContain('PASS writer.command-run.execution-explicit');
    expect(result.stdout).toContain('PASS runtime.command-run.writer-split');
    expect(result.stdout).toContain('PASS reader.session.compatibility');
    expect(result.stdout).toContain('PASS reader.session.v3');
    expect(result.stdout).toContain('PASS reader.run.v3');
    expect(result.stdout).toContain('PASS cache.search.version');
    expect(result.stdout).toContain('PASS response.operations.legacy');
    expect(result.stdout).toContain('PASS response.operations.execution-additive');
    expect(result.stdout).toContain('PASS response.schemas.compatibility');
    expect(result.stdout).toContain('PASS response.receipt-fences.wave2');
    expect(result.stdout).toContain('PASS capabilities.exact');
    expect(result.stdout).toContain('PASS cli.execution.registration');
    expect(result.stdout).toContain('PASS brief.knowledge-context.schema');
    expect(result.stdout).toContain('PASS cli.accept-reuse.machine-handler');
    expect(result.stdout).toContain('PASS cli.plan-publish.machine-handler');
    expect(result.stdout).toContain('PASS release-machine.coverage');
    expect(result.stdout).toContain('PASS release-machine.focused-fault-injection');
    expect(result.stdout).toContain('PASS release-machine.operation-tokens');
    expect(result.stdout).toContain('PASS docs.search.zh');
    expect(result.stdout).toContain('PASS docs.knowledge-wave2-supersession');
    expect(result.stdout).toContain('PASS package.prepublish.order');
    expect(result.stdout).toContain('PASS package.release-machine.command');
  });

  it('fails each independent Session Run contract drift dimension', () => {
    const cases = [
      {
        dimension: 'prompt-full-capability-negotiation',
        id: 'prompt.execution.full',
        mutate(root) {
          replaceOnce(root, 'workflows/run-mode.md', 'maestro capabilities --json', 'maestro legacy-capabilities --json');
        },
      },
      {
        dimension: 'prompt-lite-session-complete',
        id: 'prompt.execution.lite',
        mutate(root) {
          replacePattern(root, 'workflows/run-mode-lite.md', /maestro session complete/g, 'maestro legacy complete');
        },
      },
      {
        dimension: 'prompt-orchestrator-revision-fence',
        id: 'prompt.execution.orchestrator',
        mutate(root) {
          replacePattern(root, 'workflows/orchestrator-run-loop.md', /--expected-orchestration-revision/g, '--expected-session-revision');
        },
      },
      {
        dimension: 'prompt-ralph-v3-capability',
        id: 'prompt.execution.ralph',
        mutate(root) {
          replacePattern(root, 'prepare/ralph.md', /session_run_minimal_v3/g, 'legacy_session_runtime');
        },
      },
      {
        dimension: 'prompt-full-session-seal-regression',
        id: 'prompt.execution.full',
        mutate(root) {
          replaceOnce(
            root,
            'workflows/run-mode.md',
            '## Completion',
            'maestro session seal {session_id} --summary "canonical regression"\n\n## Completion',
          );
        },
      },
      {
        dimension: 'prompt-lite-request-receipts',
        id: 'prompt.execution.lite',
        mutate(root) {
          replacePattern(
            root,
            'workflows/run-mode-lite.md',
            /request_receipts_v2/g,
            'legacy_request_receipts',
          );
        },
      },
      {
        dimension: 'writer',
        id: 'writer.session.current',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('session/1.3')", "schema_version: z.literal('session/9.9')");
        },
      },
      {
        dimension: 'statusless-writer',
        id: 'writer.session.statusless-explicit',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('session/2.0')", "schema_version: z.literal('session/9.9')");
        },
      },
      {
        dimension: 'session-writer-default-inversion',
        id: 'writer.session.selection-default',
        mutate(root) {
          replaceOnce(root, 'src/run/defaults.ts', "writer: 'session/3.0',", "writer: 'session/2.0',");
        },
      },
      {
        dimension: 'execution-writer',
        id: 'writer.execution.strict',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('execution/1.0')", "schema_version: z.literal('execution/9.9')");
        },
      },
      {
        dimension: 'execution-writer-strictness',
        id: 'writer.execution.strict',
        mutate(root) {
          replacePattern(
            root,
            'src/run/schemas.ts',
            /(export const executionStateSchema = z\.object\(\{[\s\S]*?final_outcome:[\s\S]*?\}\))\.strict\(\);/,
            '$1;',
          );
        },
      },
      {
        dimension: 'execution-lease-writer',
        id: 'writer.execution-lease.strict',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('execution-lease/1.0')", "schema_version: z.literal('execution-lease/9.9')");
        },
      },
      {
        dimension: 'command-run-execution-writer',
        id: 'writer.command-run.execution-explicit',
        mutate(root) {
          replaceOnce(root, 'src/run/schemas.ts', "schema_version: z.literal('command-run/1.4')", "schema_version: z.literal('command-run/9.9')");
        },
      },
      {
        dimension: 'command-run-execution-reader-membership',
        id: 'writer.command-run.execution-explicit',
        mutate(root) {
          replacePattern(
            root,
            'src/run/schemas.ts',
            /export const commandRunReadSchema = z\.union\(\[\s*commandRunV14Schema,\s*/,
            'export const commandRunReadSchema = z.union([\n',
          );
        },
      },
      {
        dimension: 'reader',
        id: 'reader.session.compatibility',
        mutate(root) {
          replaceOnce(root, 'dashboard/src/server/wiki/virtual-wiki-adapters.ts', "&& raw.schema_version !== 'session/1.3'", "&& raw.schema_version !== 'session/9.9'");
        },
      },
      {
        dimension: 'reader-v3-session',
        id: 'reader.session.v3',
        mutate(root) {
          replaceOnce(
            root,
            'dashboard/src/server/wiki/virtual-wiki-adapters.ts',
            "raw.schema_version === 'session/3.0'",
            "raw.schema_version === 'session/9.9'",
          );
        },
      },
      {
        dimension: 'reader-v3-run',
        id: 'reader.run.v3',
        mutate(root) {
          replaceOnce(
            root,
            'dashboard/src/server/wiki/virtual-wiki-adapters.ts',
            "raw.schema_version === 'run/3.0'",
            "raw.schema_version === 'run/9.9'",
          );
        },
      },
      {
        dimension: 'cache',
        id: 'cache.search.version',
        mutate(root) {
          replaceOnce(root, 'dashboard/src/server/wiki/wiki-indexer.ts', 'const SEARCH_CACHE_VERSION = 8;', 'const SEARCH_CACHE_VERSION = 7;');
        },
      },
      {
        dimension: 'operation',
        id: 'response.operations.legacy',
        mutate(root) {
          replaceOnce(
            root,
            'src/run/protocol-schemas.ts',
            "'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'accept-reuse',",
            "'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update',",
          );
        },
      },
      {
        dimension: 'operation-execution',
        id: 'response.operations.execution-additive',
        mutate(root) {
          replaceOnce(
            root,
            'src/run/protocol-schemas.ts',
            "'execution-lease-heartbeat', 'execution-lease-release', 'execution-lease-recover',",
            "'execution-lease-heartbeat', 'execution-lease-release',",
          );
        },
      },
      {
        dimension: 'response-v11',
        id: 'response.schemas.compatibility',
        mutate(root) {
          replaceOnce(root, 'src/run/protocol-schemas.ts', "schema_version: z.literal('run-response/1.1')", "schema_version: z.literal('run-response/9.9')");
        },
      },
      {
        dimension: 'response-v12',
        id: 'response.schemas.compatibility',
        mutate(root) {
          replaceOnce(root, 'src/run/protocol-schemas.ts', "schema_version: z.literal('run-response/1.2')", "schema_version: z.literal('run-response/9.9')");
        },
      },
      {
        dimension: 'brief-result-reader-membership',
        id: 'brief.knowledge-context.schema',
        mutate(root) {
          replacePattern(
            root,
            'src/run/protocol-schemas.ts',
            /result:\s*z\.union\(\[\s*briefResultV10Schema,\s*briefResultV11Schema,\s*briefResultV12Schema\s*\]\)/,
            'result: z.union([briefResultV10Schema, briefResultV11Schema])',
          );
        },
      },
      {
        dimension: 'receipt-source-fence',
        id: 'response.receipt-fences.wave2',
        mutate(root) {
          replaceOnce(root, 'src/run/protocol-schemas.ts', "schema_version: z.literal('source-fence/1.1')", "schema_version: z.literal('source-fence/9.9')");
        },
      },
      {
        dimension: 'capabilities-feature-inversion',
        id: 'capabilities.exact',
        mutate(root) {
          replaceOnce(root, 'src/commands/capabilities.ts', 'session_statusless: !v3,', 'session_statusless: v3Ready,');
        },
      },
      {
        dimension: 'capabilities-writer-list',
        id: 'capabilities.exact',
        mutate(root) {
          replaceOnce(
            root,
            'src/commands/capabilities.ts',
            "? ['session/3.0']",
            "? ['session/9.9']",
          );
        },
      },
      {
        dimension: 'cli-execution-registration',
        id: 'cli.execution.registration',
        mutate(root) {
          replaceOnce(root, 'src/cli.ts',
            "execution:  async () => (await import('./commands/execution.js')).registerExecutionCommand,",
            "execution:  async () => (await import('./commands/execution.js')).registerCapabilitiesCommand,");
        },
      },
      {
        dimension: 'commander-json',
        id: 'cli.accept-reuse.machine-handler',
        mutate(root) {
          replacePattern(
            root,
            'src/commands/run.ts',
            /(\.command\('accept-reuse <run-id>'\)[\s\S]*?)\s*\.option\('--json', 'emit one run-response\/1\.0 envelope on stdout'\)/,
            '$1',
          );
        },
      },
      {
        dimension: 'commander-handler',
        id: 'cli.accept-reuse.machine-handler',
        mutate(root) {
          replaceOnce(root, 'src/commands/run.ts',
            'const result = acceptRunReuse(',
            'const result = disabledAcceptRunReuse(');
        },
      },
      {
        dimension: 'plan-publish-handler',
        id: 'cli.plan-publish.machine-handler',
        mutate(root) {
          replaceOnce(root, 'src/commands/plan.ts',
            'const result = publishPlan({',
            'const result = disabledPublishPlan({');
        },
      },
      {
        dimension: 'release-machine-coverage',
        id: 'release-machine.coverage',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            "    recordProof(proofs, 'complete-blocked');",
            "    recordProof(proofs, 'complete-needs-retry');");
        },
      },
      {
        dimension: 'release-machine-plan-publish-coverage',
        id: 'release-machine.coverage',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            "    recordProof(proofs, 'plan-publish-execution-applied-replayed-fences');",
            "    // Plan publication proof intentionally omitted by drift fixture");
        },
      },
      {
        dimension: 'release-machine-empty-execution-bootstrap-coverage',
        id: 'release-machine.coverage',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            "    recordProof(proofs, 'plan-publish-empty-execution-bootstrap-chain');",
            '    // Empty Execution bootstrap proof intentionally omitted by drift fixture');
        },
      },
      {
        dimension: 'release-machine-focused-fault-injection',
        id: 'release-machine.focused-fault-injection',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            'commits the lease release before lock release so release failure cannot roll it back and remains replayable',
            'lease release filter drifted');
        },
      },
      {
        dimension: 'release-machine-bootstrap-operation-token',
        id: 'release-machine.operation-tokens',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            "'execution-chain-bootstrap'",
            "'chain-bootstrap-drifted'");
        },
      },
      {
        dimension: 'release-machine-seal-alias-coverage',
        id: 'release-machine.coverage',
        mutate(root) {
          replaceOnce(root, 'scripts/check-session-run-release-machine.mjs',
            "    recordProof(proofs, 'run-seal-session-execution-alias-applied-replayed-conflict');",
            "    // Seal alias proof intentionally omitted by drift fixture");
        },
      },
      {
        dimension: 'docs-wave2-statusless',
        id: 'docs.architecture',
        mutate(root) {
          replaceOnce(root, 'guide/session-run-architecture.md', 'session_statusless=true', 'session_statusless=false');
        },
      },
      {
        dimension: 'docs-default-switch-inversion',
        id: 'docs.cli.en',
        mutate(root) {
          replaceOnce(root, 'guide/cli-commands-guide.en.md', 'There is no silent default switch.', 'The default silently switches.');
        },
      },
      {
        dimension: 'docs-knowledge-no-seal-supersession',
        id: 'docs.knowledge-wave2-supersession',
        mutate(root) {
          replaceOnce(
            root,
            'docs/knowledge-system-architecture.md',
            'promotion without a permanent Session seal',
            'promotion only after a permanent Session seal',
          );
        },
      },
      {
        dimension: 'docs-unknown-read-compatibility',
        id: 'docs.architecture',
        mutate(root) {
          replaceOnce(
            root,
            'guide/session-run-architecture.md',
            'opaque/best-effort read compatibility',
            'unknown reads always fail closed',
          );
        },
      },
      {
        dimension: 'docs',
        id: 'docs.search.zh',
        mutate(root) {
          replaceOnce(root, 'guide/search-system-guide.md', '`session/1.3` + `command-run/1.3`', '`session/9.9` + `command-run/1.3`');
        },
      },
      {
        dimension: 'package',
        id: 'package.command',
        mutate(root) {
          replaceOnce(root, 'package.json', 'node scripts/check-session-run-contract-parity.mjs', 'node scripts/incorrect-contract-gate.mjs');
        },
      },
      {
        dimension: 'package-release-machine',
        id: 'package.release-machine.command',
        mutate(root) {
          replaceOnce(root, 'package.json',
            'node scripts/check-session-run-release-machine.mjs',
            'node scripts/incorrect-release-machine.mjs');
        },
      },
      {
        dimension: 'package-release-order',
        id: 'package.prepublish.order',
        mutate(root) {
          replaceOnce(root, 'package.json',
            'npm run build && npm run check:search-ranking-release-machine:built && npm run check:session-run-release-machine && npm run build:mirrors',
            'npm run build && npm run check:search-ranking-release-machine:built && npm run build:mirrors && npm run check:session-run-release-machine');
        },
      },
    ];

    for (const testCase of cases) {
      const root = createFixture();
      testCase.mutate(root);
      const result = runGate(root);
      expect(result.status, `${testCase.dimension}: ${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(result.stdout, testCase.dimension).toContain(`FAIL ${testCase.id}`);
    }
  }, 300_000);
});

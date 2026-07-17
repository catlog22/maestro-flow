// M2 — `run complete` verdict-driven chain advancement, 免参 resolution, signal
// routing, lease guard, and the next-pointer closure. Covers the four verdicts
// against a real Run (created via createRun so the seal path exercises gates +
// handoff derivation), then asserts the chain / session transitions.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { completeRunWithVerdict, createRun } from './runtime.js';
import { resolveRunningRun, runningChainStep } from './resolve.js';
import { checkLease } from './lease.js';
import { updateChainStepStatus } from './chain.js';
import { SessionStore } from './store.js';
import { registerRunCommand } from '../commands/run.js';
import { writeStateJson, migrateV1toV2 } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-verdict-'));
  roots.push(path);
  return path;
}

/** A minimal command with a workflow body so createRun accepts it. */
function stepCommand(projectRoot: string, name: string): void {
  const cmdDir = join(projectRoot, '.claude', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, `${name}.md`), `<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n`, 'utf8');
  const wfDir = join(projectRoot, 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, `${name}.md`), `# ${name}\n\nwork\n`, 'utf8');
}

interface StepSeed {
  command: string;
  status?: string;
  decision_ref?: string | null;
}

function seedSession(
  projectRoot: string,
  sessionId: string,
  steps: StepSeed[],
  opts: { active?: boolean; lease?: SessionState['orchestration']['lease'] } = {},
): void {
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, `intent ${sessionId}`);
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'coordinator';
    draft.session.orchestration.chain = steps.map((s, i) => ({
      step_id: `step-${String(i).padStart(3, '0')}-${s.command}`,
      command: s.command,
      status: s.status ?? 'pending',
      run_id: null,
      inserted_by: 'test',
      decision_ref: s.decision_ref ?? null,
    }));
    if (opts.lease !== undefined) draft.session.orchestration.lease = opts.lease;
    return null;
  });
  const state = migrateV1toV2({ project_name: 'demo', status: 'active' });
  state.sessions = [{
    session_id: sessionId, intent: `intent ${sessionId}`, status: 'running',
    depends_on: [], roadmap_artifact_id: null, seed_ref: null,
  }];
  if (opts.active) state.active_session_id = sessionId;
  writeStateJson(projectRoot, state);
}

/**
 * Create a Run for step `index` and mark that chain step running (what `run next`
 * does), then write a minimal ready report so the seal path produces a handoff.
 */
function startStep(projectRoot: string, sessionId: string, index: number, summary = 'done work'): string {
  const store = new SessionStore(projectRoot);
  const command = store.readBundle(sessionId).session.orchestration.chain[index].command;
  const created = createRun({ projectRoot, command, sessionId, intent: `intent ${sessionId}` });
  updateChainStepStatus(projectRoot, sessionId, index, 'running', created.run_id);
  const runDir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', created.run_id);
  writeFileSync(join(runDir, 'report.md'), `---\nverdict: ready\nsummary: ${summary}\nconstraints: []\ndecisions: []\nconcerns: []\nnext: []\n---\n## 摘要\n${summary}\n`, 'utf8');
  return created.run_id;
}

function chainOf(projectRoot: string, sessionId: string): SessionState['orchestration']['chain'] {
  return new SessionStore(projectRoot).readBundle(sessionId).session.orchestration.chain;
}

function readRunHandoff(projectRoot: string, sessionId: string, runId: string) {
  return new SessionStore(projectRoot).readRun(sessionId, runId).handoff;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** Drive `maestro run complete` through commander with the given argv tail. */
async function runCompleteCli(projectRoot: string, argv: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  registerRunCommand(program);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await program.parseAsync(['node', 'maestro', 'run', 'complete', ...argv, '--workflow-root', projectRoot]);
  } catch {
    /* commander exitOverride throws on parse/validation exit — inspect exitCode */
  }
  const last = log.mock.calls.at(-1)?.[0];
  return typeof last === 'string' ? JSON.parse(last) : undefined;
}

// ── 免参 resolution ────────────────────────────────────────────────────────────

describe('run complete — 免参 resolution', () => {
  it('resolves the unique running session with a running chain step', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const store = new SessionStore(projectRoot);
    const resolved = resolveRunningRun(projectRoot, store);
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') {
      expect(resolved.sessionId).toBe('s');
      expect(resolved.step.run_id).toBe(runId);
      expect(resolved.step.index).toBe(0);
    }
  });

  it('errors with guidance when no running session has a running step', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]); // pending, not running
    const store = new SessionStore(projectRoot);
    const resolved = resolveRunningRun(projectRoot, store);
    expect(resolved.kind).toBe('error');
    if (resolved.kind === 'error') expect(resolved.message).toContain('no running session');
  });

  it('reports ambiguity and lists candidates for multiple running steps', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 'a', [{ command: 'demo' }]);
    seedSession(projectRoot, 'b', [{ command: 'demo' }]);
    startStep(projectRoot, 'a', 0);
    startStep(projectRoot, 'b', 0);
    // No active pointer → both are candidates.
    const state = migrateV1toV2({ project_name: 'demo', status: 'active' });
    state.sessions = [
      { session_id: 'a', intent: 'intent a', status: 'running', depends_on: [], roadmap_artifact_id: null, seed_ref: null },
      { session_id: 'b', intent: 'intent b', status: 'running', depends_on: [], roadmap_artifact_id: null, seed_ref: null },
    ];
    writeStateJson(projectRoot, state);
    const store = new SessionStore(projectRoot);
    const resolved = resolveRunningRun(projectRoot, store);
    expect(resolved.kind).toBe('error');
    if (resolved.kind === 'error') {
      expect(resolved.message).toContain('ambiguous');
      expect(resolved.message).toContain('a');
      expect(resolved.message).toContain('b');
    }
  });

  it('runningChainStep returns null when no step is running', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo', status: 'sealed' }]);
    const session = new SessionStore(projectRoot).readBundle('s').session;
    expect(runningChainStep(session)).toBeNull();
  });
});

// ── Four-state chain transitions ────────────────────────────────────────────────

describe('run complete — verdict chain transitions', () => {
  it('done → step sealed, session running, run sealed', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    expect(result.run_sealed).toBe(true);
    expect(result.chain?.step_status).toBe('sealed');
    expect(result.session_status).toBe('running');
    expect(chainOf(projectRoot, 's')[0].status).toBe('sealed');
  });

  it('done-with-concerns → step sealed + auto concern when no note given', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done-with-concerns' });
    expect(result.chain?.step_status).toBe('sealed');
    const handoff = readRunHandoff(projectRoot, 's', runId);
    expect(handoff?.concerns).toContain('completed with concerns');
  });

  it('needs-retry → step pending, run_id cleared, retry.count incremented', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'needs-retry' });
    expect(result.chain?.step_status).toBe('pending');
    expect(result.chain?.retry).toEqual({ count: 1, max: 2, exhausted: false });
    const step = chainOf(projectRoot, 's')[0];
    expect(step.status).toBe('pending');
    expect(step.run_id).toBeNull();
    expect(step.retry).toEqual({ count: 1, max: 2 });
    // The run itself still sealed (completeRun ran).
    expect(result.run_sealed).toBe(true);
  });

  it('needs-retry flags exhausted once count reaches max (default 2)', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);

    // First retry: count 1 (not exhausted).
    let runId = startStep(projectRoot, 's', 0);
    let result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'needs-retry' });
    expect(result.chain?.retry?.exhausted).toBe(false);

    // Second retry: count 2 == max → exhausted (CLI does not cap; it reports).
    runId = startStep(projectRoot, 's', 0);
    result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'needs-retry' });
    expect(result.chain?.retry).toEqual({ count: 2, max: 2, exhausted: true });
    expect(chainOf(projectRoot, 's')[0].status).toBe('pending'); // still re-queued
  });

  it('blocked → step failed, session paused, reason folded into concerns', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const result = completeRunWithVerdict(projectRoot, runId, 's', {
      verdict: 'blocked',
      reason: 'upstream API down',
    });
    expect(result.chain?.step_status).toBe('failed');
    expect(result.session_status).toBe('paused');
    expect(chainOf(projectRoot, 's')[0].status).toBe('failed');
    const handoff = readRunHandoff(projectRoot, 's', runId);
    expect(handoff?.concerns).toContain('upstream API down');
  });
});

describe('run complete — completion gate integrity', () => {
  it('does not advance the chain when the Run cannot seal', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    const commandPath = join(projectRoot, '.claude', 'commands', 'demo.md');
    writeFileSync(commandPath, `<contract>\nconsumes: []\nproduces:\n  - kind: plan\n    primary: true\n    path: outputs/plan.json\ngates:\n  entry: []\n  exit: []\n</contract>\n`, 'utf8');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    expect(result.run_sealed).toBe(false);
    expect(chainOf(projectRoot, 's')[0]).toMatchObject({ status: 'running', run_id: runId });
    expect(result.next.command).toBe(`maestro run check ${runId}`);
  });
});

// ── Non-chain run ───────────────────────────────────────────────────────────────

describe('run complete — non-chain run', () => {
  it('verdict does not touch chain/session for an ad-hoc run; signals ride handoff', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    // An ad-hoc run that is NOT bound to any chain step (chain step stays pending).
    const created = createRun({ projectRoot, command: 'demo', sessionId: 's', intent: 'intent s' });
    const runDir = join(projectRoot, '.workflow', 'sessions', 's', 'runs', created.run_id);
    writeFileSync(join(runDir, 'report.md'), `---\nverdict: ready\nsummary: adhoc\nconstraints: []\ndecisions: []\nconcerns: []\nnext: []\n---\n## 摘要\nadhoc\n`, 'utf8');

    const result = completeRunWithVerdict(projectRoot, created.run_id, 's', {
      verdict: 'blocked',
      reason: 'ignored for chain but on handoff',
    });
    expect(result.chain).toBeNull();
    expect(result.session_status).toBe('running'); // NOT paused — no chain binding
    expect(chainOf(projectRoot, 's')[0].status).toBe('pending'); // untouched
    const handoff = readRunHandoff(projectRoot, 's', created.run_id);
    expect(handoff?.concerns).toContain('ignored for chain but on handoff');
  });
});

// ── Signal routing (decision / evidence / reason landing) ────────────────────────

describe('run complete — signal routing', () => {
  it('decisions append to handoff.decisions with accepted status', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);

    completeRunWithVerdict(projectRoot, runId, 's', {
      verdict: 'done',
      decisions: ['picked option B', 'deferred caching'],
    });
    const handoff = readRunHandoff(projectRoot, 's', runId);
    const texts = handoff?.decisions.map(d => d.text) ?? [];
    expect(texts).toContain('picked option B');
    expect(texts).toContain('deferred caching');
    expect(handoff?.decisions.every(d => d.status === 'accepted')).toBe(true);
  });

  it('evidence paths register as artifacts on the run', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);
    // Write an evidence file inside the run dir.
    const runDir = join(projectRoot, '.workflow', 'sessions', 's', 'runs', runId);
    mkdirSync(join(runDir, 'evidence'), { recursive: true });
    writeFileSync(join(runDir, 'evidence', 'log.txt'), 'trace output\n', 'utf8');

    const result = completeRunWithVerdict(projectRoot, runId, 's', {
      verdict: 'done',
      extraArtifacts: ['evidence/log.txt'],
    });
    // Extra evidence lands in the artifact registry (artifact_ids), not the
    // outputs-scan summary — same channel `--artifact` uses.
    expect(result.seal.artifact_ids.length).toBeGreaterThan(0);
    const registry = new SessionStore(projectRoot).readBundle('s').artifacts;
    const found = Object.values(registry.artifacts).some(a => a.relative_path.endsWith('evidence/log.txt'));
    expect(found).toBe(true);
  });
});

// ── Lease guard ─────────────────────────────────────────────────────────────────

describe('run complete — lease guard (checkLease)', () => {
  const lease = { owner: 'ralph-execute', epoch: 1, id: 'L1' };

  it('rejects a mismatched owner', () => {
    expect(checkLease(lease, { executionOwner: 'other', leaseId: 'L1' })).toContain('lease conflict');
  });

  it('rejects a mismatched lease id', () => {
    expect(checkLease(lease, { executionOwner: 'ralph-execute', leaseId: 'WRONG' })).toContain('lease conflict');
  });

  it('rejects a mismatched epoch when the claim supplies one', () => {
    expect(checkLease(lease, { executionOwner: 'ralph-execute', leaseId: 'L1', ownerEpoch: 9 })).toContain('lease conflict');
  });

  it('passes a fully matching claim', () => {
    expect(checkLease(lease, { executionOwner: 'ralph-execute', leaseId: 'L1', ownerEpoch: 1 })).toBeNull();
  });

  it('a null lease imposes zero verification', () => {
    expect(checkLease(null, {})).toBeNull();
    expect(checkLease({ owner: null, epoch: 0, id: null }, {})).toBeNull();
  });
});

// ── Next-pointer closure ────────────────────────────────────────────────────────

describe('run complete — next pointer', () => {
  it('points at run next when more pending execution steps remain', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }, { command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);
    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    expect(result.next.command).toBe('maestro run next --session s');
    expect(result.next.reason).toContain('more pending steps');
  });

  it('points at run next (decision) when the next node is a decision', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'demo' },
      { command: 'gate', decision_ref: 'DP-1' },
    ]);
    const runId = startStep(projectRoot, 's', 0);
    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    expect(result.next.reason).toContain('decision');
  });

  it('points at seal-session when all steps are complete', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);
    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    expect(result.next.command).toBe('maestro run seal-session s');
    expect(result.next.reason).toContain('seal the session');
  });

  it('points at resume when the session is paused (blocked)', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }, { command: 'demo' }]);
    const runId = startStep(projectRoot, 's', 0);
    const result = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'blocked', reason: 'x' });
    expect(result.next.reason).toContain('paused');
  });
});

// ── CLI wiring (commander) ───────────────────────────────────────────────────────

describe('run complete CLI — verdict + 免参 + lease', () => {
  it('免参 done resolves the active step and seals it', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], { active: true });
    startStep(projectRoot, 's', 0);

    const out = (await runCompleteCli(projectRoot, ['--verdict', 'done'])) as { chain?: { step_status: string } };
    expect(out?.chain?.step_status).toBe('sealed');
    expect(chainOf(projectRoot, 's')[0].status).toBe('sealed');
    expect(process.exitCode).toBeFalsy();
  });

  it('accepts case-insensitive / underscore verdict spellings', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], { active: true });
    const runId = startStep(projectRoot, 's', 0);

    const out = (await runCompleteCli(projectRoot, [runId, '--session', 's', '--verdict', 'DONE_WITH_CONCERNS'])) as { verdict?: string };
    expect(out?.verdict).toBe('done-with-concerns');
  });

  it('rejects an invalid verdict with exit 2', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], { active: true });
    startStep(projectRoot, 's', 0);

    await runCompleteCli(projectRoot, ['--verdict', 'maybe']);
    expect(process.exitCode).toBe(2);
    expect(chainOf(projectRoot, 's')[0].status).toBe('running'); // untouched
  });

  it('refuses on a lease conflict (exit 1) and does not advance the chain', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], {
      active: true,
      lease: { owner: 'ralph-execute', epoch: 1, id: 'L1' },
    });
    const runId = startStep(projectRoot, 's', 0);

    await runCompleteCli(projectRoot, [runId, '--session', 's', '--verdict', 'done', '--execution-owner', 'other', '--lease-id', 'L1']);
    expect(process.exitCode).toBe(1);
    expect(chainOf(projectRoot, 's')[0].status).toBe('running'); // conflict never advances
  });

  it('passes a matching lease and advances', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], {
      active: true,
      lease: { owner: 'ralph-execute', epoch: 1, id: 'L1' },
    });
    const runId = startStep(projectRoot, 's', 0);

    await runCompleteCli(projectRoot, [
      runId, '--session', 's', '--verdict', 'done',
      '--execution-owner', 'ralph-execute', '--lease-id', 'L1', '--owner-epoch', '1',
    ]);
    expect(chainOf(projectRoot, 's')[0].status).toBe('sealed');
  });

  it('preserves the plain seal path for a verbless explicit run-id', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'demo' }], { active: true });
    const runId = startStep(projectRoot, 's', 0);

    // No verdict, no lease, explicit run-id → legacy completeRun (seals the run,
    // leaves the chain step running — chain driving is opt-in via verdict).
    const out = (await runCompleteCli(projectRoot, [runId, '--session', 's'])) as { sealed?: boolean };
    expect(out?.sealed).toBe(true);
    expect(chainOf(projectRoot, 's')[0].status).toBe('running'); // chain untouched
  });
});

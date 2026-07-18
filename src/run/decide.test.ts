// M5/M6 — `run decide` records a decision point verdict and advances the chain.
// Covers the three verdicts (proceed seals the chain decision node so run next
// continues; fix bumps retry_count + reports exhausted; escalate pauses the
// session), evidence_ref landing, decisions.ndjson append, and the CLI wiring.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { runDecide } from './decide.js';
import { runNextStep } from './next.js';
import { SessionStore } from './store.js';
import { registerRunCommand } from '../commands/run.js';
import { writeStateJson, migrateV1toV2 } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-decide-'));
  roots.push(path);
  return path;
}

/** A minimal command with a workflow body so run next can advance to it. */
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

interface PointSeed {
  point_id: string;
  status?: string;
  retry_count?: number;
  max_retries?: number;
}

function seedSession(
  projectRoot: string,
  sessionId: string,
  steps: StepSeed[],
  points: PointSeed[] = [],
  opts: { active?: boolean } = {},
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
    draft.session.orchestration.decision_points = points.map(p => ({
      point_id: p.point_id,
      after_step_id: null,
      status: p.status ?? 'pending',
      retry_count: p.retry_count ?? 0,
      max_retries: p.max_retries ?? 2,
      evidence_ref: null,
    }));
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

function orchOf(projectRoot: string, sessionId: string): SessionState['orchestration'] {
  return new SessionStore(projectRoot).readBundle(sessionId).session.orchestration;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('run decide — proceed', () => {
  it('marks the point passed and seals the chain decision node', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    // step 0 sealed, step 1 is the decision node (pending), step 2 pending exec.
    seedSession(projectRoot, 's', [
      { command: 'demo', status: 'sealed' },
      { command: 'gate', decision_ref: 'DP-1' },
      { command: 'demo' },
    ], [{ point_id: 'DP-1' }]);

    const result = runDecide(projectRoot, 's', 'DP-1', { verdict: 'proceed', confidence: 'high' });
    expect(result.point_status).toBe('passed');
    expect(result.chain?.step_status).toBe('sealed');
    expect(result.session_status).toBe('running');

    const orch = orchOf(projectRoot, 's');
    expect(orch.decision_points[0].status).toBe('passed');
    expect(orch.chain[1].status).toBe('sealed');
  });

  it('after proceed the decision node is sealed so run next no longer surfaces it', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    // The decision node is the only remaining pending node — before deciding,
    // run next surfaces the decision card (exit 2, decision node next).
    seedSession(projectRoot, 's', [
      { command: 'demo', status: 'sealed' },
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1' }]);

    const before = runNextStep(projectRoot, { sessionId: 's' });
    expect(before.exitCode).toBe(2);
    expect(before.message).toContain('Decision node');

    runDecide(projectRoot, 's', 'DP-1', { verdict: 'proceed', confidence: 'high' });

    // After proceed the node is sealed; run next reports "all complete" (exit 2)
    // rather than the decision card — the node no longer blocks.
    const after = runNextStep(projectRoot, { sessionId: 's' });
    expect(after.exitCode).toBe(2);
    expect(after.message).toContain('all complete');
    expect(orchOf(projectRoot, 's').chain[1].status).toBe('sealed');
  });
});

describe('run decide — fix', () => {
  it('bumps retry_count, keeps status pending, and does not seal the node', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1', retry_count: 0, max_retries: 2 }]);

    const result = runDecide(projectRoot, 's', 'DP-1', { verdict: 'fix', confidence: 'medium' });
    expect(result.point_status).toBe('pending');
    expect(result.retry).toEqual({ count: 1, max: 2, exhausted: false });

    const orch = orchOf(projectRoot, 's');
    expect(orch.decision_points[0].retry_count).toBe(1);
    expect(orch.decision_points[0].status).toBe('pending');
    expect(orch.chain[0].status).toBe('pending'); // decision node untouched
  });

  it('reports exhausted once retry_count reaches max_retries (CLI does not cap)', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1', retry_count: 1, max_retries: 2 }]);

    const result = runDecide(projectRoot, 's', 'DP-1', { verdict: 'fix', confidence: 'low' });
    expect(result.retry).toEqual({ count: 2, max: 2, exhausted: true });
    expect(orchOf(projectRoot, 's').decision_points[0].status).toBe('pending'); // still pending
  });
});

describe('run decide — escalate', () => {
  it('sets the point escalated and pauses the session', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1' }]);

    const result = runDecide(projectRoot, 's', 'DP-1', { verdict: 'escalate', confidence: 'high' });
    expect(result.point_status).toBe('escalated');
    expect(result.session_status).toBe('paused');

    const bundle = new SessionStore(projectRoot).readBundle('s');
    expect(bundle.session.status).toBe('paused');
    expect(bundle.session.orchestration.decision_points[0].status).toBe('escalated');
    expect(bundle.session.orchestration.chain[0].status).toBe('pending'); // stays pending
    expect(result.next).toMatchObject({ suggest_only: true, action: 'resolve_session', command: null });
    expect(result.next.preconditions).toContain('perform an authorized Session resume transition');
  });
});

describe('run decide — evidence + decisions.ndjson', () => {
  it('lands evidence on evidence_ref and appends to decisions.ndjson', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1' }]);

    runDecide(projectRoot, 's', 'DP-1', {
      verdict: 'proceed',
      confidence: 'high',
      summary: 'gate clean',
      evidence: 'runs/r1/report.md',
    });

    expect(orchOf(projectRoot, 's').decision_points[0].evidence_ref).toBe('runs/r1/report.md');

    const logPath = join(projectRoot, '.workflow', 'sessions', 's', 'decisions.ndjson');
    expect(existsSync(logPath)).toBe(true);
    const record = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(record.type).toBe('decide');
    expect(record.point_id).toBe('DP-1');
    expect(record.verdict).toBe('proceed');
    expect(record.confidence).toBe('high');
    expect(record.evidence_ref).toBe('runs/r1/report.md');
  });

  it('falls back to summary for evidence_ref when no evidence path is given', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], [{ point_id: 'DP-1' }]);

    runDecide(projectRoot, 's', 'DP-1', { verdict: 'proceed', confidence: 'high', summary: 'looks good' });
    expect(orchOf(projectRoot, 's').decision_points[0].evidence_ref).toBe('looks good');
  });
});

describe('run decide — errors', () => {
  it('throws for a missing session', () => {
    const projectRoot = root();
    expect(() => runDecide(projectRoot, 'nope', 'DP-1', { verdict: 'proceed', confidence: 'high' }))
      .toThrow(/session not found/);
  });

  it('throws for a missing decision point and lists known points', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'gate', decision_ref: 'DP-1' }], [{ point_id: 'DP-1' }]);
    expect(() => runDecide(projectRoot, 's', 'DP-9', { verdict: 'proceed', confidence: 'high' }))
      .toThrow(/decision point not found: DP-9.*DP-1/s);
  });

  it('rejects re-deciding a terminal decision point', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'gate', decision_ref: 'DP-1' }], [{ point_id: 'DP-1' }]);
    runDecide(projectRoot, 's', 'DP-1', { verdict: 'proceed', confidence: 'high' });

    expect(() => runDecide(projectRoot, 's', 'DP-1', { verdict: 'escalate', confidence: 'low' }))
      .toThrow(/terminal decisions cannot be re-decided/);
    expect(orchOf(projectRoot, 's').decision_points[0].status).toBe('passed');
  });
});

// ── CLI wiring ────────────────────────────────────────────────────────────────

async function runDecideCli(projectRoot: string, argv: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  registerRunCommand(program);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await program.parseAsync(['node', 'maestro', 'run', 'decide', ...argv, '--workflow-root', projectRoot]);
  } catch {
    /* commander exitOverride throws on parse/validation exit */
  }
  const last = log.mock.calls.at(-1)?.[0];
  return typeof last === 'string' ? JSON.parse(last) : undefined;
}

describe('run decide CLI', () => {
  it('proceed advances the point via commander', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'gate', decision_ref: 'DP-1' }], [{ point_id: 'DP-1' }], { active: true });

    const out = (await runDecideCli(projectRoot, ['DP-1', '--session', 's', '--verdict', 'proceed', '--confidence', 'high'])) as { point_status?: string };
    expect(out?.point_status).toBe('passed');
    expect(orchOf(projectRoot, 's').decision_points[0].status).toBe('passed');
    expect(process.exitCode).toBeFalsy();
  });

  it('rejects an invalid verdict with exit 2', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'gate', decision_ref: 'DP-1' }], [{ point_id: 'DP-1' }], { active: true });

    await runDecideCli(projectRoot, ['DP-1', '--session', 's', '--verdict', 'maybe', '--confidence', 'high']);
    expect(process.exitCode).toBe(2);
    expect(orchOf(projectRoot, 's').decision_points[0].status).toBe('pending'); // untouched
  });

  it('rejects an invalid confidence with exit 2', async () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', [{ command: 'gate', decision_ref: 'DP-1' }], [{ point_id: 'DP-1' }], { active: true });

    await runDecideCli(projectRoot, ['DP-1', '--session', 's', '--verdict', 'proceed', '--confidence', 'maybe']);
    expect(process.exitCode).toBe(2);
  });
});

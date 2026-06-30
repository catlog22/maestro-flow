import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, runDerive, runDecide, parseSignal } from '../cmd-brain.js';
import type { BrainLedger } from '../brain-schema.js';

let dir: string;
let cwd: string;

const writeState = (milestones: unknown[], artifacts: unknown[] = [], current = 'M1') => {
  writeFileSync(join(dir, '.workflow', 'state.json'), JSON.stringify({
    version: '2.0', project_name: null, status: 'active',
    current_milestone: current, current_task_id: null,
    milestones, artifacts,
    accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
    transition_history: [], milestone_history: [], last_updated: '',
  }));
};

const latestLedger = (): BrainLedger => {
  const brainDir = join(dir, '.workflow', '.brain');
  const sess = readdirSync(brainDir)[0];
  return JSON.parse(readFileSync(join(brainDir, sess, 'ledger.json'), 'utf-8'));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brain-cli-'));
  mkdirSync(join(dir, '.workflow'), { recursive: true });
  cwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('maestro brain CLI engine (end-to-end)', () => {
  it('init refuses empty intent (exit 2)', () => {
    expect(runInit({ intent: '   ', autonomous: true })).toBe(2);
  });

  it('init creates a ledger.json with correct defaults', () => {
    const code = runInit({ intent: 'build X', autonomous: true, maxRounds: 12, now: new Date('2026-06-28T06:30:00Z') });
    expect(code).toBe(0);
    const led = latestLedger();
    expect(led.intent).toBe('build X');
    expect(led.autonomous).toBe(true);
    expect(led.max_rounds).toBe(12);
    expect(led.status).toBe('running');
    expect(led.convergence).toEqual({ stuck: {}, revises: {}, crash_retries: {} });
  });

  it('derive prints cursor + stop eval (exit 0)', () => {
    writeState([{ id: 'M1', name: 'M1', title: 'Core', status: 'active', phases: [1] }]);
    runInit({ intent: 'x', autonomous: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runDerive({ json: true })).toBe(0);
    const out = log.mock.calls.map(c => c[0]).join('\n');
    log.mockRestore();
    expect(out).toContain('"cursor"');
    expect(out).toContain('M1/phase-1');
  });

  it('decide returns terminate when all mandatory milestones completed', () => {
    writeState([{ id: 'M1', name: 'M1', title: 'Core', status: 'completed', phases: [1] }],
      [{ id: 'EXC-001', type: 'execute', milestone: 'M1', phase: 1, scope: 'phase', path: '', status: 'completed', depends_on: null, harvested: false, created_at: '2026-01-01', completed_at: null }]);
    runInit({ intent: 'x', autonomous: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runDecide({ signal: 'ok', json: true });
    const out = log.mock.calls.map(c => c[0]).join('\n');
    log.mockRestore();
    expect(out).toContain('"decision": "terminate"');
    expect(out).toContain('completed');
  });

  it('decide --commit persists the round AND bumps the convergence counter (caps trip across rounds)', () => {
    writeState([{ id: 'M1', name: 'M1', title: 'Core', status: 'active', phases: [1, 2] }]);
    runInit({ intent: 'x', autonomous: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // a result-problem advances stuck["M1/phase-1"]: commit twice -> counter persists to 2
    runDecide({ signal: 'result-problem', commit: true });
    runDecide({ signal: 'result-problem', commit: true });
    log.mockRestore();
    const led = latestLedger();
    expect(led.rounds).toHaveLength(2);
    expect(led.convergence.stuck['M1/phase-1']).toBe(2);
  });

  it('parseSignal handles roadmap-problem:<issue>', () => {
    expect(parseSignal('roadmap-problem:export-sem')).toEqual({ kind: 'roadmap-problem', issue: 'export-sem' });
    expect(parseSignal('unfixable-external')).toEqual({ kind: 'unfixable-external' });
    expect(parseSignal(undefined)).toEqual({ kind: 'ok' });
  });
});

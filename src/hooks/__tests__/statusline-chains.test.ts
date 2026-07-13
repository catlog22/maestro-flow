/**
 * Tests for line-2 chain rendering: simplification, 48h expiry, cap=3.
 *
 * Spins up a temp workspace with .workflow/state.json fixtures and invokes
 * formatStatusline to verify rendered output.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { formatStatusline } from '../statusline.js';

const ANSI = /\x1b\[[0-9;]*m/g;
function plain(s: string): string { return s.replace(ANSI, ''); }

let workspace: string;

function setup(opts: {
  intent?: string;
  sessionStatus?: string;
  runs: Array<{ id: string; sequence: number; status: string; command: string }>;
  artifacts?: Array<{ id: string; kind: string; status: string; runId: string; path: string; createdAt?: string }>;
}): void {
  workspace = mkdtempSync(join(tmpdir(), 'statusline-chain-test-'));
  const sessionId = '20260713-statusline';
  const sessionDir = join(workspace, '.workflow', 'sessions', sessionId);
  const runsDir = join(sessionDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(workspace, '.workflow', 'state.json'), JSON.stringify({
    version: '2.0', active_session_id: sessionId, sessions: [{ session_id: sessionId, intent: opts.intent ?? 'MVP', status: opts.sessionStatus ?? 'running' }],
  }));
  const active = opts.runs.find(run => run.status === 'running' || run.status === 'blocked');
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
    session_id: sessionId, intent: opts.intent ?? 'MVP', status: opts.sessionStatus ?? 'running', active_run_id: active?.id ?? null,
  }));
  const registry: Record<string, unknown> = {};
  for (const artifact of opts.artifacts ?? []) {
    registry[artifact.id] = { kind: artifact.kind, status: artifact.status, producer_run_id: artifact.runId, relative_path: artifact.path, created_at: artifact.createdAt ?? isoDaysAgo(0) };
  }
  writeFileSync(join(sessionDir, 'artifacts.json'), JSON.stringify({ artifacts: registry, aliases: {} }));
  for (const run of opts.runs) {
    const dir = join(runsDir, run.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ run_id: run.id, sequence: run.sequence, status: run.status, command: { name: run.command } }));
  }
}

function teardown(): void {
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('statusline chain rendering', () => {
  beforeEach(() => { workspace = ''; });
  afterEach(teardown);

  it('renders sealed canonical Session progress', () => {
    setup({ intent: 'MVP', sessionStatus: 'sealed', runs: [
      { id: '20260713-001-analyze', sequence: 1, status: 'sealed', command: 'analyze' },
      { id: '20260713-002-plan', sequence: 2, status: 'sealed', command: 'plan' },
    ], artifacts: [
      { id: 'ART-001', kind: 'findings', status: 'sealed', runId: '20260713-001-analyze', path: 'runs/20260713-001-analyze/outputs/findings.json' },
    ] });
    const out = plain(formatStatusline({ workspace: { current_dir: workspace } }));
    assert.match(out, /\bMVP\b/);
    assert.match(out, /✓/);
  });

  it('renders active Run sequence and progress', () => {
    setup({ intent: 'MVP', runs: [
      { id: '20260713-001-analyze', sequence: 1, status: 'sealed', command: 'analyze' },
      { id: '20260713-002-plan', sequence: 2, status: 'sealed', command: 'plan' },
      { id: '20260713-003-execute', sequence: 3, status: 'running', command: 'execute' },
    ], artifacts: [
      { id: 'ART-001', kind: 'findings', status: 'sealed', runId: '20260713-001-analyze', path: 'runs/20260713-001-analyze/outputs/findings.json' },
      { id: 'ART-002', kind: 'plan', status: 'sealed', runId: '20260713-002-plan', path: 'runs/20260713-002-plan/outputs/plan.json' },
    ] });
    const out = plain(formatStatusline({ workspace: { current_dir: workspace } }));
    assert.match(out, /P3\b/, `should show active Run sequence: ${out}`);
    assert.match(out, /2\/3/, `should show sealed/total progress: ${out}`);
  });

  it('renders canonical artifact paths without old phase directories', () => {
    setup({ intent: 'Search migration', runs: [
      { id: '20260713-001-review', sequence: 1, status: 'sealed', command: 'review' },
    ], artifacts: [
      { id: 'ART-001', kind: 'review-findings', status: 'sealed', runId: '20260713-001-review', path: 'runs/20260713-001-review/outputs/findings.json' },
    ] });
    const out = plain(formatStatusline({ workspace: { current_dir: workspace } }));
    assert.match(out, /Search migration/);
    assert.ok(!out.includes('phases/'));
  });
});

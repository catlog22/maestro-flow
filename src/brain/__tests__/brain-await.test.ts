import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyChildStatus, awaitChildTerminal } from '../brain-await.js';

describe('classifyChildStatus — real terminal-field semantics (v8)', () => {
  it('ralph completed + all sub-goals done -> terminal completed', () => {
    const c = classifyChildStatus({ status: 'completed', task_decomposition_all_done: true }, 'ralph');
    expect(c).toEqual({ terminal: true, outcome: 'completed', hardSignal: false });
  });
  it('ralph completed but sub-goals NOT all done -> hard signal (never silent-pass)', () => {
    const c = classifyChildStatus({ status: 'completed', task_decomposition_all_done: false }, 'ralph');
    expect(c?.hardSignal).toBe(true);
    expect(c?.outcome).toBe('paused');
  });
  it('ralph paused / failed -> terminal hard signal', () => {
    expect(classifyChildStatus({ status: 'paused' }, 'ralph')?.hardSignal).toBe(true);
    expect(classifyChildStatus({ status: 'failed' }, 'ralph')?.outcome).toBe('failed');
  });
  it('ralph running -> NOT terminal (null)', () => {
    expect(classifyChildStatus({ status: 'running' }, 'ralph')).toBeNull();
  });
  it('odyssey COMPLETED / phase_goals_all_done -> terminal completed', () => {
    expect(classifyChildStatus({ current_state: 'COMPLETED' }, 'odyssey')?.outcome).toBe('completed');
    expect(classifyChildStatus({ phase_goals_all_done: true }, 'odyssey')?.outcome).toBe('completed');
  });
  it('odyssey mid-run -> NOT terminal', () => {
    expect(classifyChildStatus({ current_state: 'S_FIX' }, 'odyssey')).toBeNull();
  });
  it('missing fields -> never false-green', () => {
    expect(classifyChildStatus({}, 'ralph')).toBeNull();
    expect(classifyChildStatus(null, 'ralph')).toBeNull();
  });
});

describe('awaitChildTerminal — event-driven suspend', () => {
  let dir: string;
  let statusPath: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'brain-await-')); statusPath = join(dir, 'status.json'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('resolves immediately if already terminal', async () => {
    writeFileSync(statusPath, JSON.stringify({ status: 'completed', task_decomposition_all_done: true }));
    const r = await awaitChildTerminal({ statusPath, kind: 'ralph', timeoutMs: 1000, floorSec: 0.02 });
    expect(r.outcome).toBe('completed');
    expect(r.terminal).toBe(true);
  });

  it('suspends, then resolves when the child flips to terminal (no busy-poll)', async () => {
    writeFileSync(statusPath, JSON.stringify({ status: 'running' }));
    const p = awaitChildTerminal({ statusPath, kind: 'ralph', timeoutMs: 2000, floorSec: 0.025 });
    setTimeout(() => writeFileSync(statusPath, JSON.stringify({ status: 'completed', task_decomposition_all_done: true })), 60);
    const r = await p;
    expect(r.outcome).toBe('completed');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('paused child -> hard signal outcome', async () => {
    writeFileSync(statusPath, JSON.stringify({ status: 'running' }));
    const p = awaitChildTerminal({ statusPath, kind: 'ralph', timeoutMs: 2000, floorSec: 0.025 });
    setTimeout(() => writeFileSync(statusPath, JSON.stringify({ status: 'paused' })), 50);
    const r = await p;
    expect(r.outcome).toBe('paused');
    expect(r.hardSignal).toBe(true);
  });

  it('times out (bounded, not infinite) when never terminal -> hard signal', async () => {
    writeFileSync(statusPath, JSON.stringify({ status: 'running' }));
    const r = await awaitChildTerminal({ statusPath, kind: 'ralph', timeoutMs: 120, floorSec: 0.03 });
    expect(r.outcome).toBe('timeout');
    expect(r.hardSignal).toBe(true);
    expect(r.terminal).toBe(false);
  });

  it('missing status file at deadline -> missing outcome', async () => {
    const r = await awaitChildTerminal({ statusPath, kind: 'ralph', timeoutMs: 80, floorSec: 0.03 });
    expect(r.outcome).toBe('missing');
    expect(r.hardSignal).toBe(true);
  });
});

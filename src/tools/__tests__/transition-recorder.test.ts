import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTransitionEntry, appendTransition } from '../transition-recorder.js';

const TEST_DIR = join(tmpdir(), `maestro-test-transition-${Date.now()}`);
const STATE_PATH = join(TEST_DIR, 'state.json');

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// buildTransitionEntry
// ---------------------------------------------------------------------------

describe('buildTransitionEntry', () => {
  it('builds a phase transition entry with correct structure', () => {
    const entry = buildTransitionEntry({
      type: 'phase',
      fromPhase: 1,
      toPhase: 2,
      milestone: 'MVP',
      trigger: 'phase-transition',
      force: false,
      phasesCompleted: 1,
      phasesTotal: 4,
      deferredCount: 3,
      verificationStatus: 'gaps_found',
      learningsCount: 5,
    });

    assert.strictEqual(entry.type, 'phase');
    assert.strictEqual(entry.from_phase, 1);
    assert.strictEqual(entry.to_phase, 2);
    assert.strictEqual(entry.milestone, 'MVP');
    assert.strictEqual(entry.trigger, 'phase-transition');
    assert.strictEqual(entry.force, false);
    assert.ok(entry.transitioned_at); // ISO string
    assert.strictEqual(entry.snapshot.phases_completed, 1);
    assert.strictEqual(entry.snapshot.phases_total, 4);
    assert.strictEqual(entry.snapshot.deferred_count, 3);
    assert.strictEqual(entry.snapshot.verification_status, 'gaps_found');
    assert.strictEqual(entry.snapshot.learnings_count, 5);
  });

  it('builds a milestone transition entry', () => {
    const entry = buildTransitionEntry({
      type: 'milestone',
      fromPhase: null,
      toPhase: null,
      milestone: 'MVP',
      trigger: 'milestone-complete',
      force: true,
      phasesCompleted: 2,
      phasesTotal: 4,
      deferredCount: 0,
      verificationStatus: 'passed',
      learningsCount: 10,
    });

    assert.strictEqual(entry.type, 'milestone');
    assert.strictEqual(entry.from_phase, null);
    assert.strictEqual(entry.to_phase, null);
    assert.strictEqual(entry.force, true);
  });

  it('generates ISO timestamp', () => {
    const entry = buildTransitionEntry({
      type: 'phase',
      fromPhase: 1,
      toPhase: 2,
      milestone: 'MVP',
      trigger: 'phase-transition',
      force: false,
      phasesCompleted: 1,
      phasesTotal: 4,
      deferredCount: 0,
      verificationStatus: 'passed',
      learningsCount: 0,
    });

    // Should be a valid ISO date string
    const parsed = new Date(entry.transitioned_at);
    assert.ok(!isNaN(parsed.getTime()));
  });
});

// ---------------------------------------------------------------------------
// appendTransition
// ---------------------------------------------------------------------------

describe('appendTransition', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => cleanup());

  it('appends to existing transition_history', () => {
    writeFileSync(STATE_PATH, JSON.stringify({
      version: '1.0',
      current_phase: 2,
      transition_history: [
        { type: 'phase', from_phase: 1, to_phase: 2, milestone: 'MVP' },
      ],
    }));

    const entry = buildTransitionEntry({
      type: 'phase',
      fromPhase: 2,
      toPhase: 3,
      milestone: 'MVP',
      trigger: 'phase-transition',
      force: false,
      phasesCompleted: 2,
      phasesTotal: 4,
      deferredCount: 1,
      verificationStatus: 'passed',
      learningsCount: 3,
    });

    appendTransition(STATE_PATH, entry);

    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.strictEqual(state.transition_history.length, 2);
    assert.strictEqual(state.transition_history[1].from_phase, 2);
    assert.strictEqual(state.transition_history[1].to_phase, 3);
  });

  it('creates transition_history array when absent', () => {
    writeFileSync(STATE_PATH, JSON.stringify({
      version: '1.0',
      current_phase: 1,
    }));

    const entry = buildTransitionEntry({
      type: 'phase',
      fromPhase: 1,
      toPhase: 2,
      milestone: 'MVP',
      trigger: 'phase-transition',
      force: false,
      phasesCompleted: 1,
      phasesTotal: 4,
      deferredCount: 0,
      verificationStatus: 'passed',
      learningsCount: 0,
    });

    appendTransition(STATE_PATH, entry);

    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.ok(Array.isArray(state.transition_history));
    assert.strictEqual(state.transition_history.length, 1);
    assert.strictEqual(state.transition_history[0].type, 'phase');
  });

  it('updates last_updated timestamp', () => {
    writeFileSync(STATE_PATH, JSON.stringify({
      version: '1.0',
      last_updated: '2020-01-01T00:00:00Z',
    }));

    const entry = buildTransitionEntry({
      type: 'milestone',
      fromPhase: null,
      toPhase: null,
      milestone: 'MVP',
      trigger: 'milestone-complete',
      force: false,
      phasesCompleted: 2,
      phasesTotal: 2,
      deferredCount: 0,
      verificationStatus: 'passed',
      learningsCount: 5,
    });

    appendTransition(STATE_PATH, entry);

    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    assert.notStrictEqual(state.last_updated, '2020-01-01T00:00:00Z');
  });

  it('does nothing when state file does not exist', () => {
    const entry = buildTransitionEntry({
      type: 'phase',
      fromPhase: 1,
      toPhase: 2,
      milestone: 'MVP',
      trigger: 'phase-transition',
      force: false,
      phasesCompleted: 1,
      phasesTotal: 4,
      deferredCount: 0,
      verificationStatus: 'passed',
      learningsCount: 0,
    });

    // Should not throw
    appendTransition(join(TEST_DIR, 'nonexistent.json'), entry);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardStore } from './board-store.js';
import type { BoardState, PhaseCard } from '@/shared/types.js';

function makePhaseCard(phase: number, overrides: Partial<PhaseCard> = {}): PhaseCard {
  return {
    phase,
    slug: `phase-${phase}`,
    title: `Phase ${phase}`,
    status: 'pending',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    goal: 'Test goal',
    success_criteria: [],
    requirements: [],
    spec_ref: null,
    plan: { task_ids: [], task_count: 0, complexity: null, waves: [] },
    execution: { method: '', started_at: null, completed_at: null, tasks_completed: 0, tasks_total: 0, current_wave: 0, commits: [] },
    verification: { status: '', verified_at: null, must_haves: [], gaps: [] },
    validation: { status: '', test_coverage: null, gaps: [] },
    uat: { status: '', test_count: 0, passed: 0, gaps: [] },
    reflection: { rounds: 0, strategy_adjustments: [] },
    ...overrides,
  };
}

function makeBoardState(phases: PhaseCard[] = []): BoardState {
  return {
    project: {
      version: '1.0',
      project_name: 'test',
      current_milestone: '',
      current_phase: 0,
      status: 'idle',
      phases_summary: { total: 0, completed: 0, in_progress: 0, pending: 0 },
      last_updated: '2026-01-01T00:00:00Z',
      accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
    },
    phases,
    scratch: [],
    lastUpdated: '2026-01-01T00:00:00Z',
  };
}

describe('useBoardStore', () => {
  beforeEach(() => {
    useBoardStore.setState({
      board: null,
      connected: false,
      selectedPhase: null,
    });
  });

  describe('setBoard', () => {
    it('sets the board state', () => {
      const board = makeBoardState([makePhaseCard(1)]);
      useBoardStore.getState().setBoard(board);
      expect(useBoardStore.getState().board).toStrictEqual(board);
    });
  });

  describe('setConnected', () => {
    it('toggles connected status', () => {
      useBoardStore.getState().setConnected(true);
      expect(useBoardStore.getState().connected).toBe(true);
      useBoardStore.getState().setConnected(false);
      expect(useBoardStore.getState().connected).toBe(false);
    });
  });

  describe('setSelectedPhase', () => {
    it('sets selected phase', () => {
      useBoardStore.getState().setSelectedPhase(3);
      expect(useBoardStore.getState().selectedPhase).toBe(3);
    });

    it('clears selected phase with null', () => {
      useBoardStore.getState().setSelectedPhase(3);
      useBoardStore.getState().setSelectedPhase(null);
      expect(useBoardStore.getState().selectedPhase).toBeNull();
    });
  });

  describe('updatePhase', () => {
    it('updates a specific phase', () => {
      const board = makeBoardState([makePhaseCard(1), makePhaseCard(2)]);
      useBoardStore.getState().setBoard(board);
      useBoardStore.getState().updatePhase(1, { status: 'executing' });
      const updated = useBoardStore.getState().board!.phases.find((p) => p.phase === 1);
      expect(updated?.status).toBe('executing');
    });

    it('does nothing when board is null', () => {
      useBoardStore.getState().updatePhase(1, { status: 'completed' });
      expect(useBoardStore.getState().board).toBeNull();
    });

    it('leaves other phases unchanged', () => {
      const board = makeBoardState([makePhaseCard(1), makePhaseCard(2)]);
      useBoardStore.getState().setBoard(board);
      useBoardStore.getState().updatePhase(1, { status: 'executing' });
      const phase2 = useBoardStore.getState().board!.phases.find((p) => p.phase === 2);
      expect(phase2?.status).toBe('pending');
    });
  });

  describe('updateTask', () => {
    it('bumps updated_at of parent phase containing the task', () => {
      const phase = makePhaseCard(1, {
        plan: { task_ids: ['task-1', 'task-2'], task_count: 2, complexity: null, waves: [] },
        updated_at: '2026-01-01T00:00:00Z',
      });
      useBoardStore.getState().setBoard(makeBoardState([phase]));
      useBoardStore.getState().updateTask('task-1', {});
      const updated = useBoardStore.getState().board!.phases[0];
      expect(updated.updated_at).not.toBe('2026-01-01T00:00:00Z');
    });

    it('does nothing when board is null', () => {
      useBoardStore.getState().updateTask('task-1', {});
      expect(useBoardStore.getState().board).toBeNull();
    });
  });
});

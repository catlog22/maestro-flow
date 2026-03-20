import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type {
  BoardState,
  PhaseCard,
  TaskCard,
  ScratchCard,
  ProjectState,
} from '../../shared/types.js';
import { SSE_EVENT_TYPES } from '../../shared/constants.js';
import { readJsonSafe } from './file-reader.js';
import type { DashboardEventBus } from './event-bus.js';
import { toForwardSlash } from '../../shared/utils.js';

// ---------------------------------------------------------------------------
// StateManager — in-memory projection of .workflow/ directory
// ---------------------------------------------------------------------------

export class StateManager {
  private board: BoardState;
  /** Cache: phase number → directory path for O(1) lookups */
  private phaseDirCache = new Map<number, string>();
  private isSwitching = false;

  constructor(
    private workflowRoot: string,
    private readonly eventBus: DashboardEventBus,
  ) {
    this.board = emptyBoard();
  }

  /** Return current board state snapshot */
  getBoard(): BoardState {
    return this.board;
  }

  /** Return project state */
  getProject(): ProjectState {
    return this.board.project;
  }

  /** Return a specific phase by number, or undefined */
  getPhase(n: number): PhaseCard | undefined {
    return this.board.phases.find((p) => p.phase === n);
  }

  /** Return tasks for a given phase number */
  async getTasks(phaseNum: number): Promise<TaskCard[]> {
    // Use cached directory path if available
    const cached = this.phaseDirCache.get(phaseNum);
    if (cached) return readPhaseTasks(cached);

    const phaseDir = await findPhaseDir(this.workflowRoot, phaseNum);
    if (!phaseDir) return [];
    this.phaseDirCache.set(phaseNum, phaseDir);
    return readPhaseTasks(phaseDir);
  }

  // -------------------------------------------------------------------------
  // Full state build — scans the entire .workflow/ directory
  // -------------------------------------------------------------------------

  async buildInitialState(): Promise<BoardState> {
    const project = await readJsonSafe<ProjectState>(
      join(this.workflowRoot, 'state.json'),
    );

    const phases = await this.readAllPhases();
    const scratch = await this.readAllScratch();

    this.board = {
      project: project ?? emptyProject(),
      phases,
      scratch,
      lastUpdated: new Date().toISOString(),
    };

    this.eventBus.emit(SSE_EVENT_TYPES.BOARD_FULL, this.board);
    return this.board;
  }

  // -------------------------------------------------------------------------
  // Workspace switch — replace root, rebuild state, broadcast switch event
  // -------------------------------------------------------------------------

  get switching(): boolean {
    return this.isSwitching;
  }

  async resetForNewWorkspace(newRoot: string): Promise<void> {
    if (this.isSwitching) {
      throw new Error('Workspace switch already in progress.');
    }
    this.isSwitching = true;
    try {
      this.phaseDirCache.clear();
      this.workflowRoot = newRoot;
      await this.buildInitialState();
      this.eventBus.emit(SSE_EVENT_TYPES.WORKSPACE_SWITCHED, { workspace: newRoot });
    } finally {
      this.isSwitching = false;
    }
  }

  // -------------------------------------------------------------------------
  // Delta update — re-read a single changed file and emit event
  // -------------------------------------------------------------------------

  async applyFileChange(filePath: string): Promise<void> {
    const rel = toForwardSlash(relative(this.workflowRoot, filePath));

    // state.json — project-level change
    if (rel === 'state.json') {
      const project = await readJsonSafe<ProjectState>(filePath);
      if (project) {
        this.board.project = project;
        this.board.lastUpdated = new Date().toISOString();
        this.eventBus.emit(SSE_EVENT_TYPES.PROJECT_UPDATED, this.board.project);
      }
      return;
    }

    // phases/<slug>/index.json — phase updated
    const phaseIndexMatch = rel.match(/^phases\/[^/]+\/index\.json$/);
    if (phaseIndexMatch) {
      const phase = await readJsonSafe<PhaseCard>(filePath);
      if (phase) {
        this.upsertPhase(phase);
        this.board.lastUpdated = new Date().toISOString();
        this.eventBus.emit(SSE_EVENT_TYPES.PHASE_UPDATED, phase);
      }
      return;
    }

    // phases/<slug>/.task/TASK-*.json — task updated
    const taskMatch = rel.match(/^phases\/[^/]+\/\.task\/TASK-.*\.json$/);
    if (taskMatch) {
      const task = await readJsonSafe<TaskCard>(filePath);
      if (task) {
        this.board.lastUpdated = new Date().toISOString();
        this.eventBus.emit(SSE_EVENT_TYPES.TASK_UPDATED, task);
      }
      return;
    }

    // scratch/<slug>/index.json — scratch task updated
    const scratchMatch = rel.match(/^scratch\/[^/]+\/index\.json$/);
    if (scratchMatch) {
      const scratch = await readJsonSafe<ScratchCard>(filePath);
      if (scratch) {
        this.upsertScratch(scratch);
        this.board.lastUpdated = new Date().toISOString();
        this.eventBus.emit(SSE_EVENT_TYPES.SCRATCH_UPDATED, scratch);
      }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private upsertPhase(phase: PhaseCard): void {
    const idx = this.board.phases.findIndex((p) => p.phase === phase.phase);
    if (idx >= 0) {
      this.board.phases[idx] = phase;
    } else {
      this.board.phases.push(phase);
      this.board.phases.sort((a, b) => a.phase - b.phase);
    }
  }

  private upsertScratch(card: ScratchCard): void {
    const idx = this.board.scratch.findIndex((s) => s.id === card.id);
    if (idx >= 0) {
      this.board.scratch[idx] = card;
    } else {
      this.board.scratch.push(card);
    }
  }

  private async readAllPhases(): Promise<PhaseCard[]> {
    const phasesDir = join(this.workflowRoot, 'phases');
    const slugs = await safeReaddir(phasesDir);
    const phases: PhaseCard[] = [];
    this.phaseDirCache.clear();

    for (const slug of slugs) {
      const dirPath = join(phasesDir, slug);
      const indexPath = join(dirPath, 'index.json');
      const phase = await readJsonSafe<PhaseCard>(indexPath);
      if (phase) {
        phases.push(phase);
        this.phaseDirCache.set(phase.phase, dirPath);
      }
    }

    phases.sort((a, b) => a.phase - b.phase);
    return phases;
  }

  private async readAllScratch(): Promise<ScratchCard[]> {
    const scratchDir = join(this.workflowRoot, 'scratch');
    const slugs = await safeReaddir(scratchDir);
    const cards: ScratchCard[] = [];

    for (const slug of slugs) {
      const indexPath = join(scratchDir, slug, 'index.json');
      const card = await readJsonSafe<ScratchCard>(indexPath);
      if (card) {
        cards.push(card);
      }
    }

    return cards;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

async function findPhaseDir(
  workflowRoot: string,
  phaseNum: number,
): Promise<string | null> {
  const phasesDir = join(workflowRoot, 'phases');
  const slugs = await safeReaddir(phasesDir);

  for (const slug of slugs) {
    const indexPath = join(phasesDir, slug, 'index.json');
    const phase = await readJsonSafe<PhaseCard>(indexPath);
    if (phase && phase.phase === phaseNum) {
      return join(phasesDir, slug);
    }
  }

  return null;
}

async function readPhaseTasks(phaseDir: string): Promise<TaskCard[]> {
  const taskDir = join(phaseDir, '.task');
  const entries = await safeReaddirFiles(taskDir);
  const tasks: TaskCard[] = [];

  for (const entry of entries) {
    if (!entry.startsWith('TASK-') || !entry.endsWith('.json')) continue;
    const task = await readJsonSafe<TaskCard>(join(taskDir, entry));
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function safeReaddirFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

function emptyProject(): ProjectState {
  return {
    version: '1.0',
    project_name: '',
    current_milestone: '',
    current_phase: 0,
    status: 'idle',
    phases_summary: { total: 0, completed: 0, in_progress: 0, pending: 0 },
    last_updated: new Date().toISOString(),
    accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
  };
}

function emptyBoard(): BoardState {
  return {
    project: emptyProject(),
    phases: [],
    scratch: [],
    lastUpdated: new Date().toISOString(),
  };
}

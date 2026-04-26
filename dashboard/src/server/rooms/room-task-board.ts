// ---------------------------------------------------------------------------
// RoomTaskBoard — DAG task board with bidirectional dependency tracking
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import type {
  RoomTask,
  RoomTaskCreate,
  RoomTaskUpdate,
  RoomTaskStatus,
} from './room-types.js';

export class RoomTaskBoard {
  private readonly tasks = new Map<string, RoomTask[]>();

  /**
   * Create a task in the session. Auto-links bidirectional blockedBy/blocks.
   * Returns the created task.
   */
  create(sessionId: string, input: RoomTaskCreate): RoomTask {
    const now = new Date().toISOString();
    const id = randomUUID();

    let list = this.tasks.get(sessionId);
    if (!list) {
      list = [];
      this.tasks.set(sessionId, list);
    }

    // Determine initial status based on dependencies
    const blockedBy = input.blockedBy ?? [];
    const hasUnresolved = blockedBy.some((depId) => {
      const dep = list!.find((t) => t.id === depId);
      return dep && dep.status !== 'completed';
    });

    const task: RoomTask = {
      id,
      sessionId,
      title: input.title,
      description: input.description,
      status: hasUnresolved ? 'blocked' : 'pending',
      owner: input.owner,
      blockedBy: [...blockedBy],
      blocks: [],
      createdAt: now,
      updatedAt: now,
    };

    // Link bidirectional: add this task's ID to each dependency's `blocks` array
    for (const depId of blockedBy) {
      const dep = list.find((t) => t.id === depId);
      if (dep && !dep.blocks.includes(id)) {
        dep.blocks.push(id);
      }
    }

    list.push(task);
    return task;
  }

  /**
   * Update a task by ID. Returns the updated task or undefined if not found.
   */
  update(sessionId: string, taskId: string, patch: RoomTaskUpdate): RoomTask | undefined {
    const list = this.tasks.get(sessionId);
    if (!list) return undefined;

    const task = list.find((t) => t.id === taskId);
    if (!task) return undefined;

    if (patch.title !== undefined) task.title = patch.title;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.owner !== undefined) task.owner = patch.owner;
    task.updatedAt = new Date().toISOString();

    return task;
  }

  /** List all tasks in a session */
  list(sessionId: string): RoomTask[] {
    return this.tasks.get(sessionId) ?? [];
  }

  /** Get tasks owned by a specific agent role */
  getByOwner(sessionId: string, owner: string): RoomTask[] {
    const list = this.tasks.get(sessionId);
    if (!list) return [];
    return list.filter((t) => t.owner === owner);
  }

  /**
   * Check which tasks become unblocked after a task completes.
   * Removes the completed task from dependents' blockedBy arrays.
   * Returns the list of tasks that became newly unblocked (transitioned from blocked to pending).
   */
  checkUnblocks(sessionId: string, completedTaskId: string): RoomTask[] {
    const list = this.tasks.get(sessionId);
    if (!list) return [];

    const completedTask = list.find((t) => t.id === completedTaskId);
    if (!completedTask) return [];

    const nowUnblocked: RoomTask[] = [];

    for (const dependentId of completedTask.blocks) {
      const dependent = list.find((t) => t.id === dependentId);
      if (!dependent) continue;

      // Remove completedTaskId from the dependent's blockedBy
      const idx = dependent.blockedBy.indexOf(completedTaskId);
      if (idx !== -1) {
        dependent.blockedBy.splice(idx, 1);
      }

      // If no remaining blockers and currently blocked, transition to pending
      if (dependent.blockedBy.length === 0 && dependent.status === 'blocked') {
        dependent.status = 'pending';
        dependent.updatedAt = new Date().toISOString();
        nowUnblocked.push(dependent);
      }
    }

    return nowUnblocked;
  }

  /** Clear all tasks for a session */
  clear(sessionId: string): void {
    this.tasks.delete(sessionId);
  }
}

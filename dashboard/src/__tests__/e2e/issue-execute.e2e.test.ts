import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';

import { createExecutionRoutes } from '../../server/routes/execution.js';
import { createIssueRoutes } from '../../server/routes/issues.js';
import type { Issue } from '../../shared/issue-types.js';
import type { ExecutionScheduler } from '../../server/execution/execution-scheduler.js';
import type { AgentType } from '../../shared/agent-types.js';

// ---------------------------------------------------------------------------
// L3 E2E: Issue Execute — Dispatch, Batch, Cancel, Status across routes
//
// Flow: Create issues via issue routes -> dispatch execution -> verify status
//       -> cancel -> verify state consistency
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock ExecutionScheduler with state tracking
// ---------------------------------------------------------------------------

interface TrackedCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

function createMockScheduler() {
  const calls: TrackedCall[] = [];
  const running: { issueId: string; processId: string; executor: AgentType }[] = [];
  const queued: string[] = [];
  let enabled = false;

  const scheduler = {
    executeIssue: vi.fn(async (issueId: string, executor?: AgentType) => {
      calls.push({ method: 'executeIssue', args: [issueId, executor], timestamp: Date.now() });
      running.push({
        issueId,
        processId: `proc-${issueId}`,
        executor: executor ?? 'claude-code',
      });
    }),

    executeBatch: vi.fn(async (issueIds: string[], executor?: AgentType, maxConcurrency?: number) => {
      calls.push({ method: 'executeBatch', args: [issueIds, executor, maxConcurrency], timestamp: Date.now() });
      const max = maxConcurrency ?? 3;
      for (let i = 0; i < issueIds.length; i++) {
        if (i < max) {
          running.push({
            issueId: issueIds[i],
            processId: `proc-${issueIds[i]}`,
            executor: executor ?? 'claude-code',
          });
        } else {
          queued.push(issueIds[i]);
        }
      }
    }),

    cancelIssue: vi.fn(async (id: string) => {
      calls.push({ method: 'cancelIssue', args: [id], timestamp: Date.now() });
      const idx = running.findIndex((s) => s.issueId === id);
      if (idx >= 0) {
        running.splice(idx, 1);
      } else {
        const qIdx = queued.indexOf(id);
        if (qIdx >= 0) queued.splice(qIdx, 1);
        else throw new Error(`Issue ${id} not in running or queued state`);
      }
    }),

    getStatus: vi.fn(() => ({
      enabled,
      running: running.map((r) => ({
        issueId: r.issueId,
        processId: r.processId,
        executor: r.executor,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        turnNumber: 1,
        maxTurns: 3,
      })),
      queued: [...queued],
      retrying: [],
      lastTickAt: null,
      isCommanderActive: false,
      stats: { totalDispatched: calls.filter((c) => c.method === 'executeIssue').length, totalCompleted: 0, totalFailed: 0 },
    })),

    updateConfig: vi.fn((config: Record<string, unknown>) => {
      calls.push({ method: 'updateConfig', args: [config], timestamp: Date.now() });
    }),

    startSupervisor: vi.fn(() => {
      enabled = true;
      calls.push({ method: 'startSupervisor', args: [], timestamp: Date.now() });
    }),

    stopSupervisor: vi.fn(() => {
      enabled = false;
      calls.push({ method: 'stopSupervisor', args: [], timestamp: Date.now() });
    }),
  } as unknown as ExecutionScheduler;

  return { scheduler, calls, running, queued };
}

// ---------------------------------------------------------------------------
// App setup helpers
// ---------------------------------------------------------------------------

let workflowRoot: string;
let app: Hono;
let mockScheduler: ReturnType<typeof createMockScheduler>;

beforeEach(async () => {
  workflowRoot = join(tmpdir(), `e2e-exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(join(workflowRoot, 'issues'), { recursive: true });

  mockScheduler = createMockScheduler();
  app = new Hono();
  app.route('/', createIssueRoutes(workflowRoot));
  app.route('/', createExecutionRoutes(mockScheduler.scheduler));
});

afterEach(async () => {
  await rm(workflowRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Issue helpers
// ---------------------------------------------------------------------------

async function createIssue(data: Record<string, unknown>): Promise<Issue> {
  const res = await app.request('/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Issue;
}

async function addSolution(issueId: string): Promise<Issue> {
  const res = await app.request(`/api/issues/${issueId}/solution`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      steps: [
        { description: 'Implement fix', target: 'src/module.ts' },
        { description: 'Add test', target: 'src/module.test.ts', verification: 'Tests pass' },
      ],
      context: 'Using existing patterns',
      planned_at: new Date().toISOString(),
      planned_by: 'test-agent',
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Issue;
}

// ---------------------------------------------------------------------------
// E2E: Issue Execute dispatch + batch + cancel + status
// ---------------------------------------------------------------------------

describe('E2E: Issue Execute — dispatch, batch, cancel, status', () => {

  // ── Single issue dispatch ───────────────────────────────────────────────
  describe('Single issue dispatch', () => {
    it('dispatches a single issue for execution', async () => {
      const issue = await createIssue({
        title: 'Fix auth bug',
        description: 'Token expiry not handled',
        type: 'bug',
        priority: 'high',
      });
      await addSolution(issue.id);

      // Dispatch execution
      const res = await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; issueId: string };
      expect(body.ok).toBe(true);
      expect(body.issueId).toBe(issue.id);

      // Verify scheduler was called
      expect(mockScheduler.calls).toHaveLength(1);
      expect(mockScheduler.calls[0].method).toBe('executeIssue');
      expect(mockScheduler.calls[0].args[0]).toBe(issue.id);

      // Verify status reflects the running issue
      const statusRes = await app.request('/api/execution/status');
      const status = (await statusRes.json()) as { running: { issueId: string }[] };
      expect(status.running).toHaveLength(1);
      expect(status.running[0].issueId).toBe(issue.id);
    });

    it('dispatches with executor override', async () => {
      const issue = await createIssue({
        title: 'Add feature',
        description: 'New endpoint',
        type: 'feature',
        priority: 'medium',
      });

      const res = await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, executor: 'gemini' }),
      });

      expect(res.status).toBe(200);
      expect(mockScheduler.calls[0].args).toEqual([issue.id, 'gemini']);

      // Verify status shows correct executor
      const statusRes = await app.request('/api/execution/status');
      const status = (await statusRes.json()) as { running: { issueId: string; executor: string }[] };
      expect(status.running[0].executor).toBe('gemini');
    });

    it('rejects dispatch with invalid executor', async () => {
      const issue = await createIssue({
        title: 'Test',
        description: 'Test',
      });

      const res = await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, executor: 'nonexistent-tool' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('executor');
    });

    it('rejects dispatch without issueId', async () => {
      const res = await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('issueId');
    });
  });

  // ── Batch dispatch ──────────────────────────────────────────────────────
  describe('Batch dispatch', () => {
    it('dispatches multiple issues in batch', async () => {
      const issues = await Promise.all([
        createIssue({ title: 'Issue A', description: 'Desc A', type: 'bug', priority: 'high' }),
        createIssue({ title: 'Issue B', description: 'Desc B', type: 'task', priority: 'medium' }),
        createIssue({ title: 'Issue C', description: 'Desc C', type: 'feature', priority: 'low' }),
      ]);
      const ids = issues.map((i) => i.id);

      const res = await app.request('/api/execution/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ids }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; count: number };
      expect(body.ok).toBe(true);
      expect(body.count).toBe(3);

      // Verify scheduler received all IDs
      expect(mockScheduler.calls[0].method).toBe('executeBatch');
      expect(mockScheduler.calls[0].args[0]).toEqual(ids);
    });

    it('respects maxConcurrency in batch', async () => {
      const issues = await Promise.all([
        createIssue({ title: 'Issue 1', description: 'D1' }),
        createIssue({ title: 'Issue 2', description: 'D2' }),
        createIssue({ title: 'Issue 3', description: 'D3' }),
        createIssue({ title: 'Issue 4', description: 'D4' }),
      ]);
      const ids = issues.map((i) => i.id);

      const res = await app.request('/api/execution/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ids, maxConcurrency: 2 }),
      });

      expect(res.status).toBe(200);

      // Verify maxConcurrency was passed
      expect(mockScheduler.calls[0].args[2]).toBe(2);

      // Verify running vs queued split in mock
      const statusRes = await app.request('/api/execution/status');
      const status = (await statusRes.json()) as { running: unknown[]; queued: string[] };
      expect(status.running).toHaveLength(2);
      expect(status.queued).toHaveLength(2);
    });

    it('rejects batch with empty array', async () => {
      const res = await app.request('/api/execution/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects batch with non-string elements', async () => {
      const res = await app.request('/api/execution/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: [123, 456] }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Cancel ──────────────────────────────────────────────────────────────
  describe('Cancel execution', () => {
    it('cancels a running issue execution', async () => {
      const issue = await createIssue({ title: 'Cancel me', description: 'Test cancel' });

      // Start execution
      await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id }),
      });

      // Verify running
      let statusRes = await app.request('/api/execution/status');
      let status = (await statusRes.json()) as { running: { issueId: string }[] };
      expect(status.running).toHaveLength(1);

      // Cancel
      const cancelRes = await app.request(`/api/execution/cancel/${issue.id}`, { method: 'POST' });
      expect(cancelRes.status).toBe(200);
      const cancelBody = (await cancelRes.json()) as { ok: boolean };
      expect(cancelBody.ok).toBe(true);

      // Verify no longer running
      statusRes = await app.request('/api/execution/status');
      status = (await statusRes.json()) as { running: { issueId: string }[] };
      expect(status.running).toHaveLength(0);
    });

    it('returns 500 when cancelling non-existent execution', async () => {
      const res = await app.request('/api/execution/cancel/NON-EXISTENT', { method: 'POST' });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('not in running or queued');
    });
  });

  // ── Supervisor control ─────────────────────────────────────────────────
  describe('Supervisor toggle', () => {
    it('enables and disables supervisor', async () => {
      // Enable
      let res = await app.request('/api/execution/supervisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      let body = (await res.json()) as { ok: boolean; status: { enabled: boolean } };
      expect(body.ok).toBe(true);
      expect(body.status.enabled).toBe(true);

      // Disable
      res = await app.request('/api/execution/supervisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      body = (await res.json()) as { ok: boolean; status: { enabled: boolean } };
      expect(body.status.enabled).toBe(false);
    });

    it('updates config and enables supervisor in one call', async () => {
      const res = await app.request('/api/execution/supervisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          config: { maxConcurrentAgents: 5, pollIntervalMs: 10000 },
        }),
      });

      expect(res.status).toBe(200);
      const configCalls = mockScheduler.calls.filter((c) => c.method === 'updateConfig');
      expect(configCalls).toHaveLength(1);
      expect(configCalls[0].args[0]).toEqual({ maxConcurrentAgents: 5, pollIntervalMs: 10000 });

      const startCalls = mockScheduler.calls.filter((c) => c.method === 'startSupervisor');
      expect(startCalls).toHaveLength(1);
    });
  });

  // ── Full lifecycle: create → solve → dispatch → cancel ─────────────────
  describe('Full issue execute lifecycle', () => {
    it('create issue → add solution → dispatch → verify running → cancel → verify stopped', async () => {
      // Step 1: Create issue
      const issue = await createIssue({
        title: 'Implement rate limiting',
        description: 'Add rate limiting to API endpoints',
        type: 'feature',
        priority: 'high',
      });
      expect(issue.status).toBe('open');

      // Step 2: Add analysis
      const analysisRes = await app.request(`/api/issues/${issue.id}/analysis`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root_cause: 'No rate limiting exists',
          impact: 'API vulnerable to abuse',
          related_files: ['src/middleware/rate-limit.ts'],
          confidence: 0.9,
          suggested_approach: 'Sliding window with Redis backend',
          analyzed_at: new Date().toISOString(),
          analyzed_by: 'gemini',
        }),
      });
      expect(analysisRes.status).toBe(200);

      // Step 3: Add solution
      const planned = await addSolution(issue.id);
      expect(planned.solution).toBeDefined();
      expect(planned.solution!.steps).toHaveLength(2);

      // Step 4: Dispatch execution
      const dispatchRes = await app.request('/api/execution/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, executor: 'codex' }),
      });
      expect(dispatchRes.status).toBe(200);

      // Step 5: Verify running
      let statusRes = await app.request('/api/execution/status');
      let status = (await statusRes.json()) as { running: { issueId: string; executor: string }[] };
      expect(status.running).toHaveLength(1);
      expect(status.running[0].issueId).toBe(issue.id);
      expect(status.running[0].executor).toBe('codex');

      // Step 6: Cancel
      const cancelRes = await app.request(`/api/execution/cancel/${issue.id}`, { method: 'POST' });
      expect(cancelRes.status).toBe(200);

      // Step 7: Verify stopped
      statusRes = await app.request('/api/execution/status');
      status = (await statusRes.json()) as { running: { issueId: string }[] };
      expect(status.running).toHaveLength(0);
    });

    it('batch dispatch multiple issues → partial cancel → verify remaining', async () => {
      const issues = await Promise.all([
        createIssue({ title: 'Task A', description: 'DA', type: 'task', priority: 'high' }),
        createIssue({ title: 'Task B', description: 'DB', type: 'task', priority: 'medium' }),
        createIssue({ title: 'Task C', description: 'DC', type: 'task', priority: 'low' }),
      ]);
      const ids = issues.map((i) => i.id);

      // Dispatch all 3
      const batchRes = await app.request('/api/execution/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: ids, executor: 'gemini' }),
      });
      expect(batchRes.status).toBe(200);

      // Cancel only the second one
      const cancelRes = await app.request(`/api/execution/cancel/${ids[1]}`, { method: 'POST' });
      expect(cancelRes.status).toBe(200);

      // Verify only 2 remain running
      const statusRes = await app.request('/api/execution/status');
      const status = (await statusRes.json()) as { running: { issueId: string }[] };
      expect(status.running).toHaveLength(2);
      const runningIds = status.running.map((r) => r.issueId);
      expect(runningIds).toContain(ids[0]);
      expect(runningIds).not.toContain(ids[1]);
      expect(runningIds).toContain(ids[2]);
    });
  });
});

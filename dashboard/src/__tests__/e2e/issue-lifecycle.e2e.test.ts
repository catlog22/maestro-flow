import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createIssueRoutes } from '../../server/routes/issues.js';
import type { Issue } from '../../shared/issue-types.js';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// L3 E2E: Issue Lifecycle — Full CRUD + analysis + solution across routes
//
// Flow: Create issue -> Get -> Update status -> Add analysis -> Add solution
//       -> Update to resolved -> Close -> Delete -> verify gone
// ---------------------------------------------------------------------------

let workflowRoot: string;
let app: Hono;

beforeEach(async () => {
  workflowRoot = join(tmpdir(), `e2e-issue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(join(workflowRoot, 'issues'), { recursive: true });

  app = new Hono();
  app.route('/', createIssueRoutes(workflowRoot));
});

afterEach(async () => {
  await rm(workflowRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
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

async function getIssue(id: string): Promise<Issue> {
  const res = await app.request(`/api/issues/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Issue;
}

async function patchIssue(id: string, data: Record<string, unknown>): Promise<Issue> {
  const res = await app.request(`/api/issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Issue;
}

async function listIssues(query?: string): Promise<Issue[]> {
  const url = query ? `/api/issues?${query}` : '/api/issues';
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Issue[];
}

// ---------------------------------------------------------------------------
// E2E: Full issue lifecycle
// ---------------------------------------------------------------------------

describe('E2E: Issue lifecycle — create -> update -> analyze -> solve -> close -> delete', () => {
  it('complete issue lifecycle from creation to deletion', async () => {
    // Step 1: Create an issue
    const issue = await createIssue({
      title: 'Fix auth token expiry',
      description: 'JWT tokens expire without refresh mechanism',
      type: 'bug',
      priority: 'high',
    });

    expect(issue.id).toBeDefined();
    expect(issue.title).toBe('Fix auth token expiry');
    expect(issue.type).toBe('bug');
    expect(issue.priority).toBe('high');
    expect(issue.status).toBe('open');
    expect(issue.created_at).toBeDefined();

    // Step 2: Retrieve the issue
    const fetched = await getIssue(issue.id);
    expect(fetched.id).toBe(issue.id);
    expect(fetched.title).toBe('Fix auth token expiry');

    // Step 3: Update issue status to in_progress
    const inProgress = await patchIssue(issue.id, { status: 'in_progress' });
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.updated_at).not.toBe(issue.updated_at);

    // Step 4: Add analysis
    const analysisRes = await app.request(`/api/issues/${issue.id}/analysis`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root_cause: 'No token refresh logic implemented',
        impact: 'Users are logged out every 15 minutes',
        related_files: ['src/auth/token.ts', 'src/middleware/auth.ts'],
        confidence: 0.85,
        suggested_approach: 'Implement refresh token rotation with sliding expiry',
        analyzed_at: new Date().toISOString(),
        analyzed_by: 'claude-code',
      }),
    });
    expect(analysisRes.status).toBe(200);
    const analyzed = (await analysisRes.json()) as Issue;
    expect(analyzed.analysis).toBeDefined();
    expect(analyzed.analysis!.root_cause).toBe('No token refresh logic implemented');
    expect(analyzed.analysis!.confidence).toBe(0.85);

    // Step 5: Add solution plan
    const solutionRes = await app.request(`/api/issues/${issue.id}/solution`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [
          { description: 'Add refresh token generation', target: 'src/auth/token.ts' },
          { description: 'Implement token rotation endpoint', target: 'src/auth/routes.ts' },
          { description: 'Add middleware for auto-refresh', target: 'src/middleware/auth.ts', verification: 'Token refreshes within 5 min of expiry' },
        ],
        context: 'Using JWT with RS256, existing auth middleware',
        planned_at: new Date().toISOString(),
        planned_by: 'claude-code',
      }),
    });
    expect(solutionRes.status).toBe(200);
    const planned = (await solutionRes.json()) as Issue;
    expect(planned.solution).toBeDefined();
    expect(planned.solution!.steps).toHaveLength(3);

    // Step 6: Resolve the issue
    const resolved = await patchIssue(issue.id, { status: 'resolved' });
    expect(resolved.status).toBe('resolved');

    // Step 7: Close the issue
    const closed = await patchIssue(issue.id, { status: 'closed' });
    expect(closed.status).toBe('closed');

    // Step 8: Verify the full issue state
    const finalState = await getIssue(issue.id);
    expect(finalState.status).toBe('closed');
    expect(finalState.analysis).toBeDefined();
    expect(finalState.solution).toBeDefined();
    expect(finalState.solution!.steps).toHaveLength(3);

    // Step 9: Delete the issue
    const deleteRes = await app.request(`/api/issues/${issue.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    // Step 10: Verify deletion
    const getRes = await app.request(`/api/issues/${issue.id}`);
    expect(getRes.status).toBe(404);
  });

  it('multiple issues with filtering across statuses', async () => {
    // Create multiple issues
    const bug = await createIssue({ title: 'Bug A', description: 'Desc A', type: 'bug', priority: 'high' });
    const feature = await createIssue({ title: 'Feature B', description: 'Desc B', type: 'feature', priority: 'medium' });
    const task = await createIssue({ title: 'Task C', description: 'Desc C', type: 'task', priority: 'low' });

    // Transition each to different statuses
    await patchIssue(bug.id, { status: 'in_progress' });
    await patchIssue(feature.id, { status: 'resolved' });
    // task stays open

    // List all
    const allIssues = await listIssues();
    expect(allIssues).toHaveLength(3);

    // Filter by status
    const openIssues = await listIssues('status=open');
    expect(openIssues).toHaveLength(1);
    expect(openIssues[0].title).toBe('Task C');

    const inProgressIssues = await listIssues('status=in_progress');
    expect(inProgressIssues).toHaveLength(1);
    expect(inProgressIssues[0].title).toBe('Bug A');

    const resolvedIssues = await listIssues('status=resolved');
    expect(resolvedIssues).toHaveLength(1);
    expect(resolvedIssues[0].title).toBe('Feature B');

    // Filter by type
    const bugs = await listIssues('type=bug');
    expect(bugs).toHaveLength(1);
    expect(bugs[0].type).toBe('bug');
  });

  it('issue validation rejects invalid data', async () => {
    // Missing title
    let res = await app.request('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'no title' }),
    });
    expect(res.status).toBe(400);

    // Missing description
    res = await app.request('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'no desc' }),
    });
    expect(res.status).toBe(400);

    // Invalid type
    res = await app.request('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test', description: 'test', type: 'invalid' }),
    });
    expect(res.status).toBe(400);

    // Invalid priority
    res = await app.request('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test', description: 'test', priority: 'critical' }),
    });
    expect(res.status).toBe(400);
  });

  it('updating non-existent issue returns 404', async () => {
    const res = await app.request('/api/issues/NON-EXISTENT-ID', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    expect(res.status).toBe(404);
  });

  it('deleting non-existent issue returns 404', async () => {
    const res = await app.request('/api/issues/NON-EXISTENT-ID', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('analysis on non-existent issue returns 404', async () => {
    const res = await app.request('/api/issues/NON-EXISTENT-ID/analysis', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root_cause: 'test',
        impact: 'test',
        related_files: [],
        confidence: 0.5,
        suggested_approach: 'test',
        analyzed_at: new Date().toISOString(),
        analyzed_by: 'test',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('analysis validation rejects invalid confidence', async () => {
    const issue = await createIssue({ title: 'Test', description: 'Test' });

    const res = await app.request(`/api/issues/${issue.id}/analysis`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root_cause: 'test',
        impact: 'test',
        related_files: [],
        confidence: 1.5,
        suggested_approach: 'test',
        analyzed_at: new Date().toISOString(),
        analyzed_by: 'test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('solution validation rejects empty steps', async () => {
    const issue = await createIssue({ title: 'Test', description: 'Test' });

    const res = await app.request(`/api/issues/${issue.id}/solution`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: [],
        planned_at: new Date().toISOString(),
        planned_by: 'test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('concurrent issue operations maintain consistency', async () => {
    // Create multiple issues concurrently
    const creates = await Promise.all([
      createIssue({ title: 'Concurrent A', description: 'Desc A' }),
      createIssue({ title: 'Concurrent B', description: 'Desc B' }),
      createIssue({ title: 'Concurrent C', description: 'Desc C' }),
    ]);

    expect(creates).toHaveLength(3);
    const ids = new Set(creates.map((c) => c.id));
    expect(ids.size).toBe(3); // All unique IDs

    // List should have all 3
    const all = await listIssues();
    expect(all).toHaveLength(3);
  });
});

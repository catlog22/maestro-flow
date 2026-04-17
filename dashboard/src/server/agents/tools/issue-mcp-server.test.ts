import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Capture tool handlers via mock
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
const capturedTools = new Map<string, ToolHandler>();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    capturedTools.set(name, handler);
    return { name, handler };
  },
  createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
    type: 'sdk',
    name: opts.name,
    instance: {},
  }),
}));

import { createIssueMcpServer } from './issue-mcp-server.js';
import { writeIssuesJsonl, readIssuesJsonl } from '../../utils/issue-store.js';
import type { Issue } from '../../../shared/issue-types.js';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.id ?? 'ISS-test-1',
    title: 'Test issue',
    description: 'Test description',
    type: 'bug',
    priority: 'medium',
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('issue-mcp-server', () => {
  let tempDir: string;
  let jsonlPath: string;

  beforeEach(async () => {
    capturedTools.clear();
    tempDir = await mkdtemp(join(tmpdir(), 'issue-mcp-'));
    await mkdir(join(tempDir, 'issues'), { recursive: true });
    jsonlPath = join(tempDir, 'issues', 'issues.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates an MCP server with correct name', async () => {
    const server = await createIssueMcpServer(tempDir);
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('issue-monitor');
  });

  it('registers three tools: get_issue, list_issues, update_issue', async () => {
    await createIssueMcpServer(tempDir);
    expect(capturedTools.has('get_issue')).toBe(true);
    expect(capturedTools.has('list_issues')).toBe(true);
    expect(capturedTools.has('update_issue')).toBe(true);
  });

  describe('get_issue handler', () => {
    it('returns issue data when found', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('get_issue')!;

      const issue = makeIssue({ id: 'ISS-get-1', title: 'Get Test' });
      await writeIssuesJsonl(jsonlPath, [issue]);

      const result = await handler({ issue_id: 'ISS-get-1' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('ISS-get-1');
      expect(parsed.title).toBe('Get Test');
    });

    it('returns error when issue not found', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('get_issue')!;

      await writeIssuesJsonl(jsonlPath, []);

      const result = await handler({ issue_id: 'ISS-missing' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('ISS-missing');
    });

    it('returns error when JSONL file is empty', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('get_issue')!;

      const result = await handler({ issue_id: 'ISS-1' });
      expect(result.isError).toBe(true);
    });
  });

  describe('list_issues handler', () => {
    it('returns all issues when no filters', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issues = [
        makeIssue({ id: 'ISS-1', status: 'open', type: 'bug', priority: 'high' }),
        makeIssue({ id: 'ISS-2', status: 'resolved', type: 'feature', priority: 'low' }),
      ];
      await writeIssuesJsonl(jsonlPath, issues);

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('ISS-1');
      expect(parsed[0].has_analysis).toBe(false);
      expect(parsed[0].has_solution).toBe(false);
      expect(parsed[0].execution_status).toBe('none');
    });

    it('filters by status', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issues = [
        makeIssue({ id: 'ISS-1', status: 'open' }),
        makeIssue({ id: 'ISS-2', status: 'resolved' }),
        makeIssue({ id: 'ISS-3', status: 'open' }),
      ];
      await writeIssuesJsonl(jsonlPath, issues);

      const result = await handler({ status: 'open' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.every((i: { status: string }) => i.status === 'open')).toBe(true);
    });

    it('filters by type', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issues = [
        makeIssue({ id: 'ISS-1', type: 'bug' }),
        makeIssue({ id: 'ISS-2', type: 'feature' }),
        makeIssue({ id: 'ISS-3', type: 'bug' }),
      ];
      await writeIssuesJsonl(jsonlPath, issues);

      const result = await handler({ type: 'bug' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it('filters by both status and type', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issues = [
        makeIssue({ id: 'ISS-1', status: 'open', type: 'bug' }),
        makeIssue({ id: 'ISS-2', status: 'open', type: 'feature' }),
        makeIssue({ id: 'ISS-3', status: 'resolved', type: 'bug' }),
      ];
      await writeIssuesJsonl(jsonlPath, issues);

      const result = await handler({ status: 'open', type: 'bug' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('ISS-1');
    });

    it('includes analysis and solution presence flags', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issue = makeIssue({
        id: 'ISS-1',
        analysis: {
          root_cause: 'x',
          impact: 'y',
          related_files: [],
          confidence: 0.9,
          suggested_approach: 'z',
          analyzed_at: '2026-01-01T00:00:00Z',
          analyzed_by: 'test',
        },
        solution: {
          steps: [{ description: 'fix it' }],
          planned_at: '2026-01-01T00:00:00Z',
          planned_by: 'test',
        },
      });
      await writeIssuesJsonl(jsonlPath, [issue]);

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].has_analysis).toBe(true);
      expect(parsed[0].has_solution).toBe(true);
    });

    it('includes execution status when present', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const issue = makeIssue({
        id: 'ISS-1',
        execution: { status: 'running' } as any,
      });
      await writeIssuesJsonl(jsonlPath, [issue]);

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].execution_status).toBe('running');
    });

    it('returns empty array when no issues exist', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('list_issues')!;

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });
  });

  describe('update_issue handler', () => {
    it('updates description field', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, [makeIssue({ id: 'ISS-upd-1', description: 'original' })]);

      const result = await handler({ issue_id: 'ISS-upd-1', description: 'updated text' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.updated).toBe('ISS-upd-1');

      const after = await readIssuesJsonl(jsonlPath);
      expect(after[0].description).toBe('updated text');
      expect(after[0].updated_at).toBeTruthy();
    });

    it('sets analysis fields with timestamps', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, [makeIssue({ id: 'ISS-ana-1' })]);

      const result = await handler({
        issue_id: 'ISS-ana-1',
        analysis: {
          root_cause: 'null pointer',
          impact: 'crash on load',
          related_files: ['src/main.ts'],
          confidence: 0.9,
          suggested_approach: 'add null check',
        },
      });
      expect(result.isError).toBeUndefined();

      const after = await readIssuesJsonl(jsonlPath);
      expect(after[0].analysis?.root_cause).toBe('null pointer');
      expect(after[0].analysis?.analyzed_at).toBeTruthy();
      expect(after[0].analysis?.analyzed_by).toBe('agent-sdk');
    });

    it('sets solution fields with timestamps', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, [makeIssue({ id: 'ISS-sol-1' })]);

      const result = await handler({
        issue_id: 'ISS-sol-1',
        solution: {
          steps: [
            { description: 'Add null check', target: 'src/main.ts', verification: 'test passes' },
          ],
          context: 'crash on startup',
        },
      });
      expect(result.isError).toBeUndefined();

      const after = await readIssuesJsonl(jsonlPath);
      expect(after[0].solution?.steps).toHaveLength(1);
      expect(after[0].solution?.planned_at).toBeTruthy();
      expect(after[0].solution?.planned_by).toBe('agent-sdk');
    });

    it('returns error when issue not found', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, []);

      const result = await handler({ issue_id: 'ISS-missing', description: 'test' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('ISS-missing');
    });

    it('updates multiple fields at once', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, [makeIssue({ id: 'ISS-multi' })]);

      await handler({
        issue_id: 'ISS-multi',
        description: 'new desc',
        analysis: {
          root_cause: 'rc',
          impact: 'imp',
          related_files: [],
          confidence: 0.5,
          suggested_approach: 'approach',
        },
        solution: {
          steps: [{ description: 'step 1' }],
        },
      });

      const after = await readIssuesJsonl(jsonlPath);
      expect(after[0].description).toBe('new desc');
      expect(after[0].analysis?.root_cause).toBe('rc');
      expect(after[0].solution?.steps).toHaveLength(1);
    });

    it('preserves other issues when updating one', async () => {
      createIssueMcpServer(tempDir);
      const handler = capturedTools.get('update_issue')!;

      await writeIssuesJsonl(jsonlPath, [
        makeIssue({ id: 'ISS-1', description: 'first' }),
        makeIssue({ id: 'ISS-2', description: 'second' }),
      ]);

      await handler({ issue_id: 'ISS-1', description: 'updated first' });

      const after = await readIssuesJsonl(jsonlPath);
      expect(after).toHaveLength(2);
      expect(after[0].description).toBe('updated first');
      expect(after[1].description).toBe('second');
    });
  });
});

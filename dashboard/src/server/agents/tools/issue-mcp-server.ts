// ---------------------------------------------------------------------------
// Issue MCP Server — SDK in-process MCP server for issue monitoring
// ---------------------------------------------------------------------------
// Provides get_issue, list_issues, update_issue tools to Agent SDK queries.
// Injected via options.mcpServers in agent-sdk-adapter and wave-executor.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { z } from 'zod';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

import {
  readIssuesJsonl,
  writeIssuesJsonl,
  withIssueWriteLock,
  resolveIssuesJsonlPath,
} from '../../utils/issue-store.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function buildTools(jsonlPath: string) {
  const getIssueTool = tool(
    'get_issue',
    'Get a single issue by ID. Returns the full issue JSON including analysis, solution, and execution state.',
    { issue_id: z.string().describe('The issue ID (e.g. ISS-xxx)') },
    async (args) => {
      const issues = await readIssuesJsonl(jsonlPath);
      const issue = issues.find((i) => i.id === args.issue_id);
      if (!issue) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Issue not found: ${args.issue_id}` }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(issue, null, 2) }] };
    },
  );

  const listIssuesTool = tool(
    'list_issues',
    'List issues with optional status and type filters. Returns summary array with id, title, status, type, priority.',
    {
      status: z.string().optional().describe('Filter by status: open|in_progress|resolved|closed'),
      type: z.string().optional().describe('Filter by type: bug|feature|improvement|task'),
    },
    async (args) => {
      let issues = await readIssuesJsonl(jsonlPath);
      if (args.status) {
        issues = issues.filter((i) => i.status === args.status);
      }
      if (args.type) {
        issues = issues.filter((i) => i.type === args.type);
      }
      const summaries = issues.map((i) => ({
        id: i.id,
        title: i.title,
        status: i.status,
        type: i.type,
        priority: i.priority,
        has_analysis: !!i.analysis,
        has_solution: !!i.solution,
        execution_status: i.execution?.status ?? 'none',
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] };
    },
  );

  const updateIssueTool = tool(
    'update_issue',
    'Update an issue. Can write description, analysis, and solution fields. Cannot modify status or execution (owned by ExecutionScheduler).',
    {
      issue_id: z.string().describe('The issue ID to update'),
      description: z.string().optional().describe('New description text'),
      analysis: z.object({
        root_cause: z.string(),
        impact: z.string(),
        related_files: z.array(z.string()),
        confidence: z.number(),
        suggested_approach: z.string(),
      }).optional().describe('Structured root cause analysis'),
      solution: z.object({
        steps: z.array(z.object({
          description: z.string(),
          target: z.string().optional(),
          verification: z.string().optional(),
        })),
        context: z.string().optional(),
      }).optional().describe('Solution plan with steps'),
    },
    async (args) => {
      const result = await withIssueWriteLock(async () => {
        const issues = await readIssuesJsonl(jsonlPath);
        const idx = issues.findIndex((i) => i.id === args.issue_id);
        if (idx === -1) {
          return { error: `Issue not found: ${args.issue_id}` };
        }

        const issue = issues[idx];

        if (args.description !== undefined) {
          issue.description = args.description;
        }
        if (args.analysis !== undefined) {
          issue.analysis = {
            ...args.analysis,
            analyzed_at: new Date().toISOString(),
            analyzed_by: 'agent-sdk',
          };
        }
        if (args.solution !== undefined) {
          issue.solution = {
            ...args.solution,
            planned_at: new Date().toISOString(),
            planned_by: 'agent-sdk',
          };
        }

        issue.updated_at = new Date().toISOString();
        issues[idx] = issue;
        await writeIssuesJsonl(jsonlPath, issues);
        return { updated: issue.id };
      });

      if ('error' in result) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  return [getIssueTool, listIssuesTool, updateIssueTool];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createIssueMcpServer(workflowRoot: string): Promise<McpSdkServerConfigWithInstance> {
  const jsonlPath = await resolveIssuesJsonlPath(workflowRoot);
  return createSdkMcpServer({
    name: 'issue-monitor',
    tools: buildTools(jsonlPath),
  });
}

// ---------------------------------------------------------------------------
// Linear API proxy routes -- fetches issues via Linear GraphQL API
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveIssuesJsonlPath } from '../utils/issue-store.js';
import type {
  LinearIssue,
  LinearWorkflowState,
  LinearLabel,
  LinearUser,
  LinearTeam,
  LinearBoardState,
  LinearKanbanColumn,
  LinearPriority,
} from '../../shared/linear-types.js';
import type { Issue, IssuePriority } from '../../shared/issue-types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// ---------------------------------------------------------------------------
// GraphQL queries
// ---------------------------------------------------------------------------

const TEAMS_QUERY = `
  query {
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`;

const BOARD_QUERY = `
  query TeamBoard($teamId: String!) {
    team(id: $teamId) {
      id
      name
      key
      states {
        nodes {
          id
          name
          type
          color
          position
        }
      }
      issues(first: 100, filter: { state: { type: { nin: ["canceled"] } } }) {
        nodes {
          id
          identifier
          title
          description
          priority
          priorityLabel
          url
          createdAt
          updatedAt
          state {
            id
            name
            type
            color
            position
          }
          assignee {
            id
            name
            displayName
            avatarUrl
          }
          labels {
            nodes {
              id
              name
              color
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return process.env.LINEAR_API_KEY ?? null;
}

async function linearFetch(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('LINEAR_API_KEY environment variable not set');

  const res = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

/** State type ordering for kanban columns */
const STATE_TYPE_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/** Map Linear priority → local priority */
const LINEAR_PRIORITY_MAP: Record<number, IssuePriority> = {
  0: 'medium',  // No priority
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

/** Map local priority → Linear priority number */
const LOCAL_PRIORITY_TO_LINEAR: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/** Map Linear state.type → local issue status */
function linearStateToLocalStatus(stateType: string): 'open' | 'in_progress' | 'resolved' | 'closed' {
  switch (stateType) {
    case 'completed': return 'resolved';
    case 'started': return 'in_progress';
    case 'canceled': return 'closed';
    default: return 'open';
  }
}

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
      }
    }
  }
`;

export function createLinearRoutes(workflowRoot?: string | (() => string)): Hono {
  const app = new Hono();
  const getRoot = () => typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;
  const getJsonlPath = async () => {
    const root = getRoot();
    return root ? resolveIssuesJsonlPath(root) : '';
  };

  // GET /api/linear/status -- check if API key is configured
  app.get('/api/linear/status', (c) => {
    const hasKey = !!getApiKey();
    return c.json({ configured: hasKey });
  });

  // GET /api/linear/teams -- list all teams
  app.get('/api/linear/teams', async (c) => {
    try {
      const data = await linearFetch(TEAMS_QUERY) as {
        teams: { nodes: LinearTeam[] };
      };
      return c.json(data.teams.nodes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/linear/board?teamId=xxx -- get kanban board for a team
  app.get('/api/linear/board', async (c) => {
    try {
      const teamId = c.req.query('teamId');
      if (!teamId) {
        return c.json({ error: 'Missing teamId query parameter' }, 400);
      }

      const data = await linearFetch(BOARD_QUERY, { teamId }) as {
        team: {
          id: string;
          name: string;
          key: string;
          states: {
            nodes: Array<{
              id: string;
              name: string;
              type: string;
              color: string;
              position: number;
            }>;
          };
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              description: string | null;
              priority: number;
              url: string;
              createdAt: string;
              updatedAt: string;
              state: {
                id: string;
                name: string;
                type: string;
                color: string;
                position: number;
              };
              assignee: {
                id: string;
                name: string;
                displayName: string;
                avatarUrl: string | null;
              } | null;
              labels: {
                nodes: Array<{
                  id: string;
                  name: string;
                  color: string;
                }>;
              };
            }>;
          };
        };
      };

      const team: LinearTeam = {
        id: data.team.id,
        name: data.team.name,
        key: data.team.key,
      };

      // Build workflow states sorted by type then position
      const states: LinearWorkflowState[] = data.team.states.nodes
        .sort((a, b) => {
          const typeOrder = (STATE_TYPE_ORDER[a.type] ?? 99) - (STATE_TYPE_ORDER[b.type] ?? 99);
          return typeOrder !== 0 ? typeOrder : a.position - b.position;
        });

      // Map issues
      const issues: LinearIssue[] = data.team.issues.nodes.map((n) => ({
        id: n.id,
        identifier: n.identifier,
        title: n.title,
        description: n.description,
        priority: n.priority as LinearIssue['priority'],
        state: n.state,
        assignee: n.assignee,
        labels: n.labels.nodes,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        url: n.url,
      }));

      // Group into columns
      const issuesByState = new Map<string, LinearIssue[]>();
      for (const state of states) {
        issuesByState.set(state.id, []);
      }
      for (const issue of issues) {
        const list = issuesByState.get(issue.state.id);
        if (list) list.push(issue);
        else issuesByState.set(issue.state.id, [issue]);
      }

      const columns: LinearKanbanColumn[] = states.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        color: s.color,
        issues: issuesByState.get(s.id) ?? [],
      }));

      const board: LinearBoardState = {
        team,
        columns,
        totalIssues: issues.length,
      };

      return c.json(board);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/linear/import -- import Linear issues → local issues.jsonl
  app.post('/api/linear/import', async (c) => {
    try {
      const jp = await getJsonlPath();
      if (!jp) {
        return c.json({ error: 'Workflow root not configured' }, 500);
      }

      const body = await c.req.json() as { issues: LinearIssue[] };
      if (!Array.isArray(body.issues) || body.issues.length === 0) {
        return c.json({ error: 'No issues provided' }, 400);
      }

      // Read existing issues to avoid duplicates
      let existing: Issue[] = [];
      try {
        const raw = await readFile(jp, 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            try { existing.push(JSON.parse(trimmed) as Issue); } catch { /* skip */ }
          }
        }
      } catch { /* file doesn't exist */ }

      const now = new Date().toISOString();
      const imported: Issue[] = [];
      const errors: string[] = [];

      for (const li of body.issues) {
        try {
          const issue: Issue = {
            id: `ISS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            title: `[${li.identifier}] ${li.title}`,
            description: li.description ?? '',
            type: 'task',
            priority: LINEAR_PRIORITY_MAP[li.priority] ?? 'medium',
            status: linearStateToLocalStatus(li.state.type),
            created_at: now,
            updated_at: now,
          };
          imported.push(issue);
        } catch (err) {
          errors.push(`${li.identifier}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (imported.length > 0) {
        await mkdir(dirname(jp), { recursive: true });
        const lines = imported.map((i) => JSON.stringify(i)).join('\n');
        let existingContent = '';
        try { existingContent = await readFile(jp, 'utf-8'); } catch { /* ok */ }
        const sep = existingContent.length > 0 && !existingContent.endsWith('\n') ? '\n' : '';
        await writeFile(jp, existingContent + sep + lines + '\n', 'utf-8');
      }

      return c.json({ imported: imported.length, errors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/linear/export -- export local issues → Linear via issueCreate mutation
  app.post('/api/linear/export', async (c) => {
    try {
      const body = await c.req.json() as { issues: Issue[]; teamId: string };
      if (!body.teamId) {
        return c.json({ error: 'Missing teamId' }, 400);
      }
      if (!Array.isArray(body.issues) || body.issues.length === 0) {
        return c.json({ error: 'No issues provided' }, 400);
      }

      let exported = 0;
      const errors: string[] = [];

      for (const issue of body.issues) {
        try {
          const input: Record<string, unknown> = {
            teamId: body.teamId,
            title: issue.title,
            description: issue.description || undefined,
            priority: LOCAL_PRIORITY_TO_LINEAR[issue.priority] ?? 3,
          };

          const data = await linearFetch(ISSUE_CREATE_MUTATION, { input }) as {
            issueCreate: { success: boolean; issue?: { identifier: string } };
          };

          if (data.issueCreate.success) {
            exported++;
          } else {
            errors.push(`${issue.title}: Create failed`);
          }
        } catch (err) {
          errors.push(`${issue.title}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return c.json({ exported, errors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

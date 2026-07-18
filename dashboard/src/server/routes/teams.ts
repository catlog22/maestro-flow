// ---------------------------------------------------------------------------
// Team Session REST API routes -- Run-scoped team state with legacy fallback
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, normalize, relative, sep } from 'node:path';

import { createDefaultDelegateBroker } from '../../../../src/async/delegate-broker.js';
import {
  getTeamSessionCleanupEligibility,
  rankResumeCandidates,
  type TeamSessionClassification,
} from '../../../../src/team/session-lifecycle.js';
import { readStoredTeamSessionClassificationAt } from '../../../../src/tools/team-msg.js';
import {
  findExactTeamWorkLocation,
  listTeamWorkLocations,
  type TeamWorkLocation,
} from '../../../../src/tools/team-run-paths.js';

import type {
  TeamSessionSummary,
  TeamSessionDetail,
  TeamMessage,
  PipelineNode,
  TeamRole,
  SessionFileEntry,
} from '../../shared/team-types.js';
import { inferSkill } from '../../shared/team-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readJsonlSafe(filePath: string): Record<string, unknown>[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function countLines(filePath: string): number {
  try {
    if (!existsSync(filePath)) return 0;
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return 0;
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

type TeamLocation = TeamWorkLocation;

const KNOWN_RUN_STATUSES = new Set([
  'created', 'running', 'blocked', 'completed', 'paused', 'sealed', 'archived', 'failed',
]);

function buildSummary(
  location: TeamLocation,
  classification: TeamSessionClassification,
): TeamSessionSummary | null {
  const sessionId = location.id;
  const sessionDir = location.stateDir;
  const sessionPath = join(sessionDir, 'team-session.json');
  const metaPath = join(sessionDir, '.msg', 'meta.json');
  const messagesPath = join(sessionDir, '.msg', 'messages.jsonl');

  const sessionData = readJsonSafe(sessionPath) ?? {};
  const meta = readJsonSafe(metaPath) ?? {};

  const messageCount = countLines(messagesPath);

  // Extract roles
  const roles: string[] = [];
  if (Array.isArray(sessionData.roles)) {
    for (const r of sessionData.roles) {
      if (typeof r === 'string') roles.push(r);
      else if (r && typeof r === 'object' && 'name' in (r as object)) roles.push((r as { name: string }).name);
    }
  } else if (Array.isArray(meta.roles)) {
    roles.push(...(meta.roles as string[]));
  }

  // Extract pipeline stages
  const pipelineStages: PipelineNode[] = [];
  const stages = (sessionData.pipeline_stages || meta.pipeline_stages) as string[] | undefined;
  if (Array.isArray(stages)) {
    stages.forEach((name, i) => {
      pipelineStages.push({ id: `stage-${i}`, name: String(name), status: 'pending' });
    });
  }

  // Timestamps
  const createdAt = (meta.created_at as string) || (sessionData.created_at as string) || '';
  const updatedAt = (meta.updated_at as string) || (sessionData.updated_at as string) || createdAt;

  // Duration
  let duration = '';
  if (createdAt) {
    const diffMs = (updatedAt ? new Date(updatedAt).getTime() : Date.now()) - new Date(createdAt).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) duration = `${mins}m`;
    else if (mins < 1440) duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
    else duration = `${Math.floor(mins / 1440)}d`;
  }

  // Task progress from role_state
  let completed = 0;
  let total = 0;
  if (meta.role_state && typeof meta.role_state === 'object') {
    for (const rs of Object.values(meta.role_state as Record<string, Record<string, unknown>>)) {
      if (rs.status === 'done') completed++;
      total++;
    }
  }

  return {
    sessionId,
    title: (sessionData.task_description as string) || (sessionData.team_name as string) || (meta.team_name as string) || sessionId,
    description: (sessionData.task_description as string) || '',
    status: classification.lifecycle,
    health: classification.health,
    cleanupEligible: classification.cleanupEligible,
    skill: inferSkill(sessionId),
    roles,
    taskProgress: { completed, total },
    messageCount,
    duration,
    createdAt,
    updatedAt,
    pipelineStages,
  };
}

function scanSessionFiles(location: TeamLocation): SessionFileEntry[] {
  const files: SessionFileEntry[] = [];
  let fileIdx = 0;

  const categoryDirs: { dirPath: string; displayPath: string; category: SessionFileEntry['category'] }[] = [
    ...(location.scope === 'legacy'
      ? [{ dirPath: join(location.stateDir, 'artifacts'), displayPath: 'artifacts', category: 'artifacts' as const }]
      : [{ dirPath: join(location.rootDir, 'outputs'), displayPath: 'outputs', category: 'artifacts' as const }]),
    {
      dirPath: join(location.stateDir, 'wisdom'),
      displayPath: location.scope === 'legacy' ? 'wisdom' : 'work/team/wisdom',
      category: 'wisdom',
    },
    {
      dirPath: join(location.stateDir, 'role-specs'),
      displayPath: location.scope === 'legacy' ? 'role-specs' : 'work/team/role-specs',
      category: 'role-specs',
    },
  ];

  for (const { dirPath, displayPath, category } of categoryDirs) {
    try {
      if (!existsSync(dirPath)) continue;
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        files.push({
          id: `file-${fileIdx++}`,
          path: `${displayPath}/${entry.name}`,
          name: entry.name,
          category,
        });
      }
    } catch {
      // skip unreadable directories
    }
  }

  // Add session-level files
  const sessionFiles = ['team-session.json', 'shared-memory.json'];
  for (const name of sessionFiles) {
    if (existsSync(join(location.stateDir, name))) {
      files.push({
        id: `file-${fileIdx++}`,
        path: location.scope === 'legacy' ? name : `work/team/${name}`,
        name,
        category: 'session',
      });
    }
  }

  // Add message bus files
  const msgDir = join(location.stateDir, '.msg');
  if (existsSync(msgDir)) {
    try {
      const msgEntries = readdirSync(msgDir, { withFileTypes: true });
      for (const entry of msgEntries) {
        if (!entry.isFile()) continue;
        files.push({
          id: `file-${fileIdx++}`,
          path: location.scope === 'legacy' ? `.msg/${entry.name}` : `work/team/.msg/${entry.name}`,
          name: entry.name,
          category: 'message-bus',
        });
      }
    } catch {
      // skip
    }
  }

  return files;
}

function buildRoleDetails(sessionData: Record<string, unknown>, meta: Record<string, unknown>): TeamRole[] {
  const roleDetails: TeamRole[] = [];
  const roleState = (meta.role_state || {}) as Record<string, Record<string, unknown>>;

  // Get role names from session data or meta
  const roleNames: string[] = [];
  if (Array.isArray(sessionData.roles)) {
    for (const r of sessionData.roles) {
      if (typeof r === 'string') roleNames.push(r);
      else if (r && typeof r === 'object' && 'name' in (r as object)) roleNames.push((r as { name: string }).name);
    }
  } else if (Array.isArray(meta.roles)) {
    roleNames.push(...(meta.roles as string[]));
  } else {
    roleNames.push(...Object.keys(roleState));
  }

  for (const name of roleNames) {
    const rs = roleState[name] || {};
    const statusVal = (rs.status as string) || 'pending';
    roleDetails.push({
      name,
      prefix: name.substring(0, 3).toUpperCase(),
      status: (['done', 'active', 'pending', 'injected'].includes(statusVal) ? statusVal : 'pending') as TeamRole['status'],
      taskCount: typeof rs.task_count === 'number' ? rs.task_count : 0,
      innerLoop: rs.inner_loop === true,
      injected: rs.injected === true,
      injectionReason: typeof rs.injection_reason === 'string' ? rs.injection_reason : undefined,
    });
  }

  return roleDetails;
}

function buildPipelineWaves(sessionData: Record<string, unknown>, meta: Record<string, unknown>): { waves: { number: number; nodes: PipelineNode[] }[] } {
  const waves: { number: number; nodes: PipelineNode[] }[] = [];
  const stages = (sessionData.pipeline_stages || meta.pipeline_stages) as string[] | undefined;

  if (Array.isArray(stages)) {
    // Group into a single wave if no wave info available
    const nodes: PipelineNode[] = stages.map((name, i) => ({
      id: `stage-${i}`,
      name: String(name),
      status: 'pending' as PipelineNode['status'],
      wave: 0,
    }));
    waves.push({ number: 0, nodes });
  }

  return { waves };
}

export interface TeamRouteLifecycleOptions {
  now?: () => string | number | Date;
  staleTtlMs?: number;
  inspectLiveBrokerMembers?: (location: TeamLocation) => { count: number; known: boolean };
}

function inspectLiveBrokerMembers(location: TeamLocation): { count: number; known: boolean } {
  const membersPath = join(location.stateDir, 'members.json');
  if (!existsSync(membersPath)) return { count: 0, known: true };
  const members = readJsonSafe(membersPath);
  if (!members) return { count: 0, known: false };
  if (!Array.isArray(members.members)) return { count: 0, known: false };

  try {
    const broker = createDefaultDelegateBroker();
    let count = 0;
    for (const member of members.members) {
      if (!member || typeof member !== 'object') continue;
      const jobId = (member as Record<string, unknown>).job_id;
      if (typeof jobId !== 'string') continue;
      const job = broker.getJob(jobId);
      if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) continue;
      if (job.metadata?.cancelRequestedAt) continue;
      if (['queued', 'running', 'input_required'].includes(job.status)) count += 1;
    }
    return { count, known: true };
  } catch {
    return { count: 0, known: false };
  }
}

function classifyLocation(
  location: TeamLocation,
  options: TeamRouteLifecycleOptions,
): TeamSessionClassification {
  const broker = (options.inspectLiveBrokerMembers ?? inspectLiveBrokerMembers)(location);
  return readStoredTeamSessionClassificationAt(
    {
      stateDir: location.stateDir,
      ...(location.scope === 'run' ? { runRootDir: location.rootDir } : {}),
    },
    {
      now: options.now?.() ?? new Date(),
      staleTtlMs: options.staleTtlMs ?? 24 * 60 * 60 * 1_000,
      liveBrokerMembers: broker.count,
      livenessKnown: broker.known,
    },
  );
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function exactLocation(workflowRoot: string, id: string): TeamLocation | null {
  return findExactTeamWorkLocation(id, workflowRoot);
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createTeamRoutes(
  workflowRoot: string | (() => string),
  lifecycleOptions: TeamRouteLifecycleOptions = {},
): Hono {
  const app = new Hono();
  const getWorkflowRoot = () => typeof workflowRoot === 'function' ? workflowRoot() : workflowRoot;

  // GET /api/teams/sessions
  app.get('/api/teams/sessions', async (c) => {
    try {
      let summaries: TeamSessionSummary[] = [];

      for (const location of listTeamWorkLocations(getWorkflowRoot())) {
        const summary = buildSummary(location, classifyLocation(location, lifecycleOptions));
        if (summary) summaries.push(summary);
      }

      // Sort by updatedAt descending
      summaries.sort((a, b) => {
        if (!a.updatedAt && !b.updatedAt) return 0;
        if (!a.updatedAt) return 1;
        if (!b.updatedAt) return -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      // Apply filters
      const statusFilter = c.req.query('status');
      if (statusFilter) {
        summaries = summaries.filter((s) => s.status === statusFilter);
      }

      const skillFilter = c.req.query('skill');
      if (skillFilter) {
        summaries = summaries.filter((s) => s.skill === skillFilter);
      }

      return c.json(summaries);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/teams/resume-candidates -- ranking never implies selection.
  app.get('/api/teams/resume-candidates', async (c) => {
    try {
      const locations = listTeamWorkLocations(getWorkflowRoot());
      const ranking = rankResumeCandidates(
        locations.map((location) => ({
          sessionId: location.sessionId ?? location.id,
          ...(location.runId ? { runId: location.runId } : {}),
          runDir: location.rootDir,
          classification: classifyLocation(location, lifecycleOptions),
        })),
        {
          ...(c.req.query('run_id') ? { runId: c.req.query('run_id') } : {}),
          ...(c.req.query('session_id') ? { sessionId: c.req.query('session_id') } : {}),
          ...(c.req.query('run_dir') ? { runDir: c.req.query('run_dir') } : {}),
        },
      );

      return c.json({
        ...ranking,
        selected: ranking.selected ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/teams/sessions/:sessionId
  app.get('/api/teams/sessions/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const location = exactLocation(getWorkflowRoot(), sessionId);

      if (!location) {
        return c.json({ error: `Session not found: ${sessionId}` }, 404);
      }

      const summary = buildSummary(location, classifyLocation(location, lifecycleOptions));
      if (!summary) {
        return c.json({ error: `Failed to read session: ${sessionId}` }, 500);
      }

      const sessionData = readJsonSafe(join(location.stateDir, 'team-session.json')) ?? {};
      const meta = readJsonSafe(join(location.stateDir, '.msg', 'meta.json')) ?? {};

      // Read last 50 messages
      const allMessages = readJsonlSafe(join(location.stateDir, '.msg', 'messages.jsonl')) as unknown as TeamMessage[];
      const messages = allMessages.slice(-50);

      const roleDetails = buildRoleDetails(sessionData, meta);
      const pipeline = buildPipelineWaves(sessionData, meta);
      const files = scanSessionFiles(location);

      const detail: TeamSessionDetail = {
        ...summary,
        roleDetails,
        messages,
        files,
        pipeline,
      };

      return c.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/teams/sessions/:sessionId/abandon -- audited transition only.
  app.post('/api/teams/sessions/:sessionId/abandon', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const location = exactLocation(getWorkflowRoot(), sessionId);
      if (!location) return c.json({ error: `Session not found: ${sessionId}` }, 404);

      const classification = classifyLocation(location, lifecycleOptions);
      const run = location.scope === 'run' ? readJsonSafe(join(location.rootDir, 'run.json')) : null;
      const runStatus = typeof run?.status === 'string' ? run.status : null;
      const canonicalRunChecked = location.scope === 'legacy' || (runStatus !== null && KNOWN_RUN_STATUSES.has(runStatus));
      const eligible =
        canonicalRunChecked &&
        (classification.lifecycle === 'active' || classification.lifecycle === 'paused') &&
        classification.health === 'stale_candidate' &&
        !classification.live;
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const confirm = body.confirm === true;

      if (!confirm) {
        return c.json({
          ok: false,
          dryRun: true,
          eligible,
          classification,
          checks: { canonicalRunChecked, runStatus, live: classification.live },
        });
      }
      if (!eligible) {
        return c.json({
          error: 'Abandon transition refused by lifecycle checks',
          classification,
          checks: { canonicalRunChecked, runStatus, live: classification.live },
        }, 409);
      }

      const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!actor || !reason) {
        return c.json({ error: 'Confirmed abandon requires non-empty actor and reason' }, 400);
      }

      const now = lifecycleOptions.now?.() ?? new Date();
      const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
      const audit = { audited: true, actor, reason, at };
      const sessionPath = join(location.stateDir, 'team-session.json');
      const session = readJsonSafe(sessionPath) ?? {};
      writeFileSync(sessionPath, JSON.stringify({
        ...session,
        status: 'abandoned',
        updated_at: at,
        abandonment_transition: audit,
      }, null, 2), 'utf-8');

      const metaDir = join(location.stateDir, '.msg');
      mkdirSync(metaDir, { recursive: true });
      const metaPath = join(metaDir, 'meta.json');
      const meta = readJsonSafe(metaPath) ?? {};
      writeFileSync(metaPath, JSON.stringify({
        ...meta,
        status: 'abandoned',
        updated_at: at,
      }, null, 2), 'utf-8');

      return c.json({
        ok: true,
        transition: 'abandoned',
        audit,
        cleanupPerformed: false,
        classification: classifyLocation(location, lifecycleOptions),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // DELETE /api/teams/sessions/:sessionId -- dry-run by default, second confirmation required.
  app.delete('/api/teams/sessions/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const location = exactLocation(getWorkflowRoot(), sessionId);

      if (!location) {
        return c.json({ error: `Session not found: ${sessionId}` }, 404);
      }

      const classification = classifyLocation(location, lifecycleOptions);
      const force = c.req.query('force') === 'true';
      const cleanup = getTeamSessionCleanupEligibility(classification, { force });
      const confirm = c.req.query('confirm') === 'true';
      if (!confirm) {
        return c.json({ ok: false, dryRun: true, ...cleanup, classification });
      }
      if (!cleanup.eligible) {
        return c.json({ error: cleanup.reason, classification }, 409);
      }

      // Team cleanup removes only stateDir. Run authority and outputs are outside it.
      if (!isPathInside(getWorkflowRoot(), location.stateDir)) {
        return c.json({ error: 'Access denied: path traversal detected' }, 403);
      }
      if (location.scope === 'run' && resolve(location.stateDir) !== resolve(location.rootDir, 'work', 'team')) {
        return c.json({ error: 'Access denied: invalid canonical team state path' }, 403);
      }

      rmSync(location.stateDir, { recursive: true, force: true });
      return c.json({ ok: true, deleted: location.stateDir, preservedRunRoot: location.scope === 'run' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/teams/sessions/:sessionId/messages
  app.get('/api/teams/sessions/:sessionId/messages', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const location = exactLocation(getWorkflowRoot(), sessionId);

      if (!location) {
        return c.json({ error: `Session not found: ${sessionId}` }, 404);
      }

      const messagesPath = join(location.stateDir, '.msg', 'messages.jsonl');
      let messages = readJsonlSafe(messagesPath) as unknown as TeamMessage[];

      // Apply filters
      const fromFilter = c.req.query('from');
      if (fromFilter) {
        messages = messages.filter((m) => m.from === fromFilter);
      }

      const typeFilter = c.req.query('type');
      if (typeFilter) {
        messages = messages.filter((m) => m.type === typeFilter);
      }

      // Slice to last N
      const last = parseInt(c.req.query('last') || '50', 10);
      const limit = isNaN(last) || last <= 0 ? 50 : last;
      messages = messages.slice(-limit);

      return c.json(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/teams/sessions/:sessionId/files/*
  app.get('/api/teams/sessions/:sessionId/files/*', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const location = exactLocation(getWorkflowRoot(), sessionId);

      if (!location) {
        return c.json({ error: `Session not found: ${sessionId}` }, 404);
      }

      // Extract wildcard path
      const url = new URL(c.req.url);
      const prefix = `/api/teams/sessions/${sessionId}/files/`;
      const filePath = decodeURIComponent(url.pathname.slice(prefix.length));

      if (!filePath) {
        return c.json({ error: 'File path required' }, 400);
      }

      // Security: resolve and validate path stays within session directory
      const resolvedSession = resolve(location.rootDir);
      const resolvedFile = resolve(location.rootDir, filePath);
      const normalizedFile = normalize(resolvedFile);

      if (!isPathInside(resolvedSession, normalizedFile)) {
        return c.json({ error: 'Access denied: path traversal detected' }, 403);
      }

      if (!existsSync(resolvedFile) || !statSync(resolvedFile).isFile()) {
        return c.json({ error: `File not found: ${filePath}` }, 404);
      }

      const content = readFileSync(resolvedFile, 'utf-8');

      // Return based on file extension
      if (filePath.endsWith('.json')) {
        try {
          return c.json(JSON.parse(content));
        } catch {
          return c.text(content);
        }
      }

      if (filePath.endsWith('.jsonl')) {
        try {
          const lines = content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
          return c.json(lines);
        } catch {
          return c.text(content);
        }
      }

      // Text files (.md, .txt, etc.)
      return c.text(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

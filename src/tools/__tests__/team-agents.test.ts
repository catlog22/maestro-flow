import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handler } from '../team-agents.js';
import type { TeamMember } from '../team-agents.js';
import { runWithRepositoryExecution } from '../../repository/context.js';
import type { AgentRepositoryBinding, AgentRepositoryContext } from '../../../shared/agent-types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;
let uid = 0;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'team-agents-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;
  uid++;
}

/** Generate a unique session ID to avoid collisions with the global broker DB. */
function sid(label: string): string {
  return `${label}-${uid}-${process.pid}`;
}

function teardown(): void {
  if (prevRoot === undefined) {
    delete process.env.MAESTRO_PROJECT_ROOT;
  } else {
    process.env.MAESTRO_PROJECT_ROOT = prevRoot;
  }
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team-agents', () => {
  beforeEach(setup);
  afterEach(teardown);

  // --- Parameter validation ---

  describe('parameter validation', () => {
    it('rejects missing session_id', async () => {
      const result = await handler({ operation: 'members' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('session_id');
    });

    it('rejects invalid operation', async () => {
      const result = await handler({ operation: 'bogus', session_id: 's1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid params');
    });

    it('spawn_agent requires role', async () => {
      const result = await handler({ operation: 'spawn_agent', session_id: 's1', prompt: 'do work' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('role');
    });

    it('spawn_agent requires prompt', async () => {
      const result = await handler({ operation: 'spawn_agent', session_id: 's1', role: 'worker' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt');
    });

    it('shutdown_agent requires role', async () => {
      const result = await handler({ operation: 'shutdown_agent', session_id: 's1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('role');
    });

    it('remove_agent requires role', async () => {
      const result = await handler({ operation: 'remove_agent', session_id: 's1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('role');
    });
  });

  // --- spawn_agent ---

  describe('spawn_agent', () => {
    it('creates a delegate job and returns job_id, exec_id, role', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Analyze the codebase',
        tool: 'qwen',
      });

      expect(result.success).toBe(true);
      const data = result.result as { job_id: string; exec_id: string; role: string; tool: string };
      expect(data.job_id).toBe(`${sessionId}-worker-1`);
      expect(data.exec_id).toMatch(/^agent-\d+$/);
      expect(data.role).toBe('worker-1');
      expect(data.tool).toBe('qwen');
    });

    it('persists member to members.json', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do things',
      });

      const membersPath = join(tmpDir, '.workflow', '.team', sessionId, 'members.json');
      expect(existsSync(membersPath)).toBe(true);

      const raw = JSON.parse(readFileSync(membersPath, 'utf-8'));
      expect(raw.members).toHaveLength(1);
      expect(raw.members[0].role).toBe('worker-1');
      expect(raw.members[0].job_id).toBe(`${sessionId}-worker-1`);
    });

    it('defaults tool to "gemini"', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-2',
        prompt: 'Do things',
      });

      const data = result.result as { tool: string };
      expect(data.tool).toBe('gemini');
    });

    it('rejects duplicate role in same session', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do things',
      });

      const result = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do other things',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('allows same role in different sessions', async () => {
      const r1 = await handler({
        operation: 'spawn_agent',
        session_id: sid('session-a'),
        role: 'worker',
        prompt: 'Work A',
      });
      const r2 = await handler({
        operation: 'spawn_agent',
        session_id: sid('session-b'),
        role: 'worker',
        prompt: 'Work B',
      });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  // --- shutdown_agent ---

  describe('shutdown_agent', () => {
    it('requests cancel for a running agent', async () => {
      const sessionId = sid('test-session');
      // Spawn first
      const spawnResult = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
      });
      const spawnData = spawnResult.result as { job_id: string };

      const result = await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'worker-1',
      });

      expect(result.success).toBe(true);
      const data = result.result as { job_id: string; role: string; status: string };
      expect(data.job_id).toBe(spawnData.job_id);
      expect(data.role).toBe('worker-1');
      expect(data.status).toBe('cancelling');
    });

    it('returns error for non-existent role', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'ghost',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns success for already-cancelled job', async () => {
      const sessionId = sid('test-session');
      // Spawn and then immediately cancel
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
      });
      await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'worker-1',
      });

      // Second shutdown should report pending cancel request
      const result = await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'worker-1',
      });

      expect(result.success).toBe(true);
      const data = result.result as { message: string };
      expect(data.message).toContain('pending cancel request');
    });
  });

  // --- remove_agent ---

  describe('remove_agent', () => {
    it('removes agent from members.json', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
      });
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-2',
        prompt: 'More work',
      });

      const result = await handler({
        operation: 'remove_agent',
        session_id: sessionId,
        role: 'worker-1',
      });

      expect(result.success).toBe(true);
      const data = result.result as { role: string };
      expect(data.role).toBe('worker-1');

      // Verify only worker-2 remains
      const membersResult = await handler({
        operation: 'members',
        session_id: sessionId,
      });
      const membersData = membersResult.result as { members: { role: string }[] };
      expect(membersData.members).toHaveLength(1);
      expect(membersData.members[0].role).toBe('worker-2');
    });

    it('returns error for non-existent role', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'remove_agent',
        session_id: sessionId,
        role: 'ghost',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // --- members ---

  describe('members', () => {
    it('returns empty list for session with no agents', async () => {
      const result = await handler({
        operation: 'members',
        session_id: sid('empty-session'),
      });

      expect(result.success).toBe(true);
      const data = result.result as { members: unknown[]; total: number };
      expect(data.members).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    it('lists agents with status from broker', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
        tool: 'codex',
      });

      const result = await handler({
        operation: 'members',
        session_id: sessionId,
      });

      expect(result.success).toBe(true);
      const data = result.result as {
        members: { role: string; status: string; tool: string; job_id: string }[];
        total: number;
        formatted: string;
      };

      expect(data.total).toBe(1);
      expect(data.members[0].role).toBe('worker-1');
      expect(data.members[0].tool).toBe('codex');
      // After spawn, broker has a 'queued' event which maps to 'running' status
      expect(data.members[0].status).toBe('running');
      expect(data.formatted).toContain('worker-1');
    });

    it('reports idle status after shutdown', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
      });
      await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'worker-1',
      });

      const result = await handler({
        operation: 'members',
        session_id: sessionId,
      });

      const data = result.result as { members: { role: string; status: string }[] };
      expect(data.members[0].status).toBe('idle');
    });

    it('returns formatted output', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Do work',
      });

      const result = await handler({
        operation: 'members',
        session_id: sessionId,
      });

      const data = result.result as { formatted: string };
      expect(data.formatted).toContain('worker-1');
      expect(data.formatted).toContain('status');
    });
  });

  // --- Session isolation ---

  describe('session isolation', () => {
    it('agents are isolated per session', async () => {
      const sidA = sid('session-a');
      const sidB = sid('session-b');
      await handler({
        operation: 'spawn_agent',
        session_id: sidA,
        role: 'worker',
        prompt: 'Work A',
      });
      await handler({
        operation: 'spawn_agent',
        session_id: sidB,
        role: 'worker',
        prompt: 'Work B',
      });

      const resultA = await handler({
        operation: 'members',
        session_id: sidA,
      });
      const resultB = await handler({
        operation: 'members',
        session_id: sidB,
      });

      const dataA = resultA.result as { members: { role: string; job_id: string }[] };
      const dataB = resultB.result as { members: { role: string; job_id: string }[] };

      expect(dataA.members).toHaveLength(1);
      expect(dataB.members).toHaveLength(1);
      expect(dataA.members[0].job_id).toContain(sidA);
      expect(dataB.members[0].job_id).toContain(sidB);
    });
  });

  // --- Deterministic job IDs ---

  describe('deterministic job IDs', () => {
    it('derives job_id from session_id and role', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'analyzer',
        prompt: 'Analyze things',
      });

      expect(result.success).toBe(true);
      const data = result.result as { job_id: string };
      expect(data.job_id).toBe(`${sessionId}-analyzer`);
    });
  });

  // --- spawn_agent edge cases ---

  describe('spawn_agent edge cases', () => {
    it('generates exec_id with agent- prefix', async () => {
      const sessionId = sid('test-session');
      const result = await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker',
        prompt: 'Do things',
      });

      const data = result.result as { exec_id: string };
      expect(data.exec_id).toMatch(/^agent-\d+$/);
    });

    it('stores prompt in members.json', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker',
        prompt: 'Analyze the codebase thoroughly',
      });

      const membersPath = join(tmpDir, '.workflow', '.team', sessionId, 'members.json');
      const raw = JSON.parse(readFileSync(membersPath, 'utf-8'));
      expect(raw.members[0].prompt).toBe('Analyze the codebase thoroughly');
    });

    it('stores spawned_at timestamp', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker',
        prompt: 'Do things',
      });

      const membersPath = join(tmpDir, '.workflow', '.team', sessionId, 'members.json');
      const raw = JSON.parse(readFileSync(membersPath, 'utf-8'));
      expect(raw.members[0].spawned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('inherits the host-owned actor repository context', async () => {
      const sessionId = sid('bound-session');
      const actor: AgentRepositoryContext = {
        currentRepoId: '11111111-1111-4111-8111-111111111111',
        currentRepoName: 'bound-repo',
        currentProjectRoot: tmpDir,
        identityPersisted: true,
        linkedRepositories: [],
      };
      const target: AgentRepositoryBinding = {
        repoId: actor.currentRepoId,
        repoName: actor.currentRepoName,
        projectRoot: actor.currentProjectRoot,
        relation: 'current',
        alias: 'current',
        identityPersisted: true,
        readCapabilities: [],
        writeCapabilities: [],
      };

      await runWithRepositoryExecution(actor, target, () => handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'bound-worker',
        prompt: 'Ignore any fake repository ID and inherit the host binding',
      }));

      const membersPath = join(tmpDir, '.workflow', '.team', sessionId, 'members.json');
      const raw = JSON.parse(readFileSync(membersPath, 'utf-8'));
      expect(raw.members[0].repository_context.currentRepoId).toBe(actor.currentRepoId);
      expect(raw.members[0].repository_context.currentProjectRoot).toBe(tmpDir);
    });
  });

  // --- shutdown_agent edge cases ---

  describe('shutdown_agent edge cases', () => {
    it('handles terminal job status gracefully', async () => {
      const sessionId = sid('test-session');
      // Spawn and then cancel the agent
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker',
        prompt: 'Do work',
      });

      // First shutdown request
      const result1 = await handler({
        operation: 'shutdown_agent',
        session_id: sessionId,
        role: 'worker',
      });
      expect(result1.success).toBe(true);
    });
  });

  // --- remove_agent edge cases ---

  describe('remove_agent edge cases', () => {
    it('preserves remaining members after remove', async () => {
      const sessionId = sid('test-session');
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-1',
        prompt: 'Work 1',
      });
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-2',
        prompt: 'Work 2',
      });
      await handler({
        operation: 'spawn_agent',
        session_id: sessionId,
        role: 'worker-3',
        prompt: 'Work 3',
      });

      await handler({
        operation: 'remove_agent',
        session_id: sessionId,
        role: 'worker-2',
      });

      const membersResult = await handler({
        operation: 'members',
        session_id: sessionId,
      });
      const data = membersResult.result as { members: { role: string }[]; total: number };
      expect(data.total).toBe(2);
      const roles = data.members.map(m => m.role);
      expect(roles).toContain('worker-1');
      expect(roles).toContain('worker-3');
      expect(roles).not.toContain('worker-2');
    });
  });

  // --- Schema export ---

  describe('schema export', () => {
    it('exports correct tool name', async () => {
      const { schema } = await import('../team-agents.js');
      expect(schema.name).toBe('team_agent');
    });

    it('has required fields in inputSchema', async () => {
      const { schema } = await import('../team-agents.js');
      expect(schema.inputSchema.required).toContain('operation');
      expect(schema.inputSchema.required).toContain('session_id');
    });

    it('lists all four operations', async () => {
      const { schema } = await import('../team-agents.js');
      const props = schema.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(props.operation.enum).toContain('spawn_agent');
      expect(props.operation.enum).toContain('shutdown_agent');
      expect(props.operation.enum).toContain('remove_agent');
      expect(props.operation.enum).toContain('members');
    });
  });
});

/**
 * L2 Integration Tests — Cross-module interactions for team communication architecture
 *
 * Tests real module interactions (not mocked) across:
 * - team-msg dispatch → team-mailbox read flow
 * - team-agents → delegate broker lifecycle
 * - MCP tool registration chain (index.ts)
 * - Type consistency across shared boundaries
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- Direct imports to test cross-module interaction ---
import { handler as msgHandler, readAllMessages } from '../team-msg.js';
import type { TeamMessage, DispatchStatus } from '../team-msg.js';
import { handler as mailboxHandler } from '../team-mailbox.js';
import type { MailboxMessage } from '../team-mailbox.js';
import { handler as agentsHandler } from '../team-agents.js';
import type { TeamMember } from '../team-agents.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;
let uid = 0;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'team-integration-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;
  uid++;
}

function sid(label: string): string {
  return `integ-${label}-${uid}-${process.pid}`;
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
// 1. team-msg dispatch → team-mailbox read flow
// ---------------------------------------------------------------------------

describe('L2: team-msg <-> team-mailbox cross-module', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('messages logged via team-msg with delivery_method are visible to mailbox read', async () => {
    const session = sid('msg-mbx');

    // Log a message via team-msg (dispatch lifecycle: pending)
    const logResult = await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'analyst',
      to: 'executor',
      summary: 'Analysis complete',
      type: 'state_update',
      delivery_method: 'inject',
    });
    expect(logResult.success).toBe(true);

    // Verify dispatch_status is 'pending' via team-msg readAllMessages
    const msgs = readAllMessages(session);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].dispatch_status).toBe('pending');
    expect(msgs[0].delivery_method).toBe('inject');

    // Read via team-msg's read_mailbox operation - should find the pending message
    const readResult = await msgHandler({
      operation: 'read_mailbox',
      session_id: session,
      role: 'executor',
    });
    expect(readResult.success).toBe(true);
    const readData = readResult.result as { count: number; messages: TeamMessage[] };
    expect(readData.count).toBe(1);
    expect(readData.messages[0].from).toBe('analyst');

    // After read_mailbox, the message should be marked 'delivered'
    const afterMsgs = readAllMessages(session);
    expect(afterMsgs[0].dispatch_status).toBe('delivered');
    expect(afterMsgs[0].delivered_at).toBeDefined();
  });

  it('team-msg legacy messages (no delivery_method) are NOT picked up by read_mailbox', async () => {
    const session = sid('legacy');

    // Log a legacy message (no delivery_method → auto 'delivered')
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'coordinator',
      to: 'worker',
      summary: 'Legacy message',
    });

    // read_mailbox should find no unread messages
    const readResult = await msgHandler({
      operation: 'read_mailbox',
      session_id: session,
      role: 'worker',
    });
    const readData = readResult.result as { count: number };
    expect(readData.count).toBe(0);
  });

  it('mailbox_status reflects dispatch state transitions correctly', async () => {
    const session = sid('status');

    // Log 2 pending messages to different roles
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'coordinator',
      to: 'analyst',
      delivery_method: 'inject',
    });
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'coordinator',
      to: 'executor',
      delivery_method: 'inject',
    });
    // Log 1 legacy (delivered) message
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'coordinator',
      to: 'analyst',
    });

    // Check mailbox_status before any reads
    const beforeStatus = await msgHandler({
      operation: 'mailbox_status',
      session_id: session,
    });
    const beforeData = beforeStatus.result as {
      roles: Record<string, Record<DispatchStatus, number>>;
      total_messages: number;
    };
    expect(beforeData.total_messages).toBe(3);
    expect(beforeData.roles['analyst'].pending).toBe(1);
    expect(beforeData.roles['analyst'].delivered).toBe(1);
    expect(beforeData.roles['executor'].pending).toBe(1);

    // Read analyst's mailbox (marks pending → delivered)
    await msgHandler({
      operation: 'read_mailbox',
      session_id: session,
      role: 'analyst',
    });

    // Check mailbox_status after read
    const afterStatus = await msgHandler({
      operation: 'mailbox_status',
      session_id: session,
    });
    const afterData = afterStatus.result as {
      roles: Record<string, Record<DispatchStatus, number>>;
    };
    expect(afterData.roles['analyst'].pending).toBe(0);
    expect(afterData.roles['analyst'].delivered).toBe(2);
    // executor still pending
    expect(afterData.roles['executor'].pending).toBe(1);
  });

  it('team-msg and team-mailbox use separate storage files', async () => {
    const session = sid('storage');

    // Send via team-mailbox
    await mailboxHandler({
      operation: 'send',
      session_id: session,
      from: 'alice',
      to: 'bob',
      message: 'Hello from mailbox',
    });

    // Log via team-msg
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'alice',
      to: 'bob',
      summary: 'Hello from msg bus',
    });

    // Verify separate files
    const msgPath = join(tmpDir, '.workflow', '.team', session, '.msg', 'messages.jsonl');
    const mbxPath = join(tmpDir, '.workflow', '.team', session, '.msg', 'mailbox.jsonl');
    expect(existsSync(msgPath)).toBe(true);
    expect(existsSync(mbxPath)).toBe(true);

    // Verify each has exactly 1 message
    const msgContent = readFileSync(msgPath, 'utf-8').trim().split('\n');
    const mbxContent = readFileSync(mbxPath, 'utf-8').trim().split('\n');
    expect(msgContent).toHaveLength(1);
    expect(mbxContent).toHaveLength(1);

    // Verify ID prefixes differ
    const msgMsg = JSON.parse(msgContent[0]);
    const mbxMsg = JSON.parse(mbxContent[0]);
    expect(msgMsg.id).toMatch(/^MSG-/);
    expect(mbxMsg.id).toMatch(/^MBX-/);
  });
});

// ---------------------------------------------------------------------------
// 2. team-agents → delegate broker lifecycle
// ---------------------------------------------------------------------------

describe('L2: team-agents <-> delegate broker lifecycle', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('spawn_agent creates deterministic job ID from session + role', async () => {
    const session = sid('agent-lifecycle');
    const result = await agentsHandler({
      operation: 'spawn_agent',
      session_id: session,
      role: 'researcher',
      prompt: 'Research the codebase',
    });

    expect(result.success).toBe(true);
    const data = result.result as { job_id: string; exec_id: string; role: string };
    expect(data.job_id).toBe(`${session}-researcher`);
    expect(data.exec_id).toMatch(/^agent-\d+$/);
  });

  it('full agent lifecycle: spawn → members → shutdown → members', async () => {
    const session = sid('full-lifecycle');

    // Spawn an agent
    const spawnResult = await agentsHandler({
      operation: 'spawn_agent',
      session_id: session,
      role: 'worker',
      prompt: 'Do some work',
      tool: 'codex',
    });
    expect(spawnResult.success).toBe(true);

    // Check members - should show 'running' status
    const membersResult = await agentsHandler({
      operation: 'members',
      session_id: session,
    });
    const membersData = membersResult.result as {
      members: { role: string; status: string; tool: string }[];
      total: number;
    };
    expect(membersData.total).toBe(1);
    expect(membersData.members[0].role).toBe('worker');
    expect(membersData.members[0].tool).toBe('codex');
    expect(membersData.members[0].status).toBe('running');

    // Shutdown the agent
    const shutdownResult = await agentsHandler({
      operation: 'shutdown_agent',
      session_id: session,
      role: 'worker',
    });
    expect(shutdownResult.success).toBe(true);
    const shutdownData = shutdownResult.result as { status: string };
    expect(shutdownData.status).toBe('cancelling');

    // Check members again - should show 'idle' (cancel requested)
    const afterMembers = await agentsHandler({
      operation: 'members',
      session_id: session,
    });
    const afterData = afterMembers.result as {
      members: { role: string; status: string }[];
    };
    expect(afterData.members[0].status).toBe('idle');
  });

  it('spawn + remove cleans up member registry', async () => {
    const session = sid('spawn-remove');

    await agentsHandler({
      operation: 'spawn_agent',
      session_id: session,
      role: 'analyst',
      prompt: 'Analyze things',
    });
    await agentsHandler({
      operation: 'spawn_agent',
      session_id: session,
      role: 'reviewer',
      prompt: 'Review things',
    });

    // Verify 2 members
    let membersResult = await agentsHandler({
      operation: 'members',
      session_id: session,
    });
    let membersData = membersResult.result as { total: number };
    expect(membersData.total).toBe(2);

    // Remove analyst
    await agentsHandler({
      operation: 'remove_agent',
      session_id: session,
      role: 'analyst',
    });

    // Verify only reviewer remains
    membersResult = await agentsHandler({
      operation: 'members',
      session_id: session,
    });
    membersData = membersResult.result as {
      total: number;
      members: { role: string }[];
    };
    expect(membersData.total).toBe(1);
    expect(membersData.members[0].role).toBe('reviewer');

    // Verify members.json persisted correctly
    const membersPath = join(tmpDir, '.workflow', '.team', session, 'members.json');
    const raw = JSON.parse(readFileSync(membersPath, 'utf-8'));
    expect(raw.members).toHaveLength(1);
    expect(raw.members[0].role).toBe('reviewer');
  });

  it('shutdown for non-existent role returns error', async () => {
    const session = sid('shutdown-ghost');

    const result = await agentsHandler({
      operation: 'shutdown_agent',
      session_id: session,
      role: 'ghost',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// 3. MCP tool registration chain
// ---------------------------------------------------------------------------

describe('L2: MCP tool registration chain', () => {
  it('registerBuiltinTools registers all expected tools', async () => {
    // Import the registration function and a mock-like registry
    const { registerBuiltinTools } = await import('../../tools/index.js');

    const registered: string[] = [];
    const mockRegistry = {
      register(tool: { name: string }) {
        registered.push(tool.name);
      },
    };

    registerBuiltinTools(mockRegistry as any);

    // Verify all expected tools are registered
    expect(registered).toContain('edit_file');
    expect(registered).toContain('write_file');
    expect(registered).toContain('read_file');
    expect(registered).toContain('read_many_files');
    expect(registered).toContain('team_msg');
    expect(registered).toContain('team_mailbox');

    expect(registered).toContain('team_task');
    expect(registered).toContain('team_agent');
    expect(registered).toHaveLength(8);
  });

  it('all registered tools have valid schema (name, description, inputSchema)', async () => {
    const { registerBuiltinTools } = await import('../../tools/index.js');

    const tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
    const mockRegistry = {
      register(tool: { name: string; description: string; inputSchema: Record<string, unknown> }) {
        tools.push(tool);
      },
    };

    registerBuiltinTools(mockRegistry as any);

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('registered tool handlers are callable and return valid results', async () => {
    const { registerBuiltinTools } = await import('../../tools/index.js');

    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<any>>();
    const mockRegistry = {
      register(tool: { name: string; handler: (input: Record<string, unknown>) => Promise<any> }) {
        handlers.set(tool.name, tool.handler);
      },
    };

    registerBuiltinTools(mockRegistry as any);

    // Test team_msg handler is callable
    const msgHandler = handlers.get('team_msg');
    expect(msgHandler).toBeDefined();

    // Call with invalid params - should return error content (not throw)
    const result = await msgHandler!({});
    // ccwResultToMcp wraps errors as { content: [...], isError: true }
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. team-msg state_update → meta.json integration
// ---------------------------------------------------------------------------

describe('L2: team-msg state_update → meta.json', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('state_update messages merge data into role_state in meta.json', async () => {
    const session = sid('state-update');

    // Log a state_update from analyst role
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'analyst',
      to: 'coordinator',
      type: 'state_update',
      summary: 'Analysis complete',
      data: {
        status: 'completed',
        key_findings: ['finding1', 'finding2'],
        artifact_path: 'artifacts/analysis.md',
      },
    });

    // Verify meta.json has role_state
    const metaPath = join(tmpDir, '.workflow', '.team', session, '.msg', 'meta.json');
    expect(existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.role_state).toBeDefined();
    expect(meta.role_state.analyst).toBeDefined();
    expect(meta.role_state.analyst.status).toBe('completed');
    expect(meta.role_state.analyst.key_findings).toEqual(['finding1', 'finding2']);
    expect(meta.role_state.analyst._updated_at).toBeDefined();
  });

  it('get_state reads role_state from meta.json', async () => {
    const session = sid('get-state');

    // Log a state_update
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'executor',
      to: 'coordinator',
      type: 'state_update',
      data: { status: 'completed', files_modified: ['a.ts', 'b.ts'] },
    });

    // Read state via get_state
    const stateResult = await msgHandler({
      operation: 'get_state',
      session_id: session,
      role: 'executor',
    });

    expect(stateResult.success).toBe(true);
    const stateData = stateResult.result as { role: string; state: Record<string, unknown> };
    expect(stateData.role).toBe('executor');
    expect(stateData.state.status).toBe('completed');
    expect(stateData.state.files_modified).toEqual(['a.ts', 'b.ts']);
  });

  it('multiple state_updates merge incrementally', async () => {
    const session = sid('merge-state');

    // First state_update
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'worker',
      to: 'coordinator',
      type: 'state_update',
      data: { status: 'in_progress', progress: 30 },
    });

    // Second state_update
    await msgHandler({
      operation: 'log',
      session_id: session,
      from: 'worker',
      to: 'coordinator',
      type: 'state_update',
      data: { progress: 60, current_file: 'src/main.ts' },
    });

    // Both updates should be merged
    const stateResult = await msgHandler({
      operation: 'get_state',
      session_id: session,
      role: 'worker',
    });

    const stateData = stateResult.result as { state: Record<string, unknown> };
    expect(stateData.state.status).toBe('in_progress');
    expect(stateData.state.progress).toBe(60);
    expect(stateData.state.current_file).toBe('src/main.ts');
  });
});

// ---------------------------------------------------------------------------
// 5. Session isolation across all modules
// ---------------------------------------------------------------------------

describe('L2: session isolation across modules', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('team-msg, team-mailbox, team-agents use separate session namespaces', async () => {
    const sessionA = sid('session-a');
    const sessionB = sid('session-b');

    // Log messages in session A
    await msgHandler({
      operation: 'log',
      session_id: sessionA,
      from: 'alice',
      to: 'bob',
      delivery_method: 'inject',
    });
    await mailboxHandler({
      operation: 'send',
      session_id: sessionA,
      from: 'alice',
      to: 'bob',
      message: 'Session A mailbox',
    });
    await agentsHandler({
      operation: 'spawn_agent',
      session_id: sessionA,
      role: 'worker',
      prompt: 'Work A',
    });

    // Log messages in session B
    await msgHandler({
      operation: 'log',
      session_id: sessionB,
      from: 'carol',
      to: 'dave',
      delivery_method: 'inject',
    });

    // Verify isolation: session A team-msg
    const msgsA = readAllMessages(sessionA);
    expect(msgsA).toHaveLength(1);
    expect(msgsA[0].from).toBe('alice');

    // Verify isolation: session B team-msg
    const msgsB = readAllMessages(sessionB);
    expect(msgsB).toHaveLength(1);
    expect(msgsB[0].from).toBe('carol');

    // Verify isolation: session A mailbox
    const mbxA = await mailboxHandler({
      operation: 'read',
      session_id: sessionA,
      role: 'bob',
      mark_delivered: false,
    });
    const mbxAData = mbxA.result as { unread_count: number };
    expect(mbxAData.unread_count).toBe(1);

    // Verify isolation: session B mailbox (no messages for bob)
    const mbxB = await mailboxHandler({
      operation: 'read',
      session_id: sessionB,
      role: 'bob',
      mark_delivered: false,
    });
    const mbxBData = mbxB.result as { unread_count: number };
    expect(mbxBData.unread_count).toBe(0);

    // Verify isolation: session A agents
    const agentsA = await agentsHandler({
      operation: 'members',
      session_id: sessionA,
    });
    const agentsAData = agentsA.result as { total: number };
    expect(agentsAData.total).toBe(1);

    // Verify isolation: session B agents
    const agentsB = await agentsHandler({
      operation: 'members',
      session_id: sessionB,
    });
    const agentsBData = agentsB.result as { total: number };
    expect(agentsBData.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Type consistency: TeamPhaseName vs TeamPhase
// ---------------------------------------------------------------------------

describe('L2: type consistency across boundaries', () => {
  it('TeamPhase enum (backend) contains all non-UI phases', async () => {
    const { TeamPhase } = await import('../../team/phase-types.js');

    // Backend defines 6 phases
    const backendPhases = Object.values(TeamPhase);
    expect(backendPhases).toContain('planning');
    expect(backendPhases).toContain('execution');
    expect(backendPhases).toContain('review');
    expect(backendPhases).toContain('verification');
    expect(backendPhases).toContain('fix');
    expect(backendPhases).toContain('complete');
    expect(backendPhases).toHaveLength(6);
  });

  it('TRANSITIONS map covers all TeamPhase values as source keys', async () => {
    const { TeamPhase, TRANSITIONS } = await import('../../team/phase-types.js');

    for (const phase of Object.values(TeamPhase)) {
      expect(TRANSITIONS.has(phase as any)).toBe(true);
    }
  });

  it('TRANSITIONS map targets only reference valid TeamPhase values', async () => {
    const { TeamPhase, TRANSITIONS } = await import('../../team/phase-types.js');

    const validPhases = new Set(Object.values(TeamPhase));

    for (const [source, rules] of TRANSITIONS) {
      for (const rule of rules) {
        expect(validPhases.has(rule.to)).toBe(true);
      }
    }
  });

  it('dashboard TeamPhaseName diverges from backend TeamPhase (documented risk)', async () => {
    // This test documents the known divergence between frontend and backend phase names.
    // Dashboard: 'initialization' | 'planning' | 'execution' | 'review' | 'completion' (5 phases)
    // Backend:   'planning' | 'execution' | 'review' | 'verification' | 'fix' | 'complete' (6 phases)
    //
    // Key differences:
    // - Dashboard has 'initialization', backend starts at 'planning'
    // - Dashboard has 'completion', backend has 'complete'
    // - Backend has 'verification' and 'fix' phases not in dashboard
    //
    // This is intentional: the dashboard shows a simplified view.
    // But it means phase data must be mapped when crossing the boundary.

    const { TeamPhase } = await import('../../team/phase-types.js');

    const backendPhases = new Set(Object.values(TeamPhase));
    const dashboardPhases = new Set([
      'initialization',
      'planning',
      'execution',
      'review',
      'completion',
    ]);

    // Phases in backend but not dashboard
    const backendOnly = [...backendPhases].filter(p => !dashboardPhases.has(p));
    expect(backendOnly).toContain('verification');
    expect(backendOnly).toContain('fix');
    expect(backendOnly).toContain('complete'); // dashboard uses 'completion' instead

    // Phases in dashboard but not backend
    const dashboardOnly = [...dashboardPhases].filter(p => !backendPhases.has(p as any));
    expect(dashboardOnly).toContain('initialization');
    expect(dashboardOnly).toContain('completion');
  });

  it('SSE_EVENT_TYPES has all 4 team event keys', async () => {
    // Verify the constants are wired correctly
    const { SSE_EVENT_TYPES } = await import('../../../dashboard/src/shared/constants.js');

    expect(SSE_EVENT_TYPES.TEAM_MESSAGE).toBe('team:message');
    expect(SSE_EVENT_TYPES.TEAM_DISPATCH).toBe('team:dispatch');
    expect(SSE_EVENT_TYPES.TEAM_PHASE).toBe('team:phase');
    expect(SSE_EVENT_TYPES.TEAM_AGENT_STATUS).toBe('team:agent_status');
  });
});

/**
 * Delegate MCP tool — spawn / follow-up / inspect / cancel CLI delegates.
 *
 * Default mode is analysis (read-only). write must be set explicitly.
 * Spawn is always async so the MCP request does not block.
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import {
  generateCliExecId,
} from '../agents/cli-agent-runner.js';
import { CliHistoryStore } from '../agents/cli-history-store.js';
import { DelegateBrokerClient } from '../async/delegate-broker-client.js';
import {
  handleDelegateMessage,
  normalizeDelegateExecId,
} from '../async/delegate-control.js';
import {
  launchDetachedDelegateWorker,
  type DelegateExecutionRequest,
} from '../commands/delegate.js';
import {
  loadCliToolsConfig,
  selectTool,
  selectToolByRole,
  type CliToolsConfig,
} from '../config/cli-tools-config.js';
import {
  deriveDelegateStatus,
} from '../utils/cli-format.js';

const OPERATIONS = ['run', 'message', 'status', 'output', 'cancel'] as const;
const MODES = ['analysis', 'write'] as const;
const DELIVERIES = ['inject', 'after_complete'] as const;

export interface DelegateMcpDeps {
  loadConfig?: (workDir?: string) => Promise<CliToolsConfig>;
  launch?: (request: DelegateExecutionRequest) => void;
  historyStore?: CliHistoryStore;
  broker?: DelegateBrokerClient;
}

const ParamsSchema = z.object({
  operation: z.enum(OPERATIONS).describe('Operation to perform'),
  prompt: z.string().optional().describe('[run] Task prompt'),
  to: z.string().optional().describe('[run] Target CLI tool (gemini, grok, claude, …)'),
  role: z.string().optional().describe('[run] Capability role for auto tool selection'),
  mode: z.enum(MODES).optional().describe('[run] analysis (default, read-only) or write'),
  model: z.string().optional().describe('[run] Model override'),
  cd: z.string().optional().describe('[run] Working directory'),
  id: z.string().optional().describe('[run] Optional exec id; required for other operations'),
  message: z.string().optional().describe('[message] Follow-up text'),
  delivery: z.enum(DELIVERIES).optional().describe('[message] inject (default) or after_complete'),
  full: z.boolean().optional().describe('[output] Return full output instead of last reply'),
  events: z.number().int().positive().optional().describe('[status] Recent broker events to include'),
});

function resolveWorkDir(cd?: string): string {
  return resolve(cd || process.env.MAESTRO_PROJECT_ROOT || process.cwd());
}

async function opRun(
  p: z.infer<typeof ParamsSchema>,
  deps: DelegateMcpDeps,
): Promise<CcwToolResult> {
  if (!p.prompt?.trim()) {
    return { success: false, error: 'run requires "prompt"' };
  }

  const mode = p.mode ?? 'analysis';
  const workDir = resolveWorkDir(p.cd);
  const loadConfig = deps.loadConfig ?? loadCliToolsConfig;
  const config = await loadConfig(workDir);

  if (!config.tools || Object.keys(config.tools).length === 0) {
    return { success: false, error: 'cli-tools.json has no tools configured. Run "maestro config delegate reset".' };
  }

  let selected;
  if (p.to) {
    selected = selectTool(p.to, config);
    if (!selected || selected.name !== p.to) {
      const available = Object.entries(config.tools)
        .filter(([, e]) => e.enabled)
        .map(([n]) => n);
      const exists = p.to in config.tools;
      return {
        success: false,
        error: exists
          ? `tool "${p.to}" is disabled. Enable it or use: ${available.join(', ') || '(none)'}`
          : `unknown tool "${p.to}". Available: ${available.join(', ') || '(none)'}`,
      };
    }
  } else if (p.role) {
    selected = selectToolByRole(p.role, config);
  } else {
    selected = selectTool(undefined, config);
  }

  if (!selected) {
    return { success: false, error: 'no enabled tool found in cli-tools.json' };
  }

  const execId = p.id?.trim() ? normalizeDelegateExecId(p.id) : generateCliExecId(selected.name);
  const request: DelegateExecutionRequest = {
    prompt: p.prompt,
    tool: selected.name,
    mode,
    model: p.model ?? selected.entry.primaryModel,
    workDir,
    execId,
    backend: 'direct',
    role: p.role,
  };

  const launch = deps.launch ?? launchDetachedDelegateWorker;
  try {
    launch(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to start delegate: ${message}` };
  }

  return {
    success: true,
    result: {
      exec_id: execId,
      tool: selected.name,
      mode,
      status: 'queued',
      message: `Started async delegate ${execId}. Use operation=status or operation=output to follow.`,
    },
  };
}

function requireId(id: string | undefined): string | CcwToolResult {
  if (!id?.trim()) {
    return { success: false, error: 'this operation requires "id"' };
  }
  return normalizeDelegateExecId(id);
}

function loadJob(
  id: string,
  deps: DelegateMcpDeps,
): { store: CliHistoryStore; broker: DelegateBrokerClient; meta: ReturnType<CliHistoryStore['loadMeta']>; job: ReturnType<DelegateBrokerClient['getJob']> } | CcwToolResult {
  const store = deps.historyStore ?? new CliHistoryStore();
  const broker = deps.broker ?? new DelegateBrokerClient();
  const meta = store.loadMeta(id);
  const job = broker.getJob(id);
  if (!meta && !job) {
    return { success: false, error: `Delegate execution not found: ${id}` };
  }
  return { store, broker, meta, job };
}

function opMessage(
  p: z.infer<typeof ParamsSchema>,
  deps: DelegateMcpDeps,
): CcwToolResult {
  const idOrErr = requireId(p.id);
  if (typeof idOrErr !== 'string') return idOrErr;
  if (!p.message?.trim()) {
    return { success: false, error: 'message requires "message"' };
  }

  try {
    const result = handleDelegateMessage({
      execId: idOrErr,
      message: p.message,
      delivery: p.delivery ?? 'inject',
      requestedBy: 'mcp:delegate',
    }, {
      historyStore: deps.historyStore,
      delegateBroker: deps.broker,
      launchDetachedDelegate: deps.launch,
    });
    return {
      success: true,
      result: {
        exec_id: result.execId,
        delivery: result.delivery,
        status: result.status,
        immediate_dispatch: result.immediateDispatch,
        queue_depth: result.queueDepth,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function opStatus(
  p: z.infer<typeof ParamsSchema>,
  deps: DelegateMcpDeps,
): CcwToolResult {
  const idOrErr = requireId(p.id);
  if (typeof idOrErr !== 'string') return idOrErr;
  const loaded = loadJob(idOrErr, deps);
  if ('success' in loaded) return loaded;

  const eventLimit = p.events ?? 5;
  const events = loaded.broker.listJobEvents(idOrErr).slice(-eventLimit);
  return {
    success: true,
    result: {
      exec_id: idOrErr,
      status: deriveDelegateStatus(loaded.meta, loaded.job),
      tool: loaded.meta?.tool,
      mode: loaded.meta?.mode,
      started_at: loaded.meta?.startedAt,
      completed_at: loaded.meta?.completedAt,
      events: events.map((e) => ({
        type: e.type,
        status: e.status,
        created_at: e.createdAt,
      })),
    },
  };
}

function opOutput(
  p: z.infer<typeof ParamsSchema>,
  deps: DelegateMcpDeps,
): CcwToolResult {
  const idOrErr = requireId(p.id);
  if (typeof idOrErr !== 'string') return idOrErr;
  const loaded = loadJob(idOrErr, deps);
  if ('success' in loaded) return loaded;

  const output = loaded.store.getOutput(idOrErr, {
    lastReply: !p.full,
  });
  const status = deriveDelegateStatus(loaded.meta, loaded.job);
  if (!output) {
    return {
      success: false,
      error: status === 'running' || status === 'queued'
        ? `Execution ${idOrErr} is still ${status} — no output yet.`
        : `No output available for: ${idOrErr}`,
    };
  }
  return {
    success: true,
    result: {
      exec_id: idOrErr,
      status,
      output,
    },
  };
}

function opCancel(
  p: z.infer<typeof ParamsSchema>,
  deps: DelegateMcpDeps,
): CcwToolResult {
  const idOrErr = requireId(p.id);
  if (typeof idOrErr !== 'string') return idOrErr;
  const loaded = loadJob(idOrErr, deps);
  if ('success' in loaded) return loaded;

  const current = deriveDelegateStatus(loaded.meta, loaded.job);
  if (current === 'completed' || current === 'failed' || current === 'cancelled') {
    return {
      success: true,
      result: {
        exec_id: idOrErr,
        status: current,
        message: `Delegate ${idOrErr} is already ${current}.`,
      },
    };
  }

  const updated = loaded.broker.requestCancel({
    jobId: idOrErr,
    requestedBy: 'mcp:delegate',
  });
  return {
    success: true,
    result: {
      exec_id: idOrErr,
      status: deriveDelegateStatus(loaded.meta, updated),
      message: `Cancellation requested for ${idOrErr}.`,
    },
  };
}

export const schema: ToolSchema = {
  name: 'delegate',
  description: `Delegate a prompt to an external CLI agent (Grok / Gemini / Claude / Codex / …).

Default mode is analysis (read-only). Pass mode="write" only when the task must modify files.
Spawn is async: the tool returns an exec_id immediately. Follow with status / output / message / cancel.

**Operations:**

*   **run**: Start a delegate. Requires prompt. Optional: to, role, mode, model, cd, id.
*   **message**: Send follow-up. Requires id, message. Optional: delivery=inject|after_complete.
*   **status**: Inspect progress. Requires id.
*   **output**: Read assistant output. Requires id. Optional: full=true.
*   **cancel**: Request cancellation. Requires id.`,

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [...OPERATIONS],
        description: 'run | message | status | output | cancel',
      },
      prompt: { type: 'string', description: '[run] Task prompt' },
      to: { type: 'string', description: '[run] Target tool: grok, gemini, claude, …' },
      role: { type: 'string', description: '[run] Role for auto tool selection' },
      mode: { type: 'string', enum: [...MODES], description: '[run] analysis (default) or write' },
      model: { type: 'string', description: '[run] Model override' },
      cd: { type: 'string', description: '[run] Working directory' },
      id: { type: 'string', description: 'Exec id: optional for run, required otherwise' },
      message: { type: 'string', description: '[message] Follow-up text' },
      delivery: { type: 'string', enum: [...DELIVERIES], description: '[message] inject (default) or after_complete' },
      full: { type: 'boolean', description: '[output] Full output instead of last reply' },
      events: { type: 'number', description: '[status] Recent broker events to include' },
    },
    required: ['operation'],
  },
};

export async function handler(
  params: Record<string, unknown>,
  deps: DelegateMcpDeps = {},
): Promise<CcwToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const p = parsed.data;
  switch (p.operation) {
    case 'run':
      return opRun(p, deps);
    case 'message':
      return opMessage(p, deps);
    case 'status':
      return opStatus(p, deps);
    case 'output':
      return opOutput(p, deps);
    case 'cancel':
      return opCancel(p, deps);
    default:
      return { success: false, error: `Unknown operation: ${p.operation}` };
  }
}

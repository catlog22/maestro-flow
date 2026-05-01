// ---------------------------------------------------------------------------
// `maestro delegate` — prompt-first task delegation
// ---------------------------------------------------------------------------

import { spawn, type SpawnOptions } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Command, Option } from 'commander';
import { CliAgentRunner } from '../agents/cli-agent-runner.js';
import { CliHistoryStore, type EntryLike } from '../agents/cli-history-store.js';
import type { ExecutionMeta } from '../agents/cli-history-store.js';
import { generateCliExecId } from '../agents/cli-agent-runner.js';
import { loadCliToolsConfig, selectTool, selectToolByRole } from '../config/cli-tools-config.js';
import { paths } from '../config/paths.js';
import { DelegateBrokerClient, type JsonObject, type DelegateJobEvent, type DelegateJobRecord, type DelegateQueuedMessage } from '../async/index.js';
import { handleDelegateMessage } from '../async/delegate-control.js';
import {
  deriveExecutionStatus,
  deriveDelegateStatus,
  padRight,
  truncate,
  readExecutionEntries,
  summarizeBrokerEventCli,
} from '../utils/cli-format.js';

function statusLabel(meta: ExecutionMeta): string {
  const s = deriveExecutionStatus(meta);
  return s === 'completed' ? 'done' : s === 'unknown' ? `exit:${meta.exitCode ?? '?'}` : s;
}

function summarizeHistoryEntry(entry: EntryLike): string {
  switch (entry.type) {
    case 'assistant_message':
      return `assistant: ${truncate(String(entry.content ?? ''), 120)}`;
    case 'tool_use':
      return `tool ${String(entry.name ?? '?')}: ${String(entry.status ?? 'unknown')}`;
    case 'error':
      return `error: ${String(entry.message ?? '')}`;
    case 'status_change':
      return `status: ${String(entry.status ?? '')}`;
    default:
      return `${entry.type}`;
  }
}

export interface DelegateExecutionRequest {
  prompt: string;
  tool: string;
  mode: 'analysis' | 'write';
  model?: string;
  workDir: string;
  rule?: string;
  execId: string;
  resume?: string;
  includeDirs?: string[];
  sessionId?: string;
  backend: 'direct' | 'terminal';
  settingsFile?: string;
  baseTool?: string;
  /** Delegate role for spec category mapping */
  role?: string;
}

interface ChildProcessLike {
  pid?: number;
  unref(): void;
}

interface SpawnLike {
  (command: string, args: readonly string[], options: SpawnOptions): ChildProcessLike;
}

export interface LaunchDetachedDelegateOptions {
  historyStore?: CliHistoryStore;
  brokerClient?: DelegateBrokerClient;
  spawnProcess?: SpawnLike;
  entryScript?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

function createRunningMeta(request: DelegateExecutionRequest, startedAt: string): ExecutionMeta {
  return {
    execId: request.execId,
    tool: request.tool,
    model: request.model,
    mode: request.mode,
    prompt: request.prompt.substring(0, 500),
    workDir: request.workDir,
    startedAt,
  };
}

function saveFailedMeta(
  store: CliHistoryStore,
  request: DelegateExecutionRequest,
  completedAt: string,
): void {
  const existing = store.loadMeta(request.execId);
  store.saveMeta(request.execId, {
    ...(existing ?? createRunningMeta(request, completedAt)),
    completedAt,
    exitCode: 1,
  });
}

function buildJobMetadata(request: DelegateExecutionRequest, workerPid?: number): JsonObject {
  const metadata: JsonObject = {
    tool: request.tool,
    mode: request.mode,
    workDir: request.workDir,
    prompt: request.prompt.substring(0, 200),
    backend: request.backend,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelReason: null,
  };
  if (request.model) {
    metadata.model = request.model;
  }
  if (request.rule) {
    metadata.rule = request.rule;
  }
  if (request.sessionId) {
    metadata.sessionId = request.sessionId;
  }
  if (workerPid !== undefined) {
    metadata.workerPid = workerPid;
  }
  return metadata;
}

export function buildDetachedDelegateWorkerArgs(
  request: DelegateExecutionRequest,
  entryScript = process.argv[1],
): string[] {
  if (!entryScript) {
    throw new Error('Cannot determine maestro entry script for detached delegate worker.');
  }

  const args = [entryScript, 'delegate', request.prompt, '--worker', '--to', request.tool, '--mode', request.mode, '--cd', request.workDir, '--id', request.execId, '--backend', request.backend];

  if (request.model) {
    args.push('--model', request.model);
  }
  if (request.rule) {
    args.push('--rule', request.rule);
  }
  if (request.resume) {
    args.push('--resume', request.resume);
  }
  if (request.includeDirs && request.includeDirs.length > 0) {
    args.push('--includeDirs', request.includeDirs.join(','));
  }
  if (request.sessionId) {
    args.push('--session', request.sessionId);
  }

  return args;
}

export function launchDetachedDelegateWorker(
  request: DelegateExecutionRequest,
  options: LaunchDetachedDelegateOptions = {},
): void {
  const store = options.historyStore ?? new CliHistoryStore();
  const broker = options.brokerClient ?? new DelegateBrokerClient();
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const runningMeta = createRunningMeta(request, startedAt);
  store.saveMeta(request.execId, runningMeta);

  try {
    const args = buildDetachedDelegateWorkerArgs(request, options.entryScript);
    const spawnProcess = options.spawnProcess ?? spawn;
    const env = {
      ...(options.env ?? process.env),
      MAESTRO_DISABLE_DASHBOARD_BRIDGE: '1',
    };
    const child = spawnProcess(process.execPath, args, {
      cwd: request.workDir,
      detached: true,
      stdio: 'ignore',
      env,
    });
    try {
      broker.publishEvent({
        jobId: request.execId,
        type: 'queued',
        status: 'queued',
        payload: { summary: `${request.tool}/${request.mode} queued` },
        jobMetadata: buildJobMetadata(request, child.pid),
        now: startedAt,
      });
    } catch {
      // Broker initialization is best-effort for detached launch.
    }
    child.unref();
  } catch (error) {
    saveFailedMeta(store, request, now());
    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface RelayRecord {
  sessionId?: string;
  pid?: number;
  ownerPid?: number;
  ssePort?: string;
  startedAt?: string;
}

/**
 * Scan the async dir and return live relay records.
 *
 * "Live" requires BOTH:
 *  - `pid` (the MCP server process) is alive
 *  - `ownerPid` (the Claude Code process that spawned it) is alive, when recorded
 *
 * The `ownerPid` check rejects zombie MCP servers whose parent Claude Code
 * exited but whose node process never shut down. Older relay files without
 * `ownerPid` fall back to pid-only liveness (backward compatible).
 *
 * Stale files (dead pid OR dead ownerPid) are unlinked as a side effect.
 */
export function readLiveRelayRecords(asyncDir: string): RelayRecord[] {
  let files: string[];
  try {
    files = readdirSync(asyncDir).filter(
      (f) => f.startsWith('relay-session-') && f.endsWith('.id'),
    );
  } catch {
    return [];
  }

  const live: RelayRecord[] = [];
  for (const file of files) {
    const filePath = join(asyncDir, file);
    let data: RelayRecord;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf-8')) as RelayRecord;
    } catch {
      continue;
    }

    const pidAlive = !data.pid || isProcessAlive(data.pid);
    const ownerAlive = !data.ownerPid || isProcessAlive(data.ownerPid);
    if (!pidAlive || !ownerAlive) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
      continue;
    }
    live.push(data);
  }
  return live;
}

/**
 * Resolve the relay session ID that matches the current Claude Code session.
 *
 * When CLAUDE_CODE_SSE_PORT is available, derives the session ID directly
 * from the port number — this is deterministic and avoids stale relay file
 * issues caused by PID reuse on Windows.
 *
 * Falls back to file-based matching for non-Claude-Code contexts.
 */
function resolveRelaySessionId(): string | undefined {
  const currentSsePort = process.env.CLAUDE_CODE_SSE_PORT;
  if (currentSsePort) {
    return `maestro-mcp-relay-port-${currentSsePort}`;
  }

  // Fallback: find newest live relay session from files
  const records = readLiveRelayRecords(join(paths.data, 'async'));
  if (records.length === 0) return undefined;

  let newest: RelayRecord | undefined;
  for (const record of records) {
    if (!newest || (record.startedAt ?? '') > (newest.startedAt ?? '')) {
      newest = record;
    }
  }
  return newest?.sessionId;
}

/** Check if the MCP notification channel is functional for the current session. */
export function isChannelAvailable(): boolean {
  if (process.env.CLAUDECODE !== '1') return false;
  const currentSsePort = process.env.CLAUDE_CODE_SSE_PORT;
  if (!currentSsePort) return false;

  const records = readLiveRelayRecords(join(paths.data, 'async'));
  return records.some((r) => r.ssePort === currentSsePort);
}

export function registerDelegateCommand(program: Command): void {
  const delegate = program
    .command('delegate [prompt]')
    .description('Delegate a prompt to a CLI agent tool');

  // ---- Main action ---------------------------------------------------------

  delegate
    .option('--to <tool>', 'CLI tool to delegate to (gemini, qwen, codex, claude, opencode)')
    .option('--role <role>', 'Capability role for auto tool selection (analyze, explore, review, implement, plan, brainstorm, research)')
    .option('--mode <mode>', 'Execution mode (analysis or write)', 'analysis')
    .option('--model <model>', 'Model override')
    .option('--cd <dir>', 'Working directory')
    .option('--rule <template>', 'Template name — auto-loads protocol + template')
    .option('--id <id>', 'Execution ID (auto-generated if omitted)')
    .option('--resume [id]', 'Resume previous session (last if no id)')
    .option('--includeDirs <dirs>', 'Additional directories (comma-separated)')
    .option('--session <id>', 'Claude Code session ID for completion notifications')
    .option('--backend <type>', 'Adapter backend: direct (default) or terminal (tmux/wezterm)')
    .option('--async', 'Run detached in the background; results delivered via MCP channel notifications (default: synchronous)')
    .addOption(new Option('--worker').hideHelp())
    .action(async (prompt: string | undefined, opts: {
      to?: string;
      role?: string;
      mode: string;
      model?: string;
      cd?: string;
      rule?: string;
      id?: string;
      resume?: string | true;
      includeDirs?: string;
      session?: string;
      backend?: string;
      async?: boolean;
      worker?: boolean;
    }) => {
      if (!prompt) {
        console.error('error: prompt is required. Usage: maestro delegate "your prompt"');
        process.exit(1);
      }

      const workDir = resolve(opts.cd ?? process.cwd());
      const config = await loadCliToolsConfig(workDir);

      // Tool resolution priority: --to > --role > first-enabled fallback
      let selected;
      if (opts.to) {
        if (opts.role) {
          process.stderr.write(`Warning: --to overrides --role; using tool "${opts.to}" directly.\n`);
        }
        selected = selectTool(opts.to, config);
      } else if (opts.role) {
        selected = selectToolByRole(opts.role, config);
      } else {
        selected = selectTool(undefined, config);
      }

      const toolName = selected?.name ?? opts.to ?? 'gemini';
      const model = opts.model ?? selected?.entry?.primaryModel;
      const mode = opts.mode as 'analysis' | 'write';

      if (mode !== 'analysis' && mode !== 'write') {
        console.error(`Invalid mode: ${opts.mode}. Use "analysis" or "write".`);
        process.exit(1);
      }

      const backend = (opts.backend === 'terminal' ? 'terminal' : 'direct') as 'direct' | 'terminal';
      const execId = opts.id ?? generateCliExecId(toolName);
      const resume = opts.resume === true ? 'last' : opts.resume;
      const includeDirs = opts.includeDirs?.split(',').map(d => d.trim()).filter(Boolean);
      const request: DelegateExecutionRequest = {
        prompt,
        tool: toolName,
        mode,
        model,
        workDir,
        rule: opts.rule,
        execId,
        resume,
        includeDirs,
        sessionId: opts.session ?? resolveRelaySessionId(),
        backend,
        settingsFile: selected?.entry?.settingsFile,
        baseTool: selected?.entry?.baseTool,
        role: opts.role,
      };

      try {
        // Default = sync. Async only when --async is explicitly passed.
        // Channel auto-detection is unreliable: CC's --channels mode is not
        // observable from the MCP server side (verified via clientCapabilities
        // diff — both modes announce identical capabilities).
        const useAsync = !opts.worker && opts.async === true;
        if (useAsync) {
          process.stderr.write(`[MAESTRO_EXEC_ID=${execId}]\n`);
          launchDetachedDelegateWorker(request);
          console.log(`Started async delegate: ${execId}`);
          console.log(`Use \`maestro delegate output ${execId}\` to inspect the result.`);
          return;
        }

        const runner = new CliAgentRunner();
        const syncMode = !opts.worker;

        // Sync mode: emit ONE broker event at start so any active channel
        // subscriber (CC launched with --dangerously-load-development-channels)
        // sees a "started" notification. No subsequent events are published —
        // sync output returns directly via stdout when the command completes.
        if (syncMode) {
          try {
            const broker = new DelegateBrokerClient();
            broker.publishEvent({
              jobId: execId,
              type: 'status_update',
              status: 'running',
              payload: { summary: `${toolName}/${mode} started (sync)` },
              jobMetadata: {
                tool: toolName,
                mode,
                workDir,
                backend,
                ...(request.sessionId ? { sessionId: request.sessionId } : {}),
              },
            });
          } catch {
            // Broker publish is best-effort; sync execution must continue.
          }
        }

        const exitCode = await runner.run({ ...request, sync: syncMode });

        // In sync mode, output the final result after completion
        if (syncMode) {
          const store = new CliHistoryStore();
          const output = store.getOutput(execId);
          if (output) {
            process.stderr.write('\n--- Output ---\n');
            process.stdout.write(output);
            if (!output.endsWith('\n')) process.stdout.write('\n');
          }

          // Publish final broker event so `delegate status` reflects completion.
          // The runner skips broker events in sync mode, so we emit it here.
          try {
            const broker = new DelegateBrokerClient();
            const finalStatus = exitCode === 130 ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed';
            broker.publishEvent({
              jobId: execId,
              type: finalStatus,
              status: finalStatus,
              payload: {
                summary: `${toolName}/${mode} ${finalStatus}`,
                exitCode,
                completedAt: new Date().toISOString(),
              },
              jobMetadata: {
                tool: toolName,
                mode,
                workDir,
                backend,
                ...(request.sessionId ? { sessionId: request.sessionId } : {}),
              },
            });
          } catch {
            // Best-effort; sync execution already succeeded.
          }
        }

        process.exit(exitCode);
      } catch (err) {
        saveFailedMeta(new CliHistoryStore(), request, new Date().toISOString());
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Delegate failed: ${message}`);
        process.exit(1);
      }
    });

  // ---- show subcommand -----------------------------------------------------

  delegate
    .command('show')
    .description('List recent delegated executions')
    .option('--all', 'Include full history')
    .action((opts: { all?: boolean }) => {
      const store = new CliHistoryStore();
      const limit = opts.all ? 100 : 20;
      const items = store.listRecent(limit);

      if (items.length === 0) {
        console.log('No recent executions.');
        return;
      }

      const colId = 24;
      const colTool = 10;
      const colMode = 10;
      const colStatus = 10;
      const colPrompt = 50;

      const header = [
        padRight('ID', colId),
        padRight('Tool', colTool),
        padRight('Mode', colMode),
        padRight('Status', colStatus),
        padRight('Prompt', colPrompt),
      ].join('  ');

      console.log(header);
      console.log('-'.repeat(header.length));

      for (const meta of items) {
        const row = [
          padRight(meta.execId, colId),
          padRight(meta.tool, colTool),
          padRight(meta.mode, colMode),
          padRight(statusLabel(meta), colStatus),
          padRight(truncate(meta.prompt, colPrompt), colPrompt),
        ].join('  ');
        console.log(row);
      }
    });

  // ---- output subcommand ---------------------------------------------------

  delegate
    .command('output <id>')
    .description('Get assistant output for a delegated execution')
    .option('--verbose', 'Show full metadata and raw output')
    .option('--all', 'Include thinking/reasoning entries in output')
    .option('--offset <n>', 'Character offset to start from (for pagination)')
    .option('--limit <n>', 'Max characters to return (for pagination)')
    .action((id: string, opts: { verbose?: boolean; all?: boolean; offset?: string; limit?: string }) => {
      const store = new CliHistoryStore();
      const meta = store.loadMeta(id);

      if (!meta) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      const offset = opts.offset ? parseInt(opts.offset, 10) : undefined;
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

      if (opts.verbose) {
        console.log(`ID:     ${meta.execId}`);
        console.log(`Tool:   ${meta.tool}`);
        console.log(`Mode:   ${meta.mode}`);
        console.log(`Status: ${statusLabel(meta)}`);
        console.log(`Start:  ${meta.startedAt}`);
        if (meta.completedAt) {
          console.log(`End:    ${meta.completedAt}`);
        }
        const totalChars = store.getOutputLength(meta.execId);
        console.log(`Chars:  ${totalChars}`);
        if (offset || limit) {
          console.log(`Page:   offset=${offset ?? 0} limit=${limit ?? 'all'}`);
        }
        console.log('---');
      }

      const output = store.getOutput(id, { includeAll: opts.all, offset, limit });
      if (!output) {
        const status = statusLabel(meta);
        if (status === 'running') {
          console.error(`Execution ${id} is still running — no output yet.`);
        } else {
          console.error(`No output available for: ${id}`);
        }
        process.exit(1);
      }

      process.stdout.write(output);
    });

  delegate
    .command('status <id>')
    .description('Inspect broker + history state for a delegated execution')
    .option('--events <n>', 'Number of recent broker events to show', '5')
    .action((id: string, opts: { events?: string }) => {
      const store = new CliHistoryStore();
      const broker = new DelegateBrokerClient();
      const meta = store.loadMeta(id);
      const job = broker.getJob(id);

      if (!meta && !job) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      const eventLimit = Math.max(1, parseInt(opts.events ?? '5', 10) || 5);
      const events = broker.listJobEvents(id).slice(-eventLimit);
      const status = deriveDelegateStatus(meta, job);

      console.log(`ID:     ${id}`);
      console.log(`Status: ${status}`);
      if (meta) {
        console.log(`Tool:   ${meta.tool}`);
        console.log(`Mode:   ${meta.mode}`);
        console.log(`Start:  ${meta.startedAt}`);
        if (meta.completedAt) {
          console.log(`End:    ${meta.completedAt}`);
        }
      }
      if (job) {
        console.log(`Job:    ${job.lastEventType} @ ${job.updatedAt}`);
        if (job.metadata?.cancelRequestedAt && typeof job.metadata.cancelRequestedAt === 'string') {
          console.log(`Cancel: requested at ${job.metadata.cancelRequestedAt}`);
        }
        if (job.latestSnapshot && typeof job.latestSnapshot.outputPreview === 'string') {
          console.log(`Preview: ${job.latestSnapshot.outputPreview}`);
        }
      }
      if (events.length > 0) {
        console.log('Recent events:');
        for (const event of events) {
          console.log(`  - ${summarizeBrokerEventCli(event)}`);
        }
      }
    });

  delegate
    .command('tail <id>')
    .description('Show recent broker events and persisted history for a delegated execution')
    .option('--events <n>', 'Number of broker events to show', '10')
    .option('--history <n>', 'Number of history entries to show', '10')
    .action((id: string, opts: { events?: string; history?: string }) => {
      const store = new CliHistoryStore();
      const broker = new DelegateBrokerClient();
      const meta = store.loadMeta(id);
      const events = broker.listJobEvents(id);
      const historyEntries = readExecutionEntries(store, id);

      if (!meta && events.length === 0 && historyEntries.length === 0) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      const eventLimit = Math.max(1, parseInt(opts.events ?? '10', 10) || 10);
      const historyLimit = Math.max(1, parseInt(opts.history ?? '10', 10) || 10);
      console.log(`== Broker Events (${Math.min(eventLimit, events.length)}/${events.length}) ==`);
      for (const event of events.slice(-eventLimit)) {
        console.log(summarizeBrokerEventCli(event));
      }
      console.log('');
      console.log(`== History Tail (${Math.min(historyLimit, historyEntries.length)}/${historyEntries.length}) ==`);
      for (const entry of historyEntries.slice(-historyLimit)) {
        console.log(summarizeHistoryEntry(entry));
      }
    });

  delegate
    .command('cancel <id>')
    .description('Request cancellation for an async delegated execution')
    .action((id: string) => {
      const store = new CliHistoryStore();
      const broker = new DelegateBrokerClient();
      const meta = store.loadMeta(id);
      const job = broker.getJob(id);

      if (!meta && !job) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      const currentStatus = deriveDelegateStatus(meta, job);
      if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
        console.log(`Delegate ${id} is already ${currentStatus}.`);
        return;
      }

      const updated = broker.requestCancel({
        jobId: id,
        requestedBy: 'cli:delegate:cancel',
      });
      console.log(`Cancellation requested for ${id}.`);
      console.log(`Current status: ${deriveDelegateStatus(meta, updated)}`);
      console.log('Use `maestro delegate status <id>` or `maestro delegate tail <id>` to follow progress.');
    });

  // ---- message subcommand --------------------------------------------------

  delegate
    .command('message <id> <text>')
    .description('Send a follow-up message to a running or completed delegate')
    .option('--delivery <mode>', 'Delivery mode: inject or after_complete', 'inject')
    .action((id: string, text: string, opts: { delivery?: string }) => {
      const delivery = opts.delivery ?? 'inject';
      if (delivery !== 'inject' && delivery !== 'after_complete') {
        console.error(`Invalid delivery mode: ${delivery}. Use "inject" or "after_complete".`);
        process.exit(1);
      }

      let result;
      try {
        result = handleDelegateMessage({
          execId: id,
          message: text,
          delivery: delivery as 'inject' | 'after_complete',
          requestedBy: 'cli:delegate:message',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed: ${message}`);
        process.exit(1);
      }

      console.log(`Message accepted for ${result.execId}`);
      console.log(`Delivery:  ${result.delivery}`);
      console.log(`Status:    ${result.status}`);
      if (result.immediateDispatch) {
        console.log(`Dispatch:  immediate (previous status: ${result.previousStatus})`);
      } else {
        console.log(`Queue:     ${result.queueDepth} message(s) pending`);
      }
    });

  // ---- messages subcommand -------------------------------------------------

  delegate
    .command('messages <id>')
    .description('List queued and dispatched follow-up messages for a delegate')
    .action((id: string) => {
      const store = new CliHistoryStore();
      const broker = new DelegateBrokerClient();
      const meta = store.loadMeta(id);
      const job = broker.getJob(id);

      if (!meta && !job) {
        console.error(`Execution not found: ${id}`);
        process.exit(1);
      }

      const messages = broker.listMessages(id);
      if (messages.length === 0) {
        console.log(`No messages for ${id}.`);
        return;
      }

      const colId = 12;
      const colDelivery = 16;
      const colStatus = 12;
      const colMessage = 60;

      const header = [
        padRight('MessageID', colId),
        padRight('Delivery', colDelivery),
        padRight('Status', colStatus),
        padRight('Message', colMessage),
      ].join('  ');

      console.log(header);
      console.log('-'.repeat(header.length));

      for (const msg of messages) {
        const row = [
          padRight(msg.messageId.slice(0, colId), colId),
          padRight(msg.delivery, colDelivery),
          padRight(msg.status, colStatus),
          padRight(truncate(msg.message, colMessage), colMessage),
        ].join('  ');
        console.log(row);
      }
    });
}

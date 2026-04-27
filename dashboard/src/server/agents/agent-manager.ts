// ---------------------------------------------------------------------------
// AgentManager — orchestrates adapters, bridges agent events to EventBus
// ---------------------------------------------------------------------------

import { appendFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentType,
  AgentConfig,
  AgentProcess,
  NormalizedEntry,
  ApprovalDecision,
} from '../../shared/agent-types.js';
import type { AgentAdapter } from './base-adapter.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { CLI_HISTORY_DIR_NAME } from '../../shared/constants.js';

export class AgentManager {
  private readonly adapters = new Map<AgentType, AgentAdapter>();
  private readonly processToAdapter = new Map<string, AgentAdapter>();
  private readonly entryHistory = new Map<string, NormalizedEntry[]>();
  private readonly unsubscribers = new Map<string, Array<() => void>>();
  private readonly cliProcesses = new Map<string, AgentProcess>();
  private readonly cliCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processExecIds = new Map<string, string>(); // processId -> execId for JSONL persistence
  private readonly processConfigs = new Map<string, { process: AgentProcess; config: AgentConfig }>(); // for meta persistence
  private readonly MAX_HISTORY = 1000;
  private readonly CLI_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly eventBus: DashboardEventBus) {}

  // --- CLI History persistence (write-through to ~/.maestro/cli-history/) ---

  private get historyDir(): string {
    const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
    return join(maestroHome, CLI_HISTORY_DIR_NAME);
  }

  private ensureHistoryDir(): void {
    const dir = this.historyDir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private persistEntry(processId: string, entry: NormalizedEntry): void {
    const execId = this.processExecIds.get(processId);
    if (!execId) return;
    try {
      this.ensureHistoryDir();
      appendFileSync(join(this.historyDir, `${execId}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Best-effort — don't break agent flow
    }
  }

  private persistMeta(processId: string, process: AgentProcess, config: AgentConfig, exitCode?: number): void {
    const execId = this.processExecIds.get(processId);
    if (!execId) return;
    try {
      this.ensureHistoryDir();
      const meta = {
        execId,
        tool: config.type === 'claude-code' ? 'claude' : config.type,
        model: config.model,
        mode: config.approvalMode === 'auto' ? 'write' : 'analysis',
        prompt: config.prompt.substring(0, 500),
        workDir: config.workDir,
        startedAt: process.startedAt,
        completedAt: new Date().toISOString(),
        exitCode,
      };
      writeFileSync(join(this.historyDir, `${execId}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');
    } catch {
      // Best-effort
    }
  }

  /** Register an adapter for a specific agent type */
  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.agentType, adapter);
  }

  /** List registered adapter type names */
  listAdapterTypes(): AgentType[] {
    return Array.from(this.adapters.keys());
  }

  /** Spawn a new agent process and wire up event forwarding */
  async spawn(type: AgentType, config: AgentConfig): Promise<AgentProcess> {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for type: ${type}`);
    }

    const process = await adapter.spawn(config);

    // Pass through team metadata from config so it's visible on the emitted AgentProcess
    if (config.metadata?.teamSessionId || config.metadata?.teamRole) {
      process.metadata = {
        ...process.metadata,
        ...(config.metadata.teamSessionId != null && { teamSessionId: config.metadata.teamSessionId }),
        ...(config.metadata.teamRole != null && { teamRole: config.metadata.teamRole }),
      };
    }

    this.processToAdapter.set(process.id, adapter);
    this.entryHistory.set(process.id, []);

    // Generate execId for CLI History persistence (dashboard-spawned sessions)
    const prefix = config.type === 'claude-code' ? 'cld' : config.type.substring(0, 3);
    const execId = `${prefix}-${process.id.replace(/-/g, '').substring(0, 12)}`;
    this.processExecIds.set(process.id, execId);
    this.processConfigs.set(process.id, { process, config });

    const unsubs: Array<() => void> = [];

    // Subscribe to entry events -> buffer + persist + emit to EventBus
    const unsubEntry = adapter.onEntry(process.id, (entry) => {
      const history = this.entryHistory.get(process.id);
      if (history) {
        history.push(entry);
        if (history.length > this.MAX_HISTORY) {
          history.shift();
        }
      }
      this.persistEntry(process.id, entry);
      this.eventBus.emit('agent:entry', entry);

      // --- Lifecycle bridge: Detect agent completion from entries ---
      if (entry.type === 'status_change') {
        if (entry.status === 'stopped' || entry.status === 'error') {
          this.handleAutoStop(process.id, entry.reason);
        } else if (entry.status === 'paused') {
          // Turn completed in app-server mode — process still alive
          this.eventBus.emit('agent:turnCompleted', { processId: process.id });
        }
      }
    });
    unsubs.push(unsubEntry);

    // Subscribe to approval events -> emit to EventBus
    const unsubApproval = adapter.onApproval(process.id, (request) => {
      this.eventBus.emit('agent:approval', request);
    });
    unsubs.push(unsubApproval);

    this.unsubscribers.set(process.id, unsubs);

    // Emit spawned event (client synthesizes user_message from config.prompt)
    this.eventBus.emit('agent:spawned', process);

    return process;
  }

  /** Stop a running agent process */
  async stop(processId: string): Promise<void> {
    const adapter = this.processToAdapter.get(processId);
    if (!adapter) {
      throw new Error(`No process found: ${processId}`);
    }

    await adapter.stop(processId);

    // If the process was already cleaned up (e.g. by handleAutoStop triggered 
    // by a status_change entry during shutdown), we're done.
    if (!this.processToAdapter.has(processId)) {
      return;
    }

    // Clean up subscriptions
    const unsubs = this.unsubscribers.get(processId);
    if (unsubs) {
      for (const unsub of unsubs) {
        unsub();
      }
      this.unsubscribers.delete(processId);
    }

    this.eventBus.emit('agent:stopped', { processId });

    // Persist meta to CLI History before cleanup
    const saved = this.processConfigs.get(processId);
    if (saved) this.persistMeta(processId, saved.process, saved.config, 0);

    this.processToAdapter.delete(processId);
    this.entryHistory.delete(processId);
    this.processExecIds.delete(processId);
    this.processConfigs.delete(processId);
  }

  /** Handle agent process that stopped on its own */
  private handleAutoStop(processId: string, reason?: string): void {
    if (!this.processToAdapter.has(processId)) return;

    // Clean up subscriptions
    const unsubs = this.unsubscribers.get(processId);
    if (unsubs) {
      for (const unsub of unsubs) {
        unsub();
      }
      this.unsubscribers.delete(processId);
    }

    this.eventBus.emit('agent:stopped', { processId, reason });

    // Persist meta to CLI History before cleanup
    const saved = this.processConfigs.get(processId);
    if (saved) this.persistMeta(processId, saved.process, saved.config, reason ? 1 : 0);

    this.processToAdapter.delete(processId);
    this.entryHistory.delete(processId);
    this.processExecIds.delete(processId);
    this.processConfigs.delete(processId);
  }

  /** Send a message to a running agent process */
  async sendMessage(processId: string, content: string): Promise<void> {
    const adapter = this.processToAdapter.get(processId);
    if (!adapter) {
      throw new Error(`No process found: ${processId}`);
    }
    await adapter.sendMessage(processId, content);
  }

  /** Respond to an approval request from an agent */
  async respondApproval(decision: ApprovalDecision): Promise<void> {
    const adapter = this.processToAdapter.get(decision.processId);
    if (!adapter) {
      throw new Error(`No process found: ${decision.processId}`);
    }
    await adapter.respondApproval(decision);
  }

  // --- CLI Bridge session registration (no adapter, read-only) ------------

  /** Register a CLI-bridged process (forwarded via DashboardBridge WS) */
  registerCliProcess(process: AgentProcess): void {
    const existing = this.cliProcesses.get(process.id);
    this.cliProcesses.set(process.id, existing ? { ...existing, ...process } : process);
    if (!this.entryHistory.has(process.id)) {
      this.entryHistory.set(process.id, []);
    }
  }

  /** Buffer an entry for a CLI-bridged process */
  addCliEntry(processId: string, entry: NormalizedEntry): void {
    const history = this.entryHistory.get(processId);
    if (history) {
      history.push(entry);
      if (history.length > this.MAX_HISTORY) {
        history.shift();
      }
    }
  }

  /** Update status of a CLI-bridged process and schedule delayed cleanup */
  updateCliProcessStatus(processId: string, status: AgentProcess['status']): void {
    const proc = this.cliProcesses.get(processId);
    if (proc) {
      proc.status = status;
      const existing = this.cliCleanupTimers.get(processId);
      if (existing) {
        clearTimeout(existing);
        this.cliCleanupTimers.delete(processId);
      }

      if (status === 'stopped' || status === 'error') {
        // Delay cleanup so frontends can still load entries after reconnect
        this.cliCleanupTimers.set(processId, setTimeout(() => {
          this.entryHistory.delete(processId);
          this.cliProcesses.delete(processId);
          this.cliCleanupTimers.delete(processId);
        }, this.CLI_CLEANUP_DELAY_MS));
      }
    }
  }

  /** List all active processes across all adapters + CLI bridge */
  listProcesses(): AgentProcess[] {
    const all: AgentProcess[] = [];
    for (const adapter of this.adapters.values()) {
      all.push(...adapter.listProcesses());
    }
    // Only include CLI bridge processes that are still active.
    // Stopped/error CLI processes are already available via /api/cli-history
    // and should not be listed here to avoid flooding the frontend.
    for (const proc of this.cliProcesses.values()) {
      if (proc.status !== 'stopped' && proc.status !== 'error') {
        all.push(proc);
      }
    }
    return all;
  }

  /** Get buffered entry history for a process */
  getEntries(processId: string): NormalizedEntry[] {
    return this.entryHistory.get(processId) ?? [];
  }

  /** Stop all running processes (used during shutdown) */
  async stopAll(): Promise<void> {
    const processIds = Array.from(this.processToAdapter.keys());
    await Promise.allSettled(processIds.map((id) => this.stop(id)));
  }
}

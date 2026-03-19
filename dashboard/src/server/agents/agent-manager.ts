// ---------------------------------------------------------------------------
// AgentManager — orchestrates adapters, bridges agent events to EventBus
// ---------------------------------------------------------------------------

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

export class AgentManager {
  private readonly adapters = new Map<AgentType, AgentAdapter>();
  private readonly processToAdapter = new Map<string, AgentAdapter>();
  private readonly entryHistory = new Map<string, NormalizedEntry[]>();
  private readonly unsubscribers = new Map<string, Array<() => void>>();
  private readonly cliProcesses = new Map<string, AgentProcess>();
  private readonly MAX_HISTORY = 1000;

  constructor(private readonly eventBus: DashboardEventBus) {}

  /** Register an adapter for a specific agent type */
  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.agentType, adapter);
  }

  /** Spawn a new agent process and wire up event forwarding */
  async spawn(type: AgentType, config: AgentConfig): Promise<AgentProcess> {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for type: ${type}`);
    }

    const process = await adapter.spawn(config);
    this.processToAdapter.set(process.id, adapter);
    this.entryHistory.set(process.id, []);

    const unsubs: Array<() => void> = [];

    // Subscribe to entry events -> buffer + emit to EventBus
    const unsubEntry = adapter.onEntry(process.id, (entry) => {
      const history = this.entryHistory.get(process.id);
      if (history) {
        history.push(entry);
        if (history.length > this.MAX_HISTORY) {
          history.shift();
        }
      }
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

    // Emit spawned event
    this.eventBus.emit('agent:spawned', process);

    // Emit user's initial prompt as a user_message entry so it appears in chat
    if (config.prompt) {
      const userEntry = EntryNormalizer.userMessage(process.id, config.prompt);
      const history = this.entryHistory.get(process.id);
      if (history) history.push(userEntry);
      this.eventBus.emit('agent:entry', userEntry);
    }

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

    this.processToAdapter.delete(processId);
    this.entryHistory.delete(processId);
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

    this.processToAdapter.delete(processId);
    this.entryHistory.delete(processId);
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
    this.cliProcesses.set(process.id, process);
    this.entryHistory.set(process.id, []);
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

  /** Update status of a CLI-bridged process */
  updateCliProcessStatus(processId: string, status: 'stopped' | 'error'): void {
    const proc = this.cliProcesses.get(processId);
    if (proc) {
      proc.status = status;
    }
  }

  /** List all active processes across all adapters + CLI bridge */
  listProcesses(): AgentProcess[] {
    const all: AgentProcess[] = [];
    for (const adapter of this.adapters.values()) {
      all.push(...adapter.listProcesses());
    }
    all.push(...this.cliProcesses.values());
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

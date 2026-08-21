// ---------------------------------------------------------------------------
// Terminal Adapter — wraps TerminalBackend into AdapterLike interface
// with 2s polling output collection and 120s stale timeout.
// ---------------------------------------------------------------------------

import type { TerminalBackend } from './terminal-backend.js';

// ---------------------------------------------------------------------------
// Re-declare minimal types locally to avoid cross-rootDir imports.
// These mirror the canonical types in cli-agent-runner.ts.
// ---------------------------------------------------------------------------

type AgentType = 'claude-code' | 'codex' | 'gemini' | 'qwen' | 'opencode' | 'pi' | 'grok';

type AgentProcessStatus =
  | 'spawning'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

interface AgentConfig {
  type: AgentType;
  prompt: string;
  workDir: string;
  env?: Record<string, string>;
  model?: string;
  approvalMode?: 'suggest' | 'auto';
}

interface AgentProcess {
  id: string;
  type: AgentType;
  status: AgentProcessStatus;
  config: AgentConfig;
  startedAt: string;
  pid?: number;
}

interface NormalizedEntryBase {
  id: string;
  processId: string;
  timestamp: string;
}

type NormalizedEntry =
  | (NormalizedEntryBase & { type: 'user_message'; content: string })
  | (NormalizedEntryBase & { type: 'assistant_message'; content: string; partial: boolean })
  | (NormalizedEntryBase & { type: 'thinking'; content: string })
  | (NormalizedEntryBase & { type: 'tool_use'; name: string; input: Record<string, unknown>; status: string; result?: string })
  | (NormalizedEntryBase & { type: 'file_change'; path: string; action: string; diff?: string })
  | (NormalizedEntryBase & { type: 'command_exec'; command: string; exitCode?: number; output?: string })
  | (NormalizedEntryBase & { type: 'approval_request'; toolName: string; toolInput: Record<string, unknown>; requestId: string })
  | (NormalizedEntryBase & { type: 'approval_response'; requestId: string; allowed: boolean })
  | (NormalizedEntryBase & { type: 'error'; message: string; code?: string })
  | (NormalizedEntryBase & { type: 'status_change'; status: AgentProcessStatus; reason?: string })
  | (NormalizedEntryBase & { type: 'token_usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number });

/** Minimal adapter interface matching BaseAgentAdapter's public surface */
interface AdapterLike {
  spawn(config: AgentConfig): Promise<AgentProcess>;
  stop(processId: string): Promise<void>;
  onEntry(processId: string, cb: (entry: NormalizedEntry) => void): () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const MAX_STALE_CYCLES = 60;  // 60 * 2s = 120s stale timeout
const STARTUP_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// TerminalAdapter
// ---------------------------------------------------------------------------

interface PaneState {
  paneId: string;
  polling: boolean;
}

export class TerminalAdapter implements AdapterLike {
  private readonly panes = new Map<string, PaneState>();
  private readonly listeners = new Map<string, Set<(entry: NormalizedEntry) => void>>();

  constructor(
    private readonly backend: TerminalBackend,
    private readonly toolCmd: string,  // e.g. 'gemini', 'codex'
  ) {}

  async spawn(config: AgentConfig): Promise<AgentProcess> {
    const processId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Create pane with the CLI tool running
    const paneId = await this.backend.createPane({
      cwd: config.workDir,
      cmd: this.toolCmd,
    });

    this.panes.set(processId, { paneId, polling: true });

    // Wait for tool to start, then inject prompt
    await sleep(STARTUP_DELAY_MS);
    await this.backend.sendText(paneId, config.prompt);

    // Start polling for output (fire-and-forget async loop)
    this.pollOutput(processId, paneId);

    return {
      id: processId,
      type: config.type,
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
    };
  }

  async stop(processId: string): Promise<void> {
    const pane = this.panes.get(processId);
    if (!pane) return;

    pane.polling = false;
    await this.backend.killPane(pane.paneId);
    this.panes.delete(processId);

    this.emit(processId, {
      id: `${processId}-stop`,
      processId,
      timestamp: new Date().toISOString(),
      type: 'status_change',
      status: 'stopped',
      reason: 'manual stop',
    });
  }

  onEntry(processId: string, cb: (entry: NormalizedEntry) => void): () => void {
    if (!this.listeners.has(processId)) {
      this.listeners.set(processId, new Set());
    }
    this.listeners.get(processId)!.add(cb);
    return () => {
      this.listeners.get(processId)?.delete(cb);
    };
  }

  // -------------------------------------------------------------------------
  // Polling loop — getText diff every 2s, 120s stale timeout
  // -------------------------------------------------------------------------

  private async pollOutput(processId: string, paneId: string): Promise<void> {
    let lastContent = '';
    let staleCount = 0;

    while (this.panes.get(processId)?.polling) {
      await sleep(POLL_INTERVAL_MS);

      // Check if pane is still alive
      const alive = await this.backend.isAlive(paneId);
      if (!alive) {
        this.emit(processId, {
          id: `${processId}-done`,
          processId,
          timestamp: new Date().toISOString(),
          type: 'status_change',
          status: 'stopped',
          reason: 'pane exited',
        });
        this.panes.delete(processId);
        break;
      }

      // Capture pane content and diff against previous snapshot
      const content = await this.backend.getText(paneId, 100);
      if (content !== lastContent) {
        const newContent = content.slice(lastContent.length);
        if (newContent.trim()) {
          this.emit(processId, {
            id: `${processId}-${Date.now()}`,
            processId,
            timestamp: new Date().toISOString(),
            type: 'assistant_message',
            content: newContent,
            partial: true,
          });
        }
        lastContent = content;
        staleCount = 0;
      } else {
        staleCount++;
        if (staleCount >= MAX_STALE_CYCLES) {
          this.emit(processId, {
            id: `${processId}-timeout`,
            processId,
            timestamp: new Date().toISOString(),
            type: 'status_change',
            status: 'stopped',
            reason: 'output stale timeout (120s)',
          });
          this.panes.delete(processId);
          break;
        }
      }
    }
  }

  private emit(processId: string, entry: NormalizedEntry): void {
    const cbs = this.listeners.get(processId);
    if (cbs) {
      cbs.forEach(cb => cb(entry));
    }
  }
}

// ---------------------------------------------------------------------------
// AgentSdkAdapter — bridges @anthropic-ai/claude-agent-sdk to BaseAgentAdapter
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentConfig,
  AgentProcess,
  ApprovalDecision,
  ApprovalRequest,
} from '../../shared/agent-types.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgentAdapter } from './base-adapter.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { SdkMessageTranslator } from './sdk-message-translator.js';
import { createIssueMcpServer } from './tools/issue-mcp-server.js';

// ---------------------------------------------------------------------------
// Pending approval tracking
// ---------------------------------------------------------------------------

interface PendingApproval {
  requestId: string;
  processId: string;
  resolve: (result: PermissionResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** Auto-deny timeout for pending approvals (5 minutes) */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class AgentSdkAdapter extends BaseAgentAdapter {
  readonly agentType = 'agent-sdk' as const;

  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private issueMcpServer: McpSdkServerConfigWithInstance | null = null;
  private readonly issueMcpServerPromise: Promise<McpSdkServerConfigWithInstance> | null;

  constructor(workflowRoot?: string) {
    super();
    this.issueMcpServerPromise = workflowRoot ? createIssueMcpServer(workflowRoot) : null;
  }

  private async getIssueMcpServer(): Promise<McpSdkServerConfigWithInstance | null> {
    if (!this.issueMcpServerPromise) return null;
    if (!this.issueMcpServer) {
      this.issueMcpServer = await this.issueMcpServerPromise;
    }
    return this.issueMcpServer;
  }

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const abortController = new AbortController();
    this.abortControllers.set(processId, abortController);

    const agentProcess: AgentProcess = {
      id: processId,
      type: 'agent-sdk',
      status: 'spawning',
      config,
      startedAt: new Date().toISOString(),
      interactive: false,
    };

    // Fire-and-forget the SDK query — errors are handled inside
    this.runAgentQuery(processId, config, abortController).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEntry(processId, EntryNormalizer.error(processId, message, 'sdk_error'));
      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'error', message),
      );
      const proc = this.getProcess(processId);
      if (proc) {
        proc.status = 'error';
      }
    });

    return agentProcess;
  }

  protected async doStop(processId: string): Promise<void> {
    // Update status
    const proc = this.getProcess(processId);
    if (proc) {
      proc.status = 'stopping';
      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'stopping', 'User requested stop'),
      );
    }

    // Abort the SDK query
    const controller = this.abortControllers.get(processId);
    if (controller) {
      controller.abort();
    }

    // Deny all pending approvals for this process
    this.denyAllPendingApprovals(processId);

    // Cleanup
    this.abortControllers.delete(processId);
  }

  protected async doSendMessage(
    _processId: string,
    _content: string,
  ): Promise<void> {
    throw new Error('AgentSdkAdapter does not support interactive messages');
  }

  protected async doRespondApproval(decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.id);
    if (!pending) {
      throw new Error(`No pending approval found with id: ${decision.id}`);
    }

    // Clear the timeout
    clearTimeout(pending.timeoutId);

    // Build the permission result
    const result: PermissionResult = decision.allow
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'User denied permission' };

    // Resolve the promise to unblock the SDK
    pending.resolve(result);

    // Emit approval response entry
    this.emitEntry(
      decision.processId,
      EntryNormalizer.approvalResponse(decision.processId, decision.id, decision.allow),
    );

    // Cleanup
    this.pendingApprovals.delete(decision.id);
  }

  // --- Private: SDK query execution ----------------------------------------

  private async runAgentQuery(
    processId: string,
    config: AgentConfig,
    abortController: AbortController,
  ): Promise<void> {
    const translator = new SdkMessageTranslator(processId);

    // Build SDK options
    const options: Options = {
      abortController,
      cwd: config.workDir,
      model: config.model,
      settingSources: ['project'],
    };

    // When settingsFile is set, use settings file path and dontAsk mode
    if (config.settingsFile) {
      (options as Record<string, unknown>).settings = config.settingsFile;
      options.permissionMode = 'dontAsk';
    } else {
      // Existing env-based behavior
      if (config.env || config.baseUrl || config.apiKey) {
        options.env = { ...process.env, ...config.env };
      }
      if (config.baseUrl) {
        options.env = options.env ?? { ...process.env };
        options.env.ANTHROPIC_BASE_URL = config.baseUrl;
      }
      if (config.apiKey) {
        options.env = options.env ?? { ...process.env };
        options.env.ANTHROPIC_API_KEY = config.apiKey;
      }

      // Set permission mode based on config
      const permissionMode = this.resolvePermissionMode(config);
      options.permissionMode = permissionMode;

      // If not bypassing permissions, install the canUseTool callback
      if (permissionMode !== 'bypassPermissions') {
        options.canUseTool = this.createCanUseToolCallback(processId);
      } else {
        options.allowDangerouslySkipPermissions = true;
      }
    }

    // Inject issue MCP server if available
    const issueMcp = await this.getIssueMcpServer();
    if (issueMcp) {
      options.mcpServers = { 'issue-monitor': issueMcp };
    }

    // Start the query
    const queryInstance: Query = query({ prompt: config.prompt, options });

    // Update status to running
    const proc = this.getProcess(processId);
    if (proc) {
      proc.status = 'running';
    }
    this.emitEntry(
      processId,
      EntryNormalizer.statusChange(processId, 'running'),
    );

    // Iterate the async generator
    for await (const msg of queryInstance) {
      // Treat each message as a record for the translator
      const entries = translator.translate(msg as unknown as Record<string, unknown>);
      for (const entry of entries) {
        this.emitEntry(processId, entry);
      }
    }

    // Query completed normally
    const completedProc = this.getProcess(processId);
    if (completedProc && completedProc.status !== 'error' && completedProc.status !== 'stopping') {
      completedProc.status = 'stopped';
      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'stopped', 'Query completed'),
      );
    }

    // Cleanup
    this.abortControllers.delete(processId);
  }

  // --- Private: Permission handling ----------------------------------------

  private createCanUseToolCallback(processId: string): CanUseTool {
    return async (toolName, input, cbOptions) => {
      return this.handleCanUseTool(processId, toolName, input, cbOptions.signal);
    };
  }

  private handleCanUseTool(
    processId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const requestId = randomUUID();

    return new Promise<PermissionResult>((resolve) => {
      // Auto-deny after timeout
      const timeoutId = setTimeout(() => {
        if (this.pendingApprovals.has(requestId)) {
          this.pendingApprovals.delete(requestId);
          this.emitEntry(
            processId,
            EntryNormalizer.approvalResponse(processId, requestId, false),
          );
          resolve({ behavior: 'deny', message: 'Approval timed out (5 minutes)' });
        }
      }, APPROVAL_TIMEOUT_MS);

      // Store the pending approval
      const pending: PendingApproval = {
        requestId,
        processId,
        resolve,
        timeoutId,
      };
      this.pendingApprovals.set(requestId, pending);

      // Listen for abort to clean up
      const onAbort = () => {
        if (this.pendingApprovals.has(requestId)) {
          clearTimeout(timeoutId);
          this.pendingApprovals.delete(requestId);
          resolve({ behavior: 'deny', message: 'Operation aborted' });
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });

      // Emit the approval request entry
      this.emitEntry(
        processId,
        EntryNormalizer.approvalRequest(processId, toolName, toolInput, requestId),
      );

      // Emit the approval event so listeners can present the UI
      const request: ApprovalRequest = {
        id: requestId,
        processId,
        toolName,
        toolInput,
        timestamp: new Date().toISOString(),
      };
      this.emitApproval(processId, request);
    });
  }

  // --- Private: Helpers ----------------------------------------------------

  private resolvePermissionMode(config: AgentConfig): PermissionMode {
    if (config.approvalMode === 'auto') {
      return 'bypassPermissions';
    }
    return 'default';
  }

  private denyAllPendingApprovals(processId: string): void {
    for (const [id, pending] of this.pendingApprovals) {
      if (pending.processId === processId) {
        clearTimeout(pending.timeoutId);
        pending.resolve({ behavior: 'deny', message: 'Process stopped' });
        this.emitEntry(
          processId,
          EntryNormalizer.approvalResponse(processId, id, false),
        );
        this.pendingApprovals.delete(id);
      }
    }
  }
}

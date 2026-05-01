// ---------------------------------------------------------------------------
// CLI Agent Runner
// Orchestrates adapter selection, process spawning, stdout rendering, and
// exit handling for the `maestro cli` command.
// ---------------------------------------------------------------------------
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { DashboardBridge } from './dashboard-bridge.js';
import { CliHistoryStore } from './cli-history-store.js';
import { loadTemplate, loadProtocol } from '../config/template-discovery.js';
import { loadSpecs } from '../tools/spec-loader.js';
import { NOTIFY_PREFIX } from '../hooks/constants.js';
import { DelegateBrokerClient } from '../async/index.js';
// ---------------------------------------------------------------------------
// Tool name -> AgentType mapping
// ---------------------------------------------------------------------------
const TOOL_TO_AGENT_TYPE = {
    gemini: 'gemini',
    'gemini-a2a': 'gemini-a2a',
    qwen: 'qwen',
    codex: 'codex',
    'codex-server': 'codex-server',
    claude: 'claude-code',
    opencode: 'opencode',
};
// ---------------------------------------------------------------------------
// AgentType -> terminal CLI command mapping
// ---------------------------------------------------------------------------
const AGENT_TYPE_TO_TERMINAL_CMD = {
    'gemini': 'gemini',
    'gemini-a2a': 'gemini',
    'qwen': 'qwen',
    'codex': 'codex',
    'codex-server': 'codex',
    'claude-code': 'claude',
    'opencode': 'opencode',
};
// ---------------------------------------------------------------------------
// Execution ID generation
// ---------------------------------------------------------------------------
const TOOL_PREFIX = {
    gemini: 'gem',
    'gemini-a2a': 'gma',
    qwen: 'qwn',
    codex: 'cdx',
    'codex-server': 'cxs',
    claude: 'cld',
    opencode: 'opc',
};
export function generateCliExecId(tool) {
    const prefix = TOOL_PREFIX[tool] ?? 'run';
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const rand = randomBytes(2).toString('hex'); // 4 hex chars
    return `${prefix}-${hh}${mm}${ss}-${rand}`;
}
// ---------------------------------------------------------------------------
// Prompt assembly — protocol + user prompt + template
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Role → Spec category mapping
// ---------------------------------------------------------------------------
const ROLE_SPEC_CATEGORIES = {
    analyze: ['arch', 'coding', 'quality'],
    explore: ['arch', 'coding'],
    review: ['review', 'quality', 'coding'],
    implement: ['coding', 'arch', 'quality', 'test'],
    plan: ['arch', 'coding'],
    brainstorm: ['arch'],
    research: ['arch'],
};
const MODE_SPEC_CATEGORIES = {
    analysis: ['arch', 'coding', 'quality', 'review'],
    write: ['coding', 'arch', 'quality', 'test'],
};
async function assemblePrompt(userPrompt, mode, rule, workDir, role) {
    const parts = [];
    // 1. Load mode protocol
    const protocol = await loadProtocol(mode);
    if (protocol) {
        parts.push(protocol);
    }
    // 2. Pre-load project specs — category filtered by role, then mode fallback
    if (workDir) {
        try {
            const categories = role
                ? ROLE_SPEC_CATEGORIES[role]
                : MODE_SPEC_CATEGORIES[mode];
            const specParts = [];
            if (categories) {
                for (const cat of categories) {
                    const result = loadSpecs(workDir, cat);
                    if (result.content) {
                        specParts.push(result.content);
                    }
                }
            }
            if (specParts.length === 0) {
                // Fallback: load all specs
                const allResult = loadSpecs(workDir);
                if (allResult.content) {
                    specParts.push(allResult.content);
                }
            }
            if (specParts.length > 0) {
                parts.push(`[PROJECT SPECS]\n\n${specParts.join('\n\n')}`);
            }
        }
        catch {
            // Specs are optional — continue without them
        }
    }
    // 3. User prompt
    parts.push(userPrompt);
    // 4. Load rule template (if specified)
    if (rule) {
        const template = await loadTemplate(rule);
        if (template) {
            parts.push(template);
        }
        else {
            console.error(`Warning: template "${rule}" not found, proceeding without it.`);
        }
    }
    return parts.join('\n\n');
}
// ---------------------------------------------------------------------------
// Adapter factory — uses package.json imports for cross-rootDir resolution
// ---------------------------------------------------------------------------
async function createAdapter(agentType, backend) {
    if (backend === 'terminal') {
        const { detectBackend } = await import('./terminal-backend.js');
        const { TerminalAdapter } = await import('./terminal-adapter.js');
        const termBackend = detectBackend();
        if (!termBackend) {
            throw new Error('No terminal multiplexer detected (need TMUX or WEZTERM_PANE env)');
        }
        const cmd = AGENT_TYPE_TO_TERMINAL_CMD[agentType] ?? agentType;
        return new TerminalAdapter(termBackend, cmd);
    }
    const mod = await import('#maestro-dashboard/agents/adapter-factory.js');
    const factory = mod.createAdapterForType;
    return await factory(agentType);
}
// ---------------------------------------------------------------------------
// Entry renderer — writes normalized entries to stdout/stderr
// ---------------------------------------------------------------------------
function renderEntry(entry) {
    switch (entry.type) {
        case 'assistant_message':
            process.stdout.write(entry.content);
            break;
        case 'tool_use':
            if (entry.status === 'running') {
                console.log(`[Tool: ${entry.name}]`);
            }
            else if (entry.status === 'completed' || entry.status === 'failed') {
                console.log(`[Tool ${entry.name}: ${entry.status}]`);
                if (entry.result) {
                    console.log(entry.result);
                }
            }
            break;
        case 'error':
            console.error(`Error: ${entry.message}`);
            break;
        case 'file_change':
            console.log(`[File ${entry.action}: ${entry.path}]`);
            break;
        case 'command_exec':
            console.log(`[Exec: ${entry.command}]`);
            break;
        case 'token_usage':
            console.log(`[Tokens: ${entry.inputTokens}in/${entry.outputTokens}out]`);
            break;
        // Silently skip: user_message, thinking, approval_request,
        // approval_response, status_change (handled by the runner itself)
        default:
            break;
    }
}
function buildJobMetadata(options) {
    const metadata = {
        tool: options.tool,
        mode: options.mode,
        workDir: options.workDir,
        prompt: options.prompt.substring(0, 200),
        cancelRequestedAt: null,
        cancelRequestedBy: null,
        cancelReason: null,
    };
    if (options.model) {
        metadata.model = options.model;
    }
    if (options.rule) {
        metadata.rule = options.rule;
    }
    if (options.backend) {
        metadata.backend = options.backend;
    }
    if (options.sessionId) {
        metadata.sessionId = options.sessionId;
    }
    if (options.includeDirs && options.includeDirs.length > 0) {
        metadata.includeDirs = options.includeDirs;
    }
    return metadata;
}
function mergeJsonObjects(base, patch) {
    return patch ? { ...base, ...patch } : { ...base };
}
function spawnQueuedDelegateWorker(options, execId, prompt) {
    const entryScript = process.argv[1];
    if (!entryScript) {
        return false;
    }
    const args = [
        entryScript,
        'delegate',
        prompt,
        '--worker',
        '--to',
        options.tool,
        '--mode',
        options.mode,
        '--cd',
        options.workDir,
        '--id',
        execId,
        '--backend',
        options.backend ?? 'direct',
        '--resume',
        execId,
    ];
    if (options.model) {
        args.push('--model', options.model);
    }
    if (options.rule) {
        args.push('--rule', options.rule);
    }
    if (options.includeDirs && options.includeDirs.length > 0) {
        args.push('--includeDirs', options.includeDirs.join(','));
    }
    if (options.sessionId) {
        args.push('--session', options.sessionId);
    }
    const child = spawn(process.execPath, args, {
        cwd: options.workDir,
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            MAESTRO_DISABLE_DASHBOARD_BRIDGE: '1',
        },
    });
    child.unref();
    return true;
}
function isTerminalStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function summarizeEntry(entry) {
    switch (entry.type) {
        case 'assistant_message':
            return entry.content.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Assistant response updated';
        case 'tool_use':
            return `Tool ${entry.name} ${entry.status}`;
        case 'file_change':
            return `File ${entry.action}: ${entry.path}`;
        case 'command_exec':
            return `Command: ${entry.command}`;
        case 'error':
            return entry.message;
        case 'status_change':
            return `Status changed to ${entry.status}`;
        default:
            return `Event: ${entry.type}`;
    }
}
/** Snapshots are disabled during execution — only start and end events are published. */
function shouldPublishSnapshot(_entry) {
    return false;
}
function createNoopBridge() {
    return {
        async tryConnect() {
            return false;
        },
        forwardSpawn() {
            return;
        },
        forwardEntry() {
            return;
        },
        forwardStopped() {
            return;
        },
        close() {
            return;
        },
    };
}
// ---------------------------------------------------------------------------
// CliAgentRunner
// ---------------------------------------------------------------------------
export class CliAgentRunner {
    dependencies;
    constructor(dependencies = {}) {
        this.dependencies = dependencies;
    }
    /** Resolve dashboard WS URL from env → config → default port 3001 */
    static getDashboardWsUrl() {
        const envPort = process.env.MAESTRO_DASHBOARD_PORT;
        if (envPort) {
            const p = parseInt(envPort, 10);
            if (!isNaN(p))
                return `ws://127.0.0.1:${p}/ws`;
        }
        try {
            const configPath = resolve(process.cwd(), '.workflow', 'config.json');
            const raw = readFileSync(configPath, 'utf-8');
            const json = JSON.parse(raw);
            const dashboard = json['dashboard'];
            if (dashboard?.port && typeof dashboard.port === 'number') {
                return `ws://127.0.0.1:${dashboard.port}/ws`;
            }
        }
        catch {
            // Config missing or unreadable — use default
        }
        return 'ws://127.0.0.1:3001/ws';
    }
    /**
     * Send MCP channel notification (primary path).
     * If maestro MCP server is running in this process, push a
     * notifications/claude/channel message directly.
     */
    static sendChannelNotification(_sessionId, execId, tool, mode, status, exitCode) {
        try {
            // Dynamic import to avoid circular dependency — getMcpServer is exported
            // from mcp/server.ts which may not be loaded in CLI-only mode.
            const { getMcpServer } = require('../mcp/server.js');
            const server = getMcpServer();
            if (!server)
                return;
            const label = status === 'completed'
                ? 'DONE'
                : status === 'cancelled'
                    ? 'CANCELLED'
                    : 'FAILED';
            const content = `[DELEGATE ${label}] ${execId} ${tool}/${mode} ${status === 'failed' ? `exit:${exitCode}` : status}`;
            // Fire-and-forget notification via MCP protocol
            server.notification({
                method: 'notifications/claude/channel',
                params: {
                    content,
                    meta: { exec_id: execId, job_id: execId, tool, mode, exit_code: String(exitCode), event_type: status, status },
                },
            }).catch((err) => { console.error(`[${execId}] MCP notification send failed: ${err instanceof Error ? err.message : err}`); });
        }
        catch (err) {
            console.error(`[${execId}] MCP server not available for channel notification: ${err instanceof Error ? err.message : err}`);
        }
    }
    /**
     * Run a CLI agent to completion and return its exit code (0 = success).
     */
    async run(options) {
        const agentType = TOOL_TO_AGENT_TYPE[options.tool]
            ?? (options.baseTool ? TOOL_TO_AGENT_TYPE[options.baseTool] : undefined);
        if (!agentType) {
            console.error(`Unknown tool: ${options.tool}`);
            return 1;
        }
        // Generate or use provided execution ID
        const execId = options.execId ?? generateCliExecId(options.tool);
        process.stderr.write(`[MAESTRO_EXEC_ID=${execId}]\n`);
        // History store for persistence and resume
        const store = new CliHistoryStore();
        const syncMode = options.sync === true;
        const broker = syncMode ? undefined : (this.dependencies.brokerClient ?? new DelegateBrokerClient());
        const now = this.dependencies.now ?? (() => new Date().toISOString());
        const jobMetadata = syncMode ? {} : buildJobMetadata(options);
        // Handle --resume: prepend previous session context to user prompt
        let userPrompt = options.prompt;
        if (options.resume) {
            let resumeId = options.resume;
            if (resumeId === 'last') {
                const recent = store.listRecent(1);
                resumeId = recent.length > 0 ? recent[0].execId : '';
            }
            if (resumeId) {
                userPrompt = store.buildResumePrompt(resumeId, userPrompt);
            }
            else {
                console.error('No previous execution found for --resume');
            }
        }
        // Assemble final prompt: protocol + user prompt + template
        const finalPrompt = await assemblePrompt(userPrompt, options.mode, options.rule, options.workDir, options.role);
        const adapterFactory = this.dependencies.createAdapter ?? createAdapter;
        const adapter = await adapterFactory(agentType, options.backend);
        // Optional Dashboard bridge — connect silently, don't block startup
        const bridgeEnabled = process.env.MAESTRO_DISABLE_DASHBOARD_BRIDGE !== '1';
        const bridge = bridgeEnabled
            ? (this.dependencies.createBridge?.() ?? new DashboardBridge())
            : createNoopBridge();
        const bridgeConnected = bridgeEnabled
            ? await bridge.tryConnect(CliAgentRunner.getDashboardWsUrl(), 1000)
            : false;
        if (!bridgeConnected) {
            process.stderr.write('[Dashboard not connected — real-time view unavailable]\n');
        }
        const config = {
            type: agentType,
            prompt: finalPrompt,
            workDir: options.workDir,
            model: options.model,
            approvalMode: options.mode === 'write' ? 'auto' : 'suggest',
            interactive: adapter.supportsInteractive?.() === true,
            settingsFile: options.settingsFile?.replace(/^~(?=[\\/])/, homedir()),
        };
        const agentProcess = await adapter.spawn(config);
        bridge.forwardSpawn(agentProcess);
        const agentJobMetadata = {
            ...jobMetadata,
            agentProcessId: agentProcess.id,
        };
        store.saveMeta(execId, {
            execId,
            tool: options.tool,
            model: options.model,
            mode: options.mode,
            prompt: options.prompt.substring(0, 500),
            workDir: options.workDir,
            startedAt: agentProcess.startedAt,
        });
        /** Write a snapshot-style progress line to stderr (sync mode). */
        const writeStreamLog = (label, summary) => {
            process.stderr.write(`[DELEGATE ${label}] ${execId} ${summary}\n`);
        };
        const publishEvent = (type, status, summary, extraPayload = {}, extraJobMetadata) => {
            if (syncMode) {
                // In sync mode, write progress to stderr instead of broker
                const label = status === 'running' ? 'RUNNING'
                    : status === 'completed' ? 'DONE'
                        : status === 'failed' ? 'FAILED'
                            : status === 'cancelled' ? 'CANCELLED'
                                : status.toUpperCase();
                writeStreamLog(label, summary);
                return;
            }
            try {
                const snapshot = store.buildSnapshot(execId);
                broker.publishEvent({
                    jobId: execId,
                    type,
                    status,
                    snapshot: snapshot,
                    payload: {
                        execId,
                        summary,
                        ...extraPayload,
                    },
                    jobMetadata: mergeJsonObjects(agentJobMetadata, extraJobMetadata),
                });
            }
            catch {
                // Broker publication is best-effort and must not break CLI execution
            }
        };
        publishEvent('status_update', 'running', `${options.tool}/${options.mode} started`);
        // Safety net: if the process exits without a stopped event (e.g. Windows
        // shell process tree doesn't fire exit/close reliably), write meta.json
        // from the synchronous process.on('exit') handler as a last resort.
        let metaWritten = false;
        let cancellationRequested = !syncMode && Boolean(broker.getJob(execId)?.metadata?.cancelRequestedAt);
        let cancellationInitiated = false;
        let cancellationPoller = null;
        const clearCancellationPoller = () => {
            if (cancellationPoller) {
                clearInterval(cancellationPoller);
                cancellationPoller = null;
            }
        };
        const saveMeta = (status, exitCode) => {
            if (metaWritten)
                return;
            metaWritten = true;
            const completedAt = now();
            store.saveMeta(execId, {
                execId,
                tool: options.tool,
                model: options.model,
                mode: options.mode,
                prompt: options.prompt.substring(0, 500),
                workDir: options.workDir,
                startedAt: agentProcess.startedAt,
                completedAt,
                exitCode,
                ...(status === 'cancelled' ? { cancelledAt: completedAt } : {}),
            });
            publishEvent(status, status, `${options.tool}/${options.mode} ${status}`, {
                exitCode,
                completedAt,
                status,
            });
            // Write delegate completion notification (for hook fallback) — skip in sync mode
            if (!syncMode) {
                const sessionId = options.sessionId;
                if (sessionId) {
                    // JSONL file write (for hook fallback)
                    try {
                        const notifyPath = join(tmpdir(), `${NOTIFY_PREFIX}${sessionId}.jsonl`);
                        const entry = JSON.stringify({
                            execId,
                            tool: options.tool,
                            mode: options.mode,
                            prompt: options.prompt.substring(0, 200),
                            exitCode,
                            completedAt,
                            status,
                        });
                        appendFileSync(notifyPath, entry + '\n', 'utf-8');
                    }
                    catch (err) {
                        console.error(`[${execId}] Failed to write JSONL notification: ${err instanceof Error ? err.message : err}`);
                    }
                    // MCP channel notification (primary path)
                    try {
                        CliAgentRunner.sendChannelNotification(sessionId, execId, options.tool, options.mode, status, exitCode);
                    }
                    catch (err) {
                        console.error(`[${execId}] Failed to send channel notification: ${err instanceof Error ? err.message : err}`);
                    }
                }
            }
        };
        const processExitHandler = () => {
            // Also write the stopped JSONL entry so the history is complete
            // even if the adapter's stopped event was lost (Windows edge case).
            try {
                store.appendEntry(execId, {
                    type: 'status_change',
                    status: 'stopped',
                    reason: 'Process exit (safety net)',
                    timestamp: now(),
                });
            }
            catch { /* best-effort — process is exiting */ }
            saveMeta(cancellationRequested ? 'cancelled' : 'completed', cancellationRequested ? 130 : 0);
        };
        process.on('exit', processExitHandler);
        const requestCancellation = async () => {
            cancellationRequested = true;
            if (cancellationInitiated) {
                return;
            }
            cancellationInitiated = true;
            publishEvent('status_update', 'running', `Cancellation requested for ${execId}`, {
                cancelRequested: true,
            });
            try {
                await adapter.stop(agentProcess.id);
            }
            catch {
                // Adapter stop failures are surfaced by subsequent process status events.
            }
        };
        const dispatchQueuedFollowup = (finalStatus) => {
            if (!broker)
                return;
            let queuedMessage;
            try {
                queuedMessage = broker.listMessages(execId).find((message) => (message.status === 'queued'
                    && ((message.delivery === 'inject'
                        && (finalStatus === 'cancelled' || finalStatus === 'completed' || finalStatus === 'failed'))
                        || (message.delivery === 'after_complete' && finalStatus === 'completed'))));
            }
            catch {
                return;
            }
            if (!queuedMessage) {
                return;
            }
            const dispatchedAt = now();
            let launched = false;
            try {
                launched = (this.dependencies.spawnDetachedDelegate ?? spawnQueuedDelegateWorker)(options, execId, queuedMessage.message);
            }
            catch {
                launched = false;
            }
            if (!launched) {
                broker.updateMessage({
                    jobId: execId,
                    messageId: queuedMessage.messageId,
                    status: 'dropped',
                    dispatchReason: 'missing-entry-script',
                    now: dispatchedAt,
                });
                return;
            }
            broker.updateMessage({
                jobId: execId,
                messageId: queuedMessage.messageId,
                status: 'dispatched',
                dispatchReason: finalStatus,
                now: dispatchedAt,
            });
            publishEvent('status_update', finalStatus, `Queued follow-up dispatched via ${queuedMessage.delivery}`, {
                delivery: queuedMessage.delivery,
                messageId: queuedMessage.messageId,
            }, {
                cancelRequestedAt: null,
                cancelRequestedBy: null,
                cancelReason: null,
            });
        };
        const inFlightMessageIds = new Set();
        if (!syncMode && !isTerminalStatus(broker.getJob(execId)?.status)) {
            cancellationPoller = setInterval(() => {
                try {
                    const job = broker.getJob(execId);
                    if (job?.metadata?.cancelRequestedAt && !cancellationInitiated) {
                        void requestCancellation();
                    }
                }
                catch {
                    // Best-effort polling only.
                }
                // Poll for inject messages and auto-route based on adapter capabilities
                try {
                    const injectMessages = broker.listMessages(execId)
                        .filter((msg) => msg.status === 'queued' && msg.delivery === 'inject' && !inFlightMessageIds.has(msg.messageId))
                        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                    for (const msg of injectMessages) {
                        const polledNow = now();
                        if (adapter.sendMessage && (adapter.supportsInteractive?.() !== false)) {
                            // Interactive adapter: inject via stdin without interruption
                            inFlightMessageIds.add(msg.messageId);
                            void adapter.sendMessage(agentProcess.id, msg.message).then(() => {
                                broker.updateMessage({
                                    jobId: execId,
                                    messageId: msg.messageId,
                                    status: 'injected',
                                    dispatchReason: 'inject-streaming',
                                    now: polledNow,
                                });
                            }).catch(() => {
                                broker.updateMessage({
                                    jobId: execId,
                                    messageId: msg.messageId,
                                    status: 'dropped',
                                    dispatchReason: 'send-failed',
                                    now: polledNow,
                                });
                            }).finally(() => {
                                inFlightMessageIds.delete(msg.messageId);
                            });
                        }
                        else {
                            // Non-interactive adapter: fall back to cancel + resume
                            if (!cancellationInitiated) {
                                void requestCancellation();
                            }
                            break; // Messages stay queued for dispatchQueuedFollowup after restart
                        }
                    }
                }
                catch {
                    // Best-effort inject message polling.
                }
            }, 750);
        }
        if (cancellationRequested) {
            void requestCancellation();
        }
        return new Promise((resolvePromise) => {
            const unsubscribe = adapter.onEntry(agentProcess.id, (entry) => {
                // Persist entry to JSONL history before rendering
                store.appendEntry(execId, entry);
                (this.dependencies.renderEntry ?? renderEntry)(entry);
                bridge.forwardEntry(entry);
                if (syncMode) {
                    // In sync mode, stream key events to stderr as progress logs
                    if (entry.type === 'tool_use' && (entry.status === 'completed' || entry.status === 'failed')) {
                        writeStreamLog('RUNNING', `Tool ${entry.name} ${entry.status}`);
                    }
                    else if (entry.type === 'file_change') {
                        writeStreamLog('RUNNING', `File ${entry.action}: ${entry.path}`);
                    }
                    else if (entry.type === 'command_exec') {
                        writeStreamLog('RUNNING', `Command: ${entry.command}`);
                    }
                    else if (entry.type === 'error') {
                        writeStreamLog('RUNNING', `Error: ${entry.message}`);
                    }
                }
                else if (shouldPublishSnapshot(entry)) {
                    publishEvent('snapshot', 'running', summarizeEntry(entry), {
                        entryType: entry.type,
                    });
                }
                // Approval workflow: publish input_required when agent requests approval,
                // and resume to running when the user responds.
                if (entry.type === 'approval_request') {
                    publishEvent('input_required', 'input_required', `Approval requested: ${entry.toolName}`, {
                        entryType: entry.type,
                        toolName: entry.toolName,
                        requestId: entry.requestId,
                    });
                }
                if (entry.type === 'approval_response') {
                    publishEvent('status_update', 'running', `Approval response received: ${entry.requestId}`, {
                        entryType: entry.type,
                        requestId: entry.requestId,
                        allowed: entry.allowed,
                    });
                }
                // Interactive mode: when Claude emits token_usage (end of turn) and no
                // more inject messages are queued, close stdin to let the process exit.
                if (config.interactive && entry.type === 'token_usage' && broker) {
                    try {
                        const pending = broker.listMessages(execId)
                            .filter((m) => m.status === 'queued' && m.delivery === 'inject');
                        if (pending.length === 0 && !cancellationRequested) {
                            adapter.endInput?.(agentProcess.id);
                        }
                    }
                    catch { /* best-effort */ }
                }
                // Resolve when the agent process stops
                if (entry.type === 'status_change' && entry.status === 'stopped') {
                    clearCancellationPoller();
                    const finalStatus = cancellationRequested ? 'cancelled' : 'completed';
                    saveMeta(finalStatus, cancellationRequested ? 130 : 0);
                    if (!syncMode)
                        dispatchQueuedFollowup(finalStatus);
                    process.removeListener('exit', processExitHandler);
                    bridge.forwardStopped(agentProcess.id);
                    bridge.close();
                    unsubscribe();
                    resolvePromise(cancellationRequested ? 130 : 0);
                }
                // Resolve with error code on error status
                if (entry.type === 'status_change' && entry.status === 'error') {
                    clearCancellationPoller();
                    const finalStatus = cancellationRequested ? 'cancelled' : 'failed';
                    saveMeta(finalStatus, cancellationRequested ? 130 : 1);
                    if (!syncMode)
                        dispatchQueuedFollowup(finalStatus);
                    process.removeListener('exit', processExitHandler);
                    bridge.forwardStopped(agentProcess.id);
                    bridge.close();
                    unsubscribe();
                    resolvePromise(cancellationRequested ? 130 : 1);
                }
            });
        });
    }
}
//# sourceMappingURL=cli-agent-runner.js.map
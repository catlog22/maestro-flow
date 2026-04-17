import { type SpawnOptions } from 'node:child_process';
import { Command } from 'commander';
import { CliHistoryStore } from '../agents/cli-history-store.js';
import { DelegateBrokerClient } from '../async/index.js';
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
export declare function buildDetachedDelegateWorkerArgs(request: DelegateExecutionRequest, entryScript?: string): string[];
export declare function launchDetachedDelegateWorker(request: DelegateExecutionRequest, options?: LaunchDetachedDelegateOptions): void;
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
export declare function readLiveRelayRecords(asyncDir: string): RelayRecord[];
/** Check if the MCP notification channel is functional for the current session. */
export declare function isChannelAvailable(): boolean;
export declare function registerDelegateCommand(program: Command): void;
export {};
//# sourceMappingURL=delegate.d.ts.map
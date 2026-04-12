// ---------------------------------------------------------------------------
// WorkflowHookRegistry — Central registry of 9 workflow hooks
// ---------------------------------------------------------------------------

import {
  SyncHook,
  AsyncSeriesHook,
  AsyncSeriesBailHook,
  AsyncSeriesWaterfallHook,
} from './hook-engine.js';

import type { MaestroPlugin } from '../types/index.js';
import type {
  CommandNode,
  ExecuteResult,
  WalkerState,
} from '../coordinator/graph-types.js';

// ---------------------------------------------------------------------------
// Hook argument types
// ---------------------------------------------------------------------------

export interface RunContext {
  sessionId: string;
  graphId: string;
  intent: string;
}

export interface NodeContext {
  nodeId: string;
  node: CommandNode;
  state: WalkerState;
}

export interface CommandContext {
  nodeId: string;
  cmd: string;
  prompt: string;
}

export interface CommandResultContext {
  nodeId: string;
  cmd: string;
  result: ExecuteResult;
}

export interface ErrorContext {
  nodeId: string | null;
  error: Error;
  state: WalkerState;
}

export interface DecisionContext {
  nodeId: string;
  resolvedValue: unknown;
  target: string;
}

// ---------------------------------------------------------------------------
// WorkflowHookRegistry
// ---------------------------------------------------------------------------

export class WorkflowHookRegistry {
  /** Fires before a workflow run starts. Bail to cancel. */
  readonly beforeRun = new AsyncSeriesBailHook<[RunContext]>();

  /** Fires after a workflow run completes. */
  readonly afterRun = new AsyncSeriesHook<[RunContext, WalkerState]>();

  /** Fires before entering a node. Bail to skip. */
  readonly beforeNode = new AsyncSeriesBailHook<[NodeContext]>();

  /** Fires after exiting a node. */
  readonly afterNode = new AsyncSeriesHook<[NodeContext, string]>();

  /** Fires before executing a command. Bail to skip execution. */
  readonly beforeCommand = new AsyncSeriesBailHook<[CommandContext]>();

  /** Fires after a command completes. */
  readonly afterCommand = new AsyncSeriesHook<[CommandResultContext]>();

  /** Fires when an error occurs during execution. */
  readonly onError = new AsyncSeriesHook<[ErrorContext]>();

  /** Transforms the assembled prompt before sending to agent. */
  readonly transformPrompt = new AsyncSeriesWaterfallHook<string>();

  /** Fires synchronously when a decision node resolves. */
  readonly onDecision = new SyncHook<[DecisionContext]>();

  /** Apply a plugin — plugin taps into hooks via the registry. */
  apply(plugin: MaestroPlugin): void {
    plugin.apply(this);
  }

  /** Get a hook by name (for dynamic access). */
  getHook(name: string): unknown {
    const hooks: Record<string, unknown> = {
      beforeRun: this.beforeRun,
      afterRun: this.afterRun,
      beforeNode: this.beforeNode,
      afterNode: this.afterNode,
      beforeCommand: this.beforeCommand,
      afterCommand: this.afterCommand,
      onError: this.onError,
      transformPrompt: this.transformPrompt,
      onDecision: this.onDecision,
    };
    return hooks[name];
  }
}

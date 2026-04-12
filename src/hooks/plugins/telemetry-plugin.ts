// ---------------------------------------------------------------------------
// TelemetryPlugin — Collects timing and outcome data from workflow execution
// ---------------------------------------------------------------------------

import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';

export interface TelemetryEntry {
  type: 'node_exit' | 'command_result' | 'error';
  nodeId: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}

export class TelemetryPlugin implements MaestroPlugin {
  readonly name = 'telemetry';
  private entries: TelemetryEntry[] = [];

  apply(registry: WorkflowHookRegistry): void {
    registry.afterNode.tap(this.name, (ctx, outcome) => {
      this.entries.push({
        type: 'node_exit',
        nodeId: ctx.nodeId,
        timestamp: Date.now(),
        data: { outcome },
      });
    });

    registry.afterCommand.tap(this.name, (ctx) => {
      this.entries.push({
        type: 'command_result',
        nodeId: ctx.nodeId,
        timestamp: Date.now(),
        data: { cmd: ctx.cmd, success: ctx.result.success },
      });
    });

    registry.onError.tap(this.name, (ctx) => {
      this.entries.push({
        type: 'error',
        nodeId: ctx.nodeId,
        timestamp: Date.now(),
        data: { message: ctx.error.message },
      });
    });
  }

  /** Return collected telemetry entries. */
  getEntries(): readonly TelemetryEntry[] {
    return this.entries;
  }

  /** Clear collected entries. */
  clear(): void {
    this.entries = [];
  }
}

// ---------------------------------------------------------------------------
// WorkflowGuard — Blocks dangerous operations
// ---------------------------------------------------------------------------

import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+[\/~]/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:/i,
  /\bchmod\s+777\b/,
];

export interface WorkflowGuardResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Pure evaluation function — portable, no I/O dependencies.
 * @param toolName  The tool or command name (e.g. "Bash", "Write")
 * @param input     The command string or tool input to check
 * @param allowlist Tool names that bypass the check
 */
export function evaluateWorkflowGuard(
  toolName: string,
  input: string,
  allowlist: string[] = [],
): WorkflowGuardResult {
  if (allowlist.includes(toolName)) return { blocked: false };
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return {
        blocked: true,
        reason: `[WorkflowGuard] Blocked: dangerous operation detected in "${toolName}" matching ${pattern}`,
      };
    }
  }
  return { blocked: false };
}

/** In-process plugin for coordinator graph-walker */
export class WorkflowGuard implements MaestroPlugin {
  readonly name = 'workflowGuard';
  private readonly allowlist: string[];

  constructor(allowlist?: string[]) {
    this.allowlist = allowlist ?? [];
  }

  apply(registry: WorkflowHookRegistry): void {
    registry.beforeCommand.tap(this.name, (ctx) => {
      const result = evaluateWorkflowGuard(ctx.cmd, ctx.prompt, this.allowlist);
      return result.blocked ? result.reason : undefined;
    });
  }
}

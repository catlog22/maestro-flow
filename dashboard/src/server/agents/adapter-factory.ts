// ---------------------------------------------------------------------------
// Unified adapter factory — single source of truth for subprocess-based agents
//
// Excludes agent-sdk (requires SDK imports not available in CLI context).
// Used by both dashboard/index.ts and cli-agent-runner.ts.
// ---------------------------------------------------------------------------

import type { AgentType } from '../../shared/agent-types.js';
import type { AgentAdapter } from './base-adapter.js';

/**
 * Create an adapter instance for the given agent type.
 * Uses lazy dynamic imports so only the required adapter module is loaded.
 */
export async function createAdapterForType(agentType: AgentType): Promise<AgentAdapter> {
  switch (agentType) {
    case 'claude-code': {
      const { ClaudeCodeAdapter } = await import('./claude-code-adapter.js');
      return new ClaudeCodeAdapter();
    }
    case 'gemini': {
      const { StreamJsonAdapter } = await import('./stream-json-adapter.js');
      return new StreamJsonAdapter('npx -y @google/gemini-cli', 'gemini');
    }
    case 'gemini-a2a': {
      const { GeminiA2aAdapter } = await import('./gemini-a2a-adapter.js');
      return new GeminiA2aAdapter();
    }
    case 'qwen': {
      const { StreamJsonAdapter } = await import('./stream-json-adapter.js');
      return new StreamJsonAdapter('qwen', 'qwen');
    }
    case 'codex': {
      const { CodexCliAdapter } = await import('./codex-cli-adapter.js');
      return new CodexCliAdapter();
    }
    case 'codex-server': {
      const { CodexAppServerAdapter } = await import('./codex-app-server-adapter.js');
      return new CodexAppServerAdapter();
    }
    case 'opencode': {
      const { OpenCodeAdapter } = await import('./opencode-adapter.js');
      return new OpenCodeAdapter();
    }
    case 'agy': {
      const { AgyAdapter } = await import('./agy-adapter.js');
      return new AgyAdapter();
    }
    case 'api-explore': {
      const { ApiExploreAdapter } = await import('./api-explore-adapter.js');
      return new ApiExploreAdapter();
    }
    default:
      throw new Error(`Unknown agent type for adapter factory: ${agentType}`);
  }
}

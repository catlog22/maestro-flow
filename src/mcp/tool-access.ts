import type { Tool, ToolResult, WorkspaceCorpus } from '../types/index.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { AgentRepositoryContext } from '../../shared/agent-types.js';
import {
  revalidateAgentRepositoryTarget,
  resolveAgentRepositoryTarget,
  runWithRepositoryExecution,
} from '../repository/context.js';

export interface McpRepositoryAccessOptions {
  /** Host-owned binding captured once when the MCP server starts. */
  repositoryContext?: AgentRepositoryContext;
  /** A binding/configuration error retained so reads can use compatibility mode. */
  repositoryBindingError?: string;
}

export interface McpToolAccessPolicy {
  filter(tools: readonly Tool[]): Tool[];
  execute(
    registry: ToolRegistry,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult>;
}

const UNCONDITIONAL_MUTATIONS = new Set([
  'write_file',
  'edit_file',
  'team_msg',
]);

function isMutation(name: string, input: Record<string, unknown>): boolean {
  if (UNCONDITIONAL_MUTATIONS.has(name)) return true;
  if (name === 'store_knowhow') {
    return !['search', 'history'].includes(String(input.operation ?? ''));
  }
  if (name === 'team_agent') {
    return ['spawn_agent', 'shutdown_agent', 'remove_agent'].includes(String(input.operation ?? ''));
  }
  if (name === 'team_task') return !['list', 'get'].includes(String(input.operation ?? ''));
  if (name === 'team_mailbox') return !['read', 'status'].includes(String(input.operation ?? ''));
  return false;
}

function corpusForTool(name: string): WorkspaceCorpus {
  if (name === 'store_knowhow') return 'knowhow';
  if (name.startsWith('team_')) return 'session';
  return 'codebase';
}

function accessError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Repository access denied: ${message}` }],
    isError: true,
  };
}

function withTargetRepoSchema(tool: Tool): Tool {
  const inputSchema = tool.inputSchema as {
    type?: unknown;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...tool,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...(inputSchema.properties ?? {}),
        targetRepoId: {
          type: 'string',
          description: 'Canonical repository ID to target. The actor repository binding is host-owned.',
        },
      },
    },
  };
}

/**
 * Build one immutable authorization policy for an MCP server instance.
 * Discovery, execution, and repository authority all use the same snapshot.
 */
export function createMcpToolAccessPolicy(
  configuredTools: readonly string[],
  environmentTools: string | undefined,
  options: McpRepositoryAccessOptions = {},
): McpToolAccessPolicy {
  const selected = environmentTools
    ? environmentTools.split(',').map((name) => name.trim()).filter(Boolean)
    : [...configuredTools];
  const enabled = new Set(selected);
  const allowAll = enabled.has('all');
  const isEnabled = (name: string): boolean => allowAll || enabled.has(name);
  const actor = options.repositoryContext;
  const bindingError = options.repositoryBindingError;

  return Object.freeze({
    filter(tools: readonly Tool[]): Tool[] {
      return tools.filter((tool) => isEnabled(tool.name)).map(withTargetRepoSchema);
    },

    async execute(
      registry: ToolRegistry,
      name: string,
      input: Record<string, unknown>,
    ): Promise<ToolResult> {
      if (!isEnabled(name)) {
        return {
          content: [{ type: 'text', text: `Tool is not available: ${name}` }],
          isError: true,
        };
      }

      const mutation = isMutation(name, input);
      if (mutation && !actor) {
        return accessError(bindingError ?? 'mutation requires a host-owned repository binding');
      }
      if (mutation && (!actor!.currentRepoId || !actor!.identityPersisted)) {
        return accessError('mutation requires a persisted actor repository identity');
      }

      const requestedTarget = input.targetRepoId;
      if (requestedTarget !== undefined && typeof requestedTarget !== 'string') {
        return accessError('targetRepoId must be a canonical repository ID');
      }

      // Reads retain explicit legacy compatibility only for the implicit current repository.
      if (!actor && requestedTarget !== undefined) {
        return accessError('targetRepoId requires a host-owned repository binding');
      }
      if (!actor) return registry.execute(name, input);

      try {
        const mode = mutation ? 'write' : 'read';
        const corpus = corpusForTool(name);
        const selectedTarget = resolveAgentRepositoryTarget(
          actor,
          requestedTarget,
          mode,
          corpus,
        );
        const target = mutation
          ? revalidateAgentRepositoryTarget(actor, selectedTarget, mode, corpus)
          : selectedTarget;
        const canonicalInput = { ...input, targetRepoId: target.repoId };
        return await runWithRepositoryExecution(actor, target, () => registry.execute(name, canonicalInput));
      } catch (error) {
        return accessError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

export interface McpToolRequestHandlers {
  list(): {
    tools: Array<Pick<Tool, 'name' | 'description' | 'inputSchema'>>;
  };
  call(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

/** Create the paired ListTools and CallTool implementations from one policy. */
export function createMcpToolRequestHandlers(
  registry: ToolRegistry,
  configuredTools: readonly string[],
  environmentTools: string | undefined,
  options: McpRepositoryAccessOptions = {},
): McpToolRequestHandlers {
  const access = createMcpToolAccessPolicy(configuredTools, environmentTools, options);

  return Object.freeze({
    list() {
      return {
        tools: access.filter(registry.list()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    },

    call(name: string, input: Record<string, unknown>): Promise<ToolResult> {
      return access.execute(registry, name, input);
    },
  });
}

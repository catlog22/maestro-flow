// ---------------------------------------------------------------------------
// SdkMessageTranslator — maps Agent SDK SDKMessage stream to NormalizedEntry[]
// ---------------------------------------------------------------------------
// Handles 13 SDKMessage types from @anthropic-ai/claude-agent-sdk:
//   Active (6): system, assistant, user, result, tool_progress, rate_limit_event
//   Skipped (7): compact_boundary, user_message_replay, auth_status, hook_response,
//                prompt_suggestion, status, partial_assistant (handled if encountered)
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type {
  NormalizedEntry,
  NormalizedEntryBase,
} from '../../shared/agent-types.js';

/**
 * Translates Agent SDK messages into the maestro NormalizedEntry system.
 *
 * The SDK emits typed messages via an async iterable from `query()`.
 * This class maintains state for correlating tool_use blocks with their
 * subsequent tool_use_result messages.
 */
export class SdkMessageTranslator {
  private readonly processId: string;
  /** Tracks pending tool_use blocks awaiting their result via tool_use_id */
  private readonly pendingToolUses = new Map<string, { name: string; input: Record<string, unknown> }>();

  constructor(processId: string) {
    this.processId = processId;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Translate a single SDKMessage into zero or more NormalizedEntry instances.
   * Unknown or internal-only message types are silently skipped.
   */
  translate(msg: Record<string, unknown>): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];

    switch (msg.type) {
      case 'system':
        if ((msg as Record<string, unknown>).subtype === 'init') {
          entries.push({ ...this.base(), type: 'status_change', status: 'running' });
        }
        break;

      case 'assistant':
        entries.push(...this.translateAssistant(msg));
        break;

      case 'user':
        if (msg.tool_use_result) {
          entries.push(...this.translateToolResult(msg));
        } else if (!msg.isSynthetic) {
          entries.push({
            ...this.base(),
            type: 'user_message',
            content: this.extractText(msg.message),
          });
        }
        break;

      case 'result':
        entries.push(...this.translateResult(msg));
        break;

      case 'tool_progress':
        entries.push({
          ...this.base(),
          type: 'tool_use',
          name: (msg.tool_name as string) ?? 'unknown',
          input: {},
          status: 'running',
        });
        break;

      case 'rate_limit_event':
        entries.push({
          ...this.base(),
          type: 'error',
          message: 'Rate limit reached',
          code: 'RATE_LIMIT',
        });
        break;

      // Skipped types — internal SDK markers, no user-visible output
      case 'compact_boundary':
      case 'user_message_replay':
      case 'auth_status':
      case 'hook_response':
      case 'prompt_suggestion':
      case 'status':
        break;

      default:
        // Unknown message type — skip silently
        break;
    }

    return entries;
  }

  // -------------------------------------------------------------------------
  // Private translation methods
  // -------------------------------------------------------------------------

  private translateAssistant(msg: Record<string, unknown>): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];

    if (msg.error) {
      entries.push({
        ...this.base(),
        type: 'error',
        message: `Assistant error: ${msg.error}`,
      });
      return entries;
    }

    const message = msg.message as Record<string, unknown> | undefined;
    const content = (message?.content ?? []) as Array<Record<string, unknown>>;

    for (const block of content) {
      switch (block.type) {
        case 'thinking':
          entries.push({
            ...this.base(),
            type: 'thinking',
            content: (block.thinking as string) ?? '',
          });
          break;

        case 'text':
          entries.push({
            ...this.base(),
            type: 'assistant_message',
            content: (block.text as string) ?? '',
            partial: false,
          });
          break;

        case 'tool_use': {
          const toolId = block.id as string;
          const toolName = (block.name as string) ?? 'unknown';
          const toolInput = (block.input as Record<string, unknown>) ?? {};
          this.pendingToolUses.set(toolId, { name: toolName, input: toolInput });
          entries.push(this.toolUseToEntry(toolName, toolInput, 'running'));
          break;
        }
      }
    }

    return entries;
  }

  private translateToolResult(msg: Record<string, unknown>): NormalizedEntry[] {
    const result = msg.tool_use_result as Record<string, unknown>;
    if (!result) return [];

    const toolUseId = result.tool_use_id as string;
    const pending = this.pendingToolUses.get(toolUseId);
    if (!pending) return [];

    const isError = result.is_error as boolean;
    const output = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);

    const entry = this.toolUseToEntry(
      pending.name,
      pending.input,
      isError ? 'failed' : 'completed',
      output,
    );

    this.pendingToolUses.delete(toolUseId);
    return [entry];
  }

  /**
   * Routes tool usage to the appropriate NormalizedEntry type.
   * - Edit -> file_change (modify)
   * - Write -> file_change (create)
   * - Bash -> command_exec
   * - Others -> generic tool_use
   */
  private toolUseToEntry(
    toolName: string,
    input: Record<string, unknown>,
    status: 'running' | 'completed' | 'failed',
    result?: string,
  ): NormalizedEntry {
    switch (toolName) {
      case 'Edit':
        return {
          ...this.base(),
          type: 'file_change',
          path: (input.file_path as string) ?? '',
          action: 'modify',
          diff: result,
        };

      case 'Write':
        return {
          ...this.base(),
          type: 'file_change',
          path: (input.file_path as string) ?? '',
          action: 'create',
        };

      case 'Bash':
        return {
          ...this.base(),
          type: 'command_exec',
          command: (input.command as string) ?? '',
          output: result,
          exitCode: status === 'failed' ? 1 : (status === 'completed' ? 0 : undefined),
        };

      default:
        return {
          ...this.base(),
          type: 'tool_use',
          name: toolName,
          input,
          status,
          result,
        };
    }
  }

  private translateResult(msg: Record<string, unknown>): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];

    if (msg.subtype === 'success') {
      if (msg.result) {
        entries.push({
          ...this.base(),
          type: 'assistant_message',
          content: msg.result as string,
          partial: false,
        });
      }

      const usage = msg.usage as Record<string, number> | undefined;
      entries.push({
        ...this.base(),
        type: 'token_usage',
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens,
        cacheWriteTokens: usage?.cache_creation_input_tokens,
      });

      entries.push({
        ...this.base(),
        type: 'status_change',
        status: 'stopped',
      });
    } else {
      entries.push({
        ...this.base(),
        type: 'error',
        message: (msg.error as string) ?? `Agent ended: ${msg.subtype}`,
        code: msg.subtype as string,
      });
      entries.push({
        ...this.base(),
        type: 'status_change',
        status: 'error',
        reason: msg.subtype as string,
      });
    }

    return entries;
  }

  /**
   * Extract text content from a message object.
   * Handles both string content and content block arrays.
   */
  private extractText(message: unknown): string {
    if (!message || typeof message !== 'object') return '';
    const msg = message as Record<string, unknown>;
    if (!msg.content) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (!Array.isArray(msg.content)) return '';
    return (msg.content as Array<Record<string, unknown>>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text as string)
      .join('\n');
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private base(): NormalizedEntryBase {
    return {
      id: randomUUID(),
      processId: this.processId,
      timestamp: new Date().toISOString(),
    };
  }
}

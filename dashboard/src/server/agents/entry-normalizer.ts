// ---------------------------------------------------------------------------
// EntryNormalizer — static factory for creating NormalizedEntry instances
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type {
  AgentProcessStatus,
  UserMessageEntry,
  AssistantMessageEntry,
  ThinkingEntry,
  ToolUseEntry,
  FileChangeEntry,
  CommandExecEntry,
  ApprovalRequestEntry,
  ApprovalResponseEntry,
  ErrorEntry,
  StatusChangeEntry,
  TokenUsageEntry,
} from '../../shared/agent-types.js';

/** Factory for creating NormalizedEntry instances with consistent base fields */
export class EntryNormalizer {
  private static partialCounter = 0;

  private constructor() {
    // Static-only class
  }

  static userMessage(processId: string, content: string): UserMessageEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'user_message',
      content,
    };
  }

  static assistantMessage(
    processId: string,
    content: string,
    partial: boolean,
  ): AssistantMessageEntry {
    return {
      id: partial ? `p-${processId}-${++EntryNormalizer.partialCounter}` : randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'assistant_message',
      content,
      partial,
    };
  }

  static thinking(processId: string, content: string): ThinkingEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'thinking',
      content,
    };
  }

  static toolUse(
    processId: string,
    name: string,
    input: Record<string, unknown>,
    status: ToolUseEntry['status'],
    result?: string,
  ): ToolUseEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'tool_use',
      name,
      input,
      status,
      result,
    };
  }

  static fileChange(
    processId: string,
    path: string,
    action: FileChangeEntry['action'],
    diff?: string,
  ): FileChangeEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'file_change',
      path,
      action,
      diff,
    };
  }

  static commandExec(
    processId: string,
    command: string,
    exitCode?: number,
    output?: string,
  ): CommandExecEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'command_exec',
      command,
      exitCode,
      output,
    };
  }

  static approvalRequest(
    processId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    requestId: string,
  ): ApprovalRequestEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'approval_request',
      toolName,
      toolInput,
      requestId,
    };
  }

  static approvalResponse(
    processId: string,
    requestId: string,
    allowed: boolean,
  ): ApprovalResponseEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'approval_response',
      requestId,
      allowed,
    };
  }

  static error(
    processId: string,
    message: string,
    code?: string,
  ): ErrorEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'error',
      message,
      code,
    };
  }

  static statusChange(
    processId: string,
    status: AgentProcessStatus,
    reason?: string,
  ): StatusChangeEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'status_change',
      status,
      reason,
    };
  }

  static tokenUsage(
    processId: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    cacheWriteTokens?: number,
  ): TokenUsageEntry {
    return {
      id: randomUUID(),
      processId,
      timestamp: new Date().toISOString(),
      type: 'token_usage',
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    };
  }
}

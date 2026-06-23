export interface StreamJsonUsage {
  input_tokens: number;
  output_tokens: number;
}

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function emitInit(): void {
  emit({ type: 'init' });
}

export function emitMessage(content: string, delta = false, role: 'assistant' | 'user' = 'assistant'): void {
  emit({ type: 'message', content, delta, role });
}

export function emitToolUse(name: string, input: Record<string, unknown>, toolId: string): void {
  emit({ type: 'tool_use', tool_name: name, parameters: input, tool_id: toolId });
}

export function emitToolResult(toolId: string, content: string, isError = false): void {
  emit({ type: 'tool_result', tool_id: toolId, content, is_error: isError });
}

export function emitResult(usage?: StreamJsonUsage): void {
  emit({ type: 'result', ...(usage ? { usage } : {}) });
}

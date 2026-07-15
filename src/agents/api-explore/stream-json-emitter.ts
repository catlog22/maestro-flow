export interface StreamJsonUsage {
  input_tokens: number;
  output_tokens: number;
}

/** One protocol event (init | message | tool_use | tool_result | result). */
export type StreamEvent = Record<string, unknown> & { type: string };

/** Receives every protocol event emitted by the agent loop. */
export interface StreamEmitter {
  init(): void;
  message(content: string, delta?: boolean, role?: 'assistant' | 'user'): void;
  toolUse(name: string, input: Record<string, unknown>, toolId: string): void;
  toolResult(toolId: string, content: string, isError?: boolean): void;
  result(usage?: StreamJsonUsage): void;
}

function buildEmitter(sink: (event: StreamEvent) => void): StreamEmitter {
  return {
    init: () => sink({ type: 'init' }),
    message: (content, delta = false, role = 'assistant') =>
      sink({ type: 'message', content, delta, role }),
    toolUse: (name, input, toolId) =>
      sink({ type: 'tool_use', tool_name: name, parameters: input, tool_id: toolId }),
    toolResult: (toolId, content, isError = false) =>
      sink({ type: 'tool_result', tool_id: toolId, content, is_error: isError }),
    result: (usage) => sink({ type: 'result', ...(usage ? { usage } : {}) }),
  };
}

/** NDJSON on stdout — the standalone agent binary protocol. */
export const stdoutEmitter: StreamEmitter = buildEmitter(
  (event) => process.stdout.write(JSON.stringify(event) + '\n'),
);

/** Drops all events — for in-process embedding where the protocol stream is unused. */
export const silentEmitter: StreamEmitter = buildEmitter(() => {});

/** Cap for tool_result content stored in traces — keeps session files bounded. */
const TRACE_TOOL_RESULT_LIMIT = 2_000;

/** Collects events into `trace` for session persistence; tool results are truncated. */
export function createTraceEmitter(trace: StreamEvent[]): StreamEmitter {
  return buildEmitter((event) => {
    if (event.type === 'tool_result' && typeof event.content === 'string'
        && event.content.length > TRACE_TOOL_RESULT_LIMIT) {
      const omitted = event.content.length - TRACE_TOOL_RESULT_LIMIT;
      event = { ...event, content: event.content.slice(0, TRACE_TOOL_RESULT_LIMIT) + `\n…[truncated ${omitted} chars]` };
    }
    trace.push(event);
  });
}

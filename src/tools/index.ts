import type { ToolRegistry } from '../core/tool-registry.js';
import type { ToolResult } from '../types/index.js';
import { ccwResultToMcp } from '../types/tool-schema.js';

// CCW-style tool modules (schema + handler exports)
import * as editFileTool from './edit-file.js';
import * as writeFileTool from './write-file.js';
import * as readFileTool from './read-file.js';
import * as readManyFilesTool from './read-many-files.js';
import * as teamMsgTool from './team-msg.js';
import * as teamMailboxTool from './team-mailbox.js';

import * as teamTasksMcpTool from './team-tasks-mcp.js';
import * as teamAgentsTool from './team-agents.js';

/**
 * Register a CCW-style tool (with schema + handler exports) into the maestro registry.
 * Adapts CCW's { success, result, error } format to maestro's { content, isError } format.
 */
function registerCcwTool(
  registry: ToolRegistry,
  mod: { schema: { name: string; description: string; inputSchema: Record<string, unknown> }; handler: (params: Record<string, unknown>) => Promise<any> },
): void {
  registry.register({
    name: mod.schema.name,
    description: mod.schema.description,
    inputSchema: mod.schema.inputSchema,
    async handler(input: Record<string, unknown>): Promise<ToolResult> {
      const ccwResult = await mod.handler(input);
      return ccwResultToMcp(ccwResult);
    },
  });
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  registerCcwTool(registry, editFileTool);
  registerCcwTool(registry, writeFileTool);
  registerCcwTool(registry, readFileTool);
  registerCcwTool(registry, readManyFilesTool);
  registerCcwTool(registry, teamMsgTool);
  registerCcwTool(registry, teamMailboxTool);

  registerCcwTool(registry, teamTasksMcpTool);
  registerCcwTool(registry, teamAgentsTool);
}

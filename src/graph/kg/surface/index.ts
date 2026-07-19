// src/graph/kg/surface/index.ts — 对外接口导出

export { registerKgCommands } from './cli.js';
export { KG_MCP_TOOLS, handleMcpTool, precheckKg } from './mcp-tools.js';
export type { McpToolDef, KgPrecheck, KgStatus } from './mcp-tools.js';

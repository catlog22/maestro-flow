import type { WorkflowHookRegistry } from '../hooks/workflow-hooks.js';

export interface SpecInjectionConfig {
  /** Override default agent-type → spec categories mapping */
  mapping?: Record<string, { categories: string[]; extras?: string[] }>;
  /** Files to always inject regardless of agent type */
  always?: string[];
  /** Max chars before truncation kicks in */
  maxContentLength?: number;
}

export interface StatuslineConfig {
  style?: string;
}

export interface MaestroConfig {
  version: string;
  extensions: ExtensionConfig[];
  mcp: McpConfig;
  workflows: WorkflowConfig;
  hooks?: HooksConfig;
  specInjection?: SpecInjectionConfig;
  statusline?: StatuslineConfig;
}

export interface ExtensionConfig {
  name: string;
  enabled: boolean;
  path: string;
  config?: Record<string, unknown>;
}

export interface McpConfig {
  port: number;
  host: string;
  enabledTools: string[];
}

export interface WorkflowConfig {
  templatesDir: string;
  workflowsDir: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface Extension {
  name: string;
  version: string;
  tools?: Tool[];
  activate: (ctx: ExtensionContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

export interface ExtensionContext {
  registerTool: (tool: Tool) => void;
  config: Record<string, unknown>;
  log: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Hook System Types
// ---------------------------------------------------------------------------

export interface MaestroPlugin {
  name: string;
  apply(registry: WorkflowHookRegistry): void;
}

export interface ExternalHookConfig {
  event: string;
  command: string;
  timeout_ms?: number;
}

export interface HooksConfig {
  toggles: Record<string, boolean>;
  external: ExternalHookConfig[];
  plugins: string[];
}

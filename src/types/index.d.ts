import type { WorkflowHookRegistry } from '../hooks/workflow-hooks.js';
export interface SpecInjectionConfig {
    /** Override default agent-type → spec categories mapping */
    mapping?: Record<string, AgentSpecMapping>;
    /** Category-level document associations (extend CATEGORY_MAP) */
    categoryDocs?: Record<string, CategoryDocConfig>;
    /** Always-inject at session start: document paths and/or keyword-matched entries */
    always?: AlwaysInjectConfig;
    /** Global keyword filter rules */
    keywordFilters?: KeywordFilterConfig;
    /** Max chars before truncation kicks in */
    maxContentLength?: number;
}
export interface AgentSpecMapping {
    categories: string[];
    /** Additional document paths to inject for this agent type */
    extras?: string[];
    /** Keyword whitelist: only inject entries matching these keywords */
    includeKeywords?: string[];
    /** Keyword blacklist: never inject entries matching these keywords */
    excludeKeywords?: string[];
}
export interface CategoryDocConfig {
    /** Additional spec files in .workflow/specs/ for this category */
    specFiles?: string[];
    /** Additional document paths (relative to project root or knowhow/ prefix) */
    docs?: string[];
}
export interface AlwaysInjectConfig {
    /** Document paths to always inject */
    docs?: string[];
    /** Keywords: always inject spec entries matching these keywords */
    keywords?: string[];
    /** Categories: always inject all entries from these categories */
    categories?: string[];
}
export interface KeywordFilterConfig {
    /** Global keyword whitelist */
    include?: string[];
    /** Global keyword blacklist */
    exclude?: string[];
}
export interface MaestroConfig {
    version: string;
    extensions: ExtensionConfig[];
    mcp: McpConfig;
    workflows: WorkflowConfig;
    hooks?: HooksConfig;
    specInjection?: SpecInjectionConfig;
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
    content: Array<{
        type: string;
        text: string;
    }>;
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

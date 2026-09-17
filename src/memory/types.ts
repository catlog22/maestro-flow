export const MEMORY_AUTO_MODES = ['off', 'index', 'extract', 'promote-safe'] as const;
export type MemoryAutoMode = (typeof MEMORY_AUTO_MODES)[number];

export const WORKING_MEMORY_FACT_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type WorkingMemoryFactType = (typeof WORKING_MEMORY_FACT_TYPES)[number];

export const MEMORY_SCOPES = ['user', 'project', 'session'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_FACT_STATUSES = ['active', 'superseded', 'decayed'] as const;
export type MemoryFactStatus = (typeof MEMORY_FACT_STATUSES)[number];

export const MEMORY_PROMOTION_STATES = ['none', 'pending', 'staged'] as const;
export type MemoryPromotionState = (typeof MEMORY_PROMOTION_STATES)[number];

export const MEMORY_SEMANTIC_MODES = ['lexical', 'topic', 'embed'] as const;
export type MemorySemanticMode = (typeof MEMORY_SEMANTIC_MODES)[number];

/** Remote long-term memory. `mcp` uses JSON-RPC tools/list + tools/call; never a product name. */
export const MEMORY_REMOTE_MODES = ['off', 'mcp'] as const;
export type MemoryRemoteMode = (typeof MEMORY_REMOTE_MODES)[number];

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ConversationPayload {
  session_id?: string;
  run_id?: string;
  maestro_session_id?: string;
  cwd?: string;
  messages?: ConversationMessage[];
  transcript?: string;
  transcript_path?: string;
  user_prompt?: string;
  hook_event_name?: string;
}

export interface WorkingMemoryFact {
  id: string;
  type: WorkingMemoryFactType;
  text: string;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  use_count: number;
  source: 'extract' | 'remember';
  extract_method?: 'rule' | 'semantic' | 'remember';
  evidence_kind: 'transcript' | 'explicit';
  scope: MemoryScope;
  session_id?: string;
  topic: string;
  confidence: number;
  status: MemoryFactStatus;
  superseded_by?: string;
  supersedes?: string[];
  promotion_state: MemoryPromotionState;
  knowledge_candidate_id?: string;
}

export interface WorkingMemoryStoreFile {
  schema_version: 'working-memory/1.0' | 'working-memory/1.1';
  facts: WorkingMemoryFact[];
}

export interface MemoryConfig {
  auto: MemoryAutoMode;
  mem0ApiKey: string;
  mem0BaseUrl: string;
  mem0UserId: string;
  mem0AgentId: string;
  mem0AppId: string;
  workingSetMaxLines: number;
  workingSetMaxBytes: number;
  decayHalfLifeDays: number;
  minRecallScore: number;
  recallLimit: number;
  stickyLimit: number;
  autoStageSafe: boolean;
  semantic: MemorySemanticMode;
  /** `off` = local working-memory only; `mcp` = tools/list + tools/call on mcpCommand. */
  remote: MemoryRemoteMode;
  /** User-facing name of the MCP server this config points at (not a product brand). */
  mcpServer: string;
  mcpCommand: string;
  mcpArgs: string[];
  /** When true, retain may tools/call add. Default false so remote write is explicit. */
  mcpWrite: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  auto: 'promote-safe',
  mem0ApiKey: '',
  mem0BaseUrl: 'https://api.mem0.ai',
  mem0UserId: 'maestro-local',
  mem0AgentId: '',
  mem0AppId: 'maestro-flow',
  workingSetMaxLines: 200,
  workingSetMaxBytes: 25 * 1024,
  decayHalfLifeDays: 30,
  minRecallScore: 0.22,
  recallLimit: 12,
  stickyLimit: 6,
  autoStageSafe: true,
  semantic: 'topic',
  remote: 'off',
  mcpServer: '',
  mcpCommand: '',
  mcpArgs: [],
  mcpWrite: false,
};

export function isExtractEnabled(auto: MemoryAutoMode): boolean {
  return auto === 'extract' || auto === 'promote-safe';
}

/** Remote Mem0 writes only in `extract`. `promote-safe` stays local so later promote is reviewable. */
export function isMem0WriteEnabled(auto: MemoryAutoMode): boolean {
  return auto === 'extract';
}

export function isMcpRemoteEnabled(config: Pick<MemoryConfig, 'remote'>): boolean {
  return config.remote === 'mcp';
}

/** Remote MCP add only when remote is mcp and mcpWrite is explicit. */
export function isMcpWriteEnabled(config: Pick<MemoryConfig, 'remote' | 'mcpWrite'>): boolean {
  return config.remote === 'mcp' && config.mcpWrite === true;
}

export function isInjectEnabled(auto: MemoryAutoMode): boolean {
  return auto !== 'off';
}

export function isStickyFact(fact: Pick<WorkingMemoryFact, 'type' | 'source' | 'confidence'>): boolean {
  return fact.type === 'user' || fact.type === 'feedback' || fact.source === 'remember' || fact.confidence >= 0.85;
}

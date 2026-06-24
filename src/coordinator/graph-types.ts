// ---------------------------------------------------------------------------
// Graph Coordinator — Type Definitions
// Pure types, zero runtime. All graph/walker/executor/assembler interfaces.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Graph Schema Types
// ---------------------------------------------------------------------------

export interface ChainGraph {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  version: string;
  tags?: string[];
  entry: string;
  inputs?: Record<string, GraphInput>;
  nodes: Record<string, GraphNode>;
  defaults?: GraphDefaults;
}

export interface GraphInput {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
}

export interface GraphDefaults {
  timeout_ms?: number;
  analyze?: boolean;
  max_visits?: number;
  auto_flag?: string;
  retry?: RetryPolicy;
  auto_continue_on_failure?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Node Types (7 kinds)
// ---------------------------------------------------------------------------

export type GraphNode =
  | CommandNode
  | DecisionNode
  | GateNode
  | ForkNode
  | JoinNode
  | EvalNode
  | TerminalNode;

export interface ExplorePreStep {
  queries: string[];
  maxTurns?: number;
  endpoint?: string;
}

export interface CommandNode {
  type: 'command';
  cmd: string;
  args?: string;
  description?: string;
  auto_flag?: string;
  next: string;
  on_failure?: string;
  max_visits?: number;
  timeout_ms?: number;
  analyze?: boolean;
  retry?: RetryPolicy;
  auto_continue_on_failure?: boolean;
  extract?: Record<string, ExtractionRule>;
  explore?: ExplorePreStep;
}

export interface RetryPolicy {
  max_attempts?: number;
  base_backoff_ms?: number;
  max_backoff_ms?: number;
}

export interface ExtractionRule {
  strategy: 'regex' | 'json_path' | 'line_match';
  pattern: string;
  target: string;
}

export interface DecisionNode {
  type: 'decision';
  strategy?: 'expr' | 'llm';
  eval?: string;
  prompt?: string;
  context_keys?: string[];
  edges: DecisionEdge[];
}

export interface DecisionEdge {
  value?: string | number | boolean;
  match?: string;
  label?: string;
  default?: boolean;
  target: string;
  description?: string;
}

export interface GateNode {
  type: 'gate';
  condition: string;
  on_pass: string;
  on_fail: string;
  wait?: boolean;
  wait_message?: string;
}

export interface ForkNode {
  type: 'fork';
  branches: string[];
  join: string;
}

export interface JoinNode {
  type: 'join';
  strategy: 'all' | 'any' | 'majority';
  next: string;
  merge?: 'concat' | 'last' | 'best_score';
}

export interface EvalNode {
  type: 'eval';
  set: Record<string, string>;
  next: string;
}

export interface TerminalNode {
  type: 'terminal';
  status: 'success' | 'failure' | 'paused' | 'delegate';
  delegate_graph?: string;
  delegate_inputs?: Record<string, string>;
  summary?: string;
}

// ---------------------------------------------------------------------------
// 3. Walker State Types
// ---------------------------------------------------------------------------

export type WalkerStatus =
  | 'running'
  | 'waiting_command'
  | 'waiting_gate'
  | 'waiting_fork'
  | 'step_paused'
  | 'paused'
  | 'completed'
  | 'failed';

export interface WalkerState {
  session_id: string;
  graph_id: string;
  current_node: string;
  status: WalkerStatus;
  context: WalkerContext;
  history: HistoryEntry[];
  fork_state: Record<string, ForkBranchState> | null;
  delegate_stack: DelegateFrame[];
  created_at: string;
  updated_at: string;
  tool: string;
  auto_mode: boolean;
  step_mode: boolean;
  intent: string;
  recovery?: RecoveryState;
}

export interface WalkerContext {
  inputs: Record<string, unknown>;
  project: ProjectSnapshot;
  result: Record<string, unknown> | null;
  analysis: Record<string, unknown> | null;
  visits: Record<string, number>;
  var: Record<string, unknown>;
}

export interface ProjectSnapshot {
  initialized: boolean;
  current_phase: number | null;
  phase_status: string;
  phase_artifacts: Record<string, boolean>;   // per-phase presence flags (renamed from artifacts)
  artifact_registry?: Array<{                 // v2 artifact entries from state.json
    id: string; type: string; milestone?: string | null; phase?: number | null;
    scope?: string; path?: string; status: string; depends_on?: string | string[] | null;
  }>;
  execution: { tasks_completed: number; tasks_total: number };
  verification_status: string;
  review_verdict: string | null;
  uat_status: string;
  phases_total: number;
  phases_completed: number;
  accumulated_context: unknown | null;
}

export interface HistoryEntry {
  node_id: string;
  node_type: string;
  entered_at: string;
  exited_at?: string;
  outcome?: 'success' | 'failure' | 'skipped';
  exec_id?: string;
  quality_score?: number;
  summary?: string;
  retry_count?: number;
  error_message?: string;
}

export interface RecoveryState {
  total_retries: number;
  total_failures: number;
  auto_skips: number;
  consecutive_failures: number;
  last_error: string | null;
}

export interface ForkBranchState {
  branches: Record<string, 'pending' | 'running' | 'completed' | 'failed'>;
  join_node: string;
  results: Record<string, unknown>;
}

export interface DelegateFrame {
  parent_graph_id: string;
  parent_node_id: string;
  return_inputs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 4. Command Executor Interface
// ---------------------------------------------------------------------------

export type AgentType = 'claude-code' | 'claude' | 'codex' | 'gemini' | 'qwen' | 'opencode';

export interface ExecuteRequest {
  prompt: string;
  agent_type: AgentType;
  work_dir: string;
  approval_mode: 'suggest' | 'auto';
  timeout_ms: number;
  node_id: string;
  cmd: string;
}

export interface ExecuteResult {
  success: boolean;
  raw_output: string;
  exec_id: string;
  duration_ms: number;
  process_id?: string;
}

export interface CommandExecutor {
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 5. Prompt Assembler Interface
// ---------------------------------------------------------------------------

export interface AssembleRequest {
  node: CommandNode;
  node_id: string;
  session_id: string;
  context: WalkerContext;
  graph: { id: string; name: string };
  command_index: number;
  command_total: number;
  auto_mode: boolean;
  previous_command?: {
    node_id: string;
    cmd: string;
    outcome: 'success' | 'failure';
    summary?: string;
  };
}

export interface PromptAssembler {
  assemble(request: AssembleRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// 6. Expression Evaluator Interface
// ---------------------------------------------------------------------------

export interface ExprEvaluator {
  resolve(expr: string, ctx: WalkerContext): unknown;
  evaluate(expr: string, ctx: WalkerContext): boolean;
  match(edge: DecisionEdge, resolvedValue: unknown, ctx: WalkerContext): boolean;
}

// ---------------------------------------------------------------------------
// 7. Output Parser Types
// ---------------------------------------------------------------------------

export interface ParsedResult {
  structured: {
    status: 'SUCCESS' | 'FAILURE';
    phase: string | null;
    verification_status: string | null;
    review_verdict: string | null;
    uat_status: string | null;
    artifacts: string[];
    summary: string;
    [key: string]: unknown;
  };
}

export interface OutputParser {
  parse(rawOutput: string, node: CommandNode): ParsedResult;
}

// ---------------------------------------------------------------------------
// 8. Step Analyzer Types
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  quality_score: number;
  issues: string[];
  next_step_hints: {
    prompt_additions?: string;
    cautions?: string[];
    context_to_carry?: string;
  };
}

export interface StepAnalyzer {
  analyze(
    node: CommandNode,
    rawOutput: string,
    ctx: WalkerContext,
    prevCmd?: AssembleRequest['previous_command'],
  ): Promise<AnalysisResult>;
}

// ---------------------------------------------------------------------------
// 8b. LLM Decider — optional fallback for decision nodes when a static
// expression cannot pick an edge (or when strategy === 'llm'). Mirrors the
// StepAnalyzer contract: optional on walker, never throws, returns null on
// any failure so the walker can fall through to the current behavior.
//
// The walker (main flow) owns prompt assembly. The decider is a thin
// spawn+parse wrapper that receives a fully-assembled prompt and a list
// of valid targets for response validation.
// ---------------------------------------------------------------------------

export interface LLMDecisionRequest {
  node_id: string;
  prompt: string;            // fully-assembled prompt text, ready to send
  valid_targets: string[];   // closed set of acceptable DECISION values
}

export interface LLMDecisionResult {
  target: string;
  reasoning: string;
}

export interface LLMDecider {
  decide(req: LLMDecisionRequest): Promise<LLMDecisionResult | null>;
}

// ---------------------------------------------------------------------------
// 9. Event System
// ---------------------------------------------------------------------------

export type CoordinateEvent =
  | { type: 'walker:started'; session_id: string; graph_id: string; intent: string }
  | { type: 'walker:node_enter'; session_id: string; node_id: string; node_type: string }
  | { type: 'walker:node_exit'; session_id: string; node_id: string; outcome: string }
  | { type: 'walker:decision'; session_id: string; node_id: string; resolved_value: unknown; target: string }
  | { type: 'walker:command'; session_id: string; node_id: string; cmd: string; status: 'spawned' | 'completed' | 'failed' }
  | { type: 'walker:delegate'; session_id: string; from_graph: string; to_graph: string }
  | { type: 'walker:fork_start'; session_id: string; node_id: string; branches: string[] }
  | { type: 'walker:branch_complete'; session_id: string; node_id: string; branch_id: string; success: boolean }
  | { type: 'walker:join_complete'; session_id: string; node_id: string; strategy: string; success: boolean }
  | { type: 'walker:completed'; session_id: string; status: 'success' | 'failure'; history_summary: string[] }
  | { type: 'walker:error'; session_id: string; error: string };

export interface WalkerEventEmitter {
  emit(event: CoordinateEvent): void;
}

// ---------------------------------------------------------------------------
// 10. Intent Router Types
// ---------------------------------------------------------------------------

export interface IntentPattern {
  type: string;
  regex: string;
  flags?: string;
  route: IntentRoute;
}

export interface IntentRoute {
  graph?: string;
  strategy?: 'state_router';
}

export interface IntentMap {
  $schema?: string;
  version: string;
  patterns: IntentPattern[];
  fallback: IntentRoute;
}


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
  extract?: Record<string, ExtractionRule>;
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
  intent: string;
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
  artifacts: Record<string, boolean>;
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

export type AgentType = 'claude-code' | 'codex' | 'gemini' | 'qwen' | 'opencode';

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
// 9. Event System
// ---------------------------------------------------------------------------

export type CoordinateEvent =
  | { type: 'walker:started'; session_id: string; graph_id: string; intent: string }
  | { type: 'walker:node_enter'; session_id: string; node_id: string; node_type: string }
  | { type: 'walker:node_exit'; session_id: string; node_id: string; outcome: string }
  | { type: 'walker:decision'; session_id: string; node_id: string; resolved_value: unknown; target: string }
  | { type: 'walker:command'; session_id: string; node_id: string; cmd: string; status: 'spawned' | 'completed' | 'failed' }
  | { type: 'walker:delegate'; session_id: string; from_graph: string; to_graph: string }
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

// ---------------------------------------------------------------------------
// 11. Link-Coordinate Types (step-by-step interactive walker)
// ---------------------------------------------------------------------------

export interface LinkStepPreview {
  node_id: string;
  cmd: string;
  description?: string;
  resolved_args: string;
  prompt_preview: string;
  step_index: number;
  total_steps: number;
  upcoming: LinkUpcomingStep[];
  context_summary: string;
}

export interface LinkUpcomingStep {
  node_id: string;
  cmd: string;
  args_template: string;
  description?: string;
}

export type LinkAction =
  | { type: 'execute' }
  | { type: 'skip' }
  | { type: 'modify'; args: string }
  | { type: 'add'; after_node: string; cmd: string; args?: string }
  | { type: 'remove'; node_id: string }
  | { type: 'quit' };

export interface LinkSessionState extends WalkerState {
  link_mode: true;
  pending_preview: LinkStepPreview | null;
  chain_modifications: ChainModification[];
}

export interface ChainModification {
  action: 'add' | 'remove' | 'modify_args' | 'skip';
  node_id: string;
  timestamp: string;
  detail?: Record<string, unknown>;
}

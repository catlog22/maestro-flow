// ---------------------------------------------------------------------------
// Requirement expansion types -- shared between server and client
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lifecycle status (6 states)
// ---------------------------------------------------------------------------

/** Requirement expansion lifecycle status */
export type RequirementStatus =
  | 'draft'
  | 'expanding'
  | 'reviewing'
  | 'committing'
  | 'done'
  | 'failed';

// ---------------------------------------------------------------------------
// Expansion depth (3 tiers)
// ---------------------------------------------------------------------------

/** Controls granularity of requirement decomposition */
export type ExpansionDepth = 'high-level' | 'standard' | 'atomic';

// ---------------------------------------------------------------------------
// Core data structures
// ---------------------------------------------------------------------------

/** Single item in an expanded requirement checklist */
export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  type: 'feature' | 'task' | 'bug' | 'improvement';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies: string[];      // ids of other checklist items this depends on
  estimated_effort: string;    // e.g. "small", "medium", "large", "2h", "1d"
}

/** Full expanded requirement with metadata and checklist items */
export interface ExpandedRequirement {
  id: string;
  status: RequirementStatus;
  userInput: string;
  title: string;
  summary: string;
  items: ChecklistItem[];
  depth: ExpansionDepth;
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
  error?: string;              // populated when status === 'failed'
}

// ---------------------------------------------------------------------------
// WebSocket client -> server messages (requirement actions)
// ---------------------------------------------------------------------------

/** Client requests requirement expansion */
export interface RequirementExpandMessage {
  action: 'requirement:expand';
  text: string;
  depth?: ExpansionDepth;
  /** When continuing from a prior expansion, include its ID as context */
  previousRequirementId?: string;
}

/** Client requests refinement of an existing expansion */
export interface RequirementRefineMessage {
  action: 'requirement:refine';
  requirementId: string;
  feedback: string;
}

/** Client requests commit (dual mode: issues or coordinate) */
export interface RequirementCommitMessage {
  action: 'requirement:commit';
  requirementId: string;
  mode: 'issues' | 'coordinate';
}

// ---------------------------------------------------------------------------
// WebSocket server -> client messages (progress + results)
// ---------------------------------------------------------------------------

/** Server sends expansion progress updates */
export interface RequirementProgressPayload {
  requirementId: string;
  status: RequirementStatus;
  stage: string;
  progress: number;           // 0-100 percentage
  message?: string;
}

/** Server sends the expanded requirement result */
export interface RequirementExpandedPayload {
  requirement: ExpandedRequirement;
}

/** Server sends commit result */
export interface RequirementCommittedPayload {
  requirementId: string;
  mode: 'issues' | 'coordinate';
  /** For issues mode: the created issue IDs */
  issueIds?: string[];
  /** For coordinate mode: the session ID */
  coordinateSessionId?: string;
}

/** Server sends error */
export interface RequirementErrorPayload {
  requirementId?: string;
  error: string;
}

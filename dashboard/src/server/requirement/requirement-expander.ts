// ---------------------------------------------------------------------------
// RequirementExpander -- expand user requirements into structured checklists
// ---------------------------------------------------------------------------
// Uses Agent SDK query() with outputFormat for structured expansion.
// Supports expand, refine, and dual-mode commit (Issues or Coordinate).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

import type {
  ChecklistItem,
  ExpandedRequirement,
  ExpansionDepth,
  RequirementStatus,
  RequirementProgressPayload,
} from '../../shared/requirement-types.js';
import type { Issue } from '../../shared/issue-types.js';
import type { WorkflowCoordinator, CoordinateStartOpts } from '../coordinator/workflow-coordinator.js';
import {
  appendIssueJsonl,
  withIssueWriteLock,
  generateIssueId,
} from '../utils/issue-store.js';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  buildExpandPrompt,
  buildRefinePrompt,
  buildContinuePrompt,
} from './requirement-prompts.js';

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

/** Extract a JSON object from text that may contain markdown fences or preamble */
function extractJson(text: string): string | null {
  // Try 1: Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced) return fenced[1].trim();

  // Try 2: Find outermost { ... } pair
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);

  // Try 3: Raw text might already be valid JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;

  return null;
}

// ---------------------------------------------------------------------------
// Agent SDK result shape (internal)
// ---------------------------------------------------------------------------

interface ExpansionResult {
  title: string;
  summary: string;
  items: ChecklistItem[];
}

// ---------------------------------------------------------------------------
// Progress listener type
// ---------------------------------------------------------------------------

export type RequirementProgressListener = (payload: RequirementProgressPayload) => void;

// ---------------------------------------------------------------------------
// RequirementExpander
// ---------------------------------------------------------------------------

export type ExpansionMethod = 'sdk' | 'cli';

export class RequirementExpander {
  private readonly store = new Map<string, ExpandedRequirement>();
  private readonly coordinateRunner: WorkflowCoordinator;
  private readonly issueJsonlPath: string;
  private readonly requirementDir: string;
  private readonly progressListeners = new Set<RequirementProgressListener>();

  constructor(
    coordinateRunner: WorkflowCoordinator,
    issueJsonlPath: string,
    requirementDir?: string,
  ) {
    this.coordinateRunner = coordinateRunner;
    this.issueJsonlPath = issueJsonlPath;
    this.requirementDir = requirementDir ?? join(dirname(issueJsonlPath), 'requirements');
    void this.loadPersistedRequirements();
  }

  /** Subscribe to progress events (used by WS handler to forward to clients) */
  onProgress(listener: RequirementProgressListener): void {
    this.progressListeners.add(listener);
  }

  /** Unsubscribe from progress events */
  offProgress(listener: RequirementProgressListener): void {
    this.progressListeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Read access
  // -------------------------------------------------------------------------

  /** Get an expanded requirement by ID */
  get(id: string): ExpandedRequirement | undefined {
    return this.store.get(id);
  }

  /** Get all expanded requirements */
  getAll(): ExpandedRequirement[] {
    return Array.from(this.store.values());
  }

  // -------------------------------------------------------------------------
  // Expand
  // -------------------------------------------------------------------------

  /** Expand user text into a structured requirement checklist */
  async expand(text: string, depth: ExpansionDepth = 'standard', method: ExpansionMethod = 'sdk', previousRequirementId?: string): Promise<ExpandedRequirement> {
    const id = `REQ-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const requirement: ExpandedRequirement = {
      id,
      status: 'expanding',
      userInput: text,
      title: '',
      summary: '',
      items: [],
      depth,
      createdAt: now,
      updatedAt: now,
    };

    this.store.set(id, requirement);
    this.emitProgress(id, 'expanding', 'Expanding requirement...');

    try {
      // Build prompt — use continue prompt if building on a previous expansion
      const previousReq = previousRequirementId ? this.store.get(previousRequirementId) : undefined;
      const prompt = previousReq
        ? buildContinuePrompt(text, depth, previousReq)
        : buildExpandPrompt(text, depth);

      const result = await this.runExpansionQuery(
        prompt,
      );

      requirement.title = result.title;
      requirement.summary = result.summary;
      requirement.items = result.items.map((item, index) => ({
        ...item,
        id: item.id || `item-${index}`,
      }));
      requirement.status = 'reviewing';
      requirement.updatedAt = new Date().toISOString();

      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'reviewing', 'Expansion complete. Ready for review.');

      return requirement;
    } catch (err) {
      requirement.status = 'failed';
      requirement.error = err instanceof Error ? err.message : String(err);
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'failed', requirement.error);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Refine
  // -------------------------------------------------------------------------

  /** Refine an existing expansion with user feedback */
  async refine(id: string, feedback: string): Promise<ExpandedRequirement> {
    const requirement = this.store.get(id);
    if (!requirement) {
      throw new Error(`Requirement ${id} not found`);
    }
    if (requirement.status !== 'reviewing') {
      throw new Error(`Requirement ${id} is in state "${requirement.status}", expected "reviewing"`);
    }

    requirement.status = 'expanding';
    requirement.updatedAt = new Date().toISOString();
    this.store.set(id, requirement);
    this.emitProgress(id, 'expanding', 'Refining requirement...');

    try {
      const result = await this.runExpansionQuery(
        buildRefinePrompt(requirement, feedback),
      );

      requirement.title = result.title;
      requirement.summary = result.summary;
      requirement.items = result.items.map((item, index) => ({
        ...item,
        id: item.id || `new-item-${index}`,
      }));
      requirement.status = 'reviewing';
      requirement.updatedAt = new Date().toISOString();

      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'reviewing', 'Refinement complete. Ready for review.');

      return requirement;
    } catch (err) {
      requirement.status = 'failed';
      requirement.error = err instanceof Error ? err.message : String(err);
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'failed', requirement.error);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Commit as Issues
  // -------------------------------------------------------------------------

  /** Convert each checklist item to an Issue and append to issues.jsonl */
  async commitAsIssues(id: string): Promise<string[]> {
    const requirement = this.store.get(id);
    if (!requirement) {
      throw new Error(`Requirement ${id} not found`);
    }
    if (requirement.status !== 'reviewing') {
      throw new Error(`Requirement ${id} is in state "${requirement.status}", expected "reviewing"`);
    }

    requirement.status = 'committing';
    requirement.updatedAt = new Date().toISOString();
    this.store.set(id, requirement);
    this.emitProgress(id, 'committing', 'Creating issues...');

    try {
      const issueIds: string[] = [];

      for (const item of requirement.items) {
        const issueId = generateIssueId();
        const now = new Date().toISOString();

        const issue: Issue = {
          id: issueId,
          title: item.title,
          description: item.description,
          type: item.type,
          priority: item.priority,
          status: 'open',
          solution: {
            steps: [{
              description: item.description,
            }],
            context: `From requirement expansion: ${requirement.title} (${requirement.id})`,
            planned_at: now,
            planned_by: 'requirement-expander',
          },
          created_at: now,
          updated_at: now,
        };

        await withIssueWriteLock(() => appendIssueJsonl(this.issueJsonlPath, issue));
        issueIds.push(issueId);
      }

      requirement.status = 'done';
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'done', `Created ${issueIds.length} issues.`);

      return issueIds;
    } catch (err) {
      requirement.status = 'failed';
      requirement.error = err instanceof Error ? err.message : String(err);
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      this.emitProgress(id, 'failed', requirement.error);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Commit as Coordinate session
  // -------------------------------------------------------------------------

  /** Build intent from requirement and start a WorkflowCoordinator session */
  async commitAsCoordinate(id: string): Promise<string> {
    const requirement = this.store.get(id);
    if (!requirement) {
      throw new Error(`Requirement ${id} not found`);
    }
    if (requirement.status !== 'reviewing') {
      throw new Error(`Requirement ${id} is in state "${requirement.status}", expected "reviewing"`);
    }

    requirement.status = 'committing';
    requirement.updatedAt = new Date().toISOString();
    this.store.set(id, requirement);
    this.emitProgress(id, 'committing', 'Starting coordinate session...');

    try {
      // Build intent string from the expanded requirement
      const itemSummary = requirement.items
        .map((item, i) => `${i + 1}. [${item.priority}] ${item.title}: ${item.description}`)
        .join('\n');

      const intent = [
        requirement.title,
        '',
        requirement.summary,
        '',
        'Checklist:',
        itemSummary,
      ].join('\n');

      const opts: CoordinateStartOpts = {
        tool: 'claude',
        autoMode: true,
      };

      const session = await this.coordinateRunner.start(intent, opts);

      requirement.status = 'done';
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      void this.persistRequirement(requirement);
      this.emitProgress(id, 'done', `Coordinate session started: ${session.sessionId}`);

      return session.sessionId;
    } catch (err) {
      requirement.status = 'failed';
      requirement.error = err instanceof Error ? err.message : String(err);
      requirement.updatedAt = new Date().toISOString();
      this.store.set(id, requirement);
      this.emitProgress(id, 'failed', requirement.error);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Run an Agent SDK query with structured output and retry on parse failure */
  private async runExpansionQuery(prompt: string, retries = 2): Promise<ExpansionResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        let resultText = '';

        for await (const message of query({
          prompt,
          options: {
            tools: [],
            allowedTools: [],
            permissionMode: 'dontAsk',
            systemPrompt: REQUIREMENT_SYSTEM_PROMPT,
            maxTurns: 3,
            persistSession: false,
          },
        })) {
          const msg = message as Record<string, unknown>;
          if (msg.type === 'result' && msg.subtype === 'success') {
            const successMsg = message as unknown as SDKResultSuccess;
            resultText = successMsg.result;
          }
        }

        if (!resultText) {
          throw new Error('Expansion query succeeded but returned an empty result from the model.');
        }

        // Extract JSON from response — model may wrap in markdown fences or add preamble text
        const jsonStr = extractJson(resultText);
        if (!jsonStr) {
          throw new Error(`Could not extract JSON from model response: ${resultText.substring(0, 100)}...`);
        }
        const parsed = JSON.parse(jsonStr) as ExpansionResult;

        // Validate parsed result
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid expansion result: result is not an object.');
        }
        if (typeof parsed.title !== 'string' || !parsed.title) {
          throw new Error('Invalid expansion result: "title" must be a non-empty string.');
        }
        if (typeof parsed.summary !== 'string' || !parsed.summary) {
          throw new Error('Invalid expansion result: "summary" must be a non-empty string.');
        }
        if (!Array.isArray(parsed.items)) {
          throw new Error('Invalid expansion result: "items" must be an array.');
        }

        return parsed;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          // Retry on parse/validation errors
          continue;
        }
      }
    }

    throw lastError ?? new Error('Expansion query failed');
  }

  /** Map status to stage name and progress percentage */
  private static readonly STATUS_PROGRESS: Record<RequirementStatus, { stage: string; progress: number }> = {
    draft: { stage: 'initialized', progress: 0 },
    expanding: { stage: 'expanding', progress: 30 },
    reviewing: { stage: 'review', progress: 70 },
    committing: { stage: 'committing', progress: 90 },
    done: { stage: 'complete', progress: 100 },
    failed: { stage: 'failed', progress: 0 },
  };

  /** Emit a progress event to all registered listeners */
  private emitProgress(requirementId: string, status: RequirementStatus, message?: string): void {
    const { stage, progress } = RequirementExpander.STATUS_PROGRESS[status];
    const payload: RequirementProgressPayload = { requirementId, status, stage, progress, message };
    for (const listener of this.progressListeners) {
      try {
        listener(payload);
      } catch {
        // Listener errors must not break the expansion flow
      }
    }
  }

  // -------------------------------------------------------------------------
  // File persistence
  // -------------------------------------------------------------------------

  /** Persist an ExpandedRequirement to a JSON file */
  private async persistRequirement(requirement: ExpandedRequirement): Promise<void> {
    try {
      await mkdir(this.requirementDir, { recursive: true });
      const filePath = join(this.requirementDir, `${requirement.id}.json`);
      await writeFile(filePath, JSON.stringify(requirement, null, 2), 'utf-8');
    } catch {
      // Persistence failures are non-fatal
    }
  }

  /** Load all persisted requirements from the requirement directory */
  private async loadPersistedRequirements(): Promise<void> {
    try {
      await mkdir(this.requirementDir, { recursive: true });
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(this.requirementDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(this.requirementDir, file), 'utf-8');
          const req = JSON.parse(data) as ExpandedRequirement;
          if (req.id) this.store.set(req.id, req);
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory may not exist yet — that's fine
    }
  }
}

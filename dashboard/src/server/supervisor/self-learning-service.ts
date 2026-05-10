// ---------------------------------------------------------------------------
// SelfLearningService -- analyzes ExecutionJournal events to extract
// CommandPattern statistics, build a KnowledgeBase, and generate suggestions
// ---------------------------------------------------------------------------

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { DashboardEventBus } from '../state/event-bus.js';
import type { ExecutionJournal } from '../execution/execution-journal.js';
import type { JournalEvent } from '../../shared/journal-types.js';
import type {
  CommandPattern,
  KnowledgeEntry,
  LearningStats,
  LearningSuggestion,
} from '../../shared/learning-types.js';

// ---------------------------------------------------------------------------
// JSONL helpers (same resilient pattern as ExecutionJournal)
// ---------------------------------------------------------------------------

async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }
  const items: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return items;
}

async function writeJsonl<T>(filePath: string, items: T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const content = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  // Full rewrite -- learning files are small enough for atomic replacement
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, content, 'utf-8');
}

async function appendJsonl<T>(filePath: string, item: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(item) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// SelfLearningService
// ---------------------------------------------------------------------------

export class SelfLearningService {
  private readonly patternsPath: string;
  private readonly kbPath: string;

  private patterns: Map<string, CommandPattern> = new Map();
  private knowledgeBase: Map<string, KnowledgeEntry> = new Map();

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly journal: ExecutionJournal,
    workflowRoot: string,
  ) {
    this.patternsPath = join(workflowRoot, 'learning', 'patterns.jsonl');
    this.kbPath = join(workflowRoot, 'learning', 'kb.jsonl');

    this.subscribeToEvents();
    void this.loadPersistedData();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Full analysis: read all journal events, rebuild pattern stats, generate suggestions */
  async analyze(): Promise<LearningStats> {
    const events = await this.journal.readAll();
    this.rebuildPatterns(events);
    await this.persistPatterns();
    this.emitUpdate();
    return this.getStats();
  }

  /** Get current learning stats snapshot */
  getStats(): LearningStats {
    const allPatterns = this.getPatterns();
    return {
      totalCommands: allPatterns.reduce((sum, p) => sum + p.frequency, 0),
      uniquePatterns: allPatterns.length,
      topPatterns: allPatterns.slice(0, 10),
      suggestions: this.generateSuggestions(allPatterns),
      knowledgeBaseSize: this.knowledgeBase.size,
    };
  }

  /** Get all command patterns sorted by frequency (descending) */
  getPatterns(): CommandPattern[] {
    return Array.from(this.patterns.values()).sort(
      (a, b) => b.frequency - a.frequency,
    );
  }

  /** Get all knowledge base entries */
  getKnowledgeBase(): KnowledgeEntry[] {
    return Array.from(this.knowledgeBase.values());
  }

  /** @deprecated kb.jsonl is being replaced by knowhow markdown (.workflow/knowhow/). Use store_knowhow tool instead. */
  async addKnowledgeEntry(
    entry: Omit<KnowledgeEntry, 'id' | 'usageCount' | 'lastAccessed'>,
  ): Promise<KnowledgeEntry> {
    const full: KnowledgeEntry = {
      ...entry,
      id: randomUUID(),
      usageCount: 0,
      lastAccessed: new Date().toISOString(),
    };
    this.knowledgeBase.set(full.id, full);
    await appendJsonl(this.kbPath, full);
    this.emitUpdate();
    return full;
  }

  // -------------------------------------------------------------------------
  // Private: EventBus subscriptions (incremental updates)
  // -------------------------------------------------------------------------

  private subscribeToEvents(): void {
    this.eventBus.on('execution:completed', (event) => {
      const payload = event.data as Record<string, unknown> | undefined;
      const issueId = payload && typeof payload['issueId'] === 'string' ? payload['issueId'] : undefined;
      if (issueId) void this.handleExecutionEvent('completed', issueId);
    });

    this.eventBus.on('execution:failed', (event) => {
      const payload = event.data as Record<string, unknown> | undefined;
      const issueId = payload && typeof payload['issueId'] === 'string' ? payload['issueId'] : undefined;
      if (issueId) void this.handleExecutionEvent('failed', issueId);
    });
  }

  private async handleExecutionEvent(
    outcome: 'completed' | 'failed',
    issueId: string,
  ): Promise<void> {
    // Re-read journal for the specific issue to update its pattern incrementally
    const events = await this.journal.getEventsForIssue(issueId);
    if (events.length === 0) return;

    // Find the dispatched event to determine the command type
    const dispatched = events.find((e) => e.type === 'issue:dispatched');
    if (!dispatched) return;

    const executor = (dispatched as { executor?: string }).executor ?? 'unknown';
    const command = executor;

    // Compute duration from dispatched -> completed/failed
    const startEvent = dispatched;
    const endEvent = events[events.length - 1];
    const duration = startEvent && endEvent
      ? new Date(endEvent.timestamp).getTime() - new Date(startEvent.timestamp).getTime()
      : 0;

    // Update or create pattern
    const existing = this.patterns.get(command);
    if (existing) {
      const totalRuns = existing.frequency + 1;
      const prevSuccesses = Math.round(existing.successRate * existing.frequency);
      const newSuccesses = prevSuccesses + (outcome === 'completed' ? 1 : 0);

      existing.frequency = totalRuns;
      existing.successRate = newSuccesses / totalRuns;
      existing.avgDuration =
        (existing.avgDuration * (totalRuns - 1) + duration) / totalRuns;
      existing.lastUsed = new Date().toISOString();
      if (!existing.contexts.includes(issueId)) {
        existing.contexts.push(issueId);
        // Keep context list bounded
        if (existing.contexts.length > 50) {
          existing.contexts = existing.contexts.slice(-50);
        }
      }
    } else {
      this.patterns.set(command, {
        command,
        frequency: 1,
        successRate: outcome === 'completed' ? 1 : 0,
        avgDuration: duration,
        lastUsed: new Date().toISOString(),
        contexts: [issueId],
      });
    }

    await this.persistPatterns();
    this.emitUpdate();
  }

  // -------------------------------------------------------------------------
  // Private: Full rebuild from journal events
  // -------------------------------------------------------------------------

  private rebuildPatterns(events: JournalEvent[]): void {
    // Group events by issueId
    const byIssue = new Map<string, JournalEvent[]>();
    for (const event of events) {
      const list = byIssue.get(event.issueId) || [];
      list.push(event);
      byIssue.set(event.issueId, list);
    }

    const patternMap = new Map<string, {
      frequency: number;
      successes: number;
      totalDuration: number;
      lastUsed: string;
      contexts: string[];
    }>();

    for (const [issueId, issueEvents] of byIssue) {
      const dispatched = issueEvents.find((e) => e.type === 'issue:dispatched');
      if (!dispatched) continue;

      const executor = (dispatched as { executor?: string }).executor ?? 'unknown';
      const completed = issueEvents.find((e) => e.type === 'issue:completed');
      const failed = issueEvents.find((e) => e.type === 'issue:failed');
      const terminal = completed ?? failed;

      const duration = terminal
        ? new Date(terminal.timestamp).getTime() - new Date(dispatched.timestamp).getTime()
        : 0;

      const existing = patternMap.get(executor) ?? {
        frequency: 0,
        successes: 0,
        totalDuration: 0,
        lastUsed: '',
        contexts: [],
      };

      existing.frequency++;
      if (completed) existing.successes++;
      existing.totalDuration += duration;
      existing.lastUsed =
        terminal && terminal.timestamp > existing.lastUsed
          ? terminal.timestamp
          : existing.lastUsed || dispatched.timestamp;
      existing.contexts.push(issueId);

      patternMap.set(executor, existing);
    }

    // Convert to CommandPattern map
    this.patterns.clear();
    for (const [command, data] of patternMap) {
      this.patterns.set(command, {
        command,
        frequency: data.frequency,
        successRate: data.frequency > 0 ? data.successes / data.frequency : 0,
        avgDuration: data.frequency > 0 ? data.totalDuration / data.frequency : 0,
        lastUsed: data.lastUsed || new Date().toISOString(),
        contexts: data.contexts.slice(-50),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private: Suggestion generation
  // -------------------------------------------------------------------------

  private generateSuggestions(patterns: CommandPattern[]): LearningSuggestion[] {
    const suggestions: LearningSuggestion[] = [];

    for (const pattern of patterns) {
      // Low success rate -> optimize suggestion
      if (pattern.frequency >= 3 && pattern.successRate < 0.5) {
        suggestions.push({
          type: 'optimize',
          title: `Low success rate for "${pattern.command}"`,
          description:
            `Command "${pattern.command}" has a ${Math.round(pattern.successRate * 100)}% success rate ` +
            `over ${pattern.frequency} executions. Consider reviewing configuration or common failure causes.`,
          confidence: Math.min(0.9, 0.5 + pattern.frequency * 0.05),
          action: `Review recent failures for executor "${pattern.command}"`,
        });
      }

      // High frequency -> automate suggestion
      if (pattern.frequency >= 10 && pattern.successRate >= 0.8) {
        suggestions.push({
          type: 'automate',
          title: `Frequently used: "${pattern.command}"`,
          description:
            `Command "${pattern.command}" has been used ${pattern.frequency} times with ` +
            `${Math.round(pattern.successRate * 100)}% success. Consider automating common workflows.`,
          confidence: Math.min(0.95, 0.6 + pattern.successRate * 0.3),
          action: `Create automation template for "${pattern.command}"`,
        });
      }

      // Alert: high avg duration
      if (pattern.frequency >= 3 && pattern.avgDuration > 300_000) {
        suggestions.push({
          type: 'alert',
          title: `Slow execution: "${pattern.command}"`,
          description:
            `Command "${pattern.command}" averages ${Math.round(pattern.avgDuration / 1000)}s per execution. ` +
            `Consider optimizing prompts or breaking tasks into smaller units.`,
          confidence: Math.min(0.85, 0.4 + pattern.frequency * 0.05),
        });
      }
    }

    // Sort by confidence descending
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // -------------------------------------------------------------------------
  // Private: Persistence
  // -------------------------------------------------------------------------

  private async loadPersistedData(): Promise<void> {
    const patterns = await readJsonl<CommandPattern>(this.patternsPath);
    for (const p of patterns) {
      this.patterns.set(p.command, p);
    }

    const entries = await readJsonl<KnowledgeEntry>(this.kbPath);
    for (const e of entries) {
      this.knowledgeBase.set(e.id, e);
    }
  }

  private async persistPatterns(): Promise<void> {
    const allPatterns = Array.from(this.patterns.values());
    await writeJsonl(this.patternsPath, allPatterns);
  }

  // -------------------------------------------------------------------------
  // Private: Event emission
  // -------------------------------------------------------------------------

  private emitUpdate(): void {
    this.eventBus.emit('supervisor:learning_update', this.getStats());
  }
}

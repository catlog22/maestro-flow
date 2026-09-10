import { loadMemoryConfig } from './config.js';
import { autoStageSafeFacts, stageFactToKnowledge, type StageResult } from './stage.js';
import { findFact, listFacts } from './store.js';

export function promoteWorkingMemoryFact(
  projectRoot: string,
  factId: string,
  runId?: string,
  sessionId?: string,
): { session_id?: string; run_id?: string; candidate_id?: string; reused?: boolean; fact_id: string } {
  const fact = findFact(projectRoot, factId, loadMemoryConfig(projectRoot));
  if (!fact) throw new Error(`Working memory fact not found: ${factId}`);
  if (fact.status !== 'active') throw new Error(`Working memory fact is ${fact.status}: ${factId}`);
  if (!runId && !sessionId) throw new Error('Promote requires --run or --session');
  const staged = stageFactToKnowledge(projectRoot, fact, { runId, sessionId });
  if (staged.skipped || !staged.candidate_id) {
    throw new Error(staged.reason ?? 'Unable to stage working-memory fact');
  }
  return {
    session_id: staged.session_id,
    run_id: staged.run_id,
    candidate_id: staged.candidate_id,
    fact_id: fact.id,
  };
}

/**
 * Stage pending sticky facts onto an explicit Run/Session.
 * Reconcile / review / promote then treat them as ordinary knowledge candidates.
 * Never invents a Session or writes Knowhow/KG corpus entries.
 */
export function ingestWorkingMemoryIntoKnowledge(
  projectRoot: string,
  target: { runId?: string; sessionId?: string },
): StageResult[] {
  return promotePendingFacts(projectRoot, target);
}

export function promotePendingFacts(
  projectRoot: string,
  target: { runId?: string; sessionId?: string },
): StageResult[] {
  const pending = listFacts(projectRoot, { status: 'active' }, loadMemoryConfig(projectRoot))
    .filter(fact => fact.promotion_state === 'pending');
  if (target.runId || target.sessionId) {
    return pending.map(fact => {
      try {
        return stageFactToKnowledge(projectRoot, fact, target);
      } catch {
        return { fact_id: fact.id, skipped: true, reason: 'stage-failed' };
      }
    });
  }
  return autoStageSafeFacts(projectRoot, pending);
}

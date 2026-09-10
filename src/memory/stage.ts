import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { findKnowledgeAttributionAuthority } from '../run/knowledge-identity.js';
import { stageRunKnowledgeCandidate } from '../run/knowledge.js';
import { stageSessionKnowledgeCandidate } from '../run/session-knowledge.js';
import { SessionStore } from '../run/store.js';
import { patchFact } from './store.js';
import { isStickyFact, type WorkingMemoryFact } from './types.js';

export function memoryEvidencePath(projectRoot: string, factId: string): string {
  return join(projectRoot, '.workflow', 'memory', 'evidence', `${factId}.md`);
}

export function writeMemoryEvidence(projectRoot: string, fact: WorkingMemoryFact): string {
  const path = memoryEvidencePath(projectRoot, fact.id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${fact.id}\n\n${fact.text}\n`, 'utf8');
  return `.workflow/memory/evidence/${fact.id}.md:1`;
}

export interface StageResult {
  fact_id: string;
  candidate_id?: string;
  session_id?: string;
  run_id?: string;
  skipped: boolean;
  reason?: string;
}

function evidenceRefs(projectRoot: string, fact: WorkingMemoryFact): string[] {
  return [writeMemoryEvidence(projectRoot, fact)];
}

export function stageFactToKnowledge(
  projectRoot: string,
  fact: WorkingMemoryFact,
  target: { runId?: string; sessionId?: string },
): StageResult {
  const refs = evidenceRefs(projectRoot, fact);
  const payload = {
    target: 'knowhow' as const,
    title: fact.text.slice(0, 120),
    content: fact.text,
    category: 'tip',
    evidenceRefs: refs,
    keywords: [fact.topic, fact.type].filter(Boolean),
    type: 'tip',
  };
  if (target.runId) {
    const staged = stageRunKnowledgeCandidate(projectRoot, target.runId, payload, target.sessionId);
    patchFact(projectRoot, fact.id, {
      promotion_state: 'staged',
      knowledge_candidate_id: staged.candidate_id,
    });
    return {
      fact_id: fact.id,
      candidate_id: staged.candidate_id,
      session_id: staged.session_id,
      run_id: staged.run_id,
      skipped: false,
    };
  }
  if (target.sessionId) {
    const staged = stageSessionKnowledgeCandidate(projectRoot, target.sessionId, payload);
    patchFact(projectRoot, fact.id, {
      promotion_state: 'staged',
      knowledge_candidate_id: staged.candidate_id,
    });
    return {
      fact_id: fact.id,
      candidate_id: staged.candidate_id,
      session_id: staged.session_id,
      skipped: false,
    };
  }
  return { fact_id: fact.id, skipped: true, reason: 'missing-target' };
}

export function autoStageSafeFacts(projectRoot: string, facts: WorkingMemoryFact[]): StageResult[] {
  const pending = facts.filter(fact =>
    fact.promotion_state === 'pending' && isStickyFact(fact) && fact.status === 'active',
  );
  if (pending.length === 0) return [];
  try {
    const store = new SessionStore(projectRoot);
    const authority = findKnowledgeAttributionAuthority(projectRoot, store);
    if (!authority) {
      return pending.map(fact => ({ fact_id: fact.id, skipped: true, reason: 'no-authority' }));
    }
    return pending.map(fact => {
      try {
        return stageFactToKnowledge(projectRoot, fact, authority.kind === 'run'
          ? { runId: authority.runId, sessionId: authority.sessionId }
          : { sessionId: authority.sessionId });
      } catch {
        return { fact_id: fact.id, skipped: true, reason: 'stage-failed' };
      }
    });
  } catch {
    return pending.map(fact => ({ fact_id: fact.id, skipped: true, reason: 'stage-failed' }));
  }
}

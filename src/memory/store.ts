import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { updateFileAtomic } from '../utils/atomic-write.js';
import { factsConflict, topicFromText } from './topic.js';
import {
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  type MemoryFactStatus,
  type MemoryPromotionState,
  type MemoryScope,
  type WorkingMemoryFact,
  type WorkingMemoryStoreFile,
} from './types.js';

export const WORKING_MEMORY_SCHEMA = 'working-memory/1.1' as const;
const READABLE_SCHEMAS = new Set(['working-memory/1.0', 'working-memory/1.1']);
const PROMOTION_RANK: Record<MemoryPromotionState, number> = { none: 0, pending: 1, staged: 2 };

export function workingMemoryPath(projectRoot: string): string {
  return join(projectRoot, '.workflow', 'memory', 'working-memory.json');
}

export function factIdForText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return `wm-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

export function emptyWorkingMemory(): WorkingMemoryStoreFile {
  return { schema_version: WORKING_MEMORY_SCHEMA, facts: [] };
}

export function normalizeFact(
  raw: Partial<WorkingMemoryFact> & { text: string },
  now: string = new Date().toISOString(),
): WorkingMemoryFact {
  const text = raw.text.trim();
  const created = raw.created_at ?? now;
  return {
    id: raw.id ?? factIdForText(text),
    type: raw.type ?? 'project',
    text,
    created_at: created,
    updated_at: raw.updated_at ?? created,
    last_used_at: raw.last_used_at,
    use_count: raw.use_count ?? 0,
    source: raw.source ?? 'extract',
    extract_method: raw.extract_method ?? (raw.source === 'remember' ? 'remember' : undefined),
    evidence_kind: raw.evidence_kind ?? 'transcript',
    scope: raw.scope ?? 'project',
    session_id: raw.session_id,
    topic: raw.topic ?? topicFromText(text),
    confidence: raw.confidence ?? (raw.source === 'remember' ? 0.95 : 0.7),
    status: raw.status ?? 'active',
    superseded_by: raw.superseded_by,
    supersedes: raw.supersedes,
    promotion_state: raw.promotion_state ?? (raw.type === 'user' || raw.type === 'feedback' ? 'pending' : 'none'),
    knowledge_candidate_id: raw.knowledge_candidate_id,
  };
}

function decayStatus(fact: WorkingMemoryFact, config: Pick<MemoryConfig, 'decayHalfLifeDays'>, now: Date): MemoryFactStatus {
  if (fact.status === 'superseded') return 'superseded';
  const anchor = Date.parse(fact.last_used_at ?? fact.created_at);
  if (!Number.isFinite(anchor)) return fact.status === 'decayed' ? 'active' : fact.status;
  const ageDays = (now.getTime() - anchor) / 86_400_000;
  if ((fact.use_count ?? 0) === 0 && ageDays > config.decayHalfLifeDays * 2) return 'decayed';
  return 'active';
}

function applyDecay(facts: WorkingMemoryFact[], config: Pick<MemoryConfig, 'decayHalfLifeDays'>, now: Date): WorkingMemoryFact[] {
  return facts.map(fact => {
    const next = decayStatus(fact, config, now);
    return next === fact.status ? fact : { ...fact, status: next };
  });
}

type LoadedStore = {
  store: WorkingMemoryStoreFile;
  source: 'missing' | 'ok' | 'corrupt';
};

function parseStore(raw: string | null): LoadedStore {
  if (raw == null || !raw.trim()) return { store: emptyWorkingMemory(), source: 'missing' };
  try {
    const parsed = JSON.parse(raw) as WorkingMemoryStoreFile;
    if (!READABLE_SCHEMAS.has(parsed.schema_version) || !Array.isArray(parsed.facts)) {
      return { store: emptyWorkingMemory(), source: 'corrupt' };
    }
    return {
      store: {
        schema_version: WORKING_MEMORY_SCHEMA,
        facts: parsed.facts
          .filter(fact => fact && typeof fact.text === 'string' && fact.text.trim())
          .map(fact => normalizeFact(fact)),
      },
      source: 'ok',
    };
  } catch {
    return { store: emptyWorkingMemory(), source: 'corrupt' };
  }
}

function serializeStore(facts: WorkingMemoryFact[]): string {
  return `${JSON.stringify({
    schema_version: WORKING_MEMORY_SCHEMA,
    facts,
  }, null, 2)}\n`;
}

export function readWorkingMemory(
  projectRoot: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
  now: Date = new Date(),
): WorkingMemoryStoreFile {
  const path = workingMemoryPath(projectRoot);
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const loaded = parseStore(raw);
  return {
    schema_version: WORKING_MEMORY_SCHEMA,
    facts: applyDecay(loaded.store.facts, config, now),
  };
}

export function writeWorkingMemory(projectRoot: string, store: WorkingMemoryStoreFile): void {
  const path = workingMemoryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  updateFileAtomic(path, current => {
    if (parseStore(current).source === 'corrupt') return null;
    return serializeStore(store.facts);
  });
}

function withWorkingMemory<T>(
  projectRoot: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays'>,
  now: Date,
  mutate: (facts: WorkingMemoryFact[]) => { facts: WorkingMemoryFact[]; result: T; dirty: boolean },
  onCorrupt: () => T,
): T {
  const path = workingMemoryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  let result = onCorrupt();
  updateFileAtomic(path, current => {
    const loaded = parseStore(current);
    if (loaded.source === 'corrupt') {
      result = onCorrupt();
      return null;
    }
    const next = mutate(loaded.store.facts);
    result = next.result;
    if (!next.dirty) return current;
    return serializeStore(next.facts);
  });
  return result;
}

function strongerSource(
  existing: WorkingMemoryFact['source'],
  incoming: WorkingMemoryFact['source'],
): WorkingMemoryFact['source'] {
  return existing === 'remember' || incoming === 'remember' ? 'remember' : incoming;
}

function mergePromotion(existing: MemoryPromotionState, incoming: MemoryPromotionState): MemoryPromotionState {
  return PROMOTION_RANK[incoming] >= PROMOTION_RANK[existing] ? incoming : existing;
}

function mergeExact(
  existing: WorkingMemoryFact,
  incoming: WorkingMemoryFact,
  stamp: string,
): { fact: WorkingMemoryFact; changed: boolean } {
  const status: MemoryFactStatus = existing.status === 'superseded' ? 'active' : incoming.status;
  const next: WorkingMemoryFact = {
    ...existing,
    ...incoming,
    created_at: existing.created_at,
    use_count: existing.use_count,
    last_used_at: existing.last_used_at,
    source: strongerSource(existing.source, incoming.source),
    extract_method: existing.extract_method === 'remember' ? 'remember' : incoming.extract_method ?? existing.extract_method,
    confidence: Math.max(existing.confidence ?? 0, incoming.confidence ?? 0),
    promotion_state: mergePromotion(existing.promotion_state, incoming.promotion_state),
    knowledge_candidate_id: incoming.knowledge_candidate_id ?? existing.knowledge_candidate_id,
    status,
    superseded_by: status === 'active' ? undefined : existing.superseded_by,
    updated_at: existing.updated_at,
  };
  const changed = next.text !== existing.text
    || next.type !== existing.type
    || next.scope !== existing.scope
    || next.session_id !== existing.session_id
    || next.topic !== existing.topic
    || next.confidence !== existing.confidence
    || next.status !== existing.status
    || next.promotion_state !== existing.promotion_state
    || next.knowledge_candidate_id !== existing.knowledge_candidate_id
    || next.source !== existing.source;
  if (!changed) return { fact: existing, changed: false };
  return { fact: { ...next, updated_at: stamp }, changed: true };
}

function supersedeConflicts(
  facts: WorkingMemoryFact[],
  winner: WorkingMemoryFact,
  stamp: string,
): { facts: WorkingMemoryFact[]; superseded: WorkingMemoryFact[] } {
  const conflicts = facts.filter(item => item.id !== winner.id && factsConflict(winner, item));
  if (conflicts.length === 0) return { facts, superseded: [] };
  const supersededIds = new Set(conflicts.map(item => item.id));
  winner.supersedes = [...new Set([...(winner.supersedes ?? []), ...[...supersededIds]])];
  return {
    facts: facts.map(item => supersededIds.has(item.id)
      ? { ...item, status: 'superseded', superseded_by: winner.id, updated_at: stamp }
      : item),
    superseded: conflicts,
  };
}

export interface UpsertResult {
  added: WorkingMemoryFact[];
  updated: WorkingMemoryFact[];
  superseded: WorkingMemoryFact[];
}

export function upsertFacts(
  projectRoot: string,
  incoming: WorkingMemoryFact[],
  config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
  now: () => string = () => new Date().toISOString(),
): UpsertResult {
  const stamp = now();
  const clock = new Date(stamp);
  return withWorkingMemory(projectRoot, config, clock, facts => {
    const added: WorkingMemoryFact[] = [];
    const updated: WorkingMemoryFact[] = [];
    const superseded: WorkingMemoryFact[] = [];
    let nextFacts = facts;
    for (const raw of incoming) {
      const fact = normalizeFact(raw, stamp);
      const exactIndex = nextFacts.findIndex(item => item.id === fact.id);
      if (exactIndex >= 0) {
        const merged = mergeExact(nextFacts[exactIndex], fact, stamp);
        nextFacts = nextFacts.map((item, index) => index === exactIndex ? merged.fact : item);
        const resolved = supersedeConflicts(nextFacts, merged.fact, stamp);
        nextFacts = resolved.facts;
        superseded.push(...resolved.superseded);
        if (merged.changed) updated.push(merged.fact);
        continue;
      }
      const resolved = supersedeConflicts(nextFacts, fact, stamp);
      nextFacts = [...resolved.facts, fact];
      superseded.push(...resolved.superseded);
      added.push(fact);
    }
    return {
      facts: nextFacts,
      dirty: added.length + updated.length + superseded.length > 0,
      result: { added, updated, superseded },
    };
  }, () => ({ added: [], updated: [], superseded: [] }));
}

/** ADD-only compatibility: identical normalized text is skipped. */
export function addFacts(projectRoot: string, incoming: WorkingMemoryFact[]): WorkingMemoryFact[] {
  return upsertFacts(projectRoot, incoming).added;
}

export function rememberFact(
  projectRoot: string,
  text: string,
  type: WorkingMemoryFact['type'] = 'user',
  scope: MemoryScope = 'project',
  sessionId?: string,
): WorkingMemoryFact {
  const trimmed = text.trim();
  const resolvedScope: MemoryScope = scope === 'session' && !sessionId ? 'project' : scope;
  const fact = normalizeFact({
    id: factIdForText(trimmed),
    type,
    text: trimmed,
    source: 'remember',
    extract_method: 'remember',
    evidence_kind: 'explicit',
    scope: resolvedScope,
    session_id: resolvedScope === 'session' ? sessionId : undefined,
    confidence: 0.95,
    promotion_state: 'pending',
  });
  const result = upsertFacts(projectRoot, [fact]);
  const saved = result.added[0] ?? result.updated[0] ?? findFact(projectRoot, fact.id);
  if (!saved) throw new Error('Unable to persist working-memory fact');
  return saved;
}

export function listFacts(
  projectRoot: string,
  options: { status?: MemoryFactStatus | 'all'; scope?: MemoryScope; sessionId?: string } = {},
  config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
): WorkingMemoryFact[] {
  const status = options.status ?? 'active';
  return readWorkingMemory(projectRoot, config).facts.filter(fact => {
    if (status !== 'all' && fact.status !== status) return false;
    if (options.scope && fact.scope !== options.scope) return false;
    if (options.sessionId && fact.scope === 'session' && fact.session_id !== options.sessionId) return false;
    if (options.sessionId && fact.scope === 'session' && !fact.session_id) return false;
    return true;
  });
}

export function visibleFacts(
  projectRoot: string,
  sessionId?: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
): WorkingMemoryFact[] {
  return readWorkingMemory(projectRoot, config).facts.filter(fact => {
    if (fact.status !== 'active') return false;
    if (fact.scope === 'session') return Boolean(sessionId) && fact.session_id === sessionId;
    return true;
  });
}

export function forgetFact(projectRoot: string, id: string): boolean {
  return withWorkingMemory(projectRoot, DEFAULT_MEMORY_CONFIG, new Date(), facts => {
    const next = facts.filter(fact => fact.id !== id && fact.text !== id);
    return { facts: next, dirty: next.length !== facts.length, result: next.length !== facts.length };
  }, () => false);
}

export function findFact(
  projectRoot: string,
  id: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
): WorkingMemoryFact | undefined {
  return readWorkingMemory(projectRoot, config).facts.find(fact => fact.id === id);
}

export function touchFacts(
  projectRoot: string,
  ids: string[],
  now: string = new Date().toISOString(),
  _config: Pick<MemoryConfig, 'decayHalfLifeDays'> = DEFAULT_MEMORY_CONFIG,
): void {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  withWorkingMemory(projectRoot, _config, new Date(now), facts => {
    let changed = false;
    const next = facts.map(fact => {
      if (!wanted.has(fact.id) || fact.status !== 'active') return fact;
      changed = true;
      return { ...fact, last_used_at: now, use_count: (fact.use_count ?? 0) + 1 };
    });
    return { facts: next, dirty: changed, result: undefined };
  }, () => undefined);
}

export function patchFact(
  projectRoot: string,
  id: string,
  patch: Partial<WorkingMemoryFact>,
): WorkingMemoryFact | undefined {
  return withWorkingMemory(projectRoot, DEFAULT_MEMORY_CONFIG, new Date(), facts => {
    let next: WorkingMemoryFact | undefined;
    const mapped = facts.map(fact => {
      if (fact.id !== id) return fact;
      next = normalizeFact({
        ...fact,
        ...patch,
        id: fact.id,
        text: patch.text ?? fact.text,
        promotion_state: patch.promotion_state
          ? mergePromotion(fact.promotion_state, patch.promotion_state)
          : fact.promotion_state,
        knowledge_candidate_id: patch.knowledge_candidate_id ?? fact.knowledge_candidate_id,
        updated_at: new Date().toISOString(),
      });
      return next;
    });
    return { facts: mapped, dirty: Boolean(next), result: next };
  }, () => undefined);
}

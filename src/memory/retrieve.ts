import { lexicalSimilarity, tokenizeMemory } from './tokens.js';
import { topicOverlap, topicsFromQuery } from './topic.js';
import { isStickyFact, type MemoryConfig, type WorkingMemoryFact } from './types.js';

export interface ScoredMemoryFact {
  fact: WorkingMemoryFact;
  score: number;
}

function ageDays(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, (now.getTime() - then) / 86_400_000);
}

export function scoreFactAgainstQuery(
  fact: WorkingMemoryFact,
  query: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays' | 'semantic'>,
  now: Date = new Date(),
  embeddingScore = 0,
  queryTopics: readonly string[] = topicsFromQuery(query),
): number {
  if (fact.status !== 'active') return 0;
  const overlap = query.trim()
    ? lexicalSimilarity(fact.text, query)
    : isStickyFact(fact) ? 0.55 : 0.15;
  const queryTokens = tokenizeMemory(query);
  const factTokens = new Set(tokenizeMemory(fact.text));
  const tokenHits = queryTokens.filter(token => factTokens.has(token)).length;
  const tokenBoost = queryTokens.length > 0 ? tokenHits / queryTokens.length : 0;
  const typeBoost = fact.type === 'user' ? 0.12 : fact.type === 'feedback' ? 0.1 : 0;
  const explicitBoost = fact.source === 'remember' ? 0.08 : 0;
  const usageBoost = Math.min(0.08, Math.log10((fact.use_count ?? 0) + 1) * 0.05);
  const topicBoost = query.trim() && config.semantic !== 'lexical'
    ? 0.36 * topicOverlap(fact.topic, queryTopics)
    : 0;
  const embedBoost = config.semantic === 'embed' ? 0.28 * Math.max(0, embeddingScore) : 0;
  const halfLife = Math.max(1, config.decayHalfLifeDays);
  const recency = 0.5 ** (ageDays(fact.last_used_at ?? fact.updated_at ?? fact.created_at, now) / halfLife);
  const confidence = Number.isFinite(fact.confidence) ? fact.confidence : 0.5;
  return Math.min(1, (
    0.55 * overlap
    + 0.2 * tokenBoost
    + typeBoost
    + explicitBoost
    + usageBoost
    + topicBoost
    + embedBoost
  ) * (0.45 + 0.55 * recency) * (0.7 + 0.3 * confidence));
}

export function retrieveFacts(
  facts: WorkingMemoryFact[],
  query: string,
  config: Pick<MemoryConfig, 'decayHalfLifeDays' | 'minRecallScore' | 'recallLimit' | 'stickyLimit' | 'semantic'>,
  now: Date = new Date(),
  embeddingScores?: Map<string, number>,
): ScoredMemoryFact[] {
  const active = facts.filter(fact => fact.status === 'active');
  const queryTopics = topicsFromQuery(query);
  const scored = active
    .map(fact => ({
      fact,
      score: scoreFactAgainstQuery(
        fact,
        query,
        config,
        now,
        embeddingScores?.get(fact.id) ?? 0,
        queryTopics,
      ),
    }))
    .sort((left, right) => right.score - left.score || right.fact.updated_at.localeCompare(left.fact.updated_at));
  if (!query.trim()) {
    return scored
      .filter(item => isStickyFact(item.fact))
      .slice(0, Math.max(1, config.stickyLimit));
  }
  const ranked = scored.filter(item =>
    item.score >= config.minRecallScore || (isStickyFact(item.fact) && item.score >= config.minRecallScore * 0.6),
  );
  return ranked.slice(0, Math.max(1, config.recallLimit));
}

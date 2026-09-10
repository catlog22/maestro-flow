import { retrieveFacts } from './retrieve.js';
import { visibleFacts } from './store.js';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig, type WorkingMemoryFact } from './types.js';

export const MEMORY_WRAP_OPEN = '<maestro-memory>';
export const MEMORY_WRAP_CLOSE = '</maestro-memory>';

export function capWorkingSet(
  facts: WorkingMemoryFact[],
  maxLines: number = DEFAULT_MEMORY_CONFIG.workingSetMaxLines,
  maxBytes: number = DEFAULT_MEMORY_CONFIG.workingSetMaxBytes,
): WorkingMemoryFact[] {
  const kept: WorkingMemoryFact[] = [];
  let lines = 0;
  let bytes = 0;
  for (const fact of facts) {
    const line = `- ${fact.text}`;
    const nextLines = lines + 1;
    const nextBytes = bytes + Buffer.byteLength(`${line}\n`, 'utf8');
    if (nextLines > maxLines || nextBytes > maxBytes) break;
    kept.push(fact);
    lines = nextLines;
    bytes = nextBytes;
  }
  return kept;
}

export function formatWorkingMemoryInject(
  facts: WorkingMemoryFact[],
  config: Pick<MemoryConfig, 'workingSetMaxLines' | 'workingSetMaxBytes'> = DEFAULT_MEMORY_CONFIG,
): string {
  const capped = capWorkingSet(facts, config.workingSetMaxLines, config.workingSetMaxBytes);
  if (capped.length === 0) return '';
  const body = ['## working-memory', ...capped.map(fact => `- ${fact.text}`)].join('\n');
  return `${MEMORY_WRAP_OPEN}\n${body}\n${MEMORY_WRAP_CLOSE}`;
}

export function selectWorkingMemory(
  projectRoot: string,
  query: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
  sessionId?: string,
  embeddingScores?: Map<string, number>,
): WorkingMemoryFact[] {
  return retrieveFacts(visibleFacts(projectRoot, sessionId, config), query, config, new Date(), embeddingScores)
    .map(item => item.fact);
}

export function injectWorkingMemory(
  projectRoot: string,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
  query = '',
  sessionId?: string,
  embeddingScores?: Map<string, number>,
): string {
  return formatWorkingMemoryInject(
    selectWorkingMemory(projectRoot, query, config, sessionId, embeddingScores),
    config,
  );
}

export function formatRecalledMemory(
  facts: WorkingMemoryFact[],
  remoteTexts: string[] = [],
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): string {
  const localTexts = new Set(facts.map(fact => fact.text));
  const remoteFacts: WorkingMemoryFact[] = remoteTexts
    .map(text => text.trim())
    .filter(text => text && !localTexts.has(text))
    .map((text, index) => ({
      id: `mem0-${index}`,
      type: 'reference' as const,
      text,
      created_at: '1970-01-01T00:00:00.000Z',
      updated_at: '1970-01-01T00:00:00.000Z',
      use_count: 0,
      source: 'extract' as const,
      evidence_kind: 'transcript' as const,
      scope: 'project' as const,
      topic: 'reference',
      confidence: 0.4,
      status: 'active' as const,
      promotion_state: 'none' as const,
    }));
  return formatWorkingMemoryInject([...facts, ...remoteFacts], config);
}

export function isSpecPriorityContext(content: string): boolean {
  return content.includes('<maestro-context') || content.includes('## specs');
}

/** Specs stay first; working memory is additive and never rewrites spec context. */
export function composeWithSpecPriority(existing: string, memory: string): string {
  if (!memory) return existing;
  if (!existing) return memory;
  if (isSpecPriorityContext(existing)) return `${existing}\n\n${memory}`;
  return `${memory}\n\n${existing}`;
}

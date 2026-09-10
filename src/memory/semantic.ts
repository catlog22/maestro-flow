import { tokenizeMemory } from './tokens.js';
import { topicFromText } from './topic.js';
import type { WorkingMemoryFactType } from './types.js';

export interface MemoryEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface SemanticDraft {
  text: string;
  type: WorkingMemoryFactType;
  confidence: number;
}

/**
 * Objects that make a speech-act worth remembering.
 * A frame without one of these is treated as chatter.
 */
const CONCRETE_OBJECT = /\b(pnpm|npm|yarn|bun|named exports?|default exports?|export by name|__tests__|lockfile|esm|cjs)\b|具名导出|默认导出|按名称导出|模块旁边|源码旁边|包管理|pnpm-lock|package-lock|yarn\.lock/i;

interface SpeechActFrame {
  match: RegExp;
  type: WorkingMemoryFactType;
}

const SPEECH_ACTS: SpeechActFrame[] = [
  {
    match: /(?:standardize\s+on|standardise\s+on|统一(?:用|使用)|必须(?:用|使用)|let'?s\s+(?:standardize\s+on|standardise\s+on|use)|adopt)\s+(.{2,120})/i,
    type: 'user',
  },
  {
    match: /(?:team\s+decided|we\s+decided|decided\s+that)\s+(.{2,120})/i,
    type: 'user',
  },
  {
    match: /(?:the convention is(?:\s+to)?|convention:)\s+(.{2,120})/i,
    type: 'user',
  },
  {
    match: /(?:stop\s+using|不再(?:用|使用)|弃用)\s+(.{2,120})/i,
    type: 'feedback',
  },
  {
    match: /(?:tests?(?:\s+files?)?\s+(?:live|go|sit|belong|stay|beside|next to)|测试(?:文件|测例)?(?:放在|写在|就放在|放)|测例就放在)\s+(.{2,120})/i,
    type: 'user',
  },
  {
    match: /(?:export\s+by\s+name|modules?\s+should\s+export|按名称导出|对外(?:用|使用)?具名导出)/i,
    type: 'user',
  },
];

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function hasConcreteMemoryObject(text: string): boolean {
  if (CONCRETE_OBJECT.test(text)) return true;
  const topic = topicFromText(text);
  return topic !== 'general' && !topic.startsWith('topic:');
}

/**
 * Speech-act frames used only after the regex/structured rule path misses.
 * Requires a concrete object (tool, export style, test layout, …).
 */
export function extractSemanticDraft(text: string): SemanticDraft | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  for (const frame of SPEECH_ACTS) {
    const matched = trimmed.match(frame.match);
    if (!matched) continue;
    const extracted = (matched[1] ?? trimmed).trim();
    if (!hasConcreteMemoryObject(extracted) && !hasConcreteMemoryObject(trimmed)) continue;
    return {
      text: extracted || trimmed,
      type: frame.type,
      confidence: 0.72,
    };
  }
  return null;
}

export async function embeddingScoresForFacts(
  embedder: MemoryEmbedder,
  query: string,
  facts: ReadonlyArray<{ id: string; text: string }>,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!query.trim() || facts.length === 0) return scores;
  const vectors = await embedder.embed([query, ...facts.map(fact => fact.text)]);
  const queryVector = vectors[0] ?? [];
  facts.forEach((fact, index) => {
    scores.set(fact.id, cosineSimilarity(queryVector, vectors[index + 1] ?? []));
  });
  return scores;
}

/** Deterministic bag-of-words embedder for tests — not used on the default hook path. */
export function bagOfWordsEmbedder(): MemoryEmbedder {
  return {
    async embed(texts) {
      const vocab = [...new Set(texts.flatMap(text => tokenizeMemory(text)))];
      return texts.map(text => {
        const tokens = new Set(tokenizeMemory(text));
        return vocab.map(token => (tokens.has(token) ? 1 : 0));
      });
    },
  };
}

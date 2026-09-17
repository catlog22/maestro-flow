import { claimFromText, claimsCompete } from './claim.js';
import { tokenizeMemory } from './tokens.js';
import type { WorkingMemoryFact } from './types.js';

const KNOWN_TOPICS: Array<{ topic: string; needles: RegExp }> = [
  { topic: 'package-manager', needles: /\b(npm|yarn|pnpm|bun)\b|包管理|依赖安装/i },
  { topic: 'module-exports', needles: /\b(named exports?|default exports?|export by name)\b|具名导出|默认导出|按名称导出/i },
  { topic: 'test-layout', needles: /\btests? live\b|__tests__|测试文件|测例|模块旁边|源码旁边|tests? (?:belong|beside|next to)/i },
  { topic: 'package-manager-lock', needles: /\blockfile\b|pnpm-lock|package-lock|yarn\.lock/i },
];

const QUERY_ALIASES: Array<{ topic: string; needles: RegExp }> = [
  { topic: 'package-manager', needles: /\b(package manager|package-manager|install(?:s|er)?|deps?|dependencies)\b|包管理|依赖/i },
  { topic: 'module-exports', needles: /\b(export|exports|public api|module surface)\b|公开\s*api|模块导出/i },
  { topic: 'test-layout', needles: /\b(where (?:do )?tests|test (?:file|layout|location|live))\b|测试放|测例|测试文件/i },
];

export function knownTopicFromText(...texts: string[]): string | undefined {
  for (const text of texts) {
    for (const item of KNOWN_TOPICS) {
      if (item.needles.test(text)) return item.topic;
    }
  }
  return undefined;
}

export function topicFromText(text: string): string {
  return knownTopicFromText(text) ?? fallbackTopic(text);
}

function fallbackTopic(text: string): string {
  const tokens = tokenizeMemory(text).slice(0, 4).sort();
  return tokens.length > 0 ? `topic:${tokens.join('+')}` : 'general';
}

export function topicsFromQuery(query: string): string[] {
  const topics = new Set<string>();
  for (const item of KNOWN_TOPICS) {
    if (item.needles.test(query)) topics.add(item.topic);
  }
  for (const item of QUERY_ALIASES) {
    if (item.needles.test(query)) topics.add(item.topic);
  }
  const inferred = topicFromText(query);
  if (inferred !== 'general' && !inferred.startsWith('topic:')) topics.add(inferred);
  return [...topics];
}

export function topicOverlap(factTopic: string, queryTopics: readonly string[]): number {
  return factTopic && queryTopics.includes(factTopic) ? 1 : 0;
}

export function factsConflict(incoming: Pick<WorkingMemoryFact, 'topic' | 'type' | 'text'>, existing: Pick<WorkingMemoryFact, 'topic' | 'type' | 'text' | 'status'>): boolean {
  if (existing.status && existing.status !== 'active') return false;
  if (incoming.text.trim().toLowerCase() === existing.text.trim().toLowerCase()) return false;
  const preference = incoming.type === 'user' || incoming.type === 'feedback';
  const existingPreference = existing.type === 'user' || existing.type === 'feedback';
  if (!preference || !existingPreference) return false;
  return claimsCompete(claimFromText(incoming.text), claimFromText(existing.text));
}

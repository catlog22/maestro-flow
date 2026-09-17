import { extractWorkingMemoryFacts } from './extract.js';
import { retrieveFacts } from './retrieve.js';
import { normalizeFact } from './store.js';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig, type WorkingMemoryFact } from './types.js';

export interface ExtractGoldItem {
  text: string;
  keep: boolean;
  topic?: string;
  method?: 'rule' | 'semantic';
  needle?: string;
}

export interface RetrieveGoldItem {
  query: string;
  relevant: string;
  distractors: string[];
}

export const EXTRACT_GOLD: ExtractGoldItem[] = [
  { text: 'remember: always use pnpm, not npm', keep: true, topic: 'package-manager', method: 'rule', needle: 'pnpm' },
  { text: 'prefer named exports in src/memory', keep: true, topic: 'module-exports', method: 'rule' },
  { text: '请用 pnpm，不要用 npm', keep: true, topic: 'package-manager', method: 'rule', needle: 'pnpm' },
  { text: '我们约定测试文件放在模块旁边', keep: true, topic: 'test-layout', method: 'rule' },
  { text: 'use named exports, not default exports', keep: true, topic: 'module-exports', method: 'rule' },
  { text: "don't use yarn for this repo", keep: true, topic: 'package-manager', method: 'rule' },
  { text: "let's standardize on pnpm for installs", keep: true, topic: 'package-manager', needle: 'pnpm' },
  { text: 'team decided modules should export by name', keep: true, topic: 'module-exports', method: 'semantic', needle: 'export' },
  { text: '统一用 pnpm 装依赖', keep: true, topic: 'package-manager', needle: 'pnpm' },
  { text: '模块对外按名称导出', keep: true, topic: 'module-exports', method: 'semantic' },
  { text: 'tests belong next to the source module', keep: true, topic: 'test-layout', method: 'semantic' },
  { text: 'the convention is to keep tests beside each module', keep: true, topic: 'test-layout', method: 'semantic' },
  { text: 'ok', keep: false },
  { text: "I'll update the lockfile as follows", keep: false },
  { text: 'thanks', keep: false },
  { text: 'continue', keep: false },
  { text: 'what is pnpm', keep: false },
  { text: 'which package manager should we use', keep: false },
  { text: 'at Object.handler (src/cli.ts:10)', keep: false },
];

export const RETRIEVE_GOLD: RetrieveGoldItem[] = [
  {
    query: 'which package manager should the repo use',
    relevant: 'always use pnpm, not npm',
    distractors: ['prefer named exports', 'random meeting note about lunch'],
  },
  {
    query: 'where should tests live',
    relevant: 'tests belong next to the source module',
    distractors: ['always use pnpm, not npm', 'prefer named exports'],
  },
  {
    query: 'how should modules export',
    relevant: 'team decided modules should export by name',
    distractors: ['always use pnpm, not npm', 'random meeting note about lunch'],
  },
];

export const EXTRACT_MIN_PRECISION = 0.85;
export const EXTRACT_MIN_RECALL = 0.85;
export const RETRIEVE_MIN_HIT_AT_1 = 0.8;

export interface ExtractEvalResult {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  misses: string[];
  extras: string[];
}

export interface RetrieveEvalResult {
  hitAt1: number;
  hitAtK: number;
  misses: string[];
}

export function evaluateExtract(gold: readonly ExtractGoldItem[] = EXTRACT_GOLD): ExtractEvalResult {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const misses: string[] = [];
  const extras: string[] = [];
  for (const item of gold) {
    const facts = extractWorkingMemoryFacts({
      messages: [{ role: 'user', content: item.text }],
    });
    const kept = facts.length > 0;
    const topicOk = !item.topic || facts.some(fact => fact.topic === item.topic);
    const methodOk = !item.method || facts.some(fact => fact.extract_method === item.method);
    const needle = item.needle;
    const needleOk = !needle || facts.some(fact => fact.text.includes(needle));
    const hit = kept && topicOk && methodOk && needleOk;
    if (item.keep && hit) truePositives++;
    else if (item.keep) {
      falseNegatives++;
      misses.push(item.text);
    } else if (kept) {
      falsePositives++;
      extras.push(item.text);
    }
  }
  const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, truePositives, falsePositives, falseNegatives, misses, extras };
}

export function evaluateRetrieve(
  gold: readonly RetrieveGoldItem[] = RETRIEVE_GOLD,
  config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
  now: Date = new Date('2026-09-10T00:00:00.000Z'),
): RetrieveEvalResult {
  const misses: string[] = [];
  let hits1 = 0;
  let hitsK = 0;
  for (const item of gold) {
    const facts: WorkingMemoryFact[] = [item.relevant, ...item.distractors].map((text, index) => normalizeFact({
      id: `eval-${index}`,
      type: index === 0 ? 'user' : 'project',
      text,
      source: index === 0 ? 'remember' : 'extract',
      confidence: index === 0 ? 0.9 : 0.4,
      created_at: now.toISOString(),
    }));
    const ranked = retrieveFacts(facts, item.query, config, now);
    if (ranked[0]?.fact.text === item.relevant) hits1++;
    else misses.push(item.query);
    if (ranked.some(entry => entry.fact.text === item.relevant)) hitsK++;
  }
  return {
    hitAt1: gold.length === 0 ? 1 : hits1 / gold.length,
    hitAtK: gold.length === 0 ? 1 : hitsK / gold.length,
    misses,
  };
}

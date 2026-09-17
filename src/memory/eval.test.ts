import { describe, expect, it } from 'vitest';

import {
  EXTRACT_GOLD,
  EXTRACT_MIN_PRECISION,
  EXTRACT_MIN_RECALL,
  RETRIEVE_MIN_HIT_AT_1,
  evaluateExtract,
  evaluateRetrieve,
} from './eval.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';

describe('working-memory extract evaluation', () => {
  it('meets precision and recall gates on the gold set, including paraphrases', () => {
    const result = evaluateExtract(EXTRACT_GOLD);
    expect(result.misses, `misses: ${result.misses.join(' | ')}`).toEqual([]);
    expect(result.extras, `extras: ${result.extras.join(' | ')}`).toEqual([]);
    expect(result.precision).toBeGreaterThanOrEqual(EXTRACT_MIN_PRECISION);
    expect(result.recall).toBeGreaterThanOrEqual(EXTRACT_MIN_RECALL);
  });
});

describe('working-memory retrieve evaluation', () => {
  it('hits the relevant fact at rank 1 for paraphrastic prompts', () => {
    const result = evaluateRetrieve(undefined, DEFAULT_MEMORY_CONFIG);
    expect(result.misses, `misses: ${result.misses.join(' | ')}`).toEqual([]);
    expect(result.hitAt1).toBeGreaterThanOrEqual(RETRIEVE_MIN_HIT_AT_1);
    expect(result.hitAtK).toBe(1);
  });
});

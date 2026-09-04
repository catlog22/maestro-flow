import { describe, expect, it } from 'vitest';

import {
  SEARCH_CANDIDATE_HARD_CAP,
  adaptiveSearchCandidateLimit,
  compareSearchCandidateResults,
  computeSearchCandidateBudget,
  countUniqueSearchCandidates,
  escalateSearchCandidateBudget,
  legacySearchCandidateLimit,
  shouldEscalateSearchCandidateBudget,
} from './candidate-budget.js';

describe('SearchCandidateBudget', () => {
  it('computes one bounded adaptive pass and preserves the legacy comparison', () => {
    const budget = computeSearchCandidateBudget(20, { mode: 'adaptive', surface: 'mixed' });
    expect(budget).toMatchObject({
      resultLimit: 20,
      candidateLimit: 40,
      initialCandidateLimit: 40,
      maxCandidateLimit: SEARCH_CANDIDATE_HARD_CAP,
      legacyCandidateLimit: 60,
      mode: 'adaptive',
      escalated: false,
    });
    expect(legacySearchCandidateLimit(20, 'mixed')).toBe(60);
    expect(adaptiveSearchCandidateLimit(250)).toBe(500);
  });

  it('escalates exactly once only for a saturated underfilled eligible pool', () => {
    const budget = computeSearchCandidateBudget(20, { mode: 'adaptive' });
    expect(shouldEscalateSearchCandidateBudget(budget, {
      candidateCount: budget.candidateLimit,
      eligibleUniqueCount: 19,
    })).toBe(true);
    const escalated = escalateSearchCandidateBudget(budget, {
      candidateCount: budget.candidateLimit,
      eligibleUniqueCount: 19,
    });
    expect(escalated.candidateLimit).toBe(80);
    expect(escalated.escalated).toBe(true);
    expect(shouldEscalateSearchCandidateBudget(escalated, {
      candidateCount: escalated.candidateLimit,
      eligibleUniqueCount: 19,
    })).toBe(false);
    expect(shouldEscalateSearchCandidateBudget(budget, {
      candidateCount: budget.candidateLimit - 1,
      eligibleUniqueCount: 1,
    })).toBe(false);
    expect(shouldEscalateSearchCandidateBudget(budget, {
      candidateCount: budget.candidateLimit,
      eligibleUniqueCount: 20,
    })).toBe(false);
  });

  it('caps escalation at 500 and supports deterministic Top20 shadow comparison', () => {
    const budget = computeSearchCandidateBudget(200, { mode: 'adaptive' });
    const next = escalateSearchCandidateBudget(budget, {
      candidateCount: budget.candidateLimit,
      eligibleUniqueCount: 1,
    });
    expect(next.candidateLimit).toBe(500);
    expect(countUniqueSearchCandidates([{ id: 'a' }, { id: 'a' }, { id: 'b' }], item => item.id)).toBe(2);
    expect(compareSearchCandidateResults(
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      budget,
    )).toMatchObject({ topIdsEqual: true, overlapCount: 3, topLimit: 200 });
  });
});

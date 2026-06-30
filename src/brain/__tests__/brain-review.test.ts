import { describe, it, expect } from 'vitest';
import { selectTier, selectReviewIsolation, aggregateVerdict, type ReviewDecisionInput } from '../brain-review.js';

const base = (over: Partial<ReviewDecisionInput> = {}): ReviewDecisionInput => ({
  difficulty: 'normal', selfReportedSuccess: true, codeChanged: true, critical: false, ...over,
});

describe('selectTier — invariant#7 L2 floor (brain-specific, ralph has no analog)', () => {
  it('no code change -> L1', () => expect(selectTier(base({ codeChanged: false, selfReportedSuccess: false }))).toBe('L1'));
  it('code changed + self-reported success -> L2 floor (never trust the green)', () => expect(selectTier(base())).toBe('L2'));
  it('hard difficulty -> L2', () => expect(selectTier(base({ selfReportedSuccess: false, difficulty: 'hard' }))).toBe('L2'));
  it('critical -> L3', () => expect(selectTier(base({ critical: true }))).toBe('L3'));
  it('forced L1 on self-reported code is clamped up to L2', () => expect(selectTier(base({ forcedTier: 'L1' }))).toBe('L2'));
});

describe('selectReviewIsolation — invariant#4 evaluator != implementer', () => {
  it('multi-CLI -> different CLI', () => {
    expect(selectReviewIsolation('claude', ['claude', 'codex'])).toEqual({ reviewCli: 'codex', isolation: 'different-cli' });
  });
  it('Claude-only -> distinct fresh-context instance (valid isolation)', () => {
    expect(selectReviewIsolation('claude', ['claude']).isolation).toBe('distinct-instance');
  });
});

describe('aggregateVerdict — fail-closed anti-false-green', () => {
  it('any false-green fails the round', () => expect(aggregateVerdict([{ id: 'v', verdict: 'pass', confidence: 99 }, { id: 'c', verdict: 'false-green', confidence: 100 }]).verdict).toBe('false-green'));
  it('a gap fails', () => expect(aggregateVerdict([{ id: 'r', verdict: 'gap', confidence: 90 }]).verdict).toBe('gap'));
  it('low confidence fails closed', () => expect(aggregateVerdict([{ id: 'v', verdict: 'pass', confidence: 40 }]).verdict).toBe('gap'));
  it('all pass with confidence -> pass', () => expect(aggregateVerdict([{ id: 'v', verdict: 'pass', confidence: 95 }]).verdict).toBe('pass'));
});

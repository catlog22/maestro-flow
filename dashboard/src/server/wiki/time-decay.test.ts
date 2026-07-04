import { describe, expect, it } from 'vitest';

import { computeTimeDecayFactor, applyTimeDecay } from './time-decay.js';
import type { WikiEntry } from './wiki-types.js';

const NOW = Date.parse('2026-07-04T00:00:00Z');
const DAY = 86_400_000;

function entry(overrides: Partial<WikiEntry>): WikiEntry {
  return {
    id: 'spec-x',
    type: 'spec',
    title: 'X',
    summary: '',
    tags: [],
    status: 'active',
    created: '2026-01-01T00:00:00Z',
    updated: '2026-07-04T00:00:00Z',
    related: [],
    source: { kind: 'file', path: 'specs/x.md' },
    body: '',
    ext: {},
    scope: null,
    category: null,
    specCategory: null,
    createdBy: null,
    sourceRef: null,
    parent: null,
    ...overrides,
  };
}

describe('computeTimeDecayFactor', () => {
  it('returns 1.0 for a zero-age entry', () => {
    const e = entry({ ext: { timestamp: '2026-07-04' } });
    expect(computeTimeDecayFactor(e, NOW)).toBeCloseTo(1.0, 5);
  });

  it('returns 1.0 when no date is parseable', () => {
    const e = entry({ ext: {}, updated: 'not-a-date' });
    expect(computeTimeDecayFactor(e, NOW)).toBe(1.0);
  });

  it('decays a spec to 0.65 at one half-life (60 days)', () => {
    // floor 0.3 + 0.7 * e^(-ln2) = 0.3 + 0.7 * 0.5 = 0.65
    const e = entry({ type: 'spec', ext: { timestamp: undefined }, updated: new Date(NOW - 60 * DAY).toISOString() });
    expect(computeTimeDecayFactor(e, NOW)).toBeCloseTo(0.65, 3);
  });

  it('decays knowhow faster than spec at the same age (shorter half-life)', () => {
    const age = new Date(NOW - 30 * DAY).toISOString();
    const spec = entry({ type: 'spec', updated: age });
    const knowhow = entry({ type: 'knowhow', updated: age });
    expect(computeTimeDecayFactor(knowhow, NOW)).toBeLessThan(computeTimeDecayFactor(spec, NOW));
  });

  it('never decays below the floor (0.3)', () => {
    const e = entry({ type: 'issue', updated: new Date(NOW - 3650 * DAY).toISOString() });
    expect(computeTimeDecayFactor(e, NOW)).toBeGreaterThanOrEqual(0.3);
  });

  it('prefers ext.timestamp over updated', () => {
    // fresh mtime, but old date attribute → should decay by the old date
    const e = entry({ type: 'spec', ext: { timestamp: '2026-05-05' }, updated: '2026-07-04T00:00:00Z' });
    const ageDays = (NOW - Date.parse('2026-05-05')) / DAY;
    expect(ageDays).toBeGreaterThan(0);
    expect(computeTimeDecayFactor(e, NOW)).toBeLessThan(1.0);
  });
});

describe('applyTimeDecay', () => {
  it('re-sorts so a fresher lower-BM25 entry can overtake a stale higher-BM25 entry', () => {
    const stale = entry({ id: 'stale', type: 'issue', updated: new Date(NOW - 200 * DAY).toISOString() });
    const fresh = entry({ id: 'fresh', type: 'issue', updated: new Date(NOW).toISOString() });
    const results = [
      { entry: stale, score: 10 },
      { entry: fresh, score: 8 },
    ];
    const out = applyTimeDecay(results, NOW);
    expect(out[0].entry.id).toBe('fresh');
  });

  it('preserves order when all entries are equally fresh', () => {
    const a = entry({ id: 'a', updated: new Date(NOW).toISOString() });
    const b = entry({ id: 'b', updated: new Date(NOW).toISOString() });
    const out = applyTimeDecay([{ entry: a, score: 10 }, { entry: b, score: 8 }], NOW);
    expect(out.map(r => r.entry.id)).toEqual(['a', 'b']);
  });
});

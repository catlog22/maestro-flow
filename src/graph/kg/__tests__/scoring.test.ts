import { describe, it, expect } from 'vitest';
import {
  removeStopWords,
  getStemVariants,
  extractSearchTerms,
  expandCodeQuery,
  kindBonus,
  scorePathRelevance,
  nameMatchBonus,
  computeScore,
} from '../query/scoring.js';

describe('removeStopWords', () => {
  it('filters English and code noise stop words (case-insensitive)', () => {
    expect(removeStopWords(['the', 'Tenant', 'function', 'Service'])).toEqual(['Tenant', 'Service']);
  });

  it('keeps all tokens when none are stop words', () => {
    expect(removeStopWords(['alpha', 'beta'])).toEqual(['alpha', 'beta']);
  });

  it('returns empty for empty input', () => {
    expect(removeStopWords([])).toEqual([]);
  });
});

describe('getStemVariants', () => {
  it('includes the lowercased original term', () => {
    expect(getStemVariants('Running')).toContain('running');
  });

  it('generates ies → y variant', () => {
    expect(getStemVariants('categories')).toContain('category');
  });

  it('generates ing-stripped variant', () => {
    expect(getStemVariants('mapping')).toContain('mapp');
  });

  it('generates s-stripped plural variant', () => {
    expect(getStemVariants('users')).toContain('user');
  });
});

describe('extractSearchTerms', () => {
  it('splits camelCase into tokens and keeps the compound', () => {
    const terms = extractSearchTerms('getUserById');
    expect(terms).toContain('get');
    expect(terms).toContain('user');
    expect(terms).toContain('getuserbyid');
  });

  it('splits snake_case / kebab-case / paths', () => {
    const terms = extractSearchTerms('user_profile-edit/view');
    expect(terms).toContain('user');
    expect(terms).toContain('profile');
    expect(terms).toContain('edit');
    expect(terms).toContain('view');
  });

  it('dedupes terms', () => {
    const terms = extractSearchTerms('User user USER');
    expect(terms.filter((t) => t === 'user')).toHaveLength(1);
  });
});

describe('expandCodeQuery', () => {
  it('expands abbreviations to full synonyms', () => {
    const expanded = expandCodeQuery('auth');
    expect(expanded).toContain('authentication');
    expect(expanded).toContain('authorization');
  });

  it('expands db ↔ database', () => {
    expect(expandCodeQuery('db')).toContain('database');
  });

  it('includes stem variants of length >= 3', () => {
    const expanded = expandCodeQuery('users');
    expect(expanded.split(/\s+/)).toContain('user');
  });
});

describe('kindBonus', () => {
  it('ranks function/method highest among code kinds', () => {
    expect(kindBonus('function')).toBe(10);
    expect(kindBonus('method')).toBe(10);
  });

  it('gives domain_term the top knowledge bonus', () => {
    expect(kindBonus('domain_term')).toBe(12);
  });

  it('returns 0 for unknown kinds', () => {
    expect(kindBonus('something_else' as never)).toBe(0);
  });
});

describe('scorePathRelevance', () => {
  it('rewards filename match (+10) and path match (+3)', () => {
    const score = scorePathRelevance('src/auth/login.ts', 'login');
    expect(score).toBeGreaterThanOrEqual(13); // filename(10) + path(3)
  });

  it('penalizes test paths (-15)', () => {
    const testScore = scorePathRelevance('src/login.test.ts', 'login');
    const prodScore = scorePathRelevance('src/login.ts', 'login');
    expect(testScore).toBeLessThan(prodScore);
    expect(prodScore - testScore).toBe(15);
  });

  it('returns 0 for unrelated path/query', () => {
    expect(scorePathRelevance('src/foo/bar.ts', 'zzz')).toBe(0);
  });
});

describe('nameMatchBonus', () => {
  it('exact name match → +80', () => {
    expect(nameMatchBonus('TenantService', 'tenantservice')).toBe(80);
  });

  it('token exact match → +60', () => {
    expect(nameMatchBonus('getUserById', 'user')).toBe(60);
  });

  it('full token containment → +15', () => {
    // query token 'cde' is a substring of the single name token 'abcdefgh'.
    expect(nameMatchBonus('abcdefgh', 'cde')).toBe(15);
  });

  it('no match → 0', () => {
    expect(nameMatchBonus('alpha', 'zzz')).toBe(0);
  });
});

describe('computeScore', () => {
  const baseNode = {
    id: 'n1',
    kind: 'function' as const,
    name: 'login',
    filePath: 'src/auth/login.ts',
  };

  it('combines kindBonus + pathRelevance + nameMatchBonus', () => {
    const score = computeScore(baseNode, 'login');
    // kindBonus(10) + path(filename 10 + dir 'auth'? no + path 3) + nameMatch exact-ish
    expect(score).toBeGreaterThan(10);
  });

  it('caps BM25 contribution at 30', () => {
    const withBm25 = computeScore({ ...baseNode, _bm25Score: 100 }, 'zzz');
    const noBm25 = computeScore({ ...baseNode }, 'zzz');
    expect(withBm25 - noBm25).toBe(30); // min(100*2, 30) = 30
  });

  it('applies credibilityFactor as a multiplier', () => {
    const full = computeScore(baseNode, 'login');
    const half = computeScore(baseNode, 'login', 0.5);
    expect(half).toBeCloseTo(full * 0.5, 5);
  });
});

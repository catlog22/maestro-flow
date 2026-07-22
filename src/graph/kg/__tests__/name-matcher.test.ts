import { describe, it, expect } from 'vitest';
import { matchReference, tokenize } from '../resolution/name-matcher.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface Cand {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
}

function cand(id: string, name: string, qualifiedName: string, filePath: string): Cand {
  return { id, name, qualifiedName, filePath };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits camelCase / PascalCase', () => {
    expect(tokenize('getUserById')).toEqual(['get', 'user', 'by', 'id']);
  });

  it('splits snake_case and SCREAMING_SNAKE', () => {
    expect(tokenize('max_retry_count')).toEqual(['max', 'retry', 'count']);
    expect(tokenize('HTTP_SERVER')).toEqual(['http', 'server']);
  });

  it('splits on dots and whitespace', () => {
    expect(tokenize('foo.bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('handles acronym boundaries (HTMLParser → html/parser)', () => {
    expect(tokenize('HTMLParser')).toEqual(['html', 'parser']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchReference — 6 级策略链
// ---------------------------------------------------------------------------

describe('matchReference', () => {
  it('returns null for empty candidates', () => {
    expect(matchReference('foo', [])).toBeNull();
  });

  it('strategy 1: single exact-name match → confidence 1.0', () => {
    const c = [
      cand('1', 'helper', 'util.helper', 'src/util.ts'),
      cand('2', 'other', 'util.other', 'src/util.ts'),
    ];
    const r = matchReference('helper', c);
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('exact-name');
    expect(r!.confidence).toBe(1.0);
    expect(r!.qualifiedName).toBe('util.helper');
  });

  it('strategy 1: multiple exact matches disambiguated by path proximity', () => {
    const c = [
      cand('1', 'helper', 'a.helper', 'src/a/helper.ts'),
      cand('2', 'helper', 'b.helper', 'src/b/helper.ts'),
    ];
    const r = matchReference('helper', c, { fromFilePath: 'src/a/consumer.ts' });
    expect(r).not.toBeNull();
    // Same-directory candidate wins via proximity disambiguation.
    expect(r!.qualifiedName).toBe('a.helper');
    expect(r!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('strategy 2: qualified-suffix match when no exact name match', () => {
    const c = [
      // Candidate name differs from ref, but qualifiedName ends with `.run`.
      cand('1', 'start', 'svc.TaskRunner.run', 'src/runner.ts'),
      cand('2', 'walk', 'svc.Walker.walk', 'src/walker.ts'),
    ];
    const r = matchReference('run', c);
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('qualified-suffix');
    expect(r!.qualifiedName).toBe('svc.TaskRunner.run');
    expect(r!.confidence).toBe(0.9);
  });

  it('strategy 3: file-path match for import-style references', () => {
    const c = [
      cand('1', 'helper', 'utils.helper', 'src/utils/helper.ts'),
      cand('2', 'index', 'main.index', 'src/main/index.ts'),
    ];
    // Reference looks like an import path; no exact/suffix name match.
    const r = matchReference('utils/helper', c);
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('file-path');
    expect(r!.qualifiedName).toBe('utils.helper');
    expect(r!.confidence).toBe(0.85);
  });

  it('strategy 4: method-call resolution via receiverType', () => {
    const c = [
      cand('1', 'run', 'app.Service.run', 'src/service.ts'),
      cand('2', 'run', 'app.Other.run', 'src/other.ts'),
    ];
    const r = matchReference('service.run', c, { receiverType: 'Service' });
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('method-call');
    expect(r!.qualifiedName).toBe('app.Service.run');
    expect(r!.confidence).toBe(0.8);
  });

  it('strategy 5: fuzzy-tokens match (token subset, overlap >= 0.5)', () => {
    const c = [
      cand('1', 'user_service_impl', 'app.user_service_impl', 'src/app.ts'),
      cand('2', 'logger', 'app.logger', 'src/logger.ts'),
    ];
    // matchReference lowercases before tokenize, so use underscore tokens:
    // 'user_service' {user,service} vs 'user_service_impl' {user,service,impl} = 2/3.
    const r = matchReference('user_service', c);
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('fuzzy-tokens');
    expect(r!.qualifiedName).toBe('app.user_service_impl');
    // Fuzzy confidence = overlap(0.667) * 0.7 ≈ 0.467
    expect(r!.confidence).toBeGreaterThan(0.4);
    expect(r!.confidence).toBeLessThan(0.7);
  });

  it('strategy 6: path-proximity fallback when nothing else matches', () => {
    const c = [
      cand('1', 'helper', 'utils.helper', 'src/utils/helper.ts'),
      cand('2', 'logger', 'lib.logger', 'src/lib/logger.ts'),
    ];
    // 'xyz' matches no name/suffix/path/method/fuzzy; proximity to src/utils wins.
    const r = matchReference('xyz', c, { fromFilePath: 'src/utils/consumer.ts' });
    expect(r).not.toBeNull();
    expect(r!.strategy).toBe('path-proximity');
    expect(r!.qualifiedName).toBe('utils.helper');
    expect(r!.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('returns null when no strategy matches and no proximity context', () => {
    const c = [cand('1', 'helper', 'utils.helper', 'src/utils/helper.ts')];
    // 'zzz' shares no tokens, no proximity context provided.
    expect(matchReference('zzz', c)).toBeNull();
  });
});

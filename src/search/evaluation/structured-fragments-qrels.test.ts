import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type StructuredQrels = {
  schema_version: string;
  queries: Array<{ id: string; query: string; category: string; relevance: Record<string, number> }>;
};

const qrelsPath = fileURLToPath(new URL('./fixtures/structured-fragments-qrels.json', import.meta.url));

describe('structured fragment qrels', () => {
  it('covers paraphrase, cross-heading, deep-section, CJK, and exact-symbol lanes', () => {
    const qrels = JSON.parse(readFileSync(qrelsPath, 'utf8')) as StructuredQrels;
    expect(qrels.schema_version).toBe('search-ranking-qrels/1.0');
    expect(new Set(qrels.queries.map(query => query.category))).toEqual(new Set([
      'paraphrase', 'cross-heading', 'deep-section', 'cjk', 'exact-symbol',
    ]));
    expect(qrels.queries).toHaveLength(5);
    expect(qrels.queries.every(query => query.id && query.query && Object.keys(query.relevance).length > 0)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { BoundedTtlCache } from './bounded-ttl-cache.js';

describe('BoundedTtlCache', () => {
  it('evicts expired entries before live entries', () => {
    let now = 0;
    const cache = new BoundedTtlCache<string, string>(2, 10, () => now);
    cache.set('expired', 'old');
    now = 11;
    cache.set('current', 'new');

    expect(cache.get('expired')).toBeUndefined();
    expect(cache.get('current')).toBe('new');
    expect(cache.size).toBe(1);
  });

  it('keeps the most recently accessed live entries within the bound', () => {
    let now = 0;
    const cache = new BoundedTtlCache<string, object>(2, 100, () => now);
    const first = { id: 1 };
    const second = { id: 2 };
    const third = { id: 3 };
    cache.set('first', first);
    cache.set('second', second);
    expect(cache.get('first')).toBe(first);
    now = 1;
    cache.set('third', third);

    expect(cache.size).toBe(2);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(first);
    expect(cache.get('third')).toBe(third);
  });

  it('does not extend TTL when a live value is read', () => {
    let now = 0;
    const cache = new BoundedTtlCache<string, string>(2, 10, () => now);
    cache.set('value', 'cached');
    now = 9;
    expect(cache.get('value')).toBe('cached');
    now = 10;
    expect(cache.get('value')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { EXTRACT_GOLD } from './eval.js';
import { extractWorkingMemoryFacts } from './extract.js';

describe('working-memory extract gold set', () => {
  it('keeps durable preferences and drops chatter or questions', () => {
    for (const item of EXTRACT_GOLD) {
      const facts = extractWorkingMemoryFacts({
        messages: [{ role: 'user', content: item.text }],
      });
      if (item.keep) {
        expect(facts, item.text).not.toHaveLength(0);
        if (item.topic) expect(facts[0].topic, item.text).toBe(item.topic);
        if (item.method) expect(facts[0].extract_method, item.text).toBe(item.method);
        if (item.needle) expect(facts.some(fact => fact.text.includes(item.needle)), item.text).toBe(true);
      } else {
        expect(facts, item.text).toHaveLength(0);
      }
    }
  });
});

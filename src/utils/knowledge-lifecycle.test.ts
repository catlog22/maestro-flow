import { describe, expect, it } from 'vitest';

import { getKnowledgeStatus, isDeprecatedKnowledgeEntry } from './knowledge-lifecycle.js';

describe('knowledge lifecycle policy', () => {
  it('recognizes deprecated and superseded top-level statuses', () => {
    expect(isDeprecatedKnowledgeEntry({ status: 'deprecated' })).toBe(true);
    expect(isDeprecatedKnowledgeEntry({ status: 'superseded' })).toBe(true);
    expect(getKnowledgeStatus({ status: 'SUPERSEDED' })).toBe('deprecated');
  });

  it('falls back to ext.status for full Wiki entries', () => {
    expect(isDeprecatedKnowledgeEntry({ ext: { status: 'deprecated' } })).toBe(true);
  });

  it('prefers the normalized top-level status', () => {
    expect(getKnowledgeStatus({ status: 'active', ext: { status: 'deprecated' } })).toBe('active');
    expect(isDeprecatedKnowledgeEntry({ status: 'active', ext: { status: 'deprecated' } })).toBe(false);
  });

  it('keeps active and missing statuses visible', () => {
    expect(isDeprecatedKnowledgeEntry({ status: 'active' })).toBe(false);
    expect(isDeprecatedKnowledgeEntry({})).toBe(false);
  });
});

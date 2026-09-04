import { afterEach, describe, expect, it } from 'vitest';
import { mapVectorResultsToParents, splitDocToChunks } from './embedding.js';
import {
  buildSearchFragments,
  buildStructuredFragments,
  isStructuredChunksEnabled,
  maestroGraphCodeDocument,
  STRUCTURED_FRAGMENT_POLICY,
  STRUCTURED_FRAGMENT_POLICY_CHECKSUM,
  structuredFragmentPolicyChecksum,
} from './structured-fragments.js';

const originalFlag = process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS;
  else process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS = originalFlag;
});

describe('Maestro-native structured search fragments', () => {
  it('is opt-in and does not treat arbitrary truthy values as enabled', () => {
    expect(isStructuredChunksEnabled('1')).toBe(true);
    expect(isStructuredChunksEnabled('true')).toBe(false);
    expect(isStructuredChunksEnabled(undefined)).toBe(false);
  });

  it('keeps the complete markdown heading hierarchy, including deep sections', () => {
    const body = [
      '# Root', 'root text',
      '## Authentication', 'auth text',
      '### Token rotation', 'rotation text',
      '#### Deep implementation', 'deep text',
      '##### Details', 'detail text',
      '###### Edge case', 'edge text',
      '## Recovery', 'recovery text',
      '## Audit', 'audit text',
    ].join('\n');
    const fragments = buildSearchFragments({ id: 'knowhow-hierarchy', title: 'Hierarchy', body });
    expect(fragments.length).toBe(8);
    expect(fragments.find(fragment => fragment.text.includes('Deep implementation'))?.breadcrumb)
      .toEqual(['Root', 'Authentication', 'Token rotation', 'Deep implementation']);
    expect(fragments.find(fragment => fragment.text.includes('Edge case'))?.range).toMatchObject({
      startLine: 11,
      endLine: 12,
    });
    expect(new Set(fragments.map(fragment => fragment.parentId))).toEqual(new Set(['knowhow-hierarchy']));
    expect(fragments.every(fragment => fragment.fragmentId.startsWith('knowhow-hierarchy#'))).toBe(true);
  });

  it('splits long sections with overlap and deterministic ids/hashes', () => {
    const policy = { ...STRUCTURED_FRAGMENT_POLICY, maxChars: 80, overlapChars: 20 };
    const body = '# Long section\n' + Array.from({ length: 30 }, (_, i) => `line ${i} semantic retrieval context`).join('\n');
    const input = { id: 'wiki-long', title: 'Long', summary: 'Long section', body };
    const first = buildSearchFragments(input, policy);
    const second = buildSearchFragments(input, policy);
    expect(first.length).toBeGreaterThan(2);
    expect(first.map(fragment => fragment.fragmentId)).toEqual(second.map(fragment => fragment.fragmentId));
    expect(first.map(fragment => fragment.contentHash)).toEqual(second.map(fragment => fragment.contentHash));
    expect(first.slice(1).some((fragment, index) => fragment.text.includes(first[index].text.slice(-15)))).toBe(true);
    expect(first.every(fragment => fragment.policyChecksum === structuredFragmentPolicyChecksum(policy))).toBe(true);
    expect(new Set(first.map(fragment => fragment.fragmentId)).size).toBe(first.length);
    const shifted = buildSearchFragments({ ...input, body: '# Intro\nintro\n' + body }, policy);
    expect(shifted.find(fragment => fragment.breadcrumb.includes('Long section'))?.fragmentId)
      .toBe(first[0].fragmentId);
  });

  it('retains useful line ranges and CJK content for plain text', () => {
    const body = '第一行：配置缓存\n第二行：恢复令牌\n第三行：验证签名\n';
    const fragments = buildSearchFragments({ id: 'note-cjk', title: '中文说明', body, kind: 'text' }, {
      ...STRUCTURED_FRAGMENT_POLICY,
      maxChars: 12,
      textLineBudget: 1,
    });
    expect(fragments.length).toBeGreaterThanOrEqual(3);
    expect(fragments[0].text).toContain('配置缓存');
    expect(fragments.map(fragment => [fragment.range.startLine, fragment.range.endLine])).toEqual(
      expect.arrayContaining([[1, 1], [2, 2], [3, 3]]),
    );
  });

  it('uses existing MaestroGraph symbol/signature/path fields for code context', () => {
    const [fragment] = buildSearchFragments(maestroGraphCodeDocument({
      id: 'code:function:validate',
      filePath: 'src/auth/token.ts',
      kind: 'function',
      language: 'typescript',
      name: 'validateToken',
      qualifiedName: 'Auth.validateToken',
      signature: '(token: string): boolean',
      definition: 'return token.length > 0;',
      startLine: 40,
      endLine: 42,
    }));
    expect(fragment.kind).toBe('code');
    expect(fragment.parentId).toBe('code:function:validate');
    expect(fragment.text).toContain('path: src/auth/token.ts');
    expect(fragment.text).toContain('symbol: Auth.validateToken');
    expect(fragment.text).toContain('signature: (token: string): boolean');
    expect(fragment.range).toMatchObject({ startLine: 40, endLine: 42 });
  });

  it('evolves embedding chunks only when the structured flag is enabled', () => {
    const document = { id: 'wiki-compat', title: 'Compat', summary: '', tags: [], body: '# Heading\ncontent' };
    delete process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS;
    const legacy = splitDocToChunks(document);
    expect(legacy[0]).toEqual({ chunkId: 'wiki-compat#0', text: expect.any(String) });
    process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS = '1';
    const structured = splitDocToChunks(document);
    expect(structured[0].chunkId).toMatch(/^wiki-compat#markdown-/);
    expect(structured[0].fragment).toMatchObject({
      fragmentId: structured[0].chunkId,
      parentId: 'wiki-compat',
      kind: 'markdown',
      breadcrumb: ['Heading'],
      range: { startLine: 1 },
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      policyChecksum: STRUCTURED_FRAGMENT_POLICY_CHECKSUM,
    });
  });

  it('deduplicates vector evidence to parents while keeping the best fragment score', () => {
    const fragments = buildSearchFragments({ id: 'wiki-parent', title: 'Parent', body: '# A\nfirst\n# B\nsecond' });
    const index = {
      docIds: fragments.map(fragment => fragment.fragmentId),
      chunkDocIds: fragments.map(() => 'wiki-parent'),
      fragments,
    };
    const mapped = mapVectorResultsToParents([
      { docId: fragments[0].fragmentId, score: 0.4 },
      { docId: fragments[1].fragmentId, score: 0.9 },
    ], index);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ docId: 'wiki-parent', score: 0.9, fragment: fragments[1] });
  });

  it('builds in input order without changing public parent identities', () => {
    const fragments = buildStructuredFragments([
      { id: 'spec:one', title: 'One', body: '# A\ntext' },
      { id: 'spec:two', title: 'Two', body: '# B\ntext' },
    ]);
    expect(fragments.map(fragment => fragment.parentId)).toEqual(['spec:one', 'spec:two']);
    expect(fragments.every(fragment => fragment.policyChecksum === STRUCTURED_FRAGMENT_POLICY_CHECKSUM)).toBe(true);
  });
});

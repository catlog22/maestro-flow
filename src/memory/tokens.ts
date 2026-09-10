const STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'use', 'this',
  'that', 'with', 'from', 'please', 'always', 'never', 'prefer', 'named',
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'or',
  '这个', '那个', '可以', '我们', '请用', '不要', '不要用', '记住',
]);

export function tokenizeMemory(text: string): string[] {
  const lower = text.toLowerCase();
  const english = lower
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2 && !STOP.has(token));
  const han = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjk: string[] = [];
  for (const seq of han) {
    if (seq.length <= 6 && !STOP.has(seq)) cjk.push(seq);
    for (let n = 2; n <= Math.min(4, seq.length); n++) {
      for (let i = 0; i <= seq.length - n; i++) {
        const gram = seq.slice(i, i + n);
        if (!STOP.has(gram)) cjk.push(gram);
      }
    }
  }
  return [...new Set([...english, ...cjk])];
}

export function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let overlap = 0;
  const seen = new Set<string>();
  for (const item of left) {
    if (seen.has(item)) continue;
    seen.add(item);
    if (rightSet.has(item)) overlap++;
  }
  return overlap / new Set([...left, ...right]).size;
}

export function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeMemory(left);
  const rightTokens = tokenizeMemory(right);
  const tokenScore = jaccard(leftTokens, rightTokens);
  const compactLeft = left.toLowerCase().replace(/\s+/g, '');
  const compactRight = right.toLowerCase().replace(/\s+/g, '');
  const contained = compactLeft.includes(compactRight) || compactRight.includes(compactLeft)
    ? Math.min(compactLeft.length, compactRight.length) / Math.max(compactLeft.length, compactRight.length, 1)
    : 0;
  return Math.min(1, 0.7 * tokenScore + 0.3 * contained);
}

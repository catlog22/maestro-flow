import { basename, dirname } from 'node:path';
import type { NodeKind } from '../types.js';

export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'are', 'was',
  'be', 'has', 'had', 'have', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'all', 'each',
  'every', 'how', 'what', 'where', 'when', 'who', 'which', 'why',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'show', 'give', 'tell',
  'been', 'done', 'made', 'used', 'using', 'work', 'works', 'found',
  'also', 'into', 'then', 'than', 'just', 'more', 'some', 'such',
  'over', 'only', 'out', 'its', 'so', 'up', 'as', 'if',
  'look', 'need', 'needs', 'want', 'happen', 'happens',
  'affect', 'affected', 'break', 'breaks', 'failing',
  'implemented', 'implement',
  'code', 'file', 'files', 'function', 'method', 'class', 'type',
  'fix', 'bug', 'called',
]);

export function getStemVariants(term: string): string[] {
  const variants = new Set<string>();
  const t = term.toLowerCase();

  if (t.endsWith('ing') && t.length > 5) {
    const base = t.slice(0, -3);
    variants.add(base);
    variants.add(base + 'e');
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      variants.add(base.slice(0, -1));
    }
  }
  if ((t.endsWith('tion') || t.endsWith('sion')) && t.length > 5) {
    variants.add(t.slice(0, -3));
  }
  if (t.endsWith('ment') && t.length > 6) {
    variants.add(t.slice(0, -4));
  }
  if (t.endsWith('ies') && t.length > 4) {
    variants.add(t.slice(0, -3) + 'y');
  } else if (t.endsWith('es') && t.length > 4) {
    variants.add(t.slice(0, -2));
  } else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 4) {
    variants.add(t.slice(0, -1));
  }
  if (t.endsWith('ed') && !t.endsWith('eed') && t.length > 4) {
    variants.add(t.slice(0, -1));
    variants.add(t.slice(0, -2));
    if (t.endsWith('ied') && t.length > 5) {
      variants.add(t.slice(0, -3) + 'y');
    }
  }
  if (t.endsWith('er') && t.length > 4) {
    const base = t.slice(0, -2);
    variants.add(base);
    variants.add(base + 'e');
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
      variants.add(base.slice(0, -1));
    }
  }

  return [...variants].filter(v => v.length >= 3 && v !== t);
}

export function extractSearchTerms(query: string, options?: { stems?: boolean }): string[] {
  const includeStems = options?.stems !== false;
  const tokens = new Set<string>();

  const compoundPattern = /\b([a-zA-Z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+|[A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g;
  let match;
  while ((match = compoundPattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 3) tokens.add(match[1].toLowerCase());
  }

  const snakePattern = /\b([a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+)\b/g;
  while ((match = snakePattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 3) tokens.add(match[1].toLowerCase());
  }

  const camelSplit = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const normalised = camelSplit.replace(/[_.]+/g, ' ');
  const words = normalised.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (STOP_WORDS.has(lower)) continue;
    tokens.add(lower);
  }

  if (includeStems) {
    const stems = new Set<string>();
    for (const token of tokens) {
      for (const variant of getStemVariants(token)) {
        if (!tokens.has(variant) && !STOP_WORDS.has(variant)) stems.add(variant);
      }
    }
    for (const stem of stems) tokens.add(stem);
  }

  return [...tokens];
}

export function scorePathRelevance(filePath: string, query: string): number {
  const terms = extractSearchTerms(query, { stems: false });
  if (terms.length === 0) return 0;

  const pathLower = filePath.toLowerCase();
  const fileName = basename(filePath).toLowerCase();
  const dirName = dirname(filePath).toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (fileName.includes(term)) score += 10;
    if (dirName.includes(term)) score += 5;
    else if (pathLower.includes(term)) score += 3;
  }

  const queryLower = query.toLowerCase();
  const isTestQuery = queryLower.includes('test') || queryLower.includes('spec');
  if (!isTestQuery && isTestFile(filePath)) score -= 15;

  return score;
}

export function nameMatchBonus(nodeName: string, query: string): number {
  const nameLower = nodeName.toLowerCase();
  const rawTerms = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2);
  const queryTokens = query.split(/\s+/).map(t => t.toLowerCase()).filter(t => t.length >= 2);
  const queryLower = query.replace(/\s+/g, '').toLowerCase();

  if (nameLower === queryLower) return 80;
  if (queryTokens.length > 1 && queryTokens.includes(nameLower)) return 60;
  if (nameLower.startsWith(queryLower)) {
    const ratio = queryLower.length / nameLower.length;
    return Math.round(10 + 30 * ratio);
  }
  if (rawTerms.length > 1 && rawTerms.every(t => nameLower.includes(t))) return 15;
  if (nameLower.includes(queryLower)) return 10;
  return 0;
}

export function kindBonus(kind: NodeKind): number {
  const bonuses: Record<string, number> = {
    function: 10, method: 10, class: 8, interface: 9, type_alias: 6,
    struct: 6, trait: 9, enum: 5, component: 8, route: 9, module: 4,
    property: 3, field: 3, variable: 2, constant: 3, import: 1,
    export: 1, parameter: 0, namespace: 4, file: 0, protocol: 9, enum_member: 3,
  };
  return bonuses[kind] ?? 0;
}

export function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const fileName = basename(filePath);
  const lowerName = fileName.toLowerCase();

  if (
    lowerName.startsWith('test_') || lowerName.startsWith('test.') ||
    /[._-](test|tests|spec|specs)\.[a-z0-9]+$/.test(lowerName) ||
    /(?:Test|Tests|TestCase|Tester|Spec|Specs)\.[A-Za-z0-9]+$/.test(fileName)
  ) return true;

  if (
    lower.includes('/tests/') || lower.includes('/test/') ||
    lower.includes('/__tests__/') || lower.includes('/spec/') ||
    lower.includes('/specs/') || lower.includes('/testing/') ||
    lower.startsWith('test/') || lower.startsWith('tests/') ||
    lower.startsWith('spec/') || lower.startsWith('specs/')
  ) return true;

  return false;
}

export function isGeneratedFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const patterns = [
    '.pb.go', '.pb.rs', '.pb.py', '.pb.ts', '.pb.js',
    '_generated.', '.generated.', '_gen.', '.gen.',
    'mock_', '.mock.', '_mock.',
    '/generated/', '/gen/', '/auto-generated/',
    '.min.js', '.min.css', '.bundle.js',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  ];
  return patterns.some(p => lower.includes(p));
}

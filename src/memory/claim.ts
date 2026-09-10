import { jaccard } from './tokens.js';

export type MemoryPolarity = 'prefer' | 'avoid' | 'neutral';

export interface MemoryClaim {
  objects: string[];
  family?: string;
  polarity: MemoryPolarity;
}

const OBJECT_ALIASES: Array<{ id: string; family: string; needles: RegExp }> = [
  { id: 'npm', family: 'package-manager', needles: /\bnpm\b/i },
  { id: 'yarn', family: 'package-manager', needles: /\byarn\b/i },
  { id: 'pnpm', family: 'package-manager', needles: /\bpnpm\b/i },
  { id: 'bun', family: 'package-manager', needles: /\bbun\b/i },
  { id: 'named-export', family: 'module-exports', needles: /\bnamed exports?|export by name|具名导出|按名称导出/i },
  { id: 'default-export', family: 'module-exports', needles: /\bdefault exports?|默认导出/i },
  { id: 'beside-module', family: 'test-layout', needles: /模块旁边|源码旁边|beside|next to the (?:source )?module|tests? belong/i },
  { id: 'tests-dir', family: 'test-layout', needles: /__tests__/i },
];

/** Chosen-tool sentences: "use X not Y" / "用 X 不要用 Y" count as prefer, not avoid. */
const USE_NOT = /(?:请用|用|use)\s+.+\s*(?:，|,)?\s*(?:不要用|别用|而不是|instead of|not)\s+/i;
const PREFER = /\b(prefer|always use|standardize on|standardise on|adopt)\b|请用|统一用|必须用|我们约定/i;
const AVOID = /\b(never use|don't use|do not use|stop using)\b|不要用|别用|弃用|不再(?:用|使用)/i;

const MEMORY_LEAD = /^(remember(?:\s+that)?|记住(?:一下)?|请记住|我们约定|从此以后|以后都)\s*[:：]?\s*/i;
const USE_LEAD = /^(always\s+)?(never\s+)?(please\s+)?(use|using|请用|使用|用)\s+/i;

const GENERIC_OBJECT = new Set([
  'always', 'never', 'prefer', 'named', 'default', 'export', 'exports',
  'module', 'source', 'file', 'files', 'repo', 'project', 'this', 'that',
  'palette', 'color', 'style', 'using', 'instead', 'remember', 'theme',
  'need', 'think', 'dont', "don't",
]);

export function claimFromText(text: string): MemoryClaim {
  const known = OBJECT_ALIASES.filter(item => item.needles.test(text));
  const objects = [...new Set(known.map(item => item.id))];
  const families = [...new Set(known.map(item => item.family))];
  return {
    objects: objects.length > 0 ? objects : contentObjects(text),
    family: families.length === 1 ? families[0] : undefined,
    polarity: polarityFromText(text),
  };
}

export function polarityFromText(text: string): MemoryPolarity {
  if (USE_NOT.test(text)) return 'prefer';
  if (PREFER.test(text)) return 'prefer';
  if (AVOID.test(text)) return 'avoid';
  return 'neutral';
}

function stripClaimLead(text: string): string {
  return text.replace(MEMORY_LEAD, '').replace(USE_LEAD, '').trim();
}

function contentObjects(text: string): string[] {
  const stripped = stripClaimLead(text);
  const english = stripped
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !GENERIC_OBJECT.has(token));
  const han = stripped.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjk = han
    .map(seq => seq.replace(/^(请记住|记住|使用|请用|不要用|别用|用)/, ''))
    .filter(seq => seq.length >= 2);
  return [...new Set([...english, ...cjk])];
}

function oppositePolarity(left: MemoryPolarity, right: MemoryPolarity): boolean {
  return (left === 'prefer' && right === 'avoid') || (left === 'avoid' && right === 'prefer');
}

export function claimsCompete(incoming: MemoryClaim, existing: MemoryClaim): boolean {
  if (incoming.family && incoming.family === existing.family) {
    if (incoming.polarity === 'prefer' && existing.polarity === 'prefer') return true;
    const shared = incoming.objects.filter(item => existing.objects.includes(item));
    return shared.length > 0 && oppositePolarity(incoming.polarity, existing.polarity);
  }
  if (incoming.family && existing.family && incoming.family !== existing.family) return false;
  const shared = incoming.objects.filter(item => existing.objects.includes(item));
  if (shared.length >= 2) return true;
  return jaccard(incoming.objects, existing.objects) >= 0.4;
}

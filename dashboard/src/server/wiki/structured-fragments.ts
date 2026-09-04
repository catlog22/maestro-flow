import { createHash } from 'node:crypto';

// Reserve a large ordinal range for split parts so duplicate heading paths do
// not collide when both occurrences are long sections.
const STRUCTURE_ORDINAL_STRIDE = 1_000_000;

/**
 * Internal recall unit used by the opt-in structured embedding index.  A
 * fragment never becomes a public search result: `parentId` remains the
 * externally visible WikiEntry id and the indexer collapses fragment hits
 * back to that id before returning results.
 */
export type SearchFragmentKind = 'markdown' | 'text' | 'code';

export interface SearchFragmentRange {
  /** 1-based inclusive source line range. */
  startLine: number;
  endLine: number;
  /** UTF-16 source offsets, start inclusive/end exclusive. */
  startChar?: number;
  endChar?: number;
}

export interface SearchFragment {
  /** Stable internal id; never expose this as a WikiEntry id. */
  fragmentId: string;
  /** Existing WikiEntry/MaestroGraph id retained as the result identity. */
  parentId: string;
  /** Text sent to the embedding provider. */
  text: string;
  range: SearchFragmentRange;
  /** Heading path from the document root, or an empty array for plain text. */
  breadcrumb: string[];
  kind: SearchFragmentKind;
  /** SHA-256 of the exact embedding text (not a provider/model hash). */
  contentHash: string;
  /** Chunk policy which produced this fragment. */
  policyChecksum: string;
}

export interface StructuredFragmentPolicy {
  schema: 'search-fragments/1';
  /** Maximum embedding text budget in UTF-16 characters. */
  maxChars: number;
  /** Overlap between adjacent long-section fragments. */
  overlapChars: number;
  /** Markdown heading depth considered for hierarchy. */
  maxHeadingLevel: number;
  /** Number of source lines used when no character range is available. */
  textLineBudget: number;
}

/**
 * Deliberately conservative defaults.  They are part of the checksum: changing
 * any value invalidates structured artifacts instead of mixing old vectors
 * with newly generated fragments.
 */
export const STRUCTURED_FRAGMENT_POLICY: Readonly<StructuredFragmentPolicy> = Object.freeze({
  schema: 'search-fragments/1' as const,
  maxChars: 1_200,
  overlapChars: 180,
  maxHeadingLevel: 6,
  textLineBudget: 80,
});

function canonicalPolicy(policy: StructuredFragmentPolicy): string {
  return JSON.stringify({
    schema: policy.schema,
    maxChars: policy.maxChars,
    overlapChars: policy.overlapChars,
    maxHeadingLevel: policy.maxHeadingLevel,
    textLineBudget: policy.textLineBudget,
  });
}

export function structuredFragmentPolicyChecksum(
  policy: StructuredFragmentPolicy = STRUCTURED_FRAGMENT_POLICY,
): string {
  return createHash('sha256').update(canonicalPolicy(policy)).digest('hex');
}

export const STRUCTURED_FRAGMENT_POLICY_CHECKSUM = structuredFragmentPolicyChecksum();

/** Structured chunks stay explicitly opt-in until ranking/performance gates pass. */
export function isStructuredChunksEnabled(value = process.env.MAESTRO_SEARCH_STRUCTURED_CHUNKS): boolean {
  return value?.trim() === '1';
}

export interface SearchFragmentDocument {
  id: string;
  title?: string;
  summary?: string;
  tags?: readonly string[];
  body?: string;
  /** `code` selects MaestroGraph fields below; no parser is invoked here. */
  kind?: SearchFragmentKind;
  filePath?: string | null;
  symbol?: string | null;
  qualifiedName?: string | null;
  signature?: string | null;
  language?: string | null;
  definition?: string | null;
  sourceType?: string | null;
  startLine?: number;
  endLine?: number;
}

interface SourceSlice {
  text: string;
  start: number;
  end: number;
  breadcrumb: string[];
  ordinal: number;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function clampPolicy(policy: StructuredFragmentPolicy): StructuredFragmentPolicy {
  const maxChars = Number.isSafeInteger(policy.maxChars) && policy.maxChars > 0
    ? policy.maxChars : STRUCTURED_FRAGMENT_POLICY.maxChars;
  const overlapChars = Number.isSafeInteger(policy.overlapChars) && policy.overlapChars >= 0
    ? Math.min(policy.overlapChars, Math.max(0, maxChars - 1))
    : STRUCTURED_FRAGMENT_POLICY.overlapChars;
  const maxHeadingLevel = Number.isSafeInteger(policy.maxHeadingLevel) && policy.maxHeadingLevel > 0
    ? Math.min(6, policy.maxHeadingLevel) : STRUCTURED_FRAGMENT_POLICY.maxHeadingLevel;
  const textLineBudget = Number.isSafeInteger(policy.textLineBudget) && policy.textLineBudget > 0
    ? policy.textLineBudget : STRUCTURED_FRAGMENT_POLICY.textLineBudget;
  return { schema: 'search-fragments/1', maxChars, overlapChars, maxHeadingLevel, textLineBudget };
}

function lineAtOffset(source: string, offset: number): number {
  let line = 1;
  const bounded = Math.max(0, Math.min(offset, source.length));
  for (let i = 0; i < bounded; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function sourceRange(source: string, start: number, end: number, lineBase = 0): SearchFragmentRange {
  const safeStart = Math.max(0, Math.min(start, source.length));
  const safeEnd = Math.max(safeStart, Math.min(end, source.length));
  const startLine = Math.max(1, lineAtOffset(source, safeStart) + lineBase);
  // An empty range still points at its source line.
  const endLine = Math.max(startLine, lineAtOffset(source, Math.max(safeStart, safeEnd - 1)) + lineBase);
  return { startLine, endLine, startChar: safeStart, endChar: safeEnd };
}

function stableFragmentId(
  parentId: string,
  kind: SearchFragmentKind,
  breadcrumb: readonly string[],
  ordinal: number,
): string {
  // Keep the parent prefix human-readable for debugging, while hashing the
  // structural path so punctuation/CJK headings cannot produce unsafe ids.
  const structural = `${parentId}\0${kind}\0${breadcrumb.join('\u001f')}\0${ordinal}`;
  const digest = createHash('sha256').update(structural).digest('hex').slice(0, 20);
  return `${parentId}#${kind}-${digest}`;
}

function splitSlice(
  source: string,
  slice: SourceSlice,
  policy: StructuredFragmentPolicy,
): SourceSlice[] {
  const length = slice.end - slice.start;
  if (length <= policy.maxChars) return [slice];

  const out: SourceSlice[] = [];
  const step = Math.max(1, policy.maxChars - policy.overlapChars);
  let localStart = 0;
  let part = 0;
  while (localStart < length) {
    const localEnd = Math.min(length, localStart + policy.maxChars);
    out.push({
      text: source.slice(slice.start + localStart, slice.start + localEnd),
      start: slice.start + localStart,
      end: slice.start + localEnd,
      breadcrumb: slice.breadcrumb,
      ordinal: slice.ordinal + part,
    });
    if (localEnd >= length) break;
    localStart += step;
    part++;
  }
  return out;
}

function markdownSlices(
  body: string,
  policy: StructuredFragmentPolicy,
): SourceSlice[] {
  if (!body) return [{ text: '', start: 0, end: 0, breadcrumb: [], ordinal: 0 }];

  const headingRe = /^(#{1,6})[ \t]+([^\r\n]+?)\s*#*[ \t]*$/gm;
  const headings: Array<{ start: number; end: number; level: number; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body)) !== null) {
    const level = match[1].length;
    if (level > policy.maxHeadingLevel) continue;
    const lineEnd = body.indexOf('\n', match.index);
    headings.push({
      start: match.index,
      end: lineEnd < 0 ? body.length : lineEnd,
      level,
      title: match[2].trim(),
    });
  }

  const sections: SourceSlice[] = [];
  const occurrences = new Map<string, number>();
  if (headings.length === 0) {
    return [{ text: body, start: 0, end: body.length, breadcrumb: [], ordinal: 0 }];
  }
  if (headings[0].start > 0 && body.slice(0, headings[0].start).trim()) {
    sections.push({
      text: body.slice(0, headings[0].start), start: 0, end: headings[0].start,
      breadcrumb: [], ordinal: 0,
    });
  }

  const hierarchy: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    while (hierarchy.length >= heading.level) hierarchy.pop();
    hierarchy.push(heading.title);
    const nextStart = headings[i + 1]?.start ?? body.length;
    const pathKey = hierarchy.join('\u001f');
    const occurrence = occurrences.get(pathKey) ?? 0;
    occurrences.set(pathKey, occurrence + 1);
    sections.push({
      text: body.slice(heading.start, nextStart),
      start: heading.start,
      end: nextStart,
      breadcrumb: [...hierarchy],
      // The ordinal is local to this structural breadcrumb rather than a
      // document-global counter, so inserting another section does not rename
      // unrelated fragment IDs.
      ordinal: occurrence * STRUCTURE_ORDINAL_STRIDE,
    });
  }

  return sections.flatMap(section => splitSlice(body, section, policy));
}

function textSlices(body: string, policy: StructuredFragmentPolicy): SourceSlice[] {
  if (!body) return [{ text: '', start: 0, end: 0, breadcrumb: [], ordinal: 0 }];
  // Keep line boundaries where practical so line ranges remain useful. A very
  // long individual line is still split by the character budget.
  const slices: SourceSlice[] = [];
  let groupStart = 0;
  let groupEnd = 0;
  let lineCount = 0;
  let ordinal = 0;
  let cursor = 0;
  for (const line of body.split(/(?<=\n)/)) {
    const next = cursor + line.length;
    const wouldExceedChars = groupEnd > groupStart
      && next - groupStart > policy.maxChars;
    if (groupEnd > groupStart
      && (lineCount >= policy.textLineBudget || wouldExceedChars)) {
      slices.push({
        text: body.slice(groupStart, groupEnd),
        start: groupStart,
        end: groupEnd,
        breadcrumb: [],
        ordinal: ordinal++,
      });
      groupStart = cursor;
      groupEnd = cursor;
      lineCount = 0;
    }
    groupEnd = next;
    lineCount++;
    cursor = next;
  }
  if (groupEnd > groupStart || slices.length === 0) {
    slices.push({
      text: body.slice(groupStart, groupEnd),
      start: groupStart,
      end: groupEnd,
      breadcrumb: [],
      ordinal: ordinal++,
    });
  }
  return slices.flatMap(slice => splitSlice(body, slice, policy));
}

function codeText(document: SearchFragmentDocument): string {
  const symbol = document.symbol || document.qualifiedName || document.id;
  const parts = [
    `path: ${document.filePath || ''}`,
    `kind: ${document.kind || 'code'}`,
    `language: ${document.language || ''}`,
    `symbol: ${symbol}`,
    `signature: ${document.signature || ''}`,
  ];
  if (document.title) parts.push(`title: ${document.title}`);
  if (document.summary) parts.push(`summary: ${document.summary}`);
  if (document.definition) parts.push(`code: ${document.definition.slice(0, 800)}`);
  else if (document.body) parts.push(`code: ${document.body.slice(0, 800)}`);
  return parts.join('\n');
}

function effectiveKind(document: SearchFragmentDocument): SearchFragmentKind {
  if (document.kind) return document.kind;
  if (document.sourceType === 'codegraph' || document.signature || document.filePath) return 'code';
  return 'markdown';
}

function materialize(
  document: SearchFragmentDocument,
  slices: SourceSlice[],
  kind: SearchFragmentKind,
  policy: StructuredFragmentPolicy,
  sourceForRange: string,
  textPrefix = '',
): SearchFragment[] {
  const policyChecksum = structuredFragmentPolicyChecksum(policy);
  return slices.map(slice => {
    const breadcrumb = [...slice.breadcrumb];
    const breadcrumbPrefix = breadcrumb.length > 0
      ? `breadcrumb: ${breadcrumb.join(' > ')}\n`
      : '';
    const text = `${textPrefix}${breadcrumbPrefix}${slice.text}`.trim();
    const computedRange = sourceRange(
      sourceForRange,
      slice.start,
      slice.end,
      document.startLine ? document.startLine - 1 : 0,
    );
    const range = kind === 'code' && document.startLine !== undefined && document.endLine !== undefined
      ? {
        ...computedRange,
        startLine: Math.max(1, document.startLine),
        endLine: Math.max(document.startLine, document.endLine),
      }
      : computedRange;
    return {
      fragmentId: stableFragmentId(document.id, kind, breadcrumb, slice.ordinal),
      parentId: document.id,
      text,
      range,
      breadcrumb,
      kind,
      contentHash: hashText(text),
      policyChecksum,
    };
  });
}

/** Build all deterministic structured fragments for one Wiki/MaestroGraph doc. */
export function buildSearchFragments(
  document: SearchFragmentDocument,
  policy: StructuredFragmentPolicy = STRUCTURED_FRAGMENT_POLICY,
): SearchFragment[] {
  if (!document.id) return [];
  const boundedPolicy = clampPolicy(policy);
  const kind = effectiveKind(document);
  if (kind === 'code') {
    const text = codeText(document);
    const source = document.body || document.definition || text;
    return materialize(document, [{
      text, start: 0, end: source.length, breadcrumb: [], ordinal: 0,
    }], kind, boundedPolicy, source);
  }
  const body = document.body || '';
  const slices = kind === 'markdown' ? markdownSlices(body, boundedPolicy) : textSlices(body, boundedPolicy);
  const prefixParts: string[] = [];
  if (document.title) prefixParts.push(`title: ${document.title}`);
  if (document.summary) prefixParts.push(`summary: ${document.summary}`);
  if (document.tags && document.tags.length > 0) prefixParts.push(`tags: ${document.tags.join(', ')}`);
  const prefix = prefixParts.length > 0 ? `${prefixParts.join('\n')}\ncontent: ` : '';
  return materialize(document, slices, kind, boundedPolicy, body, prefix);
}

/** Build fragments in input order; no sorting or graph/parser side effects. */
export function buildStructuredFragments(
  documents: readonly SearchFragmentDocument[],
  policy: StructuredFragmentPolicy = STRUCTURED_FRAGMENT_POLICY,
): SearchFragment[] {
  const out: SearchFragment[] = [];
  for (const document of documents) out.push(...buildSearchFragments(document, policy));
  return out;
}

/** MaestroGraph fields used by code embeddings, kept parser-independent. */
export interface MaestroGraphCodeContext {
  id: string;
  filePath: string;
  kind: string;
  language: string;
  name: string;
  qualifiedName?: string;
  signature?: string;
  definition?: string;
  docstring?: string;
  startLine?: number;
  endLine?: number;
  sourceType?: string;
}

export function maestroGraphCodeDocument(node: MaestroGraphCodeContext): SearchFragmentDocument {
  return {
    id: node.id,
    kind: 'code',
    filePath: node.filePath,
    language: node.language,
    symbol: node.qualifiedName || node.name,
    qualifiedName: node.qualifiedName,
    signature: node.signature,
    definition: [node.docstring, node.definition].filter(Boolean).join('\n'),
    body: node.definition || '',
    startLine: node.startLine,
    endLine: node.endLine,
    sourceType: node.sourceType || 'codegraph',
  };
}

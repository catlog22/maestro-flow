/**
 * Canonical Knowhow/Spec content parameters and legacy read normalization.
 *
 * This module deliberately has no Node or dashboard dependencies so every
 * parser, writer, indexer, and extractor can use the same mapping rules.
 */

export const CANONICAL_KNOWLEDGE_CATEGORIES = [
  'coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui',
] as const;
export type CanonicalKnowledgeCategory = (typeof CANONICAL_KNOWLEDGE_CATEGORIES)[number];

export const KNOWHOW_TYPES = [
  'session', 'tip', 'template', 'recipe', 'reference', 'decision', 'asset',
  'blueprint', 'document',
] as const;
export type CanonicalKnowhowType = (typeof KNOWHOW_TYPES)[number];

export const DECISION_STATES = ['proposed', 'accepted', 'superseded'] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const LIFECYCLE_STATUSES = ['active', 'deprecated'] as const;
export type KnowledgeLifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export interface CanonicalContentInput extends Record<string, unknown> {
  title?: unknown;
  content?: unknown;
  body?: unknown;
  keywords?: unknown;
  tags?: unknown;
  category?: unknown;
  specCategory?: unknown;
  sourceRef?: unknown;
  source?: unknown;
  relatedPaths?: unknown;
  codePaths?: unknown;
  appliesToRepoIds?: unknown;
  type?: unknown;
  language?: unknown;
  lang?: unknown;
  decisionState?: unknown;
  lifecycleStatus?: unknown;
  status?: unknown;
  tool?: unknown;
  explicitId?: unknown;
  assetType?: unknown;
  description?: unknown;
  summary?: unknown;
}

export interface CanonicalKnowledgeContent {
  title: string;
  content: string;
  keywords: string[];
  category: CanonicalKnowledgeCategory | null;
  sourceRef: string | null;
  relatedPaths: string[];
  appliesToRepoIds: string[];
  summary: string;
  type: CanonicalKnowhowType | null;
  language: string | null;
  decisionState: DecisionState | null;
  lifecycleStatus: KnowledgeLifecycleStatus;
  tool: boolean;
  explicitId: string | null;
  /** Non-fatal legacy ambiguities retained for audit surfaces. */
  auditMarkers: string[];
  /** Invalid canonical values. Writers must reject when this is non-empty. */
  errors: string[];
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function strings(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isOneOf<T extends string>(value: string | null, values: readonly T[]): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

export function isCanonicalKnowledgeCategory(value: unknown): value is CanonicalKnowledgeCategory {
  return typeof value === 'string'
    && (CANONICAL_KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

/** Normalize and validate a project-relative related path. */
export function normalizeRelatedPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Related path must not be empty');
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[/\\]/.test(trimmed)) {
    throw new Error(`Related path must be project-relative: ${value}`);
  }
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '..')) {
    throw new Error(`Related path must not traverse outside the project: ${value}`);
  }
  if (segments.some(segment => segment.length === 0)) {
    throw new Error(`Related path contains an empty segment: ${value}`);
  }
  return normalized;
}

/**
 * Pick the first useful prose paragraph. Markdown headings, fenced markers,
 * and standalone XML tags are skipped so summaries describe actual content.
 */
export function deriveContentSummary(content: string, maxLength = 240): string {
  const paragraphs = content.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const useful = paragraphs.find(paragraph => {
    const value = paragraph.trim();
    return value.length > 0
      && !/^#{1,6}\s/.test(value)
      && !/^```/.test(value)
      && !/^<\/?[\w-]+(?:\s[^>]*)?>$/.test(value);
  }) ?? '';
  return useful.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/**
 * Normalize canonical fields while dual-reading every supported legacy alias.
 * Invalid legacy values are never silently promoted into canonical fields.
 */
export function normalizeCanonicalKnowledgeContent(
  input: CanonicalContentInput,
): CanonicalKnowledgeContent {
  const auditMarkers: string[] = [];
  const errors: string[] = [];

  const title = stringValue(input.title) ?? '';
  const canonicalContent = typeof input.content === 'string'
    ? input.content
    : (typeof input.body === 'string' ? input.body : '');
  const content = canonicalContent.replace(/\r\n?/g, '\n');

  const rawCategory = stringValue(input.category);
  const rawSpecCategory = stringValue(input.specCategory);
  const category = isOneOf(rawCategory, CANONICAL_KNOWLEDGE_CATEGORIES)
    ? rawCategory
    : (isOneOf(rawSpecCategory, CANONICAL_KNOWLEDGE_CATEGORIES) ? rawSpecCategory : null);

  const keywordValues = [...strings(input.keywords), ...strings(input.tags)];
  if (rawCategory && !isOneOf(rawCategory, CANONICAL_KNOWLEDGE_CATEGORIES)) {
    keywordValues.push(rawCategory);
    auditMarkers.push(`legacy-category-as-keyword:${rawCategory}`);
  }
  if (rawSpecCategory && !isOneOf(rawSpecCategory, CANONICAL_KNOWLEDGE_CATEGORIES)) {
    keywordValues.push(rawSpecCategory);
    auditMarkers.push(`invalid-spec-category:${rawSpecCategory}`);
  }
  if (rawCategory && rawSpecCategory
    && isOneOf(rawCategory, CANONICAL_KNOWLEDGE_CATEGORIES)
    && isOneOf(rawSpecCategory, CANONICAL_KNOWLEDGE_CATEGORIES)
    && rawCategory !== rawSpecCategory) {
    auditMarkers.push(`category-conflict:${rawCategory}:${rawSpecCategory}`);
  }
  const assetType = stringValue(input.assetType);
  if (assetType) {
    keywordValues.push(assetType);
    auditMarkers.push(`legacy-asset-type-as-keyword:${assetType}`);
  }
  const keywords = unique(keywordValues);

  const rawPaths = unique([...strings(input.relatedPaths), ...strings(input.codePaths)]);
  const relatedPaths: string[] = [];
  for (const rawPath of rawPaths) {
    try {
      relatedPaths.push(normalizeRelatedPath(rawPath));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const rawType = stringValue(input.type);
  const type = isOneOf(rawType, KNOWHOW_TYPES) ? rawType : null;
  if (rawType && !type) errors.push(`Invalid Knowhow type: ${rawType}`);

  const explicitDecisionState = stringValue(input.decisionState);
  const legacyStatus = stringValue(input.status);
  let decisionState = isOneOf(explicitDecisionState, DECISION_STATES)
    ? explicitDecisionState
    : null;
  if (explicitDecisionState && !decisionState) {
    errors.push(`Invalid decision state: ${explicitDecisionState}`);
  }
  if (!decisionState && isOneOf(legacyStatus, DECISION_STATES)) {
    decisionState = legacyStatus;
    auditMarkers.push(`legacy-status-as-decision-state:${legacyStatus}`);
  }

  const explicitLifecycle = stringValue(input.lifecycleStatus);
  let lifecycleStatus: KnowledgeLifecycleStatus = 'active';
  if (isOneOf(explicitLifecycle, LIFECYCLE_STATUSES)) {
    lifecycleStatus = explicitLifecycle;
  } else if (explicitLifecycle) {
    errors.push(`Invalid lifecycle status: ${explicitLifecycle}`);
  } else if (isOneOf(legacyStatus, LIFECYCLE_STATUSES)) {
    lifecycleStatus = legacyStatus;
    auditMarkers.push(`legacy-status-as-lifecycle-status:${legacyStatus}`);
  } else if (legacyStatus === 'superseded') {
    // Preserve the historical visibility behavior while also retaining the
    // decision meaning above.
    lifecycleStatus = 'deprecated';
    auditMarkers.push('legacy-superseded-is-deprecated');
  } else if (legacyStatus && !isOneOf(legacyStatus, DECISION_STATES)) {
    auditMarkers.push(`unresolved-legacy-status:${legacyStatus}`);
  }

  const explicitSummary = stringValue(input.description) ?? stringValue(input.summary);
  const summary = explicitSummary ?? deriveContentSummary(content);

  return {
    title,
    content,
    keywords,
    category,
    sourceRef: stringValue(input.sourceRef) ?? stringValue(input.source),
    relatedPaths: unique(relatedPaths),
    appliesToRepoIds: unique(strings(input.appliesToRepoIds)),
    summary,
    type,
    language: stringValue(input.language) ?? stringValue(input.lang),
    decisionState,
    lifecycleStatus,
    tool: input.tool === true || input.tool === 'true',
    explicitId: stringValue(input.explicitId)?.toLowerCase() ?? null,
    auditMarkers: unique(auditMarkers),
    errors: unique(errors),
  };
}

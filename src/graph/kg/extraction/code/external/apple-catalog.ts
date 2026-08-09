import appleCatalogV1 from './apple-catalog.v1.json' with { type: 'json' };
import type { UnifiedEdge, UnifiedNode } from '../../../db/types.js';
import type { StructuralReference } from '../../../resolution/structural-reference.js';

export const APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION = 'apple-external-catalog/1.0' as const;

export type AppleExternalCatalogKind = 'class' | 'protocol';

export interface AppleExternalCatalogEntry {
  module: string;
  objcName: string;
  kind: AppleExternalCatalogKind;
  swiftVisibleAliases: readonly string[];
  /** Canonical `<Module>.<ObjCName>` relation target. */
  parent: string | null;
  /** Canonical `<Module>.<ObjCName>` protocol relation targets. */
  protocols: readonly string[];
}

export interface AppleExternalCatalog {
  schemaVersion: typeof APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION;
  entries: readonly AppleExternalCatalogEntry[];
  entriesByNodeId: ReadonlyMap<string, AppleExternalCatalogEntry>;
  entriesByQualifiedName: ReadonlyMap<string, AppleExternalCatalogEntry>;
}

export interface AppleExternalCatalogCandidateMatch {
  referenceRefKey: string;
  rawTargetName: string;
  matchKind: 'canonical' | 'swift-alias';
  matchedCatalogName: string;
  canonicalNodeId: string;
  canonicalQualifiedName: string;
  canonicalObjcName: string;
  module: string;
  kind: AppleExternalCatalogKind;
}

export interface AppleExternalCatalogMaterialization {
  nodes: UnifiedNode[];
  edges: UnifiedEdge[];
  matches: AppleExternalCatalogCandidateMatch[];
}

export interface AppleExternalCatalogMaterializationOptions {
  catalog?: AppleExternalCatalog;
  now?: number;
}

const ROOT_FIELDS = ['schema_version', 'entries'] as const;
const ENTRY_FIELDS = [
  'module',
  'objcName',
  'kind',
  'swiftVisibleAliases',
  'parent',
  'protocols',
] as const;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUALIFIED_NAME_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

export function makeAppleExternalFilePath(module: string): string {
  return `@external/apple/${module}`;
}

export function makeAppleExternalNodeId(module: string, objcName: string): string {
  return `code:${makeAppleExternalFilePath(module)}:${objcName}`;
}

export function makeAppleExternalQualifiedName(module: string, objcName: string): string {
  return `${module}.${objcName}`;
}

/**
 * Validates an in-package catalog value. The loader intentionally has no
 * projectRoot, SDK path, or filesystem override surface.
 */
export function loadAppleExternalCatalog(source: unknown = appleCatalogV1): AppleExternalCatalog {
  const root = requireRecord(source, 'root');
  assertExactFields(root, ROOT_FIELDS, 'root');
  if (root.schema_version !== APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION) {
    throw catalogError(`unsupported schema_version: ${String(root.schema_version)}`);
  }
  if (!Array.isArray(root.entries)) {
    throw catalogError('entries must be an array');
  }

  const entries = root.entries.map((value, index) => parseEntry(value, index));
  const entriesByNodeId = new Map<string, AppleExternalCatalogEntry>();
  const entriesByQualifiedName = new Map<string, AppleExternalCatalogEntry>();

  for (const entry of entries) {
    const nodeId = makeAppleExternalNodeId(entry.module, entry.objcName);
    if (entriesByNodeId.has(nodeId)) {
      throw catalogError(`duplicate stable ID: ${nodeId}`);
    }
    entriesByNodeId.set(nodeId, entry);
    entriesByQualifiedName.set(
      makeAppleExternalQualifiedName(entry.module, entry.objcName),
      entry,
    );
  }

  validateAliases(entries);
  validateRelations(entries, entriesByQualifiedName);

  return Object.freeze({
    schemaVersion: APPLE_EXTERNAL_CATALOG_SCHEMA_VERSION,
    entries: Object.freeze(entries),
    entriesByNodeId,
    entriesByQualifiedName,
  });
}

export const SHIPPED_APPLE_EXTERNAL_CATALOG = loadAppleExternalCatalog();

/** Returns only exact canonical-name or explicitly declared Swift alias matches. */
export function findAppleExternalCatalogCandidates(
  reference: StructuralReference,
  catalog: AppleExternalCatalog = SHIPPED_APPLE_EXTERNAL_CATALOG,
): AppleExternalCatalogCandidateMatch[] {
  if (reference.lookupScope !== 'external' && reference.lookupScope !== 'project-and-external') {
    return [];
  }
  if (
    reference.targetLanguageHints.length > 0
    && !reference.targetLanguageHints.includes('objc')
    && !reference.targetLanguageHints.includes('unknown')
  ) {
    return [];
  }

  const rawTargetName = reference.rawTargetName;
  const rawIsQualified = rawTargetName.includes('.');
  const moduleHints = new Set(reference.moduleHints);
  const matches: AppleExternalCatalogCandidateMatch[] = [];

  for (const entry of catalog.entries) {
    if (
      reference.targetKindHints.length > 0
      && !reference.targetKindHints.includes(entry.kind)
    ) {
      continue;
    }
    // An explicit qualified target is stronger than ambient import hints.
    if (!rawIsQualified && moduleHints.size > 0 && !moduleHints.has(entry.module)) {
      continue;
    }

    const canonicalQualifiedName = makeAppleExternalQualifiedName(entry.module, entry.objcName);
    const canonicalMatches = rawIsQualified
      ? rawTargetName === canonicalQualifiedName
      : rawTargetName === entry.objcName;
    const matchedAlias = reference.origin.language === 'swift'
      ? entry.swiftVisibleAliases.find(alias => (
      rawIsQualified
        ? rawTargetName === makeAppleExternalQualifiedName(entry.module, alias)
        : rawTargetName === alias
      ))
      : undefined;
    if (!canonicalMatches && !matchedAlias) continue;

    matches.push({
      referenceRefKey: reference.refKey,
      rawTargetName,
      matchKind: canonicalMatches ? 'canonical' : 'swift-alias',
      matchedCatalogName: canonicalMatches
        ? canonicalQualifiedName
        : makeAppleExternalQualifiedName(entry.module, matchedAlias as string),
      canonicalNodeId: makeAppleExternalNodeId(entry.module, entry.objcName),
      canonicalQualifiedName,
      canonicalObjcName: entry.objcName,
      module: entry.module,
      kind: entry.kind,
    });
  }

  return matches.sort((left, right) => byteCompare(left.canonicalNodeId, right.canonicalNodeId));
}

/**
 * Materializes referenced Apple entries plus their explicit catalog ancestors.
 * Unreferenced, non-ancestor catalog entries never enter the project graph.
 */
export function materializeAppleExternalCatalog(
  references: Iterable<StructuralReference>,
  options: AppleExternalCatalogMaterializationOptions = {},
): AppleExternalCatalogMaterialization {
  const catalog = options.catalog ?? SHIPPED_APPLE_EXTERNAL_CATALOG;
  const now = options.now ?? Date.now();
  const matches = [...references]
    .flatMap(reference => findAppleExternalCatalogCandidates(reference, catalog))
    .sort((left, right) => (
      byteCompare(left.referenceRefKey, right.referenceRefKey)
      || byteCompare(left.canonicalNodeId, right.canonicalNodeId)
    ));
  const selected = new Map<string, AppleExternalCatalogEntry>();

  const includeEntryAndRelations = (entry: AppleExternalCatalogEntry): void => {
    const qualifiedName = makeAppleExternalQualifiedName(entry.module, entry.objcName);
    if (selected.has(qualifiedName)) return;
    selected.set(qualifiedName, entry);

    if (entry.parent) {
      includeEntryAndRelations(requireRelationTarget(catalog, entry.parent));
    }
    for (const protocol of entry.protocols) {
      includeEntryAndRelations(requireRelationTarget(catalog, protocol));
    }
  };

  for (const match of matches) {
    const entry = catalog.entriesByNodeId.get(match.canonicalNodeId);
    if (entry) includeEntryAndRelations(entry);
  }

  const selectedEntries = [...selected.values()].sort((left, right) => (
    byteCompare(
      makeAppleExternalNodeId(left.module, left.objcName),
      makeAppleExternalNodeId(right.module, right.objcName),
    )
  ));
  const nodes = selectedEntries.map(entry => makeAppleExternalNode(entry, catalog.schemaVersion, now));
  const edges: UnifiedEdge[] = [];

  for (const entry of selectedEntries) {
    const source = makeAppleExternalNodeId(entry.module, entry.objcName);
    if (entry.parent) {
      const target = requireRelationTarget(catalog, entry.parent);
      edges.push(makeCatalogEdge(source, target, 'extends', 'parent', catalog.schemaVersion));
    }
    for (const protocolName of entry.protocols) {
      const target = requireRelationTarget(catalog, protocolName);
      edges.push(makeCatalogEdge(
        source,
        target,
        entry.kind === 'protocol' ? 'extends' : 'implements',
        'protocol',
        catalog.schemaVersion,
      ));
    }
  }

  edges.sort((left, right) => (
    byteCompare(left.source, right.source)
    || byteCompare(left.target, right.target)
    || byteCompare(left.kind, right.kind)
  ));
  return { nodes, edges, matches };
}

function makeAppleExternalNode(
  entry: AppleExternalCatalogEntry,
  schemaVersion: string,
  now: number,
): UnifiedNode {
  const filePath = makeAppleExternalFilePath(entry.module);
  return {
    id: makeAppleExternalNodeId(entry.module, entry.objcName),
    kind: entry.kind,
    name: entry.objcName,
    qualifiedName: makeAppleExternalQualifiedName(entry.module, entry.objcName),
    filePath,
    language: 'objc',
    startLine: 0,
    endLine: 0,
    startColumn: 0,
    endColumn: 0,
    docstring: '',
    signature: '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: '',
    aliases: [...entry.swiftVisibleAliases],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {
      provider: 'apple',
      module: entry.module,
      catalogSchemaVersion: schemaVersion,
      swiftVisibleAliases: [...entry.swiftVisibleAliases],
      objcCanonicalName: entry.objcName,
    },
    updatedAt: now,
  };
}

function makeCatalogEdge(
  source: string,
  targetEntry: AppleExternalCatalogEntry,
  kind: 'extends' | 'implements',
  relation: 'parent' | 'protocol',
  schemaVersion: string,
): UnifiedEdge {
  return {
    source,
    target: makeAppleExternalNodeId(targetEntry.module, targetEntry.objcName),
    kind,
    provenance: 'framework',
    metadata: {
      provider: 'apple',
      relation,
      catalogSchemaVersion: schemaVersion,
    },
  };
}

function parseEntry(value: unknown, index: number): AppleExternalCatalogEntry {
  const context = `entries[${index}]`;
  const raw = requireRecord(value, context);
  assertExactFields(raw, ENTRY_FIELDS, context);
  const module = requireIdentifier(raw.module, `${context}.module`);
  const objcName = requireIdentifier(raw.objcName, `${context}.objcName`);
  if (raw.kind !== 'class' && raw.kind !== 'protocol') {
    throw catalogError(`${context}.kind must be class or protocol`);
  }
  const swiftVisibleAliases = requireIdentifierArray(
    raw.swiftVisibleAliases,
    `${context}.swiftVisibleAliases`,
    true,
  );
  if (raw.parent !== null && typeof raw.parent !== 'string') {
    throw catalogError(`${context}.parent must be a qualified name or null`);
  }
  if (typeof raw.parent === 'string') {
    requireQualifiedName(raw.parent, `${context}.parent`);
  }
  const protocols = requireQualifiedNameArray(raw.protocols, `${context}.protocols`);

  return Object.freeze({
    module,
    objcName,
    kind: raw.kind,
    swiftVisibleAliases: Object.freeze(swiftVisibleAliases),
    parent: raw.parent,
    protocols: Object.freeze(protocols),
  });
}

function validateAliases(entries: readonly AppleExternalCatalogEntry[]): void {
  const canonicalClaims = new Map<string, string>();
  const aliasClaims = new Map<string, string>();
  for (const entry of entries) {
    const nodeId = makeAppleExternalNodeId(entry.module, entry.objcName);
    canonicalClaims.set(makeAppleExternalQualifiedName(entry.module, entry.objcName), nodeId);
  }

  for (const entry of entries) {
    const nodeId = makeAppleExternalNodeId(entry.module, entry.objcName);
    for (const alias of entry.swiftVisibleAliases) {
      const qualifiedAlias = makeAppleExternalQualifiedName(entry.module, alias);
      if (canonicalClaims.has(qualifiedAlias)) {
        throw catalogError(`alias collision: ${qualifiedAlias}`);
      }
      const prior = aliasClaims.get(qualifiedAlias);
      if (prior) {
        throw catalogError(`duplicate alias: ${qualifiedAlias} (${prior}, ${nodeId})`);
      }
      aliasClaims.set(qualifiedAlias, nodeId);
    }
  }
}

function validateRelations(
  entries: readonly AppleExternalCatalogEntry[],
  entriesByQualifiedName: ReadonlyMap<string, AppleExternalCatalogEntry>,
): void {
  for (const entry of entries) {
    if (entry.parent) {
      const parent = entriesByQualifiedName.get(entry.parent);
      if (!parent) throw catalogError(`missing relation target: ${entry.parent}`);
      if (parent.kind !== 'class') {
        throw catalogError(`parent relation target must be a class: ${entry.parent}`);
      }
    }
    for (const protocolName of entry.protocols) {
      const protocol = entriesByQualifiedName.get(protocolName);
      if (!protocol) throw catalogError(`missing relation target: ${protocolName}`);
      if (protocol.kind !== 'protocol') {
        throw catalogError(`protocol relation target must be a protocol: ${protocolName}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (qualifiedName: string): void => {
    if (visited.has(qualifiedName)) return;
    if (visiting.has(qualifiedName)) {
      throw catalogError(`relation cycle: ${qualifiedName}`);
    }
    visiting.add(qualifiedName);
    const entry = entriesByQualifiedName.get(qualifiedName) as AppleExternalCatalogEntry;
    if (entry.parent) visit(entry.parent);
    for (const protocolName of entry.protocols) visit(protocolName);
    visiting.delete(qualifiedName);
    visited.add(qualifiedName);
  };
  for (const qualifiedName of entriesByQualifiedName.keys()) visit(qualifiedName);
}

function requireRelationTarget(
  catalog: AppleExternalCatalog,
  qualifiedName: string,
): AppleExternalCatalogEntry {
  const target = catalog.entriesByQualifiedName.get(qualifiedName);
  if (!target) {
    // A validated catalog cannot reach this branch; keep materialization fail closed.
    throw catalogError(`missing relation target: ${qualifiedName}`);
  }
  return target;
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw catalogError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) throw catalogError(`unknown field ${context}.${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw catalogError(`missing field ${context}.${key}`);
    }
  }
}

function requireIdentifier(value: unknown, context: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw catalogError(`${context} must be an identifier`);
  }
  return value;
}

function requireIdentifierArray(value: unknown, context: string, rejectDuplicates: boolean): string[] {
  if (!Array.isArray(value)) throw catalogError(`${context} must be an array`);
  const result = value.map((item, index) => requireIdentifier(item, `${context}[${index}]`));
  if (rejectDuplicates && new Set(result).size !== result.length) {
    throw catalogError(`duplicate alias: ${context}`);
  }
  return result;
}

function requireQualifiedName(value: string, context: string): string {
  if (!QUALIFIED_NAME_PATTERN.test(value)) {
    throw catalogError(`${context} must be <Module>.<ObjCName>`);
  }
  return value;
}

function requireQualifiedNameArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw catalogError(`${context} must be an array`);
  const result = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw catalogError(`${context}[${index}] must be <Module>.<ObjCName>`);
    }
    return requireQualifiedName(item, `${context}[${index}]`);
  });
  if (new Set(result).size !== result.length) {
    throw catalogError(`duplicate relation target: ${context}`);
  }
  return result;
}

function catalogError(message: string): Error {
  return new Error(`Invalid Apple external catalog: ${message}`);
}

function byteCompare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

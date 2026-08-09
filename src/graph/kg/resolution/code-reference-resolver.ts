// Strict structural reference resolver.
//
// This module deliberately avoids the legacy fuzzy matcher. Structural edges
// are materialized only from one legal exact candidate; suffix, fuzzy, path
// proximity, first-match, and score-based winner selection are forbidden.

import type { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedEdge, UnifiedEdgeKind, UnifiedNode } from '../db/types.js';
import {
  ScanPathComparisonIndex,
  type StoredStructuralReference,
  type StructuralReferenceStatus,
} from './structural-reference.js';

export interface CodeStructuralResolutionResult {
  referencesReset: number;
  resolved: number;
  ambiguous: number;
  notFound: number;
  edgesCreated: number;
  edges: UnifiedEdge[];
  durationMs: number;
}

interface CandidateSelection {
  nodes: UnifiedNode[];
  strategy: string;
  collision: boolean;
}

interface CandidateIndexes {
  byId: Map<string, UnifiedNode[]>;
  byQualifiedName: Map<string, UnifiedNode[]>;
  bySimpleName: Map<string, UnifiedNode[]>;
  byAlias: Map<string, UnifiedNode[]>;
  pathComparison: ScanPathComparisonIndex;
}

const NOMINAL_KINDS = new Set(['class', 'struct', 'enum', 'protocol', 'interface']);
const PROTOCOL_KINDS = new Set(['protocol', 'interface', 'trait']);
const CLASS_LIKE_KINDS = new Set(['class', 'struct', 'enum']);

/** Runs inside the caller-owned transaction and recomputes every stored fact. */
export function resolveCodeStructuralReferences(
  queries: KgQueryBuilder,
  now: number = Date.now(),
): CodeStructuralResolutionResult {
  const startedAt = Date.now();
  const nodes = queries.getNodesBySourceType('codegraph');
  const indexes = buildCandidateIndexes(
    nodes,
    queries.getFilePathsBySourceType('codegraph'),
  );
  const referencesReset = queries.resetStructuralReferenceStatuses({}, now);
  const references = queries.listStructuralReferences();
  const edges: UnifiedEdge[] = [];
  const counts: Record<Exclude<StructuralReferenceStatus, 'pending'>, number> = {
    resolved: 0,
    ambiguous: 0,
    not_found: 0,
  };

  for (const reference of references) {
    const anchor = indexes.byId.get(reference.anchorNodeId)?.[0];
    if (!anchor) {
      // The FK normally makes this impossible. Treat it as corruption rather
      // than silently converting a broken syntax fact into not_found.
      throw new Error(`Structural reference anchor is missing: ${reference.refKey}`);
    }

    const selection = selectCandidates(reference, anchor, indexes);
    const candidates = stableUniqueNodes(selection.nodes);
    if (selection.collision) {
      const candidateIds = stableIds(candidates);
      queries.updateStructuralReferenceResolution(reference.refKey, {
        status: 'ambiguous',
        candidates: candidateIds,
        strategy: 'unicode-path-collision',
      }, now);
      counts.ambiguous++;
      continue;
    }

    if (candidates.length === 0) {
      queries.updateStructuralReferenceResolution(reference.refKey, {
        status: 'not_found',
        candidates: [],
      }, now);
      counts.not_found++;
      continue;
    }

    if (candidates.length > 1) {
      queries.updateStructuralReferenceResolution(reference.refKey, {
        status: 'ambiguous',
        candidates: stableIds(candidates),
      }, now);
      counts.ambiguous++;
      continue;
    }

    const target = candidates[0];
    const edgeKind = edgeKindForReference(reference, anchor, target);
    if (!edgeKind) {
      // Legality filtering should have removed this candidate; keep the guard
      // fail closed if a future kind mapping drifts.
      throw new Error(`Illegal structural resolution for ${reference.refKey}`);
    }

    queries.updateStructuralReferenceResolution(reference.refKey, {
      status: 'resolved',
      resolvedNodeId: target.id,
      candidates: [target.id],
      strategy: selection.strategy,
      confidence: 1,
    }, now);
    const edge = materializeEdge(reference, anchor, target, edgeKind, selection.strategy);
    queries.upsertStructuralEdge(edge as UnifiedEdge & { originRefKey: string });
    edges.push(edge);
    counts.resolved++;
  }

  return {
    referencesReset,
    resolved: counts.resolved,
    ambiguous: counts.ambiguous,
    notFound: counts.not_found,
    edgesCreated: edges.length,
    edges,
    durationMs: Date.now() - startedAt,
  };
}

function buildCandidateIndexes(
  nodes: UnifiedNode[],
  codegraphFilePaths: readonly string[],
): CandidateIndexes {
  const byId = new Map<string, UnifiedNode[]>();
  const byQualifiedName = new Map<string, UnifiedNode[]>();
  const bySimpleName = new Map<string, UnifiedNode[]>();
  const byAlias = new Map<string, UnifiedNode[]>();
  for (const node of nodes) {
    addIndex(byId, node.id, node);
    addIndex(byQualifiedName, node.qualifiedName, node);
    addIndex(bySimpleName, node.name, node);
    for (const alias of node.aliases) addIndex(byAlias, alias, node);
  }
  return {
    byId,
    byQualifiedName,
    bySimpleName,
    byAlias,
    // FileRecord is the scan identity authority. A valid source file may emit
    // zero nodes, but it must still participate in NFC collision detection;
    // otherwise resetting staged statuses would turn a fail-closed ambiguous
    // reference into a fabricated resolved edge.
    pathComparison: new ScanPathComparisonIndex([
      ...codegraphFilePaths,
      ...nodes.map(node => node.filePath),
    ]),
  };
}

function selectCandidates(
  reference: StoredStructuralReference,
  anchor: UnifiedNode,
  indexes: CandidateIndexes,
): CandidateSelection {
  const rawTarget = reference.rawTargetName.trim();
  let nodes: UnifiedNode[] = [];
  let strategy = 'global-simple-exact';
  let explicitTargetModule: string | null = null;

  const idExact = indexes.byId.get(rawTarget) ?? [];
  if (idExact.length > 0) {
    nodes = idExact;
    strategy = 'node-id-exact';
  } else {
    const qualifiedExact = indexes.byQualifiedName.get(rawTarget) ?? [];
    if (qualifiedExact.length === 1 || (qualifiedExact.length > 0 && rawTarget.includes('.'))) {
      nodes = qualifiedExact;
      strategy = 'qualified-name-exact';
    } else if (qualifiedExact.length > 1) {
      const sameFile = sameFileLexicalCandidates(reference, indexes)
        .filter(node => qualifiedExact.some(candidate => candidate.id === node.id));
      nodes = sameFile.length > 0 ? sameFile : qualifiedExact;
      strategy = sameFile.length > 0
        ? 'qualified-name-exact+same-file-lexical-exact'
        : 'qualified-name-exact';
    } else {
      const sameFile = sameFileLexicalCandidates(reference, indexes);
      if (sameFile.length > 0) {
        nodes = sameFile;
        strategy = 'same-file-lexical-exact';
      } else if (rawTarget.includes('.')) {
        const separator = rawTarget.indexOf('.');
        const module = rawTarget.slice(0, separator);
        const moduleTarget = rawTarget.slice(separator + 1);
        const moduleQualified = [
          ...(indexes.byQualifiedName.get(moduleTarget) ?? []),
          ...(indexes.byAlias.get(moduleTarget) ?? [])
            .filter(node => aliasIsLegal(reference, node, moduleTarget)),
        ].filter(node => nodeModule(node) === module);
        if (moduleQualified.length > 0) {
          nodes = moduleQualified;
          explicitTargetModule = module;
          strategy = 'module-qualified-exact';
        }
      } else if (!rawTarget.includes('.')) {
        const simple = indexes.bySimpleName.get(rawTarget) ?? [];
        const aliases = (indexes.byAlias.get(rawTarget) ?? [])
          .filter(node => aliasIsLegal(reference, node, rawTarget));
        nodes = [...simple, ...aliases];
        strategy = simple.length === 0 && aliases.length > 0
          ? 'alias-exact'
          : 'global-simple-exact';
      }
    }
  }

  nodes = stableUniqueNodes(nodes).filter(node => lookupScopeAllows(reference, node));

  const pathNarrowing = narrowByFileHints(reference, nodes, indexes.pathComparison);
  if (pathNarrowing.collision) {
    return { nodes: pathNarrowing.nodes, strategy, collision: true };
  }
  if (reference.targetFileHints.length > 0) {
    nodes = pathNarrowing.nodes;
    strategy += '+file';
  }

  if (reference.moduleHints.length > 0 && explicitTargetModule === null) {
    nodes = nodes.filter((node) => {
      const module = nodeModule(node);
      // Project-local declarations currently have no stable module metadata;
      // retain them, while explicit external modules must match an import hint.
      return module === null || reference.moduleHints.includes(module);
    });
    strategy += '+module';
  }

  nodes = nodes.filter(node => languageAndKindAreLegal(reference, anchor, node));
  const deduped = nominalDedupe(nodes, reference);
  if (deduped.length !== nodes.length) strategy += '+nominal-dedupe';
  return { nodes: deduped, strategy, collision: false };
}

function sameFileLexicalCandidates(
  reference: StoredStructuralReference,
  indexes: CandidateIndexes,
): UnifiedNode[] {
  const rawTarget = reference.rawTargetName;
  const qualifiedNames = new Set([rawTarget]);
  const scopes = reference.anchorQualifiedName.split('.');
  scopes.pop();
  while (scopes.length > 0) {
    qualifiedNames.add(`${scopes.join('.')}.${rawTarget}`);
    scopes.pop();
  }
  const candidates = [...qualifiedNames]
    .flatMap(name => indexes.byQualifiedName.get(name) ?? [])
    .filter(node => node.filePath === reference.origin.filePath);
  if (!rawTarget.includes('.')) {
    candidates.push(...(indexes.bySimpleName.get(rawTarget) ?? [])
      .filter(node => node.filePath === reference.origin.filePath));
  }
  return stableUniqueNodes(candidates);
}

function lookupScopeAllows(reference: StoredStructuralReference, node: UnifiedNode): boolean {
  const external = isExternalNode(node);
  switch (reference.lookupScope) {
    case 'file': return node.filePath === reference.origin.filePath;
    case 'module': {
      const module = nodeModule(node);
      return module !== null && reference.moduleHints.includes(module);
    }
    case 'project': return !external;
    case 'external': return external;
    case 'project-and-external': return true;
  }
}

function narrowByFileHints(
  reference: StoredStructuralReference,
  nodes: UnifiedNode[],
  index: ScanPathComparisonIndex,
): { nodes: UnifiedNode[]; collision: boolean } {
  const relevantPaths = [reference.origin.filePath, ...reference.targetFileHints];
  const collidedKeys = new Set<string>();
  for (const path of relevantPaths) {
    const result = index.get(path);
    if (!result.ok) collidedKeys.add(result.key);
  }
  if (collidedKeys.size > 0) {
    const related = nodes.filter((node) => {
      const result = index.get(node.filePath);
      return !result.ok && collidedKeys.has(result.key);
    });
    return { nodes: related.length > 0 ? related : nodes, collision: true };
  }
  if (reference.targetFileHints.length === 0) return { nodes, collision: false };

  const hintKeys = new Set(reference.targetFileHints.map(path => {
    const result = index.get(path);
    return result.key;
  }));
  return {
    nodes: nodes.filter(node => hintKeys.has(index.get(node.filePath).key)),
    collision: false,
  };
}

function languageAndKindAreLegal(
  reference: StoredStructuralReference,
  anchor: UnifiedNode,
  node: UnifiedNode,
): boolean {
  if (
    reference.targetKindHints.length > 0
    && !reference.targetKindHints.includes(node.kind as never)
  ) return false;
  if (
    reference.targetLanguageHints.length > 0
    && !reference.targetLanguageHints.includes(node.language)
  ) return false;
  // ObjC declarations may only target Swift nodes with explicit ObjC exposure.
  // Current Swift extraction emits no such claim, so absence fails closed.
  if (
    reference.origin.language === 'objc'
    && node.language === 'swift'
    && node.metadata.objcExposed !== true
  ) return false;
  return edgeKindForReference(reference, anchor, node) !== null;
}

function edgeKindForReference(
  reference: StoredStructuralReference,
  anchor: UnifiedNode,
  target: UnifiedNode,
): UnifiedEdgeKind | null {
  if (reference.relationHint === 'contains-owner') {
    return NOMINAL_KINDS.has(target.kind) ? 'contains' : null;
  }
  if (reference.relationHint === 'decorates') {
    return reference.sourceDeclarationKind === 'category' && target.kind === 'class'
      ? 'decorates'
      : null;
  }
  if (reference.relationHint === 'extends') {
    if (PROTOCOL_KINDS.has(anchor.kind)) {
      return PROTOCOL_KINDS.has(target.kind) ? 'extends' : null;
    }
    return anchor.kind === 'class' && target.kind === 'class' ? 'extends' : null;
  }
  if (reference.relationHint === 'implements') {
    return CLASS_LIKE_KINDS.has(anchor.kind) && PROTOCOL_KINDS.has(target.kind)
      ? 'implements'
      : null;
  }
  if (reference.relationHint === 'inherits-or-conforms') {
    if (PROTOCOL_KINDS.has(target.kind)) {
      if (PROTOCOL_KINDS.has(anchor.kind)) return 'extends';
      return CLASS_LIKE_KINDS.has(anchor.kind) ? 'implements' : null;
    }
    return anchor.kind === 'class' && target.kind === 'class' ? 'extends' : null;
  }
  return null;
}

function nominalDedupe(
  input: UnifiedNode[],
  reference: StoredStructuralReference,
): UnifiedNode[] {
  let nodes = stableUniqueNodes(input);

  // A canonical generated compatibility surface wins over duplicate slices or
  // a module-less Swift implementation only when the reference explicitly
  // names that module. No manifest order or path sort is used as a winner.
  for (const module of reference.moduleHints) {
    const canonicalGenerated = nodes.filter(node => (
      nodeModule(node) === module
      && node.metadata.generatedSwiftHeader === true
      && node.metadata.externalSurfaceCanonical === true
    ));
    if (canonicalGenerated.length !== 1) continue;
    const canonical = canonicalGenerated[0];
    const canonicalRuntimeIdentity = swiftRuntimeIdentity(canonical);
    const sameNominal = nodes.filter((node) => {
      if (nominalName(node) !== nominalName(canonical)) return false;
      const candidateModule = nodeModule(node);
      if (candidateModule !== null && candidateModule !== module) return false;
      const candidateRuntimeIdentity = swiftRuntimeIdentity(node);
      // A module-less project declaration is not evidence that it is the
      // implementation behind an imported generated header. Ambient imports
      // apply to every reference in a Swift file, so name-only folding here
      // would silently prefer the external surface over a real local type.
      // Cross-surface folding therefore requires the one stable runtime
      // identity both declarations explicitly share.
      return candidateModule === module
        || (
          candidateModule === null
          && canonicalRuntimeIdentity !== null
          && candidateRuntimeIdentity === canonicalRuntimeIdentity
        );
    });
    if (sameNominal.length > 1) {
      nodes = nodes.filter(node => !sameNominal.includes(node) || node.id === canonical.id);
    }
  }

  const grouped = new Map<string, UnifiedNode[]>();
  const ungrouped: UnifiedNode[] = [];
  for (const node of nodes) {
    const module = nodeModule(node);
    const runtimeIdentity = typeof node.metadata.swiftRuntimeIdentity === 'string'
      ? node.metadata.swiftRuntimeIdentity
      : null;
    if (!module) {
      ungrouped.push(node);
      continue;
    }
    const key = `${module}\0${runtimeIdentity ?? nominalName(node)}`;
    const group = grouped.get(key) ?? [];
    group.push(node);
    grouped.set(key, group);
  }

  const output = [...ungrouped];
  for (const group of grouped.values()) output.push(...dedupeOneNominalGroup(group));

  // Header interface and implementation are two surfaces of one local ObjC
  // nominal only when exactly one declaration carries the interface marker.
  const localGroups = new Map<string, UnifiedNode[]>();
  for (const node of output) {
    if (nodeModule(node) || node.language !== 'objc') continue;
    const pathStem = node.filePath.replace(/\.(?:h|m|mm)$/i, '');
    const key = `${node.name}\0${pathStem}`;
    const group = localGroups.get(key) ?? [];
    group.push(node);
    localGroups.set(key, group);
  }
  let localOutput = [...output];
  for (const group of localGroups.values()) {
    const interfaces = group.filter(node => node.decorators.includes('interface'));
    const implementations = group.filter(node => node.decorators.includes('implementation'));
    if (interfaces.length !== 1 || implementations.length === 0) continue;
    const ids = new Set(group.map(node => node.id));
    localOutput = localOutput.filter(node => !ids.has(node.id) || node.id === interfaces[0].id);
  }
  return stableUniqueNodes(localOutput);
}

function dedupeOneNominalGroup(group: UnifiedNode[]): UnifiedNode[] {
  if (group.length <= 1) return group;
  const canonical = group.filter(node => node.metadata.externalSurfaceCanonical === true);
  if (canonical.length === 1) return canonical;
  const interfaces = group.filter(node => node.decorators.includes('interface'));
  const implementations = group.filter(node => node.decorators.includes('implementation'));
  if (interfaces.length === 1 && implementations.length > 0) return interfaces;
  return group;
}

function materializeEdge(
  reference: StoredStructuralReference,
  anchor: UnifiedNode,
  target: UnifiedNode,
  kind: UnifiedEdgeKind,
  strategy: string,
): UnifiedEdge {
  const source = reference.edgeOrientation === 'anchor-to-target' ? anchor.id : target.id;
  const edgeTarget = reference.edgeOrientation === 'anchor-to-target' ? target.id : anchor.id;
  return {
    source,
    target: edgeTarget,
    kind,
    line: reference.origin.line,
    column: reference.origin.column,
    provenance: 'structural-resolver',
    originRefKey: reference.refKey,
    metadata: {
      structuralReference: {
        refKey: reference.refKey,
        rawTargetName: reference.rawTargetName,
        strategy,
        evidenceProvenance: reference.evidenceProvenance,
      },
      ...(reference.compilationCondition
        ? { compilationCondition: reference.compilationCondition }
        : {}),
    },
  };
}

function aliasIsLegal(
  reference: StoredStructuralReference,
  node: UnifiedNode,
  alias: string,
): boolean {
  if (!node.aliases.includes(alias)) return false;
  if (node.metadata.provider === 'apple') return reference.origin.language === 'swift';
  return true;
}

function nodeModule(node: UnifiedNode): string | null {
  return typeof node.metadata.module === 'string' && node.metadata.module !== ''
    ? node.metadata.module
    : null;
}

function nominalName(node: UnifiedNode): string {
  return typeof node.metadata.objcCanonicalName === 'string'
    ? node.metadata.objcCanonicalName
    : node.name;
}

function swiftRuntimeIdentity(node: UnifiedNode): string | null {
  return typeof node.metadata.swiftRuntimeIdentity === 'string'
    ? node.metadata.swiftRuntimeIdentity
    : null;
}

function isExternalNode(node: UnifiedNode): boolean {
  return node.filePath.startsWith('@external/')
    || node.metadata.externalSurface === true
    || node.metadata.provider === 'apple';
}

function addIndex(index: Map<string, UnifiedNode[]>, key: string, node: UnifiedNode): void {
  if (!key) return;
  const values = index.get(key) ?? [];
  values.push(node);
  index.set(key, values);
}

function stableUniqueNodes(nodes: UnifiedNode[]): UnifiedNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return [...byId.values()].sort((left, right) => byteCompare(left.id, right.id));
}

function stableIds(nodes: UnifiedNode[]): string[] {
  return stableUniqueNodes(nodes).map(node => node.id);
}

function byteCompare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

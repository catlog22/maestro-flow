import type { WikiEntry, WikiIndex } from './wiki-types.js';

// ── Edge-type distance penalties for semantic traversal ─────────────────
// Lower = closer relationship. Used by semanticPath() for weighted
// shortest-path search across KG-enriched wiki entries.
const EDGE_TYPE_WEIGHT: Record<string, number> = {
  implements: 0.2,
  extends: 0.2,
  calls: 0.3,
  imports: 0.4,
  depends_on: 0.4,
  exports: 0.5,
  contains: 0.3,
  uses: 0.5,
  references: 0.7,
  mentions: 1.0,
  related_to: 0.8,
  tests: 0.4,
  configures: 0.6,
};

export interface BrokenLink {
  sourceId: string;
  target: string;
}

export interface WikiGraph {
  /** source entry id → resolved target entry ids */
  forwardLinks: Record<string, string[]>;
  /** target entry id → source entry ids (mirrors WikiIndex.backlinks) */
  backlinks: Record<string, string[]>;
  /** unresolved `[[…]]` mentions */
  brokenLinks: BrokenLink[];
}

export interface HubRank {
  id: string;
  inDegree: number;
}

export interface WikiHealth {
  score: number;
  totals: {
    entries: number;
    brokenLinks: number;
    orphans: number;
    missingTitles: number;
  };
  orphans: string[];
  hubs: HubRank[];
  brokenLinks: BrokenLink[];
  lastUpdated: number;
}

const LINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Compute forward links + broken links from the current index. Backlinks are
 * already computed by WikiIndexer; we reuse them so the graph is consistent.
 */
export function buildGraph(index: WikiIndex): WikiGraph {
  const forwardLinks: Record<string, string[]> = {};
  const broken: BrokenLink[] = [];
  const titleIndex = new Map<string, string>();
  for (const d of index.entries) titleIndex.set(d.title.toLowerCase(), d.id);

  const resolve = (target: string): string | null => {
    if (index.byId[target]) return target;
    const hit = titleIndex.get(target.toLowerCase());
    return hit ?? null;
  };

  const fwdSets = new Map<string, Set<string>>();
  const pushFwd = (source: string, targetId: string) => {
    let s = fwdSets.get(source);
    if (!s) { s = new Set(); fwdSets.set(source, s); }
    s.add(targetId);
  };

  for (const d of index.entries) {
    // `related` frontmatter
    for (const rel of d.related) {
      const hit = resolve(rel);
      if (hit) pushFwd(d.id, hit);
      else broken.push({ sourceId: d.id, target: rel });
    }
    // `parent` → child-to-parent forward link
    if (d.parent) {
      const hit = resolve(d.parent);
      if (hit) pushFwd(d.id, hit);
      // broken parent refs are not tracked as broken links — they are
      // informational only and may reference entries outside the wiki.
    }
    // inline body wikilinks
    if (d.body) {
      LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LINK_RE.exec(d.body))) {
        const hit = resolve(m[1]);
        if (hit) pushFwd(d.id, hit);
        else broken.push({ sourceId: d.id, target: m[1] });
      }
    }
  }

  for (const [k, v] of fwdSets) forwardLinks[k] = [...v];

  return {
    forwardLinks,
    backlinks: index.backlinks,
    brokenLinks: broken,
  };
}

/**
 * Entries with zero incoming and zero outgoing resolved links.
 * Virtual entries are excluded — they have no body and no `related`, and would
 * flood the list.
 */
export function detectOrphans(graph: WikiGraph, entries: WikiEntry[]): string[] {
  const out: string[] = [];
  for (const d of entries) {
    if (d.source.kind === 'virtual') continue;
    const outgoing = graph.forwardLinks[d.id]?.length ?? 0;
    const incoming = graph.backlinks[d.id]?.length ?? 0;
    if (outgoing === 0 && incoming === 0) out.push(d.id);
  }
  return out;
}

export function detectHubs(graph: WikiGraph, topN = 10): HubRank[] {
  const ranked: HubRank[] = Object.entries(graph.backlinks)
    .map(([id, sources]) => ({ id, inDegree: sources.length }))
    .sort((a, b) => b.inDegree - a.inDegree || a.id.localeCompare(b.id));
  return ranked.slice(0, topN);
}

export function detectDeadEnds(graph: WikiGraph): BrokenLink[] {
  return graph.brokenLinks.slice();
}

function isKgEntry(entry: WikiEntry): boolean {
  const vk = entry.ext?.virtualKind;
  return vk === 'kg-node' || vk === 'kg-layer' || vk === 'kg-tour-step';
}

/**
 * Heuristic health score: 100 minus weighted counts of broken links,
 * orphaned entries, and entries missing titles. Floored at 0.
 *
 * KG virtual entries are excluded from broken-link scoring so that
 * unresolved KG-internal references don't distort the wiki health metric.
 */
export function computeHealth(
  index: WikiIndex,
  graph: WikiGraph,
): WikiHealth {
  const orphans = detectOrphans(graph, index.entries);
  const hubs = detectHubs(graph, 10);
  const missingTitles = index.entries.filter(
    (d) => d.source.kind === 'file' && (!d.title || d.title === d.id.split('-').slice(1).join('-')),
  ).length;

  // Exclude broken links originating from KG virtual entries — their
  // internal cross-references are expected to be unresolvable as wiki IDs.
  const brokenLinks = graph.brokenLinks.filter(b => {
    const src = index.byId[b.sourceId];
    return !src || !isKgEntry(src);
  });

  const fileEntryCount = index.entries.filter(d => d.source.kind === 'file').length;
  const rawScore = 100 - 2 * brokenLinks.length - 1 * orphans.length - 3 * missingTitles;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    totals: {
      entries: fileEntryCount,
      brokenLinks: brokenLinks.length,
      orphans: orphans.length,
      missingTitles,
    },
    orphans,
    hubs,
    brokenLinks,
    lastUpdated: index.generatedAt,
  };
}

// ── Semantic graph (weighted edges from ext.kgEdges) ─────────────────

export interface SemanticEdge {
  source: string;
  target: string;
  edgeType: string;
  weight: number;
}

export interface SemanticGraph {
  adjacency: Map<string, SemanticEdge[]>;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Build a weighted adjacency list from KG entries' ext.kgEdges. Also
 * includes standard wiki forward links at a default weight so the
 * semantic graph covers both KG and markdown entries.
 */
export function buildSemanticGraph(index: WikiIndex, graph: WikiGraph): SemanticGraph {
  const adj = new Map<string, SemanticEdge[]>();
  let edgeCount = 0;

  const push = (e: SemanticEdge) => {
    let list = adj.get(e.source);
    if (!list) { list = []; adj.set(e.source, list); }
    list.push(e);
    edgeCount++;
  };

  for (const entry of index.entries) {
    // KG edges with typed weights
    if (Array.isArray(entry.ext?.kgEdges)) {
      for (const ke of entry.ext.kgEdges as Array<{ target: string; type: string; weight?: number }>) {
        if (!ke.target) continue;
        const w = EDGE_TYPE_WEIGHT[ke.type] ?? 0.8;
        push({ source: entry.id, target: ke.target, edgeType: ke.type, weight: w });
      }
    }
    // Standard forward links at default weight
    const fwd = graph.forwardLinks[entry.id];
    if (fwd) {
      for (const t of fwd) {
        push({ source: entry.id, target: t, edgeType: 'wiki-link', weight: 0.6 });
      }
    }
  }

  return { adjacency: adj, nodeCount: index.entries.length, edgeCount };
}

export interface SemanticPathResult {
  from: string;
  to: string;
  found: boolean;
  totalWeight: number;
  steps: Array<{ node: string; edgeType: string; weight: number }>;
}

/**
 * Dijkstra shortest path on the semantic graph (lower total weight = stronger
 * relationship chain). Treats edges as undirected for reachability.
 */
export function semanticPath(
  sg: SemanticGraph,
  fromId: string,
  toId: string,
): SemanticPathResult {
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edgeType: string; weight: number }>();
  dist.set(fromId, 0);

  // Build undirected adjacency
  const undirected = new Map<string, SemanticEdge[]>();
  for (const [src, edges] of sg.adjacency) {
    for (const e of edges) {
      let fwd = undirected.get(src);
      if (!fwd) { fwd = []; undirected.set(src, fwd); }
      fwd.push(e);
      let rev = undirected.get(e.target);
      if (!rev) { rev = []; undirected.set(e.target, rev); }
      rev.push({ source: e.target, target: src, edgeType: e.edgeType, weight: e.weight });
    }
  }

  // Simple priority queue (adequate for wiki-scale graphs)
  const queue: Array<{ node: string; cost: number }> = [{ node: fromId, cost: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { node, cost } = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);

    if (node === toId) break;

    for (const e of undirected.get(node) ?? []) {
      const alt = cost + e.weight;
      if (alt < (dist.get(e.target) ?? Infinity)) {
        dist.set(e.target, alt);
        prev.set(e.target, { node, edgeType: e.edgeType, weight: e.weight });
        queue.push({ node: e.target, cost: alt });
      }
    }
  }

  if (!dist.has(toId)) {
    return { from: fromId, to: toId, found: false, totalWeight: 0, steps: [] };
  }

  // Reconstruct path
  const steps: Array<{ node: string; edgeType: string; weight: number }> = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    if (!p) break;
    steps.unshift({ node: cur, edgeType: p.edgeType, weight: p.weight });
    cur = p.node;
  }
  steps.unshift({ node: fromId, edgeType: '', weight: 0 });

  return {
    from: fromId,
    to: toId,
    found: true,
    totalWeight: dist.get(toId)!,
    steps,
  };
}

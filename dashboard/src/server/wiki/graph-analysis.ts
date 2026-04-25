import type { WikiEntry, WikiIndex } from './wiki-types.js';

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

  const pushFwd = (source: string, targetId: string) => {
    if (!forwardLinks[source]) forwardLinks[source] = [];
    if (!forwardLinks[source].includes(targetId)) forwardLinks[source].push(targetId);
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

/**
 * Heuristic health score: 100 minus weighted counts of broken links,
 * orphaned entries, and entries missing titles. Floored at 0.
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
  const brokenLinks = graph.brokenLinks;

  const rawScore = 100 - 2 * brokenLinks.length - 1 * orphans.length - 3 * missingTitles;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    totals: {
      entries: index.entries.length,
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

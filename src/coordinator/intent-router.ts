// ---------------------------------------------------------------------------
// Intent Router — resolves user intent to a graph ID via pattern matching.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntentMap } from './graph-types.js';
import type { GraphLoader } from './graph-loader.js';

const DEFAULT_GRAPH = 'singles/quick';

export class IntentRouter {
  private intentMap: IntentMap | null = null;
  private loaded = false;

  constructor(
    private readonly loader: GraphLoader,
    private readonly chainsRoot: string,
  ) {}

  resolve(intent: string, forceGraph?: string): string {
    if (forceGraph) {
      return forceGraph;
    }

    const map = this.getIntentMap();
    if (!map) {
      return DEFAULT_GRAPH;
    }

    if (!intent) {
      return map.fallback.graph ?? DEFAULT_GRAPH;
    }

    for (const pattern of map.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern.regex, pattern.flags);
      } catch {
        console.warn(`[IntentRouter] Invalid regex "${pattern.regex}" in pattern "${pattern.type}", skipping`);
        continue;
      }

      if (re.test(intent)) {
        const route = pattern.route;
        if (route.graph) return route.graph;
        if (route.strategy === 'state_router') return '_router';
      }
    }

    return map.fallback.graph ?? DEFAULT_GRAPH;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getIntentMap(): IntentMap | null {
    if (this.loaded) return this.intentMap;
    this.loaded = true;

    const filePath = join(this.chainsRoot, '_intent-map.json');
    try {
      const content = readFileSync(filePath, 'utf-8');
      this.intentMap = JSON.parse(content) as IntentMap;
    } catch {
      console.warn(`[IntentRouter] _intent-map.json not found at ${filePath}, using default`);
      this.intentMap = null;
    }

    return this.intentMap;
  }
}

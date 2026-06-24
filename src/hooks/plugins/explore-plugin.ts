import type { MaestroPlugin } from '../../types/index.js';
import type { WorkflowHookRegistry } from '../workflow-hooks.js';
import {
  loadExploreConfig,
  resolveEndpoints,
  applyProxyEnv,
} from '../../agents/api-explore/config.js';
import {
  buildJobsFromEntries,
  runExploreJobs,
  type ExploreResult,
} from '../../agents/api-explore/runner.js';

export interface ExploreMarker {
  queries: string[];
  maxTurns?: number;
  endpoint?: string;
}

const MARKER_RE = /<!-- EXPLORE_QUERIES:([\s\S]*?)-->/;

function extractExploreMarker(prompt: string): ExploreMarker | null {
  const match = prompt.match(MARKER_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as ExploreMarker;
  } catch {
    return null;
  }
}

export class ExplorePlugin implements MaestroPlugin {
  readonly name = 'explore';

  private pendingResults: ExploreResult[] = [];

  constructor(private readonly cwd: string = process.cwd()) {}

  apply(registry: WorkflowHookRegistry): void {
    registry.transformPrompt.tap(this.name, async (prompt: string) => {
      const marker = extractExploreMarker(prompt);
      if (!marker || marker.queries.length === 0) return prompt;

      const results = await this.runQueries(marker);
      if (results.length === 0) {
        return prompt.replace(MARKER_RE, '');
      }

      const sections = results.map((r, i) =>
        `### Explore [${i + 1}]: ${truncate(r.prompt, 60)}\n\n${r.content}`,
      );
      const block = `## Context (api-explore)\n\n${sections.join('\n\n---\n\n')}`;
      const cleaned = prompt.replace(MARKER_RE, '');
      return `${block}\n\n---\n\n${cleaned}`;
    });
  }

  private async runQueries(marker: ExploreMarker): Promise<ExploreResult[]> {
    try {
      const config = loadExploreConfig();
      applyProxyEnv(config);
      const endpoints = resolveEndpoints(config, marker.endpoint);
      if (endpoints.length === 0) return [];

      const entries = marker.queries.map(q => ({ prompt: q, endpoint: marker.endpoint }));
      const jobs = buildJobsFromEntries(entries, endpoints, endpoints);

      const results = await runExploreJobs({
        jobs,
        cwd: this.cwd,
        maxTurns: marker.maxTurns ?? 4,
        concurrency: Math.min(jobs.length, 4),
      });

      return results.filter(r => r.content && !r.error);
    } catch {
      return [];
    }
  }
}

function truncate(s: string, max: number): string {
  const line = s.replace(/\n/g, ' ').trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

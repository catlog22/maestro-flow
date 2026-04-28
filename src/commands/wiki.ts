/**
 * Wiki Command — CLI for querying and mutating the wiki.
 *
 * Subcommands: list, get, search, health, graph, orphans, hubs,
 * backlinks, forward, create, update, delete
 *
 * By default operates offline by directly reading `.workflow/` files.
 * Use `--live` to route through the dashboard HTTP API instead.
 * Base URL defaults to http://127.0.0.1:3001 and can be overridden with
 * `--base <url>` or `MAESTRO_DASHBOARD_URL`.
 */

import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import { WikiWriter, WikiWriteError } from '#maestro-dashboard/wiki/writer.js';
import { computeHealth, detectOrphans, detectHubs } from '#maestro-dashboard/wiki/graph-analysis.js';
import type { WikiFilters, WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';

// Inline type to avoid cross-build dependency on dashboard dist-server.
// Must match WikiScope in dashboard/src/server/wiki/wiki-types.ts.
type WikiScope = 'project' | 'global' | 'team' | 'personal';

const DEFAULT_BASE = process.env.MAESTRO_DASHBOARD_URL ?? 'http://127.0.0.1:3001';

// ── Lazy offline clients ───────────────────────────────────────────────

let _indexer: WikiIndexer | null = null;
let _writer: WikiWriter | null = null;

function getOfflineClients(): { indexer: WikiIndexer; writer: WikiWriter } {
  if (!_indexer) {
    const workflowRoot = resolve('.workflow');
    _indexer = new WikiIndexer({ workflowRoot });
    _writer = new WikiWriter(workflowRoot, _indexer);
  }
  return { indexer: _indexer!, writer: _writer! };
}

export function registerWikiCommand(program: Command): void {
  const wiki = program
    .command('wiki')
    .description('Query and mutate the wiki (offline by default, --live for HTTP)')
    .option('--base <url>', 'Dashboard base URL', DEFAULT_BASE)
    .option('--live', 'Use HTTP API via dashboard instead of offline mode');

  // ── list ──────────────────────────────────────────────────────────────
  wiki
    .command('list')
    .alias('ls')
    .description('List wiki entries with optional filters')
    .option('--type <type>', 'Filter by type: project|roadmap|spec|issue|lesson|memory|note')
    .option('--scope <scope>', 'Filter by spec scope: project|global|team|personal')
    .option('--tag <tag>', 'Filter by tag')
    .option('--status <status>', 'Filter by status')
    .option('--category <cat>', 'Filter by category')
    .option('--created-by <cmd>', 'Filter by creating command/skill')
    .option('-q, --query <q>', 'BM25 full-text query')
    .option('--group', 'Return results grouped by type')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const qs = new URLSearchParams();
        if (opts.type) qs.set('type', opts.type);
        if (opts.scope) qs.set('scope', opts.scope);
        if (opts.tag) qs.set('tag', opts.tag);
        if (opts.status) qs.set('status', opts.status);
        if (opts.category) qs.set('category', opts.category);
        if (opts.createdBy) qs.set('createdBy', opts.createdBy);
        if (opts.query) qs.set('q', opts.query);
        if (opts.group) qs.set('group', 'true');
        const data = await apiGet(base, `/api/wiki?${qs.toString()}`);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        if (opts.group) {
          const groups = (data.groups ?? {}) as Record<string, Array<{ id: string; title: string }>>;
          for (const [type, items] of Object.entries(groups)) {
            if (items.length === 0) continue;
            console.log(`\n[${type}] (${items.length})`);
            for (const e of items) console.log(`  ${e.id}  ${e.title}`);
          }
        } else {
          const entries = (data.entries ?? []) as Array<{ id: string; type: string; title: string }>;
          console.log(`Found ${entries.length} entries`);
          for (const e of entries) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
        }
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const filters: WikiFilters & { scope?: WikiScope } = {};
      if (opts.type) filters.type = opts.type as WikiNodeType;
      if (opts.scope) filters.scope = opts.scope as WikiScope;
      if (opts.tag) filters.tag = opts.tag;
      if (opts.status) filters.status = opts.status;
      if (opts.category) filters.category = opts.category;
      if (opts.createdBy) filters.createdBy = opts.createdBy;
      if (opts.query) filters.q = opts.query;

      if (opts.group) {
        const groups = await indexer.groups(Object.keys(filters).length ? filters : undefined);
        if (opts.json) {
          console.log(JSON.stringify({ groups }, null, 2));
          return;
        }
        for (const [type, items] of Object.entries(groups)) {
          if (items.length === 0) continue;
          console.log(`\n[${type}] (${items.length})`);
          for (const e of items) console.log(`  ${e.id}  ${e.title}`);
        }
      } else {
        const entries = await indexer.query(filters);
        if (opts.json) {
          console.log(JSON.stringify({ entries }, null, 2));
          return;
        }
        console.log(`Found ${entries.length} entries`);
        for (const e of entries) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
      }
    });

  // ── get ───────────────────────────────────────────────────────────────
  wiki
    .command('get <id>')
    .description('Fetch a single wiki entry by id')
    .option('--json', 'Output as JSON')
    .action(async (id, opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, `/api/wiki/${encodeURIComponent(id)}`);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const entry = data.entry;
        if (!entry) {
          console.error('Entry not found');
          process.exit(1);
        }
        console.log(`${entry.id}  [${entry.type}]`);
        console.log(`Title: ${entry.title}`);
        if (entry.summary) console.log(`Summary: ${entry.summary}`);
        if (entry.tags?.length) console.log(`Tags: ${entry.tags.join(', ')}`);
        if (entry.source?.path) console.log(`Path: ${entry.source.path}`);
        if (entry.body) {
          console.log('\n---');
          console.log(entry.body);
        }
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const index = await indexer.get();
      const entry = index.byId[id];
      if (!entry) {
        console.error('Entry not found');
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify({ entry }, null, 2));
        return;
      }
      console.log(`${entry.id}  [${entry.type}]`);
      console.log(`Title: ${entry.title}`);
      if (entry.summary) console.log(`Summary: ${entry.summary}`);
      if (entry.tags?.length) console.log(`Tags: ${entry.tags.join(', ')}`);
      if (entry.source?.path) console.log(`Path: ${entry.source.path}`);
      if (entry.body) {
        console.log('\n---');
        console.log(entry.body);
      }
    });

  // ── search ────────────────────────────────────────────────────────────
  wiki
    .command('search <query...>')
    .description('BM25 search (alias for `list -q`)')
    .option('--json', 'Output as JSON')
    .action(async (queryParts, opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;
      const q = queryParts.join(' ');

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, `/api/wiki?q=${encodeURIComponent(q)}`);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const entries = (data.entries ?? []) as Array<{ id: string; type: string; title: string }>;
        console.log(`Query: "${q}"  (${entries.length} results)`);
        for (const e of entries) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const entries = await indexer.search(q);
      if (opts.json) {
        console.log(JSON.stringify({ entries }, null, 2));
        return;
      }
      console.log(`Query: "${q}"  (${entries.length} results)`);
      for (const e of entries) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
    });

  // ── health ────────────────────────────────────────────────────────────
  wiki
    .command('health')
    .description('Show wiki graph health score')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, '/api/wiki/health');
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(`Health Score: ${data.score}/100`);
        if (data.totals) {
          console.log(`  Entries:       ${data.totals.entries ?? 0}`);
          console.log(`  Broken links:  ${data.totals.brokenLinks ?? 0}`);
          console.log(`  Orphans:       ${data.totals.orphans ?? 0}`);
          console.log(`  Missing titles: ${data.totals.missingTitles ?? 0}`);
        }
        if (data.hubs?.length) {
          console.log('\nTop hubs:');
          for (const h of data.hubs.slice(0, 5)) {
            console.log(`  ${h.id}  (in-degree: ${h.inDegree})`);
          }
        }
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const index = await indexer.get();
      const graph = await indexer.getGraph();
      const data = computeHealth(index, graph);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Health Score: ${data.score}/100`);
      console.log(`  Entries:       ${data.totals.entries}`);
      console.log(`  Broken links:  ${data.totals.brokenLinks}`);
      console.log(`  Orphans:       ${data.totals.orphans}`);
      console.log(`  Missing titles: ${data.totals.missingTitles}`);
      if (data.hubs?.length) {
        console.log('\nTop hubs:');
        for (const h of data.hubs.slice(0, 5)) {
          console.log(`  ${h.id}  (in-degree: ${h.inDegree})`);
        }
      }
    });

  // ── graph ─────────────────────────────────────────────────────────────
  wiki
    .command('graph')
    .description('Dump full graph (forwardLinks, backlinks, brokenLinks)')
    .action(async (_opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, '/api/wiki/graph');
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const graph = await indexer.getGraph();
      console.log(JSON.stringify(graph, null, 2));
    });

  // ── orphans ───────────────────────────────────────────────────────────
  wiki
    .command('orphans')
    .description('List orphan entries (no in or out links)')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, '/api/wiki/orphans');
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const orphans = (data.orphans ?? []) as Array<{ id: string; type: string; title: string }>;
        console.log(`Orphans: ${orphans.length}`);
        for (const e of orphans) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const index = await indexer.get();
      const graph = await indexer.getGraph();
      const orphanIds = detectOrphans(graph, index.entries);
      const orphans = orphanIds.map((id) => index.byId[id]).filter(Boolean);
      if (opts.json) {
        console.log(JSON.stringify({ orphans }, null, 2));
        return;
      }
      console.log(`Orphans: ${orphans.length}`);
      for (const e of orphans) console.log(`  [${e.type}] ${e.id}  ${e.title}`);
    });

  // ── hubs ──────────────────────────────────────────────────────────────
  wiki
    .command('hubs')
    .description('Top-N hubs ranked by in-degree')
    .option('--limit <n>', 'Max entries', '10')
    .option('--json', 'Output as JSON')
    .action(async (opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, `/api/wiki/hubs?limit=${encodeURIComponent(opts.limit)}`);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const hubs = (data.hubs ?? []) as Array<{ id: string; inDegree: number }>;
        console.log(`Top ${hubs.length} hubs`);
        for (const h of hubs) console.log(`  ${h.id}  (in: ${h.inDegree})`);
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const graph = await indexer.getGraph();
      const hubs = detectHubs(graph, Number(opts.limit) || 10);
      if (opts.json) {
        console.log(JSON.stringify({ hubs }, null, 2));
        return;
      }
      console.log(`Top ${hubs.length} hubs`);
      for (const h of hubs) console.log(`  ${h.id}  (in: ${h.inDegree})`);
    });

  // ── backlinks ─────────────────────────────────────────────────────────
  wiki
    .command('backlinks <id>')
    .description('Show entries linking TO this id')
    .action(async (id, _opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, `/api/wiki/${encodeURIComponent(id)}/backlinks`);
        const backlinks = (data.backlinks ?? []) as Array<{ id: string; title: string }>;
        console.log(`Backlinks for ${id}: ${backlinks.length}`);
        for (const e of backlinks) console.log(`  ${e.id}  ${e.title}`);
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const graph = await indexer.getGraph();
      const index = await indexer.get();
      const blIds = graph.backlinks[id] ?? [];
      const backlinks = blIds.map((blId) => index.byId[blId]).filter(Boolean);
      console.log(`Backlinks for ${id}: ${backlinks.length}`);
      for (const e of backlinks) console.log(`  ${e.id}  ${e.title}`);
    });

  // ── forward ───────────────────────────────────────────────────────────
  wiki
    .command('forward <id>')
    .description('Show entries this id links TO')
    .action(async (id, _opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const data = await apiGet(base, `/api/wiki/${encodeURIComponent(id)}/forward`);
        const forward = (data.forward ?? []) as Array<{ id: string; title: string }>;
        console.log(`Forward links from ${id}: ${forward.length}`);
        for (const e of forward) console.log(`  ${e.id}  ${e.title}`);
        return;
      }

      // Offline mode
      const { indexer } = getOfflineClients();
      const graph = await indexer.getGraph();
      const index = await indexer.get();
      const fwdIds = graph.forwardLinks[id] ?? [];
      const forward = fwdIds.map((fwdId) => index.byId[fwdId]).filter(Boolean);
      console.log(`Forward links from ${id}: ${forward.length}`);
      for (const e of forward) console.log(`  ${e.id}  ${e.title}`);
    });

  // ── create ────────────────────────────────────────────────────────────
  wiki
    .command('create')
    .description('Create a new markdown wiki entry')
    .requiredOption('--type <type>', 'spec|memory|note')
    .requiredOption('--slug <slug>', 'kebab-case slug')
    .requiredOption('--title <title>', 'Entry title')
    .option('--body <text>', 'Inline body text')
    .option('--body-file <path>', 'Read body from file')
    .option('--category <cat>', 'Content category')
    .option('--created-by <cmd>', 'Creating command/skill name')
    .option('--source-ref <ref>', 'Source anchor (session ID, commit, etc.)')
    .option('--parent <id>', 'Parent entry ID')
    .option('--frontmatter <json>', 'Extra frontmatter as JSON object')
    .action(async (opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      const body = opts.bodyFile
        ? readFileSync(opts.bodyFile, 'utf-8')
        : (opts.body ?? '');

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const payload: Record<string, unknown> = {
          type: opts.type,
          slug: opts.slug,
          title: opts.title,
          body,
        };
        if (opts.category) payload.category = opts.category;
        if (opts.createdBy) payload.createdBy = opts.createdBy;
        if (opts.sourceRef) payload.sourceRef = opts.sourceRef;
        if (opts.parent) payload.parent = opts.parent;
        if (opts.frontmatter) {
          try {
            payload.frontmatter = JSON.parse(opts.frontmatter);
          } catch {
            console.error('--frontmatter must be valid JSON');
            process.exit(1);
          }
        }
        const data = await apiJson(base, 'POST', '/api/wiki', payload);
        console.log(`Created: ${data.entry?.id ?? '(unknown)'}`);
        if (data.entry?.source?.path) console.log(`  Path: ${data.entry.source.path}`);
        return;
      }

      // Offline mode
      const { writer } = getOfflineClients();
      let frontmatter: Record<string, unknown> | undefined;
      if (opts.frontmatter) {
        try {
          frontmatter = JSON.parse(opts.frontmatter);
        } catch {
          console.error('--frontmatter must be valid JSON');
          process.exit(1);
        }
      }
      try {
        const entry = await writer.create({
          type: opts.type,
          slug: opts.slug,
          title: opts.title,
          body,
          category: opts.category,
          createdBy: opts.createdBy,
          sourceRef: opts.sourceRef,
          parent: opts.parent,
          frontmatter,
        });
        console.log(`Created: ${entry.id}`);
        if (entry.source?.path) console.log(`  Path: ${entry.source.path}`);
      } catch (err) {
        if (err instanceof WikiWriteError) {
          console.error(`${err.code}: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // ── append ────────────────────────────────────────────────────────────
  wiki
    .command('append <containerId>')
    .description('Append a <spec-entry> to a container file (e.g. spec-learnings)')
    .requiredOption('--category <cat>', 'Entry category (coding, arch, debug, learning, ...)')
    .requiredOption('--body <text>', 'Entry content')
    .option('--keywords <kw>', 'Comma-separated keywords')
    .action(async (containerId, opts, cmd) => {
      // Offline mode only — no live mode for append
      const { writer } = getOfflineClients();
      try {
        const entry = await writer.appendEntry({
          containerId,
          category: opts.category,
          content: opts.body,
          keywords: opts.keywords,
        });
        console.log(`Appended: ${entry.id}`);
        console.log(`  Container: ${containerId}`);
        console.log(`  Title: ${entry.title}`);
      } catch (err) {
        if (err instanceof WikiWriteError) {
          console.error(`${err.code}: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // ── remove-entry ─────────────────────────────────────────────────────
  wiki
    .command('remove-entry <entryId>')
    .description('Remove a spec sub-entry by ID (e.g. spec-learnings-003)')
    .action(async (entryId, _opts, cmd) => {
      const { writer } = getOfflineClients();
      try {
        await writer.removeEntry(entryId);
        console.log(`Removed: ${entryId}`);
      } catch (err) {
        if (err instanceof WikiWriteError) {
          console.error(`${err.code}: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // ── update ────────────────────────────────────────────────────────────
  wiki
    .command('update <id>')
    .description('Update an existing markdown wiki entry')
    .option('--title <title>', 'New title')
    .option('--body <text>', 'New body text')
    .option('--body-file <path>', 'Read new body from file')
    .option('--frontmatter <json>', 'Frontmatter overrides as JSON object')
    .option('--expected-hash <hash>', 'sha256 for optimistic concurrency')
    .action(async (id, opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        const payload: Record<string, unknown> = {};
        if (opts.title !== undefined) payload.title = opts.title;
        if (opts.bodyFile) payload.body = readFileSync(opts.bodyFile, 'utf-8');
        else if (opts.body !== undefined) payload.body = opts.body;
        if (opts.expectedHash) payload.expectedHash = opts.expectedHash;
        if (opts.frontmatter) {
          try {
            payload.frontmatter = JSON.parse(opts.frontmatter);
          } catch {
            console.error('--frontmatter must be valid JSON');
            process.exit(1);
          }
        }
        const data = await apiJson(base, 'PUT', `/api/wiki/${encodeURIComponent(id)}`, payload);
        console.log(`Updated: ${data.entry?.id ?? id}`);
        return;
      }

      // Offline mode
      const { writer } = getOfflineClients();
      let frontmatter: Record<string, unknown> | undefined;
      if (opts.frontmatter) {
        try {
          frontmatter = JSON.parse(opts.frontmatter);
        } catch {
          console.error('--frontmatter must be valid JSON');
          process.exit(1);
        }
      }
      try {
        const entry = await writer.update(id, {
          title: opts.title,
          body: opts.bodyFile ? readFileSync(opts.bodyFile, 'utf-8') : opts.body,
          expectedHash: opts.expectedHash,
          frontmatter,
        });
        console.log(`Updated: ${entry.id}`);
      } catch (err) {
        if (err instanceof WikiWriteError) {
          console.error(`${err.code}: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // ── delete ────────────────────────────────────────────────────────────
  wiki
    .command('delete <id>')
    .alias('rm')
    .description('Delete a markdown wiki entry')
    .action(async (id, _opts, cmd) => {
      const live = cmd.parent!.opts().live as boolean | undefined;

      if (live) {
        const base = cmd.parent!.opts().base as string;
        await apiJson(base, 'DELETE', `/api/wiki/${encodeURIComponent(id)}`, null);
        console.log(`Deleted: ${id}`);
        return;
      }

      // Offline mode
      const { writer } = getOfflineClients();
      try {
        await writer.remove(id);
        console.log(`Deleted: ${id}`);
      } catch (err) {
        if (err instanceof WikiWriteError) {
          console.error(`${err.code}: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });
}

// ── HTTP helpers (used in --live mode) ─────────────────────────────────

async function apiGet(base: string, path: string): Promise<any> {
  const res = await fetchOrExit(`${base}${path}`);
  return parseOrExit(res);
}

async function apiJson(
  base: string,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
): Promise<any> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== null) init.body = JSON.stringify(body);
  const res = await fetchOrExit(`${base}${path}`, init);
  return parseOrExit(res);
}

async function fetchOrExit(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    console.error(`Failed to reach dashboard at ${url}`);
    console.error(`  ${(err as Error).message}`);
    console.error('  Hint: start the dashboard with "maestro view"');
    process.exit(1);
  }
}

async function parseOrExit(res: Response): Promise<any> {
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${data.error ?? text}`);
    if (data.details) console.error(`  details: ${JSON.stringify(data.details).slice(0, 300)}`);
    process.exit(1);
  }
  return data;
}

/**
 * KnowHow Command — CLI for creating and searching reusable knowledge.
 *
 * Subcommands: add, list, search, get
 *
 * Operates offline by directly reading/writing .workflow/knowhow/ files.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const CATEGORIES = ['session', 'tip', 'template', 'recipe', 'reference', 'decision', 'asset', 'blueprint'] as const;
const PREFIX_MAP: Record<string, string> = {
  session: 'KNW', tip: 'TIP', template: 'TPL',
  recipe: 'RCP', reference: 'REF', decision: 'DCS',
  asset: 'AST', blueprint: 'BLP',
};

function getKnowhowDir(): string {
  return resolve('.workflow/knowhow');
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w\s]*?):\s*(.*)$/);
    if (kv) data[kv[1].trim()] = kv[2].trim();
  }
  return { data, body: raw.slice(match[0].length) };
}

export function registerKnowhowCommand(program: Command): void {
  const knowhow = program
    .command('knowhow')
    .alias('kh')
    .description('Create, list, search knowhow entries (.workflow/knowhow/)');

  // ── add ────────────────────────────────────────────────────────────
  knowhow
    .command('add')
    .description('Create a new knowhow entry')
    .requiredOption('--type <type>', 'session|tip|template|recipe|reference|decision')
    .requiredOption('--title <title>', 'Entry title')
    .requiredOption('--body <text>', 'Entry body (markdown)')
    .option('--body-file <path>', 'Read body from file')
    .option('--tags <csv>', 'Comma-separated tags')
    .option('--lang <lang>', '[template] Programming language')
    .option('--source <url>', '[reference] Original URL')
    .option('--status <status>', '[decision] proposed|accepted|superseded')
    .option('--asset-type <type>', '[asset] Asset type (e.g. prompt, config, workflow)')
    .option('--code-paths <paths>', '[blueprint] Comma-separated code paths')
    .action(async (opts) => {
      const type = opts.type as string;
      if (!CATEGORIES.includes(type as any)) {
        console.error(`Unknown type: ${type}. Must be one of: ${CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      // Validate type-specific flags
      if (opts.lang && type !== 'template') {
        console.error('--lang is only valid for type "template"');
        process.exit(1);
      }
      if (opts.source && type !== 'reference') {
        console.error('--source is only valid for type "reference"');
        process.exit(1);
      }
      if (opts.status && type !== 'decision') {
        console.error('--status is only valid for type "decision"');
        process.exit(1);
      }
      if (opts.assetType && type !== 'asset') {
        console.error('--asset-type is only valid for type "asset"');
        process.exit(1);
      }
      if (opts.codePaths && type !== 'blueprint') {
        console.error('--code-paths is only valid for type "blueprint"');
        process.exit(1);
      }

      const body = opts.bodyFile ? readFileSync(opts.bodyFile, 'utf-8') : opts.body;
      const tags = opts.tags ? opts.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      const dir = getKnowhowDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const prefix = PREFIX_MAP[type];
      const filename = `${prefix}-${ts}.md`;

      const { writeFileSync } = await import('node:fs');
      const fmLines = ['---', `title: ${opts.title}`, `type: ${type}`, `category: ${type}`, `created: ${now.toISOString()}`];
      if (tags.length > 0) {
        fmLines.push('tags:');
        for (const t of tags) fmLines.push(`  - ${t}`);
      }
      if (opts.lang) fmLines.push(`lang: ${opts.lang}`);
      if (opts.source) fmLines.push(`source: ${opts.source}`);
      if (opts.status) fmLines.push(`status: ${opts.status}`);
      if (opts.assetType) fmLines.push(`assetType: ${opts.assetType}`);
      if (opts.codePaths) {
        const paths = opts.codePaths.split(',').map((s: string) => s.trim()).filter(Boolean);
        fmLines.push('codePaths:');
        for (const p of paths) fmLines.push(`  - ${p}`);
      }
      fmLines.push('---', '', body);

      writeFileSync(join(dir, filename), fmLines.join('\n'), 'utf-8');
      console.log(`Created: knowhow-${slugify(ts)}`);
      console.log(`  Type: ${type}`);
      console.log(`  File: knowhow/${filename}`);
    });

  // ── list ───────────────────────────────────────────────────────────
  knowhow
    .command('list')
    .alias('ls')
    .description('List knowhow entries')
    .option('--type <type>', 'Filter by type')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const dir = getKnowhowDir();
      if (!existsSync(dir)) {
        console.log('No knowhow entries yet.');
        return;
      }

      const entries: Array<{ id: string; filename: string; title: string; type: string; tags: string; created: string }> = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        const raw = readFileSync(join(dir, name), 'utf-8');
        const { data } = parseFrontmatter(raw);
        if (opts.type && data.type !== opts.type) continue;
        const prefix = name.match(/^([A-Z]+)-\d{8}/)?.[1] ?? '';
        const typeCat = Object.entries(PREFIX_MAP).find(([, p]) => p === prefix)?.[0] ?? '';
        entries.push({
          id: `knowhow-${slugify(name.replace(/^...-/, '').replace('.md', ''))}`,
          filename: name,
          title: data.title || 'Untitled',
          type: typeCat || data.type || '',
          tags: data.tags || '',
          created: data.created || '',
        });
      }

      if (opts.json) {
        console.log(JSON.stringify({ entries }, null, 2));
        return;
      }

      console.log(`Knowhow entries (${entries.length})`);
      for (const e of entries) {
        console.log(`  [${e.type}] ${e.id}  ${e.title}  ${e.created ? `(${e.created.slice(0, 10)})` : ''}`);
      }
    });

  // ── search ─────────────────────────────────────────────────────────
  knowhow
    .command('search <query...>')
    .description('Search knowhow entries by keyword')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Max results', (v) => parseInt(v, 10), 20)
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ').toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      const dir = getKnowhowDir();

      if (!existsSync(dir)) {
        console.log('No knowhow entries yet.');
        return;
      }

      const results: Array<{ id: string; title: string; type: string; score: number; excerpt: string }> = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        const raw = readFileSync(join(dir, name), 'utf-8');
        const contentLower = raw.toLowerCase();
        const matchCount = terms.filter((t) => contentLower.includes(t)).length;
        if (matchCount === 0) continue;

        const { data, body } = parseFrontmatter(raw);
        const prefix = name.match(/^([A-Z]+)-\d{8}/)?.[1] ?? '';
        const typeCat = Object.entries(PREFIX_MAP).find(([, p]) => p === prefix)?.[0] ?? '';
        results.push({
          id: `knowhow-${slugify(name.replace(/^...-/, '').replace('.md', ''))}`,
          title: data.title || 'Untitled',
          type: typeCat,
          score: Math.round((matchCount / terms.length) * 100) / 100,
          excerpt: body.replace(/\s+/g, ' ').slice(0, 200),
        });
      }

      results.sort((a, b) => b.score - a.score);
      const limited = results.slice(0, opts.limit);

      if (opts.json) {
        console.log(JSON.stringify({ query: q, matches: limited, total_matches: results.length }, null, 2));
        return;
      }

      console.log(`Query: "${q}"  (${limited.length}/${results.length} results)`);
      for (const r of limited) {
        console.log(`  [${r.type}] ${r.title}  (score: ${r.score})`);
        console.log(`    ${r.excerpt.slice(0, 120)}...`);
      }
    });

  // ── get ────────────────────────────────────────────────────────────
  knowhow
    .command('get <id>')
    .description('View a knowhow entry')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      const dir = getKnowhowDir();
      if (!existsSync(dir)) {
        console.error('No knowhow entries found.');
        process.exit(1);
      }

      // Try to match by partial id
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        const slug = slugify(name.replace(/^...-/, '').replace('.md', ''));
        if (id.includes(slug) || `knowhow-${slug}` === id) {
          const raw = readFileSync(join(dir, name), 'utf-8');
          if (opts.json) {
            const { data, body } = parseFrontmatter(raw);
            console.log(JSON.stringify({ entry: { id, ...data, body } }, null, 2));
            return;
          }
          console.log(raw);
          return;
        }
      }

      console.error(`Entry not found: ${id}`);
      process.exit(1);
    });
}

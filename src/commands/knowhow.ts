/**
 * KnowHow Command — CLI for creating and searching reusable knowledge.
 *
 * Subcommands: add, list, search, get
 *
 * Operates offline by directly reading/writing .workflow/knowhow/ files.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import {
  KNOWHOW_CATEGORIES as CATEGORIES,
  KNOWHOW_PREFIX_MAP as PREFIX_MAP,
  slugify,
  escapeYamlValue,
  parseFrontmatter,
  getKnowhowDir,
} from '../utils/frontmatter.js';

export function registerKnowhowCommand(program: Command): void {
  const knowhow = program
    .command('knowhow')
    .alias('kh')
    .description('Create, list, search knowhow entries (.workflow/knowhow/)');

  // ── add ────────────────────────────────────────────────────────────
  knowhow
    .command('add')
    .description('Create a new knowhow entry')
    .requiredOption('--type <type>', 'session|tip|template|recipe|reference|decision|document')
    .requiredOption('--title <title>', 'Entry title')
    .requiredOption('--body <text>', 'Entry body (markdown)')
    .option('--body-file <path>', 'Read body from file')
    .option('--keywords <csv>', 'Comma-separated keywords')
    .option('--lang <lang>', '[template] Programming language')
    .option('--source <url>', '[reference] Original URL')
    .option('--status <status>', '[decision] proposed|accepted|superseded')
    .option('--asset-type <type>', '[asset] Asset type (e.g. api-contract, data-model, prompt, config)')
    .option('--code-paths <paths>', '[asset/blueprint] Comma-separated code paths')
    .option('--category <category>', 'Spec category for agent discovery (coding, arch, test, debug, review, learning)')
    .option('--spec-category <cat>', 'Spec category for agent injection (coding|arch|debug|test|review|learning|ui)')
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
      if (opts.codePaths && type !== 'blueprint' && type !== 'asset') {
        console.error('--code-paths is only valid for type "asset" or "blueprint"');
        process.exit(1);
      }
      const validSpecCategories = ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'];
      if (opts.specCategory && !validSpecCategories.includes(opts.specCategory)) {
        console.error(`Invalid --spec-category: ${opts.specCategory}. Must be one of: ${validSpecCategories.join(', ')}`);
        process.exit(1);
      }

      const body = opts.bodyFile ? readFileSync(opts.bodyFile, 'utf-8') : opts.body;
      const tags = opts.keywords ? opts.keywords.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      const dir = getKnowhowDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const prefix = PREFIX_MAP[type];
      const slug = opts.title ? slugify(opts.title).slice(0, 40) : '';
      const filename = slug
        ? `${prefix}-${ts}-${slug}.md`
        : `${prefix}-${ts}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;

      const { writeFileSync } = await import('node:fs');
      const fmLines = ['---', `title: ${escapeYamlValue(opts.title)}`, `type: ${type}`, `created: ${now.toISOString()}`];
      if (tags.length > 0) {
        fmLines.push('keywords:');
        for (const t of tags) fmLines.push(`  - ${t}`);
      }
      if (opts.lang) fmLines.push(`lang: ${opts.lang}`);
      if (opts.source) fmLines.push(`source: ${opts.source}`);
      if (opts.status) fmLines.push(`status: ${opts.status}`);
      if (opts.category) fmLines.push(`category: ${opts.category}`);
      if (opts.specCategory) fmLines.push(`specCategory: ${opts.specCategory}`);
      if (opts.assetType) fmLines.push(`assetType: ${opts.assetType}`);
      if (opts.codePaths) {
        const paths = opts.codePaths.split(',').map((s: string) => s.trim()).filter(Boolean);
        fmLines.push('codePaths:');
        for (const p of paths) fmLines.push(`  - ${p}`);
      }
      fmLines.push('---', '', body);

      writeFileSync(join(dir, filename), fmLines.join('\n'), 'utf-8');
      const idSuffix = slug || `${pad(now.getHours())}${pad(now.getMinutes())}`;
      console.log(`Created: knowhow-${slugify(ts)}-${idSuffix}`);
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
      console.warn('[deprecated] Use "maestro search --type knowhow" instead');
      const q = queryParts.join(' ');
      const limit = opts.limit > 0 ? opts.limit : 20;
      const { runUnifiedSearch } = await import('./search.js');
      const results = await runUnifiedSearch(q, { type: 'knowhow', limit });

      if (opts.json) {
        console.log(JSON.stringify({ query: q, matches: results, total_matches: results.length }, null, 2));
        return;
      }

      console.log(`Query: "${q}"  (${results.length} results)`);
      for (const r of results) {
        const scoreTag = r.score !== null ? `  (score: ${r.score.toFixed(2)})` : '';
        console.log(`  [${r.type}] ${r.id}  ${r.title}${scoreTag}`);
        const excerpt = r.snippet || r.summary;
        if (excerpt) console.log(`    ${excerpt}`);
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

// ---------------------------------------------------------------------------
// `maestro core-memory` — CLI wrapper over the core_memory tool handler
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { readFileSync } from 'fs';
import { handler } from '../tools/core-memory.js';

function renderResult(result: Record<string, unknown>, raw: boolean): void {
  if (raw && typeof result.content === 'string') {
    // `export` returns plain text in `content` — print it verbatim so it pipes cleanly.
    process.stdout.write(result.content);
    if (!result.content.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function run(params: Record<string, unknown>, raw = false): Promise<void> {
  const result = await handler(params);
  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  renderResult(result.result as Record<string, unknown>, raw);
}

function parseTags(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function registerCoreMemoryCommand(program: Command): void {
  const cm = program
    .command('core-memory')
    .alias('cm')
    .description('Core memory — list, import, export, and search strategic context entries');

  // ---- list ---------------------------------------------------------------
  cm
    .command('list')
    .description('List memories (compact preview)')
    .option('--limit <n>', 'Max results', (v) => parseInt(v, 10), 100)
    .option('--tags <csv>', 'Filter by tags (comma-separated, AND logic)')
    .option('--path <dir>', 'Project path override')
    .action(async (opts: { limit: number; tags?: string; path?: string }) => {
      await run({
        operation: 'list',
        limit: opts.limit,
        tags: parseTags(opts.tags),
        path: opts.path,
      });
    });

  // ---- import -------------------------------------------------------------
  cm
    .command('import [text]')
    .description('Import text as a new memory. Omit [text] and pass --file, or pipe via stdin.')
    .option('--file <path>', 'Read content from a file')
    .option('--tags <csv>', 'Tags (comma-separated)')
    .option('--path <dir>', 'Project path override')
    .action(async (text: string | undefined, opts: { file?: string; tags?: string; path?: string }) => {
      let content = text;
      if (!content && opts.file) {
        content = readFileSync(opts.file, 'utf-8');
      }
      if (!content && !process.stdin.isTTY) {
        content = readFileSync(0, 'utf-8');
      }
      if (!content || !content.trim()) {
        console.error('Error: provide text as an argument, --file <path>, or via stdin');
        process.exit(1);
      }
      await run({
        operation: 'import',
        text: content,
        tags: parseTags(opts.tags),
        path: opts.path,
      });
    });

  // ---- export -------------------------------------------------------------
  cm
    .command('export <id>')
    .description('Export memory content as plain text (e.g. CMEM-20260416-203516)')
    .option('--json', 'Emit the full JSON result instead of raw content', false)
    .option('--path <dir>', 'Project path override')
    .action(async (id: string, opts: { json: boolean; path?: string }) => {
      await run({ operation: 'export', id, path: opts.path }, !opts.json);
    });

  // ---- search -------------------------------------------------------------
  cm
    .command('search <query...>')
    .description('Search memories by keyword')
    .option('--limit <n>', 'Max results', (v) => parseInt(v, 10), 100)
    .option('--tags <csv>', 'Filter by tags (comma-separated)')
    .option('--path <dir>', 'Project path override')
    .action(async (queryParts: string[], opts: { limit: number; tags?: string; path?: string }) => {
      await run({
        operation: 'search',
        query: queryParts.join(' '),
        limit: opts.limit,
        tags: parseTags(opts.tags),
        path: opts.path,
      });
    });
}

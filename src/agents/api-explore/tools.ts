import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BATCH_EXECUTION_CONCURRENCY = 16;
const BATCH_RESULT_BUDGET_BYTES = 64 * 1024;
const BATCH_COMMAND_RESULT_MAX_BYTES = 12 * 1024;

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function assertWithinCwd(target: string, cwd: string): void {
  const resolved = resolve(target);
  const resolvedCwd = resolve(cwd);
  const rel = relative(resolvedCwd, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path "${target}" is outside working directory "${cwd}"`);
  }
}

function toRelative(absPath: string, cwd: string): string {
  const rel = relative(cwd, absPath);
  return rel || absPath;
}

function relativizeOutput(output: string, cwd: string): string {
  const cwdNorm = resolve(cwd).replace(/\\/g, '/');
  const cwdBack = resolve(cwd).replace(/\//g, '\\');
  return output
    .replaceAll(cwdNorm + '/', '')
    .replaceAll(cwdBack + '\\', '')
    .replaceAll(cwdNorm, '.')
    .replaceAll(cwdBack, '.');
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const SOURCE_EXTENSION_FALLBACKS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.ts'],
  '.cjs': ['.cts', '.ts'],
};

function resolveReadableFile(filePath: string, cwd: string): { path: string; usedFallback: boolean } {
  const requested = resolve(cwd, filePath);
  assertWithinCwd(requested, cwd);
  if (existsSync(requested) && statSync(requested).isFile()) {
    return { path: requested, usedFallback: false };
  }

  const extension = extname(requested).toLowerCase();
  const fallbacks = SOURCE_EXTENSION_FALLBACKS[extension] ?? [];
  const stem = extension ? requested.slice(0, -extension.length) : requested;
  for (const fallbackExtension of fallbacks) {
    const candidate = `${stem}${fallbackExtension}`;
    assertWithinCwd(candidate, cwd);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { path: candidate, usedFallback: true };
    }
  }

  return { path: requested, usedFallback: false };
}

function readFile(args: { file_path: string; offset?: number; limit?: number }, cwd: string): string {
  const resolved = resolveReadableFile(args.file_path, cwd);
  const content = readFileSync(resolved.path, 'utf-8');
  const lines = content.split('\n');
  const offset = Math.max(1, args.offset ?? 1);
  const end = args.limit ? Math.min(offset + args.limit - 1, lines.length) : lines.length;

  const result: string[] = [];
  for (let i = offset - 1; i < end; i++) {
    result.push(`${i + 1}\t${lines[i]}`);
  }
  if (end < lines.length) {
    result.push(`... (${lines.length - end} more lines)`);
  }
  const body = result.join('\n');
  return resolved.usedFallback
    ? `[resolved source: ${toRelative(resolved.path, cwd)}]\n${body}`
    : body;
}

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

function glob(args: { pattern: string; path?: string }, cwd: string): string {
  const dir = args.path ? resolve(cwd, args.path) : cwd;
  assertWithinCwd(dir, cwd);

  try {
    const output = execFileSync('rg', ['--files', '--glob', args.pattern, dir], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    const files = output.trim().split('\n').filter(Boolean).map(f => toRelative(f.trim(), cwd));
    if (files.length > 100) {
      return files.slice(0, 100).join('\n') + `\n... (${files.length - 100} more files)`;
    }
    return files.join('\n') || 'No files found.';
  } catch {
    try {
      const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
      const matched = entries
        .filter(e => e.isFile() && e.name.match(globToRegex(args.pattern)))
        .map(e => toRelative(resolve(String(e.parentPath ?? e.path), e.name), cwd))
        .slice(0, 100);
      return matched.length > 0 ? matched.join('\n') : 'No files found.';
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

// ---------------------------------------------------------------------------
// Ripgrep runner (shared by Grep and Search)
// ---------------------------------------------------------------------------

function runRg(rgArgs: string[]): string {
  return execFileSync('rg', rgArgs, {
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
  });
}

async function runRgAsync(rgArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync('rg', rgArgs, {
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

function isNoMatch(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const value = 'status' in err
    ? (err as { status?: number | string }).status
    : 'code' in err ? (err as { code?: number | string }).code : undefined;
  return value === 1 || value === '1';
}

function isRegexError(msg: string): boolean {
  return msg.includes('regex parse error') || msg.includes('repetition quantifier') || msg.includes('look-around');
}

function runRgWithFallback(rgArgs: string[]): string {
  try {
    return runRg(rgArgs);
  } catch (err) {
    if (isNoMatch(err)) throw err;
    if (isRegexError(err instanceof Error ? err.message : String(err))) {
      return runRg(['--pcre2', ...rgArgs]);
    }
    throw err;
  }
}

async function runRgWithFallbackAsync(rgArgs: string[]): Promise<string> {
  try {
    return await runRgAsync(rgArgs);
  } catch (err) {
    if (isNoMatch(err)) throw err;
    if (isRegexError(err instanceof Error ? err.message : String(err))) {
      return runRgAsync(['--pcre2', ...rgArgs]);
    }
    throw err;
  }
}

function formatRgOutput(output: string, cwd: string, offset: number, limit: number): string {
  const raw = relativizeOutput(output.trim(), cwd);
  const allLines = raw.split('\n');
  const sliced = allLines.slice(offset, offset + limit);
  if (allLines.length > offset + limit) {
    return sliced.join('\n') + `\n... (${allLines.length - offset - limit} more, ${allLines.length} total)`;
  }
  return sliced.join('\n') || 'No matches found.';
}

// ---------------------------------------------------------------------------
// Search — simple multi-keyword search
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  return inner.includes(quote) ? value : inner.trim();
}

interface SearchArgs {
  query: string;
  path?: string;
  include?: string;
  exclude?: string;
  context?: number;
  limit?: number;
  files_only?: boolean;
}

interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

type BatchCommand = ({ type: 'Search' } & SearchArgs) | ({ type: 'Read' } & ReadArgs);

interface BatchArgs {
  commands: BatchCommand[];
}

function buildSearchRgArgs(args: SearchArgs, cwd: string): { rgArgs: string[]; usePcre2: boolean; searchPath: string } {
  const searchPath = args.path ? resolve(cwd, args.path) : cwd;
  assertWithinCwd(searchPath, cwd);

  let pattern: string;
  let usePcre2 = false;
  const q = stripMatchingQuotes(args.query.trim());

  if (q.startsWith('/') && q.endsWith('/')) {
    pattern = q.slice(1, -1);
  } else if (q.includes(' | ') || q.includes(', ')) {
    const keywords = q.split(/\s*[|,]\s*/).filter(Boolean).map(stripMatchingQuotes).map(escapeRegex);
    pattern = `(${keywords.join('|')})`;
  } else if (/\s\+\s/.test(q)) {
    const keywords = q.split(/\s\+\s/).filter(Boolean).map(stripMatchingQuotes).map(escapeRegex);
    pattern = keywords.map(k => `(?=.*${k})`).join('') + '.*';
    usePcre2 = true;
  } else if (q.includes(' ')) {
    pattern = escapeRegex(q);
  } else {
    pattern = escapeRegex(q);
  }

  const rgArgs: string[] = [];
  if (usePcre2) rgArgs.push('--pcre2');
  rgArgs.push('-i', '-n');
  if (args.files_only) {
    rgArgs.length = 0;
    if (usePcre2) rgArgs.push('--pcre2');
    rgArgs.push('-i', '-l');
  }
  const ctx = args.context ?? 0;
  if (ctx > 0 && !args.files_only) rgArgs.push('-C', String(ctx));
  if (args.include) rgArgs.push('--glob', args.include);
  if (args.exclude) rgArgs.push('--glob', `!${args.exclude}`);
  rgArgs.push('--', pattern, searchPath);

  return { rgArgs, usePcre2, searchPath };
}

function search(args: SearchArgs, cwd: string): string {
  const { rgArgs, usePcre2 } = buildSearchRgArgs(args, cwd);
  try {
    const output = usePcre2 ? runRg(rgArgs) : runRgWithFallback(rgArgs);
    return formatRgOutput(output, cwd, 0, args.limit ?? 80);
  } catch (err) {
    if (isNoMatch(err)) return 'No matches found.';
    throw err;
  }
}

async function searchAsync(args: SearchArgs, cwd: string): Promise<string> {
  const { rgArgs, usePcre2 } = buildSearchRgArgs(args, cwd);
  try {
    const output = usePcre2 ? await runRgAsync(rgArgs) : await runRgWithFallbackAsync(rgArgs);
    return formatRgOutput(output, cwd, 0, args.limit ?? 80);
  } catch (err) {
    if (isNoMatch(err)) return 'No matches found.';
    throw err;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value;
  const marker = '\n…[batch result truncated]';
  const markerBytes = Buffer.byteLength(marker, 'utf-8');
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), 'utf-8') + markerBytes <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low) + marker;
}

function canonicalCommand(command: BatchCommand): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(command).sort(([a], [b]) => a.localeCompare(b)),
  ));
}

async function runBatchCommand(command: BatchCommand, cwd: string): Promise<string> {
  if (command.type === 'Search') {
    if (typeof command.query !== 'string' || !command.query.trim()) {
      throw new Error('Batch Search command requires a non-empty query');
    }
    return searchAsync({
      ...command,
      limit: Math.min(Math.max(1, command.limit ?? 60), 120),
    }, cwd);
  }
  if (command.type === 'Read') {
    if (typeof command.file_path !== 'string' || !command.file_path.trim()) {
      throw new Error('Batch Read command requires file_path');
    }
    return readFile({
      ...command,
      limit: Math.min(Math.max(1, command.limit ?? 160), 240),
    }, cwd);
  }
  throw new Error(`Unknown Batch command type: ${(command as { type?: unknown }).type ?? '(missing)'}`);
}

async function batch(args: BatchArgs, cwd: string): Promise<string> {
  if (!Array.isArray(args.commands) || args.commands.length === 0) {
    throw new Error('Batch requires at least one command');
  }

  const results = new Array<{ status: 'ok' | 'error' | 'duplicate'; content: string }>(args.commands.length);
  const seen = new Set<string>();
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < args.commands.length) {
      const index = nextIndex++;
      const command = args.commands[index];
      const key = canonicalCommand(command);
      if (seen.has(key)) {
        results[index] = { status: 'duplicate', content: 'Skipped duplicate command in this batch.' };
        continue;
      }
      seen.add(key);
      try {
        results[index] = { status: 'ok', content: await runBatchCommand(command, cwd) };
      } catch (err) {
        results[index] = {
          status: 'error',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  const workers = Math.min(BATCH_EXECUTION_CONCURRENCY, args.commands.length);
  await Promise.all(Array.from({ length: workers }, () => runWorker()));

  const perCommandBudget = Math.min(
    BATCH_COMMAND_RESULT_MAX_BYTES,
    Math.max(512, Math.floor(BATCH_RESULT_BUDGET_BYTES / args.commands.length)),
  );
  const sections = results.map((result, index) => {
    const type = args.commands[index]?.type ?? 'Unknown';
    const content = truncateUtf8(result.content, perCommandBudget);
    return `--- command ${index + 1} (${type}, ${result.status}) ---\n${content}`;
  });
  const errors = results.filter(result => result.status === 'error').length;
  const duplicates = results.filter(result => result.status === 'duplicate').length;
  const output = [
    `Batch completed: ${args.commands.length} command(s), ${errors} error(s), ${duplicates} duplicate(s).`,
    ...sections,
  ].join('\n');
  return truncateUtf8(output, BATCH_RESULT_BUDGET_BYTES);
}

// ---------------------------------------------------------------------------
// Grep — advanced regex search
// ---------------------------------------------------------------------------

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: string;
  limit?: number;
  offset?: number;
  case_insensitive?: boolean;
  context?: number;
  before_context?: number;
  after_context?: number;
  only_matching?: boolean;
  multiline?: boolean;
}

function buildGrepRgArgs(args: GrepArgs, cwd: string): string[] {
  const searchPath = args.path ? resolve(cwd, args.path) : cwd;
  assertWithinCwd(searchPath, cwd);

  const rgArgs: string[] = [];
  if (args.case_insensitive) rgArgs.push('-i');
  if (args.multiline) rgArgs.push('-U', '--multiline-dotall');
  if (args.output_mode === 'files_with_matches') {
    rgArgs.push('-l');
  } else if (args.output_mode === 'count') {
    rgArgs.push('-c');
  } else {
    rgArgs.push('-n');
    if (args.only_matching) rgArgs.push('-o');
  }
  if (args.context) rgArgs.push('-C', String(args.context));
  if (args.before_context) rgArgs.push('-B', String(args.before_context));
  if (args.after_context) rgArgs.push('-A', String(args.after_context));
  if (args.glob) rgArgs.push('--glob', args.glob);
  if (args.type) rgArgs.push('--type', args.type);
  rgArgs.push('--', args.pattern, searchPath);
  return rgArgs;
}

function grep(args: GrepArgs, cwd: string): string {
  const rgArgs = buildGrepRgArgs(args, cwd);
  try {
    const output = runRgWithFallback(rgArgs);
    return formatRgOutput(output, cwd, args.offset ?? 0, args.limit ?? 80);
  } catch (err) {
    if (isNoMatch(err)) return 'No matches found.';
    throw err;
  }
}

async function grepAsync(args: GrepArgs, cwd: string): Promise<string> {
  const rgArgs = buildGrepRgArgs(args, cwd);
  try {
    const output = await runRgWithFallbackAsync(rgArgs);
    return formatRgOutput(output, cwd, args.offset ?? 0, args.limit ?? 80);
  } catch (err) {
    if (isNoMatch(err)) return 'No matches found.';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function executeTool(name: string, argsJson: string, cwd: string): string {
  const args = JSON.parse(argsJson || '{}');
  switch (name) {
    case 'Read': return readFile(args, cwd);
    case 'Glob': return glob(args, cwd);
    case 'Grep': return grep(args, cwd);
    case 'Search': return search(args, cwd);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function executeToolAsync(name: string, argsJson: string, cwd: string): Promise<string> {
  const args = JSON.parse(argsJson || '{}');
  switch (name) {
    case 'Batch': return batch(args, cwd);
    case 'Read': return readFile(args, cwd);
    case 'Glob': return glob(args, cwd);
    case 'Grep': return grepAsync(args, cwd);
    case 'Search': return searchAsync(args, cwd);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'Batch',
      description: 'Execute any number of independent Search and Read commands in one parallel batch. Put every command that can run independently into the same call.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            minItems: 1,
            description: 'Commands to execute concurrently. There is no fixed command-count limit; avoid duplicates and include all independent work for this round.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['Search', 'Read'], description: 'Command type.' },
                query: { type: 'string', description: 'Search query without surrounding quotes. Supports OR with |, AND with +, exact phrases, and /raw regex/.' },
                path: { type: 'string', description: 'Search directory or file.' },
                include: { type: 'string', description: 'Search include glob, e.g. *.ts.' },
                exclude: { type: 'string', description: 'Search exclude glob, e.g. *.test.ts.' },
                context: { type: 'integer', description: 'Search context lines.' },
                files_only: { type: 'boolean', description: 'Search file paths only.' },
                file_path: { type: 'string', description: 'Absolute or cwd-relative file path for Read.' },
                offset: { type: 'integer', description: 'Read start line, 1-indexed.' },
                limit: { type: 'integer', description: 'Search output-line or Read line-count limit.' },
              },
              required: ['type'],
            },
          },
        },
        required: ['commands'],
      },
    },
  },
];

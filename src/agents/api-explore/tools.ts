import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

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
  if (!resolved.startsWith(resolvedCwd)) {
    throw new Error(`Path "${target}" is outside working directory "${cwd}"`);
  }
}

function readFile(args: { file_path: string; offset?: number; limit?: number }, cwd: string): string {
  assertWithinCwd(args.file_path, cwd);
  const content = readFileSync(args.file_path, 'utf-8');
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
  return result.join('\n');
}

function glob(args: { pattern: string; path?: string }, cwd: string): string {
  const dir = args.path ? resolve(cwd, args.path) : cwd;
  assertWithinCwd(dir, cwd);

  try {
    const output = execSync(`rg --files --glob "${args.pattern}" "${dir}"`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    const files = output.trim().split('\n').filter(Boolean);
    if (files.length > 100) {
      return files.slice(0, 100).join('\n') + `\n... (${files.length - 100} more files)`;
    }
    return files.join('\n') || 'No files found.';
  } catch {
    try {
      const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
      const matched = entries
        .filter(e => e.isFile() && e.name.match(globToRegex(args.pattern)))
        .map(e => resolve(String(e.parentPath ?? e.path), e.name))
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

function grep(args: {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: string;
  head_limit?: number;
  case_insensitive?: boolean;
  context?: number;
}, cwd: string): string {
  const searchPath = args.path ? resolve(cwd, args.path) : cwd;
  assertWithinCwd(searchPath, cwd);

  const rgArgs: string[] = ['rg'];
  if (args.case_insensitive) rgArgs.push('-i');
  if (args.output_mode === 'files_with_matches') {
    rgArgs.push('-l');
  } else if (args.output_mode === 'count') {
    rgArgs.push('-c');
  } else {
    rgArgs.push('-n');
  }
  if (args.context) rgArgs.push('-C', String(args.context));
  if (args.glob) rgArgs.push('--glob', args.glob);
  if (args.type) rgArgs.push('--type', args.type);
  rgArgs.push('--', args.pattern, searchPath);

  try {
    const output = execSync(rgArgs.join(' '), {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    const lines = output.trim().split('\n');
    const limit = args.head_limit ?? 100;
    if (lines.length > limit) {
      return lines.slice(0, limit).join('\n') + `\n... (${lines.length - limit} more lines)`;
    }
    return lines.join('\n') || 'No matches found.';
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 1) {
      return 'No matches found.';
    }
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function executeTool(name: string, argsJson: string, cwd: string): string {
  const args = JSON.parse(argsJson || '{}');
  switch (name) {
    case 'Read': return readFile(args, cwd);
    case 'Glob': return glob(args, cwd);
    case 'Grep': return grep(args, cwd);
    default: return `Unknown tool: ${name}`;
  }
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read a file from the filesystem. Returns content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file to read.' },
          offset: { type: 'integer', description: 'Line number to start from (1-indexed). Optional.' },
          limit: { type: 'integer', description: 'Number of lines to read. Optional.' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern. Returns file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.js").' },
          path: { type: 'string', description: 'Directory to search in. Defaults to working directory.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search file contents using regex patterns (ripgrep). Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for.' },
          path: { type: 'string', description: 'File or directory to search. Defaults to working directory.' },
          glob: { type: 'string', description: 'Glob filter for files (e.g. "*.ts").' },
          type: { type: 'string', description: 'File type filter (e.g. "ts", "py").' },
          output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output format. Default: content.' },
          head_limit: { type: 'integer', description: 'Max lines to return. Default: 100.' },
          case_insensitive: { type: 'boolean', description: 'Case insensitive search.' },
          context: { type: 'integer', description: 'Lines of context around matches.' },
        },
        required: ['pattern'],
      },
    },
  },
];

import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import {
  assertRepositoryCapability,
  isPathContained,
  resolveRepositoryContext,
  type RepositoryContext,
} from '../repository/context.js';

/** Fixed-string exact search defaults and hard ceilings. */
export const EXACT_DEFAULT_LIMIT = 20;
export const EXACT_MAX_LIMIT = 500;
export const EXACT_DEFAULT_TIMEOUT_MS = 5_000;
export const EXACT_MAX_TIMEOUT_MS = 30_000;
export const EXACT_DEFAULT_MAX_BYTES = 1_048_576;
export const EXACT_MAX_BYTES = 4 * 1_048_576;
export const EXACT_PREVIEW_MAX_CHARS = 1_000;

/** A single literal occurrence from a governed repository scope. */
export interface ExactSearchResult {
  /** Always relative to the repository that owns the result. */
  filePath: string;
  /** One-based source line. */
  line: number;
  /** One-based Unicode code-point column. */
  column: number;
  /** Bounded source line preview. */
  preview: string;
  /** Linked workspace alias; omitted for the current repository. */
  workspace?: string;
  /** Stable linked-scope fence; never an absolute filesystem path. */
  workspaceFence?: string;
}

/** Result of a standalone exact pass. */
export interface ExactSearchOutcome {
  query: string;
  results: ExactSearchResult[];
  /** True when any result/byte/timeout bound stopped collection. */
  truncated: boolean;
  /** True when the wall-clock bound stopped collection. */
  timedOut: boolean;
  /** Number of ripgrep stdout bytes consumed (bounded). */
  bytesUsed: number;
}

/** Options for the standalone literal search. */
export interface ExactSearchOptions {
  /** Host repository root or a nested path from which it is resolved. */
  projectRoot?: string;
  /** Existing host-resolved target; used by command and trusted callers. */
  targetRepository?: RepositoryContext;
  /** Human-facing repository selector, resolved by repository authority. */
  repo?: string;
  /** Linked workspace alias/name selector. */
  workspace?: string;
  /** Explicitly include linked codebase scopes. */
  includeLinkedCode?: boolean;
  /** Maximum occurrences returned across all scopes. */
  limit?: number;
  /** Alias accepted by programmatic callers for the result cap. */
  maxResults?: number;
  /** Alias accepted by programmatic callers for the result cap. */
  resultLimit?: number;
  /** Wall-clock timeout for the whole governed search. */
  timeoutMs?: number;
  /** Alias accepted by programmatic callers for the timeout. */
  timeout?: number;
  /** Maximum ripgrep stdout bytes consumed across all scopes. */
  maxBytes?: number;
  /** Alias accepted by programmatic callers for the response-byte cap. */
  byteCap?: number;
  /** Alias accepted by programmatic callers for the response-byte cap. */
  maxResponseBytes?: number;
  /** Test/host cancellation. */
  signal?: AbortSignal;
}

interface ExactScope {
  context: RepositoryContext;
  /** Scope order is deterministic: current first, then alias-sorted linked. */
  order: number;
  /** Relative paths inside the current root that must not be traversed here. */
  excludedNestedRoots?: string[];
}

interface ExactRipgrepOptions {
  root: string;
  query: string;
  limit: number;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  workspace?: string;
  workspaceFence?: string;
  excludedNestedRoots?: readonly string[];
}

interface ExactRipgrepOutcome {
  results: ExactSearchResult[];
  truncated: boolean;
  timedOut: boolean;
  bytesUsed: number;
}

/** Internal hard exclusions. These remain in force even if ignore files are absent. */
const HARD_EXCLUDE_GLOBS = [
  '!**/.git/**',
  '!**/.workflow/**',
  '!**/.codegraph/**',
  '!**/.maestro/**',
  '!**/node_modules/**',
  '!**/vendor/**',
  '!**/dist/**',
  '!**/dist-server/**',
  '!**/build/**',
  '!**/out/**',
  '!**/coverage/**',
  '!**/target/**',
  '!**/.gradle/**',
  '!**/generated/**',
  '!**/.generated/**',
  '!**/.cache/**',
  '!**/.next/**',
  '!**/.nuxt/**',
  '!**/.svelte-kit/**',
  '!**/.turbo/**',
  '!**/.vite/**',
  '!**/__pycache__/**',
  '!**/.venv/**',
  '!**/venv/**',
  '!**/.pytest_cache/**',
  '!**/.ruff_cache/**',
  '!**/secrets/**',
  '!**/secret/**',
  '!**/private/**',
  '!**/credentials/**',
  '!**/credential/**',
  '!**/.ssh/**',
  '!**/.aws/**',
  '!**/.env',
  '!**/.env.*',
  '!**/secret*',
  '!**/credential*',
  '!**/password*',
  '!**/*.pem',
  '!**/*.key',
  '!**/*.p12',
  '!**/*.pfx',
];

/** Public for focused tests and diagnostics; the command itself uses only argv. */
export interface ExactRipgrepArgsOptions {
  root: string;
  query: string;
  /** Explicitly pass ignore files so temporary/non-Git repositories are governed too. */
  gitIgnoreFile?: string;
  maestroIgnoreFile?: string;
  excludedNestedRoots?: readonly string[];
}

/**
 * Build the complete fixed-string ripgrep argv. The `--` before the query is
 * deliberate: a user query beginning with `-` must remain a literal pattern.
 */
export function buildExactRipgrepArgs(options: ExactRipgrepArgsOptions): string[] {
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--with-filename',
    '--color',
    'never',
    '--fixed-strings',
  ];

  if (options.gitIgnoreFile) args.push('--ignore-file', options.gitIgnoreFile);
  if (options.maestroIgnoreFile) args.push('--ignore-file', options.maestroIgnoreFile);
  for (const glob of HARD_EXCLUDE_GLOBS) args.push('--glob', glob);
  for (const nestedRoot of options.excludedNestedRoots ?? []) {
    const normalized = nestedRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../')) {
      args.push('--glob', `!${normalized}/**`);
    }
  }

  args.push('--', options.query, '.');
  return args;
}

/**
 * Search governed repository source with bundled ripgrep. This is deliberately
 * standalone and never invokes the Wiki/KG providers or normal fusion.
 */
export async function runExactSearch(
  query: string,
  options: ExactSearchOptions = {},
): Promise<ExactSearchOutcome> {
  validateQuery(query);
  const limits = normalizeExactLimits(options);
  const projectRoot = options.projectRoot ?? process.cwd();
  const current = resolveRepositoryContext('current', { projectRoot });
  const selectedByRepo = options.repo
    ? resolveRepositoryContext(options.repo, { projectRoot: current.projectRoot })
    : undefined;
  const target = options.targetRepository ?? selectedByRepo ?? current;
  if (selectedByRepo && options.targetRepository && !sameRepository(selectedByRepo, options.targetRepository)) {
    throw new Error('--repo does not match the supplied target repository authority');
  }

  validateTargetBinding(current, target);

  const allLinks = resolveWorkspaceLinks(
    current.projectRoot,
    loadWorkspaceConfig(current.projectRoot),
  );
  const nestedLinkedRoots = allLinks
    .map(link => link.resolvedPath)
    .filter(path => isPathContained(path, current.projectRoot) && path !== current.projectRoot)
    .map(path => toRelativePath(current.projectRoot, path))
    .filter((path): path is string => path !== null);

  const scopes = resolveExactScopes({
    current,
    target,
    allLinks,
    options,
    nestedLinkedRoots,
  });

  const results: ExactSearchResult[] = [];
  const seen = new Set<string>();
  let bytesUsed = 0;
  let truncated = false;
  let timedOut = false;
  const deadline = Date.now() + limits.timeoutMs;

  for (const scope of scopes) {
    if (options.signal?.aborted) {
      truncated = true;
      break;
    }
    const remainingBytes = limits.maxBytes - bytesUsed;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
    const remainingMs = Math.max(1, deadline - Date.now());
    // Keep one probe slot after the global result cap is reached so a later
    // linked scope can prove that truncation really occurred. A result from
    // that probe is not exposed, only reflected in `truncated`.
    const passLimit = Math.max(1, limits.maxResults - results.length);
    const pass = await runExactRipgrep({
      root: scope.context.projectRoot,
      query,
      // Ask for one extra occurrence so an exact result cap can be marked as
      // truncated without scanning an unbounded stream.
      limit: passLimit,
      timeoutMs: remainingMs,
      maxBytes: remainingBytes,
      signal: options.signal,
      ...(scope.context.relation === 'linked' ? {
        workspace: scope.context.alias,
        workspaceFence: scope.context.repoId
          ? `repo:${scope.context.repoId}`
          : `linked:${scope.context.alias}`,
      } : {}),
      ...(scope.excludedNestedRoots
        ? { excludedNestedRoots: scope.excludedNestedRoots }
        : {}),
    });
    bytesUsed += pass.bytesUsed;
    truncated ||= pass.truncated;
    timedOut ||= pass.timedOut;
    const available = Math.max(0, limits.maxResults - results.length);
    if (pass.results.length > available) truncated = true;
    for (const result of pass.results.slice(0, available)) {
      const key = `${result.workspace ?? 'current'}\u0000${result.filePath}\u0000${result.line}\u0000${result.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    }
    if (pass.timedOut || options.signal?.aborted || bytesUsed >= limits.maxBytes) break;
    if (Date.now() >= deadline) {
      truncated = true;
      timedOut = true;
      break;
    }
  }

  // Provider order is authoritative (current first, then linked aliases),
  // while path/position sorting makes the result deterministic across OSes.
  const scopeOrder = new Map(scopes.map(scope => [scope.context.alias, scope.order]));
  results.sort((left, right) => {
    const leftOrder = scopeOrder.get(left.workspace ?? current.alias) ?? 0;
    const rightOrder = scopeOrder.get(right.workspace ?? current.alias) ?? 0;
    return leftOrder - rightOrder
      || compareStrings(left.filePath, right.filePath)
      || left.line - right.line
      || left.column - right.column;
  });

  return {
    query,
    results: results.slice(0, limits.maxResults),
    truncated: truncated || results.length > limits.maxResults,
    timedOut,
    bytesUsed: Math.min(bytesUsed, limits.maxBytes),
  };
}

/** Backward-friendly aliases for callers that use either operation name. */
export const searchExact = runExactSearch;
export const exactSearch = runExactSearch;
export const runExactFileSearch = runExactSearch;

/** Parse one ripgrep JSON match event into every occurrence on that line. */
export function parseExactRipgrepJsonLine(
  line: string,
  root: string,
  metadata: Pick<ExactSearchResult, 'workspace' | 'workspaceFence'> = {},
): ExactSearchResult[] {
  if (!line.trim()) return [];
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(event) || event.type !== 'match' || !isRecord(event.data)) return [];
  const data = event.data;
  if (!isRecord(data.path) || typeof data.path.text !== 'string') return [];
  if (!isRecord(data.lines) || typeof data.lines.text !== 'string') return [];
  if (typeof data.line_number !== 'number' || !Number.isSafeInteger(data.line_number)) return [];
  if (data.binary_offset !== undefined) return [];

  const lineNumber = data.line_number as number;
  const filePath = safeRelativeResultPath(root, data.path.text);
  if (!filePath) return [];
  const preview = trimLineEnding(data.lines.text);
  const rawSubmatches = Array.isArray(data.submatches) ? data.submatches : [];
  const submatches = rawSubmatches
    .filter(isRecord)
    .map(match => ({
      start: typeof match.start === 'number' && Number.isFinite(match.start) ? match.start : 0,
    }));
  const occurrences = submatches.length > 0 ? submatches : [{
    start: typeof data.column === 'number' && Number.isFinite(data.column) ? Math.max(0, data.column - 1) : 0,
  }];

  return occurrences.map(match => ({
    filePath,
    line: lineNumber,
    column: columnAtUtf8ByteOffset(preview, match.start),
    preview: truncatePreview(preview),
    ...metadata,
  }));
}

/** Normalize and validate exact caps for both CLI and programmatic callers. */
export function normalizeExactLimits(options: ExactSearchOptions): {
  maxResults: number;
  timeoutMs: number;
  maxBytes: number;
} {
  const maxResults = clampPositiveInteger(
    options.maxResults ?? options.resultLimit ?? options.limit ?? EXACT_DEFAULT_LIMIT,
    'max results',
    EXACT_MAX_LIMIT,
  );
  const timeoutMs = clampPositiveInteger(
    options.timeoutMs ?? options.timeout ?? EXACT_DEFAULT_TIMEOUT_MS,
    'timeout',
    EXACT_MAX_TIMEOUT_MS,
  );
  const maxBytes = clampPositiveInteger(
    options.maxBytes ?? options.byteCap ?? options.maxResponseBytes ?? EXACT_DEFAULT_MAX_BYTES,
    'byte cap',
    EXACT_MAX_BYTES,
  );
  return { maxResults, timeoutMs, maxBytes };
}

function resolveExactScopes(input: {
  current: RepositoryContext;
  target: RepositoryContext;
  allLinks: ReturnType<typeof resolveWorkspaceLinks>;
  options: ExactSearchOptions;
  nestedLinkedRoots: string[];
}): ExactScope[] {
  const { current, target, allLinks, options, nestedLinkedRoots } = input;
  const includeLinked = options.includeLinkedCode === true;

  if (options.workspace) {
    if (!includeLinked) {
      throw new Error('--workspace requires --include-linked-code for exact search');
    }
    const selected = resolveRepositoryContext(options.workspace, {
      projectRoot: current.projectRoot,
      require: { mode: 'read', corpus: 'codebase' },
    });
    if (selected.relation !== 'linked') {
      throw new Error('--workspace must select a linked repository, not the current repository');
    }
    if (options.repo && !sameRepository(selected, target)) {
      throw new Error('--repo and --workspace select different repositories');
    }
    return [{
      context: selected,
      order: 0,
      excludedNestedRoots: nestedLinkedRootsFor(selected),
    }];
  }

  if (target.relation === 'linked') {
    if (!includeLinked) {
      throw new Error('linked repository exact search requires --include-linked-code');
    }
    assertRepositoryCapability(target, 'read', 'codebase');
    return [{
      context: target,
      order: 0,
      excludedNestedRoots: nestedLinkedRootsFor(target),
    }];
  }

  // An explicit --repo current (or supplied target binding) scopes to current
  // only. With no explicit target, linked providers are added only after the
  // opt-in and capability checks.
  const scopes: ExactScope[] = [{
    context: current,
    order: 0,
    excludedNestedRoots: nestedLinkedRoots,
  }];
  if (!includeLinked || options.repo || options.targetRepository) return scopes;

  const linked = allLinks
    .filter(link => link.valid && link.share.includes('codebase'))
    .sort((left, right) => compareStrings(left.name, right.name));
  for (const link of linked) {
    const context = resolveRepositoryContext(link.name, {
      projectRoot: current.projectRoot,
      require: { mode: 'read', corpus: 'codebase' },
    });
    scopes.push({
      context,
      order: scopes.length,
      excludedNestedRoots: nestedLinkedRootsFor(context),
    });
  }
  return scopes;
}

function nestedLinkedRootsFor(context: RepositoryContext): string[] {
  const links = resolveWorkspaceLinks(
    context.projectRoot,
    loadWorkspaceConfig(context.projectRoot),
  );
  return links
    .map(link => link.resolvedPath)
    .filter(path => isPathContained(path, context.projectRoot) && path !== context.projectRoot)
    .map(path => toRelativePath(context.projectRoot, path))
    .filter((path): path is string => path !== null);
}

function validateTargetBinding(current: RepositoryContext, target: RepositoryContext): void {
  if (target.relation === 'current'
    && resolve(target.projectRoot) !== resolve(current.projectRoot)) {
    throw new Error('Current repository target does not match the active repository authority');
  }
  if (!isPathContained(target.projectRoot, target.authorityRoot || current.projectRoot)) {
    // A linked target is expected to be outside the current root; authorityRoot
    // is the host root and is the containment boundary for the link config.
    if (target.relation !== 'linked' || resolve(target.authorityRoot) !== resolve(current.projectRoot)) {
      throw new Error('Repository target is not governed by the current repository authority');
    }
  }
  if (target.relation === 'linked') {
    if (resolve(target.authorityRoot) !== resolve(current.projectRoot)) {
      throw new Error('Linked repository authority does not belong to the current repository');
    }
  }
}

function sameRepository(left: RepositoryContext, right: RepositoryContext): boolean {
  if (left.repoId && right.repoId) return left.repoId === right.repoId;
  return resolve(left.projectRoot) === resolve(right.projectRoot);
}

let ripgrepPathPromise: Promise<string> | undefined;

async function resolveRipgrepPath(): Promise<string> {
  // Keep the dependency lazy: an installation omitting platform optional
  // binaries must not break the default indexed search, which never uses exact.
  ripgrepPathPromise ??= import('@vscode/ripgrep').then(module => module.rgPath);
  return ripgrepPathPromise;
}

async function runExactRipgrep(options: ExactRipgrepOptions): Promise<ExactRipgrepOutcome> {
  const command = await resolveRipgrepPath();
  const gitIgnoreFile = resolve(options.root, '.gitignore');
  const maestroIgnoreFile = resolve(options.root, '.maestroignore');
  const args = buildExactRipgrepArgs({
    root: options.root,
    query: options.query,
    // cwd is the governed root, so keep ignore-file argv relative as well.
    ...(existsSync(gitIgnoreFile) ? { gitIgnoreFile: '.gitignore' } : {}),
    ...(existsSync(maestroIgnoreFile) ? { maestroIgnoreFile: '.maestroignore' } : {}),
    excludedNestedRoots: options.excludedNestedRoots,
  });

  return new Promise<ExactRipgrepOutcome>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: options.root,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    const results: ExactSearchResult[] = [];
    let stdoutBuffer = Buffer.alloc(0);
    let bytesUsed = 0;
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let terminated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (options.signal && abortHandler) {
        options.signal.removeEventListener('abort', abortHandler);
        abortHandler = undefined;
      }
      if (error) rejectPromise(error);
      else resolvePromise({
        results: results.slice(0, options.limit),
        truncated,
        timedOut,
        bytesUsed,
      });
    };

    const terminate = (reason: 'result' | 'bytes' | 'timeout' | 'abort'): void => {
      if (terminated || settled) return;
      terminated = true;
      truncated = true;
      timedOut ||= reason === 'timeout';
      try {
        child.kill();
      } catch {
        // The close event still settles the bounded pass.
      }
    };

    const consumeLines = (): void => {
      while (!terminated) {
        const newline = stdoutBuffer.indexOf(0x0a);
        if (newline < 0) return;
        const raw = stdoutBuffer.subarray(0, newline);
        stdoutBuffer = stdoutBuffer.subarray(newline + 1);
        const parsed = parseExactRipgrepJsonLine(
          raw.toString('utf8'),
          options.root,
          {
            ...(options.workspace ? { workspace: options.workspace } : {}),
            ...(options.workspaceFence ? { workspaceFence: options.workspaceFence } : {}),
          },
        );
        for (const result of parsed) {
          results.push(result);
          if (results.length > options.limit) {
            results.length = options.limit;
            terminate('result');
            return;
          }
        }
      }
    };

    const onData = (chunk: unknown): void => {
      if (settled || terminated) return;
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk), 'utf8');
      const remaining = options.maxBytes - bytesUsed;
      if (remaining <= 0) {
        terminate('bytes');
        return;
      }
      const accepted = bytes.length <= remaining ? bytes : bytes.subarray(0, remaining);
      bytesUsed += accepted.byteLength;
      if (accepted.length > 0) {
        stdoutBuffer = stdoutBuffer.length === 0
          ? Buffer.from(accepted)
          : Buffer.concat([stdoutBuffer, accepted]);
        consumeLines();
      }
      if (bytes.length > accepted.length) terminate('bytes');
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: unknown) => {
      if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      // A kill caused by a bounded result/byte/timeout stop may report a
      // platform-specific stream error; the bounded close path is authoritative.
      if (terminated) return;
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      if (!terminated && stdoutBuffer.length > 0) {
        const parsed = parseExactRipgrepJsonLine(
          stdoutBuffer.toString('utf8'),
          options.root,
          {
            ...(options.workspace ? { workspace: options.workspace } : {}),
            ...(options.workspaceFence ? { workspaceFence: options.workspaceFence } : {}),
          },
        );
        for (const result of parsed) {
          results.push(result);
          if (results.length > options.limit) {
            results.length = options.limit;
            truncated = true;
            break;
          }
        }
      }
      if (code === 0 || code === 1 || terminated) {
        finish();
      } else {
        const detail = stderr.trim();
        finish(new Error(`Exact ripgrep failed with exit code ${code}${detail ? `: ${detail}` : ''}`));
      }
    });

    const timeout = Math.max(1, Math.trunc(options.timeoutMs));
    timer = setTimeout(() => terminate('timeout'), timeout);
    if (options.signal) {
      if (options.signal.aborted) terminate('abort');
      else {
        abortHandler = () => terminate('abort');
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }
  });
}

function validateQuery(query: string): void {
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('Exact search query must not be empty');
  }
  if (query.includes('\u0000')) {
    throw new Error('Exact search query must not contain NUL characters');
  }
}

function clampPositiveInteger(value: number | string, label: string, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`Exact search ${label} must be a positive integer`);
  }
  return Math.min(numeric, max);
}

function safeRelativeResultPath(root: string, rawPath: string): string | null {
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isPathContained(absolutePath, root)) return null;
  // Ripgrep does not follow links by default, but re-check the emitted path so
  // a raced symlink cannot turn a governed result into an external disclosure.
  try {
    const stat = lstatSync(absolutePath);
    const canonical = realpathSync(absolutePath);
    if (stat.isSymbolicLink() && !isPathContained(canonical, root)) return null;
    if (!isPathContained(canonical, root)) return null;
  } catch {
    // A file may disappear or become unreadable after ripgrep emits its event;
    // fail closed instead of returning an unverifiable occurrence.
    return null;
  }
  return toRelativePath(root, absolutePath);
}

function toRelativePath(root: string, path: string): string | null {
  const rel = relative(resolve(root), resolve(path)).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel;
}

function columnAtUtf8ByteOffset(value: string, byteOffset: number): number {
  const bytes = Buffer.from(value, 'utf8');
  const bounded = Math.max(0, Math.min(Math.trunc(byteOffset), bytes.length));
  const prefix = bytes.subarray(0, bounded).toString('utf8');
  // Columns are one-based Unicode scalar positions, which keeps CJK and other
  // non-ASCII source coordinates stable across Windows/Linux/macOS.
  return Array.from(prefix.replace(/\r$/, '')).length + 1;
}

function trimLineEnding(value: string): string {
  return value.replace(/\r?\n$/, '').replace(/\r$/, '');
}

function truncatePreview(value: string): string {
  if (value.length <= EXACT_PREVIEW_MAX_CHARS) return value;
  return `${value.slice(0, EXACT_PREVIEW_MAX_CHARS - 1)}…`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Native lifecycle fencing intentionally performs multiple bound helper round-trips.
// Allow realistic loaded/Windows CI latency without weakening any assertion.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

import { registerKnowhowCommand } from '../../commands/knowhow.js';
import { initializeRepositoryIdentity } from '../../repository/context.js';
import {
  normalizeKnowhowReplayPayload,
  resolveKnowhowFilename,
} from '../../utils/frontmatter.js';
import {
  createKnowhowLifecycleSnapshot,
  getKnowhowEvolutionChain,
  recoverKnowhowLifecycleIntent,
  resolveLifecyclePath,
  restoreKnowhowLifecycleSnapshot,
  sealKnowhowLifecycleSnapshot,
  supersedeKnowhowEntry,
  type KnowhowRestoreIntent,
  type KnowhowRestoreReceipt,
} from '../knowhow-lifecycle.js';
import * as lifecycleAsync from '../knowhow-lifecycle-async.js';
import { handler } from '../store-knowhow.js';

const OLD_STEM = 'tip-20260723-old-rule';
const NEW_STEM = 'tip-20260723-new-rule';
const THIRD_STEM = 'tip-20260723-third-rule';
const OLD_ID = `knowhow-${OLD_STEM}`;
const NEW_ID = `knowhow-${NEW_STEM}`;
const THIRD_ID = `knowhow-${THIRD_STEM}`;

describe('knowhow replay-safe lifecycle', () => {
  let root: string;
  const externalRoots: string[] = [];
  let previousRoot: string | undefined;
  let previousExitCode: number | string | null | undefined;
  let repoId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-knowhow-lifecycle-'));
    previousRoot = process.env.MAESTRO_PROJECT_ROOT;
    previousExitCode = process.exitCode;
    process.env.MAESTRO_PROJECT_ROOT = root;
    process.exitCode = undefined;
    repoId = initializeRepositoryIdentity(root, { repoName: 'Lifecycle test' }).repo_id;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T01:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (previousRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
    else process.env.MAESTRO_PROJECT_ROOT = previousRoot;
    process.exitCode = previousExitCode;
    rmSync(root, { recursive: true, force: true });
    for (const externalRoot of externalRoots.splice(0)) {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  function knowhowDir(): string {
    return join(root, '.workflow', 'knowhow');
  }

  function pathFor(stem: string): string {
    const prefix = stem.slice(0, 3).toUpperCase();
    return join(knowhowDir(), `${prefix}${stem.slice(3)}.md`);
  }

  function lifecycleLockPath(): string {
    return join(knowhowDir(), '.lifecycle.lock');
  }

  function writeLifecycleLock(pid: number, token: string, acquiredAt = Date.now()): Buffer {
    mkdirSync(knowhowDir(), { recursive: true });
    const bytes = Buffer.from(JSON.stringify({
      schema_version: 'knowhow-lifecycle-lock/1.0',
      token,
      pid,
      acquiredAt,
    }), 'utf8');
    writeFileSync(lifecycleLockPath(), bytes);
    return bytes;
  }

  function advanceLifecycleLockClock(): void {
    vi.spyOn(Atomics, 'wait').mockImplementation((_array, _index, _value, timeout) => {
      vi.setSystemTime(new Date(Date.now() + Number(timeout ?? 0)));
      return 'timed-out';
    });
  }

  async function add(stem: string, overrides: Record<string, unknown> = {}) {
    return handler({
      operation: 'add',
      id: stem,
      type: 'tip',
      title: stem,
      description: 'stable description',
      category: 'coding',
      keywords: ['beta', 'alpha'],
      tags: ['two', 'one'],
      body: 'stable body',
      ...overrides,
    });
  }

  async function seedPair(): Promise<void> {
    expect((await add(OLD_STEM)).success).toBe(true);
    expect((await add(NEW_STEM)).success).toBe(true);
  }

  function sha256(value: string | Buffer): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
  }

  function stableJson(value: unknown): string {
    const normalize = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(normalize);
      if (item && typeof item === 'object') {
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, normalize(child)]),
        );
      }
      return item;
    };
    return JSON.stringify(normalize(value));
  }

  function restoreOutcomeHash(
    receipt: Pick<KnowhowRestoreReceipt, 'status' | 'targets' | 'conflict'>,
  ): string {
    return sha256(stableJson({
      status: receipt.status,
      targets: receipt.targets.map(target => ({
        path: target.path,
        restoreHash: target.restoreHash,
        completed: target.completed,
      })),
      conflict: receipt.conflict,
    }));
  }

  function bindRestoreRequestHash(intent: KnowhowRestoreIntent): KnowhowRestoreIntent {
    intent.requestHash = sha256(stableJson({
      requestId: intent.requestId,
      operation: intent.operation,
      subject: intent.subject,
      claimedRun: intent.claimedRun,
      targets: intent.targets.map(target => ({
        path: target.path,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        restoreHash: target.restoreHash,
      })),
    }));
    return intent;
  }

  function contentHash(path: string): string | null {
    return existsSync(path) ? sha256(readFileSync(path)) : null;
  }

  function treeState(path: string, base = path): Array<{
    path: string;
    type: 'directory' | 'file';
    mtimeMs: number;
    bytes?: string;
  }> {
    if (!existsSync(path)) return [];
    const state: ReturnType<typeof treeState> = [];
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      const stat = lstatSync(child);
      const itemPath = relative(base, child).replaceAll('\\', '/');
      if (stat.isDirectory()) {
        state.push({ path: itemPath, type: 'directory', mtimeMs: stat.mtimeMs });
        state.push(...treeState(child, base));
      } else {
        state.push({
          path: itemPath,
          type: 'file',
          mtimeMs: stat.mtimeMs,
          bytes: readFileSync(child).toString('base64'),
        });
      }
    }
    return state;
  }

  function tryCreateSymlink(
    target: string,
    path: string,
    type: 'file' | 'dir' | 'junction',
  ): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        return false;
      }
      throw error;
    }
  }

  it('normalizes only caller-owned fields with fixed set and newline semantics', () => {
    const first = normalizeKnowhowReplayPayload({
      type: 'tip',
      category: undefined,
      title: 'T',
      keywords: [' b ', 'a', 'a'],
      tags: ['z', ' y ', 'z'],
      body: 'line 1\r\nline 2\r\n\r\n',
      explicitId: 'TIP-20260723-X',
      created: 'date-a',
      updated: 'date-b',
      status: 'deprecated',
      indexScore: 42,
    });
    const second = normalizeKnowhowReplayPayload({
      type: 'tip',
      category: null,
      title: 'T',
      keywords: ['a', 'b'],
      tags: ['y', 'z'],
      body: 'line 1\nline 2\n',
      explicitId: 'tip-20260723-x',
      created: 'other',
      lifecycleStatus: 'deprecated',
    });

    expect(first).toEqual(second);
    expect(JSON.parse(first.canonical)).toEqual({
      type: 'tip',
      title: 'T',
      content: 'line 1\nline 2\n',
      keywords: ['a', 'b', 'y', 'z'],
      category: null,
      sourceRef: null,
      relatedPaths: null,
      appliesToRepoIds: null,
      language: null,
      decisionState: null,
      lifecycleStatus: 'deprecated',
      tool: false,
      explicitId: 'tip-20260723-x',
    });
  });

  it('resolves explicit ids independently of title and clock', () => {
    vi.setSystemTime(new Date('2027-12-31T23:59:59.000Z'));
    expect(resolveKnowhowFilename('recipe', 'ignored', 'rcp-20260723-stable-entry')).toEqual({
      id: 'knowhow-rcp-20260723-stable-entry',
      filename: 'RCP-20260723-stable-entry.md',
      explicitId: 'rcp-20260723-stable-entry',
    });
  });

  it('preserves created, bytes, size and mtime across a later-date replay', async () => {
    const first = await add(OLD_STEM);
    expect(first.success).toBe(true);
    expect(first.result).toMatchObject({
      schema_version: 'knowhow-add-result/1.0',
      id: OLD_ID,
      filename: 'TIP-20260723-old-rule.md',
      path: 'knowhow/TIP-20260723-old-rule.md',
      created: '2026-07-23T01:00:00.000Z',
      replayed: false,
    });
    const path = pathFor(OLD_STEM);
    const before = readFileSync(path);
    const beforeStat = statSync(path);

    vi.setSystemTime(new Date('2026-08-24T02:00:00.000Z'));
    const replay = await add(OLD_STEM, {
      keywords: ['alpha', 'beta', 'alpha'],
      tags: ['one', 'two', 'one'],
      body: 'stable body\r\n',
    });
    expect(replay.success).toBe(true);
    expect(replay.result).toMatchObject({
      created: '2026-07-23T01:00:00.000Z',
      replayed: true,
    });
    expect(readFileSync(path)).toEqual(before);
    const afterStat = statSync(path);
    expect(afterStat.size).toBe(beforeStat.size);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it.each([
    ['type', { type: 'recipe' }],
    ['category', { category: 'arch' }],
    ['title', { title: 'different title' }],
    ['keywords', { keywords: ['different'] }],
    ['tags', { tags: ['different'] }],
    ['body', { body: 'different body' }],
    ['sourceRef', { sourceRef: 'issue:42' }],
    ['relatedPaths', { relatedPaths: ['src/other.ts'] }],
    ['appliesToRepoIds', { appliesToRepoIds: ['__CURRENT_REPO_ID__'] }],
    ['language', { language: 'typescript' }],
    ['tool', { tool: true }],
  ])('fails closed for divergent caller field %s', async (_field, override) => {
    await add(OLD_STEM);
    const path = pathFor(OLD_STEM);
    const before = readFileSync(path);
    const listing = readdirSync(knowhowDir()).sort();
    const resolvedOverride = 'appliesToRepoIds' in override
      ? { ...override, appliesToRepoIds: [repoId] }
      : override;
    const result = await add(OLD_STEM, resolvedOverride);
    expect(result.success).toBe(false);
    expect(result.error).toContain('CALLER_PAYLOAD_CONFLICT');
    expect(readFileSync(path)).toEqual(before);
    expect(readdirSync(knowhowDir()).sort()).toEqual(listing);
  });

  it('ignores server-owned metadata without rewriting it during replay', async () => {
    await add(OLD_STEM);
    const path = pathFor(OLD_STEM);
    const changed = readFileSync(path, 'utf8')
      .replace('created: 2026-07-23T01:00:00.000Z', 'created: 2020-01-01T00:00:00.000Z')
      .replace('---\n\n', 'updated: 2030-01-01T00:00:00.000Z\nindexRank: 7\n---\n\n');
    writeFileSync(path, changed, 'utf8');
    const before = readFileSync(path);

    const result = await add(OLD_STEM);
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      replayed: true,
      created: '2020-01-01T00:00:00.000Z',
    });
    expect(readFileSync(path)).toEqual(before);
  });

  it('enforces the CLI body/body-file XOR before creating files', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const invoke = async (...args: string[]) => {
      process.exitCode = undefined;
      const program = new Command();
      registerKnowhowCommand(program);
      await program.parseAsync(['node', 'maestro', 'knowhow', 'add', ...args]);
      return process.exitCode;
    };
    expect(await invoke('--type', 'tip', '--title', 'none')).toBe(1);
    expect(existsSync(knowhowDir())).toBe(false);
    expect(await invoke(
      '--type', 'tip', '--title', 'both', '--body', 'inline',
      '--body-file', join(root, 'missing.md'),
    )).toBe(1);
    expect(existsSync(knowhowDir())).toBe(false);

    expect(await invoke(
      '--type', 'tip', '--id', OLD_STEM, '--title', 'inline', '--body', 'inline',
    )).toBeUndefined();
    writeFileSync(join(root, 'body.md'), 'from file', 'utf8');
    expect(await invoke(
      '--type', 'tip', '--id', NEW_STEM, '--title', 'file',
      '--body-file', join(root, 'body.md'),
    )).toBeUndefined();
    expect(readdirSync(knowhowDir()).filter(name => name.endsWith('.md'))).toHaveLength(2);
  });

  it('replays an established pair without changing either document', async () => {
    await seedPair();
    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID)).toMatchObject({
      success: true,
      replayed: false,
    });
    const beforeOld = readFileSync(pathFor(OLD_STEM));
    const beforeNew = readFileSync(pathFor(NEW_STEM));

    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID)).toMatchObject({
      success: true,
      replayed: true,
    });
    expect(readFileSync(pathFor(OLD_STEM))).toEqual(beforeOld);
    expect(readFileSync(pathFor(NEW_STEM))).toEqual(beforeNew);
    expect(existsSync(join(knowhowDir(), '.lifecycle.intent.json'))).toBe(false);
  });

  it('does not reclaim an aged lock owned by a live PID', () => {
    advanceLifecycleLockClock();
    const lockPath = lifecycleLockPath();
    const bytes = writeLifecycleLock(
      process.pid,
      'aged-live-owner-token',
      Date.now() - 120_000,
    );
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockPath, old, old);

    const result = recoverKnowhowLifecycleIntent(root);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('BUSY'),
    });
    expect(readFileSync(lockPath)).toEqual(bytes);
  });

  it('treats EPERM as live-or-unknown and reclaims only ESRCH', () => {
    advanceLifecycleLockClock();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    const lockPath = lifecycleLockPath();
    const epermBytes = writeLifecycleLock(424_241, 'eperm-owner-token');

    expect(recoverKnowhowLifecycleIntent(root)).toMatchObject({
      success: false,
      error: expect.stringContaining('BUSY'),
    });
    expect(readFileSync(lockPath)).toEqual(epermBytes);

    rmSync(lockPath);
    writeLifecycleLock(424_242, 'dead-owner-token');
    kill.mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });

    expect(recoverKnowhowLifecycleIntent(root)).toEqual({
      success: true,
      replayed: false,
    });
    expect(existsSync(lockPath)).toBe(false);
  });

  it('preserves same-PID bound lock replacement', () => {
    advanceLifecycleLockClock();
    const lockPath = lifecycleLockPath();
    writeLifecycleLock(424_242, 'dead-owner-token');
    const kill = vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (pid === 424_242) {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }
      return true;
    });
    let reclaimReplacement = Buffer.alloc(0);

    const reclaim = recoverKnowhowLifecycleIntent(root, {
      beforeLockDelete: phase => {
        if (phase !== 'reclaim') return;
        rmSync(lockPath);
        reclaimReplacement = writeLifecycleLock(
          process.pid,
          'same-pid-reclaim-replacement-token',
        );
      },
    });

    expect(reclaim).toMatchObject({
      success: false,
      error: expect.stringContaining('BUSY'),
    });
    expect(readFileSync(lockPath)).toEqual(reclaimReplacement);

    rmSync(lockPath);
    kill.mockImplementation(() => true);
    let releaseReplacement = Buffer.alloc(0);
    const release = recoverKnowhowLifecycleIntent(root, {
      beforeLockDelete: phase => {
        if (phase !== 'release') return;
        rmSync(lockPath);
        releaseReplacement = writeLifecycleLock(
          process.pid,
          'same-pid-release-replacement-token',
        );
      },
    });

    expect(release).toEqual({ success: true, replayed: false });
    expect(readFileSync(lockPath)).toEqual(releaseReplacement);
  });

  it('acquires and releases exact bound lock generation', () => {
    const lockPath = lifecycleLockPath();
    const phases: string[] = [];
    expect(recoverKnowhowLifecycleIntent(root, {
      beforeLockDelete: phase => phases.push(phase),
    })).toEqual({ success: true, replayed: false });
    expect(phases).toEqual(['release']);
    expect(existsSync(lockPath)).toBe(false);

    const activeBytes = writeLifecycleLock(process.pid, 'active-bound-owner');
    expect(recoverKnowhowLifecycleIntent(root)).toMatchObject({
      success: false,
      error: expect.stringContaining('BUSY'),
    });
    expect(readFileSync(lockPath)).toEqual(activeBytes);
    rmSync(lockPath);

    let replacement = Buffer.alloc(0);
    expect(recoverKnowhowLifecycleIntent(root, {
      beforeLockDelete: phase => {
        if (phase !== 'release') return;
        rmSync(lockPath);
        replacement = writeLifecycleLock(process.pid, 'exact-release-replacement');
      },
    })).toEqual({ success: true, replayed: false });
    expect(readFileSync(lockPath)).toEqual(replacement);
  });

  it('keeps CLI lifecycle commands synchronous when the worker is unavailable', async () => {
    await seedPair();
    const worker = vi.spyOn(lifecycleAsync, 'runKnowhowLifecycleAsync')
      .mockRejectedValue(new Error('worker unavailable'));
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invoke = async (...args: string[]): Promise<Record<string, unknown>> => {
      process.exitCode = undefined;
      const program = new Command();
      registerKnowhowCommand(program);
      await program.parseAsync(['node', 'maestro', 'knowhow', ...args]);
      expect(process.exitCode).toBeUndefined();
      return JSON.parse(output.at(-1) ?? '{}') as Record<string, unknown>;
    };

    expect(await invoke('supersede', OLD_ID, '--by', NEW_ID, '--json')).toMatchObject({
      success: true,
      operation: 'supersede',
      oldId: OLD_ID,
      newId: NEW_ID,
    });
    expect(await invoke('history', OLD_ID, '--json')).toMatchObject({
      schema_version: 'knowhow-history-result/1.0',
      operation: 'history',
      id: OLD_ID,
      entries: [
        { id: OLD_ID },
        { id: NEW_ID },
      ],
    });
    expect(await invoke('recover', '--json')).toMatchObject({
      success: true,
      replayed: false,
    });
    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects an unbound supersede intent without touching targets', async () => {
    await seedPair();
    const packagePath = join(root, 'package.json');
    writeFileSync(packagePath, '{"name":"protected"}\n', 'utf8');
    const crashed = supersedeKnowhowEntry(root, OLD_ID, NEW_ID, {
      afterTarget: (_path, completed) => {
        if (completed === 1) throw new Error('injected crash');
      },
    });
    expect(crashed.success).toBe(false);
    const intentPath = join(knowhowDir(), '.lifecycle.intent.json');
    const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as {
      targets: Array<{
        id: string;
        path: string;
        beforeHash: string | null;
        afterHash: string | null;
        beforeBase64: string | null;
        afterBase64: string | null;
      }>;
    };
    const beforePackage = readFileSync(packagePath);
    const afterPackage = Buffer.from('{"name":"overwritten"}\n', 'utf8');
    intent.targets[0] = {
      ...intent.targets[0],
      path: 'package.json',
      beforeHash: sha256(beforePackage),
      afterHash: sha256(afterPackage),
      beforeBase64: beforePackage.toString('base64'),
      afterBase64: afterPackage.toString('base64'),
    };
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    const protectedPaths = [packagePath, pathFor(OLD_STEM), pathFor(NEW_STEM), intentPath];
    const before = protectedPaths.map(path => ({
      path,
      bytes: readFileSync(path),
      mtimeMs: statSync(path).mtimeMs,
    }));

    expect(recoverKnowhowLifecycleIntent(root)).toMatchObject({
      success: false,
      code: 'KNOWHOW_LIFECYCLE_CONFLICT',
    });
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
    const recoverProgram = new Command();
    registerKnowhowCommand(recoverProgram);
    await recoverProgram.parseAsync(['node', 'maestro', 'knowhow', 'recover', '--json']);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
      success: false,
      code: 'KNOWHOW_LIFECYCLE_CONFLICT',
    });
    for (const item of before) {
      expect(readFileSync(item.path)).toEqual(item.bytes);
      expect(statSync(item.path).mtimeMs).toBe(item.mtimeMs);
    }
    expect(existsSync(join(knowhowDir(), '.lifecycle.lock'))).toBe(false);
  });

  it('keeps history read-only when recovery is pending', async () => {
    await seedPair();
    const crashed = supersedeKnowhowEntry(root, OLD_ID, NEW_ID, {
      afterTarget: (_path, completed) => {
        if (completed === 1) throw new Error('injected crash');
      },
    });
    expect(crashed.success).toBe(false);
    const intentPath = join(knowhowDir(), '.lifecycle.intent.json');
    expect(existsSync(intentPath)).toBe(true);
    const before = treeState(knowhowDir());
    const beforeDirectoryMtime = statSync(knowhowDir()).mtimeMs;
    const expectReadOnlyState = () => {
      expect(treeState(knowhowDir())).toEqual(before);
      expect(statSync(knowhowDir()).mtimeMs).toBe(beforeDirectoryMtime);
      expect(existsSync(join(knowhowDir(), '.lifecycle.lock'))).toBe(false);
    };

    expect(() => getKnowhowEvolutionChain(root, OLD_ID)).toThrow(
      /KNOWHOW_LIFECYCLE_RECOVERY_REQUIRED/,
    );
    expectReadOnlyState();

    const errors: string[] = [];
    const output: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => errors.push(String(value)));
    vi.spyOn(console, 'log').mockImplementation(value => output.push(String(value)));
    const historyProgram = new Command();
    registerKnowhowCommand(historyProgram);
    await historyProgram.parseAsync([
      'node', 'maestro', 'knowhow', 'history', OLD_ID, '--json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(errors.at(-1)).toContain('KNOWHOW_LIFECYCLE_RECOVERY_REQUIRED');
    expectReadOnlyState();

    process.exitCode = undefined;
    const toolHistory = await handler({ operation: 'history', id: OLD_ID });
    expect(toolHistory).toMatchObject({ success: false });
    expect(toolHistory.error).toContain('KNOWHOW_LIFECYCLE_RECOVERY_REQUIRED');
    expectReadOnlyState();

    const recoverProgram = new Command();
    registerKnowhowCommand(recoverProgram);
    await recoverProgram.parseAsync(['node', 'maestro', 'knowhow', 'recover', '--json']);
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
      success: true,
      replayed: true,
    });
    expect(existsSync(intentPath)).toBe(false);

    const readableProgram = new Command();
    registerKnowhowCommand(readableProgram);
    await readableProgram.parseAsync([
      'node', 'maestro', 'knowhow', 'history', OLD_ID, '--json',
    ]);
    expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
      schema_version: 'knowhow-history-result/1.0',
      operation: 'history',
      id: OLD_ID,
      entries: [
        { id: OLD_ID, deprecated: true, current: false },
        { id: NEW_ID, deprecated: false, current: true },
      ],
    });
  });

  it('rejects self links, cycles and a different successor without writing', async () => {
    await seedPair();
    await add(THIRD_STEM);
    const original = new Map(
      [OLD_STEM, NEW_STEM, THIRD_STEM].map(stem => [stem, readFileSync(pathFor(stem))]),
    );
    expect(supersedeKnowhowEntry(root, OLD_ID, OLD_ID).success).toBe(false);
    for (const [stem, bytes] of original) expect(readFileSync(pathFor(stem))).toEqual(bytes);

    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID).success).toBe(true);
    const established = new Map(
      [OLD_STEM, NEW_STEM, THIRD_STEM].map(stem => [stem, readFileSync(pathFor(stem))]),
    );
    expect(supersedeKnowhowEntry(root, NEW_ID, OLD_ID).success).toBe(false);
    expect(supersedeKnowhowEntry(root, OLD_ID, THIRD_ID).success).toBe(false);
    for (const [stem, bytes] of established) expect(readFileSync(pathFor(stem))).toEqual(bytes);

    expect(supersedeKnowhowEntry(root, NEW_ID, THIRD_ID).success).toBe(true);
    const threeNode = new Map(
      [OLD_STEM, NEW_STEM, THIRD_STEM].map(stem => [stem, readFileSync(pathFor(stem))]),
    );
    expect(supersedeKnowhowEntry(root, THIRD_ID, OLD_ID).success).toBe(false);
    for (const [stem, bytes] of threeNode) expect(readFileSync(pathFor(stem))).toEqual(bytes);
  });

  function prepareSnapshot(name = 'migration.json'): string {
    const extraPath = join(root, 'src', 'fixture.json');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(extraPath, 'before fixture', 'utf8');
    const snapshotPath = join(root, '.workflow', 'knowhow', '.snapshots', name);
    createKnowhowLifecycleSnapshot(root, {
      oldId: OLD_ID,
      newId: NEW_ID,
      newPath: 'knowhow/TIP-20260723-new-rule.md',
      includeRelative: ['src/fixture.json'],
      out: snapshotPath,
    });
    return snapshotPath;
  }

  async function prepareSealedMigration(name = 'migration.json'): Promise<string> {
    await add(OLD_STEM);
    const snapshotPath = prepareSnapshot(name);
    await add(NEW_STEM);
    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID).success).toBe(true);
    writeFileSync(join(root, 'src', 'fixture.json'), 'after fixture', 'utf8');
    sealKnowhowLifecycleSnapshot(root, snapshotPath);
    return snapshotPath;
  }

  it('quarantines only the bound delete generation', async () => {
    const snapshotPath = await prepareSealedMigration('bound-delete.json');
    let replacementPath = '';
    let quarantinePath = '';
    const replacement = 'writer replacement after exact quarantine';

    const result = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      afterTargetQuarantine: (path, quarantine) => {
        replacementPath = join(root, path);
        quarantinePath = join(root, quarantine.quarantineRelativePath);
        expect(existsSync(quarantinePath)).toBe(true);
        writeFileSync(replacementPath, replacement, 'utf8');
      },
    });

    expect(result).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
      error: expect.stringContaining('Restore output hash mismatch'),
    });
    expect(readFileSync(replacementPath, 'utf8')).toBe(replacement);
    expect(existsSync(quarantinePath)).toBe(false);
  });

  it('recovers only exact bound quarantine', async () => {
    const snapshotPath = await prepareSealedMigration('exact-quarantine.json');
    let quarantinePath = '';
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      afterTargetQuarantine: (_path, quarantine) => {
        quarantinePath = join(root, quarantine.quarantineRelativePath);
        throw new Error('crash after durable exact quarantine');
      },
    })).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
    });
    expect(existsSync(quarantinePath)).toBe(true);

    const intentPath = `${snapshotPath}.restore.intent.json`;
    const exactIntentBytes = readFileSync(intentPath);
    const mismatched = JSON.parse(exactIntentBytes.toString('utf8')) as KnowhowRestoreIntent;
    const quarantined = mismatched.targets.find(target => target.quarantine);
    expect(quarantined?.quarantine).toBeDefined();
    quarantined!.quarantine = {
      ...quarantined!.quarantine!,
      ownerGeneration: 'mismatched-owner-generation',
    };
    writeFileSync(intentPath, `${JSON.stringify(mismatched, null, 2)}\n`, 'utf8');

    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
      error: expect.stringContaining('Invalid or unbound restore quarantine'),
    });
    expect(existsSync(quarantinePath)).toBe(true);

    writeFileSync(intentPath, exactIntentBytes);
    const recovered = restoreKnowhowLifecycleSnapshot(root, snapshotPath);
    expect(recovered, JSON.stringify(recovered, null, 2)).toMatchObject({
      success: true,
      replayed: true,
    });
    expect(existsSync(quarantinePath)).toBe(false);
  });

  it('fails lifecycle before access when helper is unavailable', async () => {
    const sentinelPath = join(root, 'target-sentinel.txt');
    writeFileSync(sentinelPath, 'unobserved target bytes', 'utf8');
    const before = treeState(root);
    vi.resetModules();
    vi.doMock('../../utils/lifecycle-fs-helper.js', async () => {
      const actual = await vi.importActual<
        typeof import('../../utils/lifecycle-fs-helper.js')
      >('../../utils/lifecycle-fs-helper.js');
      return {
        ...actual,
        withVerifiedLifecycleFsHelper: () => {
          throw new actual.LifecycleFsHelperError(
            'UNSUPPORTED',
            'injected unavailable selected helper',
          );
        },
      };
    });
    try {
      const isolated = await import('../knowhow-lifecycle.js');
      expect(isolated.recoverKnowhowLifecycleIntent(root)).toMatchObject({
        success: false,
        error: expect.stringContaining('injected unavailable selected helper'),
      });
      expect(treeState(root)).toEqual(before);
    } finally {
      vi.doUnmock('../../utils/lifecycle-fs-helper.js');
      vi.resetModules();
    }
  });

  it('uses native bound lifecycle I/O exclusively', async () => {
    const externalRoot = mkdtempSync(join(tmpdir(), 'maestro-knowhow-external-'));
    externalRoots.push(externalRoot);
    const sentinelPath = join(externalRoot, 'sentinel.txt');
    writeFileSync(sentinelPath, 'external sentinel', 'utf8');
    const sentinelBefore = {
      bytes: readFileSync(sentinelPath),
      mtimeMs: statSync(sentinelPath).mtimeMs,
    };
    const linkPath = join(root, 'external-link');
    const linkCreated = tryCreateSymlink(
      externalRoot,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    if (!linkCreated) {
      expect(process.platform).toBe('win32');
      return;
    }
    const assertSentinelUnchanged = () => {
      expect(readFileSync(sentinelPath)).toEqual(sentinelBefore.bytes);
      expect(statSync(sentinelPath).mtimeMs).toBe(sentinelBefore.mtimeMs);
    };

    await seedPair();
    const pairBefore = new Map([
      [pathFor(OLD_STEM), readFileSync(pathFor(OLD_STEM))],
      [pathFor(NEW_STEM), readFileSync(pathFor(NEW_STEM))],
    ]);
    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID, {
      afterTarget: (_path, completed) => {
        if (completed === 1) throw new Error('injected crash');
      },
    }).success).toBe(false);
    const intentPath = join(knowhowDir(), '.lifecycle.intent.json');
    const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as {
      targets: Array<{ id: string; path: string }>;
    };
    intent.targets[0].path = 'external-link/sentinel.txt';
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    expect(recoverKnowhowLifecycleIntent(root).success).toBe(false);
    assertSentinelUnchanged();
    for (const [path, bytes] of pairBefore) writeFileSync(path, bytes);
    rmSync(intentPath, { force: true });

    expect(() => createKnowhowLifecycleSnapshot(root, {
      oldId: OLD_ID,
      newId: NEW_ID,
      newPath: 'knowhow/TIP-20260723-new-rule.md',
      includeRelative: ['external-link/sentinel.txt'],
      out: join(knowhowDir(), '.snapshots', 'external-create.json'),
    })).toThrow(/Unsafe knowhow lifecycle path/);
    assertSentinelUnchanged();

    const sealSnapshotPath = join(knowhowDir(), '.snapshots', 'external-seal.json');
    createKnowhowLifecycleSnapshot(root, {
      oldId: OLD_ID,
      newId: NEW_ID,
      newPath: 'knowhow/TIP-20260723-new-rule.md',
      out: sealSnapshotPath,
    });
    const sealSnapshot = JSON.parse(readFileSync(sealSnapshotPath, 'utf8')) as {
      targets: Array<{ path: string }>;
    };
    sealSnapshot.targets[0].path = 'external-link/sentinel.txt';
    writeFileSync(sealSnapshotPath, `${JSON.stringify(sealSnapshot, null, 2)}\n`, 'utf8');
    expect(() => sealKnowhowLifecycleSnapshot(root, sealSnapshotPath)).toThrow(
      /UNSAFE_PATH/,
    );
    assertSentinelUnchanged();

    const deleteTargetPath = join(root, 'src', 'delete-target.txt');
    const restoreSnapshotPath = join(knowhowDir(), '.snapshots', 'external-restore.json');
    createKnowhowLifecycleSnapshot(root, {
      oldId: OLD_ID,
      newId: NEW_ID,
      newPath: 'src/delete-target.txt',
      out: restoreSnapshotPath,
    });
    mkdirSync(dirname(deleteTargetPath), { recursive: true });
    writeFileSync(deleteTargetPath, 'created after snapshot', 'utf8');
    sealKnowhowLifecycleSnapshot(root, restoreSnapshotPath);
    const sealedRestoreDocument = readFileSync(restoreSnapshotPath, 'utf8');
    const writeSnapshotPath = join(knowhowDir(), '.snapshots', 'external-restore-write.json');
    const writeSnapshot = JSON.parse(sealedRestoreDocument) as {
      targets: Array<{ path: string; expectedAbsent: boolean }>;
    };
    const writeTarget = writeSnapshot.targets.find(target => !target.expectedAbsent);
    expect(writeTarget).toBeDefined();
    writeTarget!.path = 'external-link/sentinel.txt';
    writeFileSync(writeSnapshotPath, `${JSON.stringify(writeSnapshot, null, 2)}\n`, 'utf8');
    expect(restoreKnowhowLifecycleSnapshot(root, writeSnapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
    });
    assertSentinelUnchanged();

    expect(restoreKnowhowLifecycleSnapshot(
      root,
      join(linkPath, 'sentinel.txt'),
    )).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
    });
    assertSentinelUnchanged();

    const restoreSnapshot = JSON.parse(sealedRestoreDocument) as {
      targets: Array<{ path: string; expectedAbsent: boolean }>;
    };
    const deleteTarget = restoreSnapshot.targets.find(target => target.expectedAbsent);
    expect(deleteTarget).toBeDefined();
    deleteTarget!.path = 'external-link/sentinel.txt';
    writeFileSync(restoreSnapshotPath, `${JSON.stringify(restoreSnapshot, null, 2)}\n`, 'utf8');
    expect(restoreKnowhowLifecycleSnapshot(root, restoreSnapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
    });
    assertSentinelUnchanged();
  });

  it.skipIf(process.platform !== 'win32')(
    'rejects a Windows junction outside projectRoot',
    async () => {
      const externalRoot = mkdtempSync(join(tmpdir(), 'maestro-knowhow-junction-'));
      externalRoots.push(externalRoot);
      writeFileSync(join(externalRoot, 'sentinel.txt'), 'junction sentinel', 'utf8');
      const before = treeState(externalRoot);
      const junctionPath = join(root, 'junction');
      symlinkSync(externalRoot, junctionPath, 'junction');
      const missingTarget = join(junctionPath, 'missing-parent', 'snapshot.json');

      expect(() => resolveLifecyclePath(root, missingTarget, 'write-target')).toThrow(
        /symbolic link or junction component/,
      );
      await add(OLD_STEM);
      expect(() => createKnowhowLifecycleSnapshot(root, {
        oldId: OLD_ID,
        newId: NEW_ID,
        newPath: 'knowhow/TIP-20260723-new-rule.md',
        out: missingTarget,
      })).toThrow(/symbolic link or junction component/);
      expect(treeState(externalRoot)).toEqual(before);
    },
  );

  it('keeps in-root lifecycle paths compatible with mixed separators and Windows casing', async () => {
    await add(OLD_STEM);
    const fixturePath = join(root, 'src', 'fixture.json');
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, 'before fixture', 'utf8');
    const snapshotPath = join(knowhowDir(), '.snapshots', 'mixed-path.json');
    const mixedSnapshotPath = snapshotPath.replaceAll(sep, sep === '\\' ? '/' : '\\');
    createKnowhowLifecycleSnapshot(root, {
      oldId: OLD_ID,
      newId: NEW_ID,
      newPath: 'knowhow\\TIP-20260723-new-rule.md',
      includeRelative: ['src\\fixture.json'],
      out: mixedSnapshotPath,
    });
    await add(NEW_STEM);
    expect(supersedeKnowhowEntry(root, OLD_ID, NEW_ID).success).toBe(true);
    writeFileSync(fixturePath, 'after fixture', 'utf8');

    const equivalentSnapshotPath = process.platform === 'win32'
      ? mixedSnapshotPath.toUpperCase()
      : mixedSnapshotPath;
    sealKnowhowLifecycleSnapshot(root, equivalentSnapshotPath);
    expect(restoreKnowhowLifecycleSnapshot(root, equivalentSnapshotPath).success).toBe(true);
    expect(readFileSync(fixturePath, 'utf8')).toBe('before fixture');
    expect(existsSync(pathFor(NEW_STEM))).toBe(false);
    expect(resolveLifecyclePath(root, pathFor(OLD_STEM), 'existing-file')).toBe(
      realpathSync.native(pathFor(OLD_STEM)),
    );
  });

  it('restores only pending targets after a crash and writes an auditable receipt', async () => {
    await add(OLD_STEM);
    const oldBefore = readFileSync(pathFor(OLD_STEM));
    const snapshotPath = prepareSnapshot();
    await add(NEW_STEM);
    supersedeKnowhowEntry(root, OLD_ID, NEW_ID);
    writeFileSync(join(root, 'src', 'fixture.json'), 'after fixture', 'utf8');
    sealKnowhowLifecycleSnapshot(root, snapshotPath);

    const completedPaths: string[] = [];
    const first = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'run-002',
      afterTarget: (path, completed) => {
        completedPaths.push(path);
        if (completed === 1) throw new Error('restore crash');
      },
    });
    expect(first.success).toBe(false);
    expect(completedPaths).toHaveLength(1);

    const secondPaths: string[] = [];
    const second = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'ignored-on-replay',
      afterTarget: path => secondPaths.push(path),
    });
    expect(second.success).toBe(true);
    expect(second.replayed).toBe(true);
    expect(secondPaths).not.toContain(completedPaths[0]);
    expect(second.receipt).toMatchObject({
      schema_version: 'knowhow-restore-receipt/1.0',
      status: 'completed',
      claimedRun: 'run-002',
    });
    expect(second.receipt?.targets.every(target => target.completed)).toBe(true);
    expect(readFileSync(pathFor(OLD_STEM))).toEqual(oldBefore);
    expect(existsSync(pathFor(NEW_STEM))).toBe(false);
    expect(readFileSync(join(root, 'src', 'fixture.json'), 'utf8')).toBe('before fixture');
  });

  it('reconciles a target written before its completed checkpoint', async () => {
    const snapshotPath = await prepareSealedMigration('before-checkpoint.json');
    const writtenBeforeCrash: string[] = [];
    const first = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'run-before-checkpoint',
      beforeTargetCheckpoint: (path, completed) => {
        writtenBeforeCrash.push(path);
        if (completed === 1) throw new Error('restore before-checkpoint crash');
      },
    });
    expect(first.success).toBe(false);
    expect(writtenBeforeCrash).toHaveLength(1);

    const intentPath = `${snapshotPath}.restore.intent.json`;
    const pendingIntent = JSON.parse(
      readFileSync(intentPath, 'utf8'),
    ) as KnowhowRestoreIntent;
    const interrupted = pendingIntent.targets.find(
      target => target.path === writtenBeforeCrash[0],
    );
    expect(interrupted).toMatchObject({ completed: false });
    expect(contentHash(join(root, interrupted!.path))).toBe(interrupted!.restoreHash);

    const replayWrites: string[] = [];
    const replayCheckpoints: string[] = [];
    const replay = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'must-not-replace-original',
      beforeTargetCheckpoint: path => replayWrites.push(path),
      afterTarget: path => replayCheckpoints.push(path),
    });

    expect(replay).toMatchObject({
      success: true,
      replayed: true,
      receipt: {
        status: 'completed',
        claimedRun: 'run-before-checkpoint',
      },
    });
    expect(replayWrites).toHaveLength(pendingIntent.targets.length - 1);
    expect(replayWrites).not.toContain(interrupted!.path);
    expect(replayCheckpoints).toContain(interrupted!.path);
    expect(replay.receipt?.targets.every(target => target.completed)).toBe(true);
  });

  it('validates restore intent before bound read', async () => {
    const snapshotPath = await prepareSealedMigration('validate-before-read.json');
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      afterTarget: (_path, completed) => {
        if (completed === 1) throw new Error('persist pending restore intent');
      },
    }).success).toBe(false);
    const intentPath = `${snapshotPath}.restore.intent.json`;
    const baseline = JSON.parse(readFileSync(intentPath, 'utf8')) as KnowhowRestoreIntent;
    const targetPaths = baseline.targets.map(target => target.path);
    const targetState = targetPaths.map(path => {
      const absolute = join(root, path);
      return existsSync(absolute)
        ? {
            path,
            bytes: readFileSync(absolute),
            mtimeMs: statSync(absolute).mtimeMs,
          }
        : { path, bytes: null, mtimeMs: null };
    });
    const mutations: Array<Record<string, unknown>> = [
      { ...structuredClone(baseline), extra: true },
      bindRestoreRequestHash({
        ...structuredClone(baseline),
        targets: [...structuredClone(baseline.targets)].reverse(),
      }),
      bindRestoreRequestHash({
        ...structuredClone(baseline),
        targets: baseline.targets.map((target, index) => (
          index === 1 ? { ...target, path: baseline.targets[0].path } : { ...target }
        )),
      }),
      bindRestoreRequestHash({
        ...structuredClone(baseline),
        targets: baseline.targets.map((target, index) => (
          index === 0 ? { ...target, path: `./${target.path}` } : { ...target }
        )),
      }),
      {
        ...structuredClone(baseline),
        status: 'completed',
      },
    ];

    const observedReads: string[] = [];
    vi.resetModules();
    vi.doMock('../../utils/lifecycle-fs-helper.js', async () => {
      const actual = await vi.importActual<
        typeof import('../../utils/lifecycle-fs-helper.js')
      >('../../utils/lifecycle-fs-helper.js');
      return {
        ...actual,
        readLifecycleFileBound: (projectRoot: string, relativePath: string) => {
          observedReads.push(relativePath);
          return actual.readLifecycleFileBound(projectRoot, relativePath);
        },
      };
    });
    try {
      const isolated = await import('../knowhow-lifecycle.js');
      for (const mutation of mutations) {
        const bytes = Buffer.from(`${JSON.stringify(mutation, null, 2)}\n`, 'utf8');
        writeFileSync(intentPath, bytes);
        const intentMtimeMs = statSync(intentPath).mtimeMs;
        observedReads.length = 0;

        expect(isolated.restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
          success: false,
          code: 'KNOWHOW_RESTORE_FAILED',
        });
        expect(observedReads.some(path => targetPaths.includes(path))).toBe(false);
        expect(readFileSync(intentPath)).toEqual(bytes);
        expect(statSync(intentPath).mtimeMs).toBe(intentMtimeMs);
        for (const expected of targetState) {
          const absolute = join(root, expected.path);
          expect(existsSync(absolute)).toBe(expected.bytes !== null);
          if (expected.bytes) {
            expect(readFileSync(absolute)).toEqual(expected.bytes);
            expect(statSync(absolute).mtimeMs).toBe(expected.mtimeMs);
          }
        }
      }
    } finally {
      vi.doUnmock('../../utils/lifecycle-fs-helper.js');
      vi.resetModules();
    }
  });

  it('rejects invalid self-hashed restore state', async () => {
    const snapshotPath = await prepareSealedMigration('invalid-self-hash.json');
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      afterTarget: (_path, completed) => {
        if (completed === 1) throw new Error('persist pending restore intent');
      },
    }).success).toBe(false);
    const intentPath = `${snapshotPath}.restore.intent.json`;
    const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as KnowhowRestoreIntent;
    intent.targets[0] = {
      ...intent.targets[0],
      beforeHash: sha256('forged snapshot bytes'),
      restoreHash: sha256('forged snapshot bytes'),
    };
    bindRestoreRequestHash(intent);
    const bytes = Buffer.from(`${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    writeFileSync(intentPath, bytes);
    const before = intent.targets.map(target => {
      const absolute = join(root, target.path);
      return existsSync(absolute)
        ? { path: absolute, bytes: readFileSync(absolute), mtimeMs: statSync(absolute).mtimeMs }
        : { path: absolute, bytes: null, mtimeMs: null };
    });

    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
      error: 'Restore intent targets do not match snapshot',
    });
    expect(readFileSync(intentPath)).toEqual(bytes);
    for (const expected of before) {
      expect(existsSync(expected.path)).toBe(expected.bytes !== null);
      if (expected.bytes) {
        expect(readFileSync(expected.path)).toEqual(expected.bytes);
        expect(statSync(expected.path).mtimeMs).toBe(expected.mtimeMs);
      }
    }
  });

  it('keeps the CLI restore JSON envelope compatible', async () => {
    const snapshotPath = await prepareSealedMigration('cli-restore.json');
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const program = new Command();
    registerKnowhowCommand(program);

    await program.parseAsync([
      'node',
      'maestro',
      'knowhow',
      'restore',
      '--snapshot',
      snapshotPath,
      '--json',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
      success: true,
      replayed: false,
      intent: {
        operation: 'restore',
        status: 'completed',
      },
      receipt: {
        schema_version: 'knowhow-restore-receipt/1.0',
        operation: 'restore',
        status: 'completed',
      },
    });
  });

  it('preserves a divergent pending target while reconciling restored bytes', async () => {
    const snapshotPath = await prepareSealedMigration('pending-conflict.json');
    let interruptedPath = '';
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      beforeTargetCheckpoint: (path, completed) => {
        interruptedPath = path;
        if (completed === 1) throw new Error('restore before-checkpoint crash');
      },
    }).success).toBe(false);

    const intent = JSON.parse(
      readFileSync(`${snapshotPath}.restore.intent.json`, 'utf8'),
    ) as KnowhowRestoreIntent;
    const divergent = intent.targets.find(target => target.path !== interruptedPath);
    expect(divergent).toBeDefined();
    const divergentPath = join(root, divergent!.path);
    writeFileSync(divergentPath, 'third-party pending content', 'utf8');

    const conflict = restoreKnowhowLifecycleSnapshot(root, snapshotPath);
    expect(conflict).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_CONFLICT',
      intent: {
        status: 'conflict',
        conflict: {
          path: divergent!.path,
          expectedHash: divergent!.afterHash,
          actualHash: sha256('third-party pending content'),
        },
      },
    });
    expect(readFileSync(divergentPath, 'utf8')).toBe('third-party pending content');
    expect(conflict.intent.targets.find(
      target => target.path === interruptedPath,
    )?.completed).toBe(true);
  });

  it('recomputes resultHash from the persisted receipt outcome', async () => {
    const snapshotPath = await prepareSealedMigration('receipt-outcome.json');
    const completed = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'run-receipt-completed',
    });
    expect(completed.success).toBe(true);
    const receiptPath = `${snapshotPath}.restore.receipt.json`;
    const original = JSON.parse(
      readFileSync(receiptPath, 'utf8'),
    ) as KnowhowRestoreReceipt;
    const intent = JSON.parse(
      readFileSync(`${snapshotPath}.restore.intent.json`, 'utf8'),
    ) as KnowhowRestoreIntent;
    expect(original.resultHash).toBe(restoreOutcomeHash(original));
    expect(original).toMatchObject({
      requestId: intent.requestId,
      operation: intent.operation,
      status: intent.status,
      subject: intent.subject,
      claimedRun: intent.claimedRun,
      requestHash: intent.requestHash,
      targets: intent.targets,
    });
    expect(original.conflict).toBe(intent.conflict);

    const mutations: KnowhowRestoreReceipt[] = [
      { ...original, status: 'conflict' },
      {
        ...original,
        targets: original.targets.map((target, index) => (
          index === 0 ? { ...target, completed: false } : { ...target }
        )),
      },
      {
        ...original,
        targets: original.targets.map((target, index) => (
          index === 0
            ? { ...target, restoreHash: sha256('tampered restore hash') }
            : { ...target }
        )),
      },
    ];
    for (const mutation of mutations) {
      writeFileSync(receiptPath, `${JSON.stringify(mutation, null, 2)}\n`, 'utf8');
      expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
        success: false,
        code: 'KNOWHOW_RESTORE_FAILED',
        error: 'Invalid or unbound knowhow restore receipt',
      });
    }
  });

  it('rejects a receipt whose conflict evidence changed without updating resultHash', async () => {
    const snapshotPath = await prepareSealedMigration('receipt-conflict.json');
    let completedPath = '';
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'run-receipt-conflict',
      afterTarget: (path, completed) => {
        completedPath = path;
        if (completed === 1) throw new Error('restore crash');
      },
    }).success).toBe(false);
    writeFileSync(join(root, completedPath), 'third-party completed content', 'utf8');
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_CONFLICT',
    });

    const receiptPath = `${snapshotPath}.restore.receipt.json`;
    const original = JSON.parse(
      readFileSync(receiptPath, 'utf8'),
    ) as KnowhowRestoreReceipt;
    const intent = JSON.parse(
      readFileSync(`${snapshotPath}.restore.intent.json`, 'utf8'),
    ) as KnowhowRestoreIntent;
    expect(original.resultHash).toBe(restoreOutcomeHash(original));
    expect(original).toMatchObject({
      requestId: intent.requestId,
      operation: intent.operation,
      status: intent.status,
      subject: intent.subject,
      claimedRun: intent.claimedRun,
      requestHash: intent.requestHash,
      targets: intent.targets,
      conflict: intent.conflict,
    });

    const mutations: KnowhowRestoreReceipt[] = [
      {
        ...original,
        conflict: { ...original.conflict!, path: `${original.conflict!.path}.tampered` },
      },
      {
        ...original,
        conflict: {
          ...original.conflict!,
          expectedHash: original.conflict!.expectedHash === null
            ? sha256('tampered expected hash')
            : null,
        },
      },
      {
        ...original,
        conflict: {
          ...original.conflict!,
          actualHash: sha256('tampered actual hash'),
        },
      },
    ];
    for (const mutation of mutations) {
      writeFileSync(receiptPath, `${JSON.stringify(mutation, null, 2)}\n`, 'utf8');
      expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
        success: false,
        code: 'KNOWHOW_RESTORE_FAILED',
        error: 'Invalid or unbound knowhow restore receipt',
      });
    }
  });

  it('keeps completed-target conflicts auditable without overwriting them', async () => {
    await add(OLD_STEM);
    const snapshotPath = prepareSnapshot();
    await add(NEW_STEM);
    supersedeKnowhowEntry(root, OLD_ID, NEW_ID);
    writeFileSync(join(root, 'src', 'fixture.json'), 'after fixture', 'utf8');
    sealKnowhowLifecycleSnapshot(root, snapshotPath);

    let completedPath = '';
    restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      afterTarget: (path, completed) => {
        completedPath = path;
        if (completed === 1) throw new Error('restore crash');
      },
    });
    const absoluteCompleted = join(root, completedPath);
    writeFileSync(absoluteCompleted, 'third-party content', 'utf8');
    const conflict = restoreKnowhowLifecycleSnapshot(root, snapshotPath);
    expect(conflict).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_CONFLICT',
      intent: { status: 'conflict' },
      receipt: { status: 'conflict' },
    });
    expect(readFileSync(absoluteCompleted, 'utf8')).toBe('third-party content');
    expect(existsSync(`${snapshotPath}.restore.intent.json`)).toBe(true);
    expect(existsSync(`${snapshotPath}.restore.receipt.json`)).toBe(true);
  });

  it('re-fences terminal conflict and persists missing receipt', async () => {
    const snapshotPath = await prepareSealedMigration('terminal-replay.json');
    let completedPath = '';
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'terminal-replay-run',
      afterTarget: (path, completed) => {
        completedPath = path;
        if (completed === 1) throw new Error('persist partial restore');
      },
    }).success).toBe(false);

    const intentPath = `${snapshotPath}.restore.intent.json`;
    const receiptPath = `${snapshotPath}.restore.receipt.json`;
    const pending = JSON.parse(readFileSync(intentPath, 'utf8')) as KnowhowRestoreIntent;
    const conflictTarget = pending.targets.find(target => !target.completed)!;
    writeFileSync(join(root, conflictTarget.path), 'terminal conflict evidence', 'utf8');
    const terminal = restoreKnowhowLifecycleSnapshot(root, snapshotPath);
    expect(terminal).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_CONFLICT',
      intent: {
        status: 'conflict',
        conflict: {
          path: conflictTarget.path,
          actualHash: sha256('terminal conflict evidence'),
        },
      },
    });

    rmSync(receiptPath);
    expect(existsSync(receiptPath)).toBe(false);
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      replayed: true,
      code: 'KNOWHOW_RESTORE_CONFLICT',
      receipt: {
        schema_version: 'knowhow-restore-receipt/1.0',
        status: 'conflict',
      },
    });
    expect(existsSync(receiptPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(receiptPath, 'utf8')) as KnowhowRestoreReceipt;
    expect(persisted.resultHash).toBe(restoreOutcomeHash(persisted));

    const terminalIntent = JSON.parse(readFileSync(intentPath, 'utf8')) as KnowhowRestoreIntent;
    const completedTarget = terminalIntent.targets.find(
      target => target.path === completedPath && target.completed,
    )!;
    const pendingTarget = terminalIntent.targets.find(
      target => !target.completed && target.path !== conflictTarget.path,
    )!;
    const terminalStates = new Map(terminalIntent.targets.map(target => {
      const absolute = join(root, target.path);
      return [
        target.path,
        existsSync(absolute) ? readFileSync(absolute) : null,
      ] as const;
    }));

    for (const target of [conflictTarget, completedTarget, pendingTarget]) {
      const absolute = join(root, target.path);
      writeFileSync(absolute, `post-receipt drift for ${target.path}`, 'utf8');
      expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
        success: false,
        code: 'KNOWHOW_RESTORE_FAILED',
        error: expect.stringContaining('Restore terminal replay drift'),
      });
      const original = terminalStates.get(target.path);
      if (original === null) rmSync(absolute, { force: true });
      else writeFileSync(absolute, original!);
    }
  });
});

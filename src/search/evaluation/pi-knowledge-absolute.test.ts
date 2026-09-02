import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { WikiIndexer } from '../../../dashboard/src/server/wiki/wiki-indexer.js';
import { registerKnowhowCommand } from '../../commands/knowhow.js';
import {
  createKnowhowLifecycleSnapshot,
  getKnowhowEvolutionChain,
  restoreKnowhowLifecycleSnapshot,
  sealKnowhowLifecycleSnapshot,
  supersedeKnowhowEntry,
  type KnowhowLifecycleSnapshot,
} from '../../tools/knowhow-lifecycle.js';
import { handler as storeKnowhow } from '../../tools/store-knowhow.js';
import {
  assertNoQuerySpecialCases,
  sha256File,
} from './relevance-evaluator.js';

interface PiAbsoluteFixture {
  schema_version: 'pi-knowledge-absolute/1.0';
  canonicalId: string;
  legacyId: string;
  thresholds: {
    topK: number;
    recallAt: number;
    minRecall: number;
    maxDeprecatedLeakCount: number;
  };
  queries: Array<{
    id: string;
    query: string;
    targetIds: string[];
  }>;
}

interface PiHoldoutFixture {
  schema_version: 'search-ranking-holdouts/1.0';
  queries: Array<{
    id: string;
    query: string;
    targetIds: string[];
    category: string;
  }>;
}

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const absolutePath = join(fixturesRoot, 'pi-knowledge-absolute.json');
const holdoutsPath = join(fixturesRoot, 'search-ranking-holdouts.json');
const qrelsPath = join(fixturesRoot, 'search-ranking-qrels.json');
const baselinePath = join(fixturesRoot, 'search-ranking-baseline.json');
const legacyBeforePath = join(fixturesRoot, 'pi-knowledge-legacy-before.md');
const legacySupersededPath = join(fixturesRoot, 'pi-knowledge-legacy-superseded.md');
const canonicalFixturePath = join(fixturesRoot, 'pi-knowledge-canonical.md');

const explicitId = 'rcp-20260723-pi-skills-canonical-generation';
const canonicalFilename = 'RCP-20260723-pi-skills-canonical-generation.md';
const canonicalRelativePath = `.workflow/knowhow/${canonicalFilename}`;
const legacyRelativePath = '.workflow/knowhow/RCP-20260716-pi-maestro-flow-cli.md';
const snapshotRelativePath =
  '.workflow/knowhow/.migration-snapshots/pi-skills-canonical-generation.before.json';

const canonicalPayload = {
  operation: 'add',
  type: 'recipe',
  category: 'arch',
  title: 'Pi skills canonical generation from Maestro sources',
  description:
    'Generate Pi skills and agents from canonical Maestro .claude sources into .pi outputs without hand-maintained mirrors.',
  keywords: [
    'pi',
    'canonical-generation',
    'buildPiSkills',
    'buildPiAgents',
    'generated-assets',
  ],
  tags: ['pi', 'skills', 'agents', 'generation'],
  body: [
    '# Canonical Pi generation',
    '',
    'Use `.claude/commands`, `.claude/skills`, and `.claude/agents` as the source of truth.',
    '`buildPiSkills` generates `.pi/skills`; `buildPiAgents` generates `.pi/agents`.',
    'The `.pi` trees are generated output and must not be hand edited.',
  ].join('\n'),
  id: explicitId,
} as const;

const absolute = JSON.parse(readFileSync(absolutePath, 'utf8')) as PiAbsoluteFixture;
const holdouts = JSON.parse(readFileSync(holdoutsPath, 'utf8')) as PiHoldoutFixture;
const restoreCrashPoints = [1, 2, 3, 4];

let root: string;
let previousRoot: string | undefined;
let previousExitCode: number | string | null | undefined;

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function snapshotBeforeBytes(relativePath: string): Buffer {
  if (relativePath !== legacyRelativePath) {
    throw new Error(`Missing tracked before fixture: ${relativePath}`);
  }
  return readFileSync(legacyBeforePath);
}

function seedLegacy(workspaceRoot: string): void {
  write(
    join(workspaceRoot, legacyRelativePath),
    snapshotBeforeBytes(legacyRelativePath),
  );
}

async function addCanonical(overrides: Record<string, unknown> = {}) {
  return storeKnowhow({ ...canonicalPayload, ...overrides });
}

function createSnapshot(workspaceRoot: string): string {
  const snapshotPath = join(workspaceRoot, snapshotRelativePath);
  createKnowhowLifecycleSnapshot(workspaceRoot, {
    oldId: absolute.legacyId,
    newId: absolute.canonicalId,
    newPath: `knowhow/${canonicalFilename}`,
    includeRelative: [
      'src/search/evaluation/fixtures/pi-knowledge-absolute.json',
      'src/search/evaluation/pi-knowledge-absolute.test.ts',
    ],
    out: snapshotPath,
  });
  return snapshotPath;
}

async function migrateWorkspace(workspaceRoot: string): Promise<string> {
  process.env.MAESTRO_PROJECT_ROOT = workspaceRoot;
  seedLegacy(workspaceRoot);
  const snapshotPath = createSnapshot(workspaceRoot);
  const added = await addCanonical();
  expect(added.success).toBe(true);
  expect(supersedeKnowhowEntry(
    workspaceRoot,
    absolute.legacyId,
    absolute.canonicalId,
  ).success).toBe(true);
  expect(readFileSync(join(workspaceRoot, legacyRelativePath))).toEqual(
    readFileSync(legacySupersededPath),
  );
  write(
    join(workspaceRoot, 'src/search/evaluation/fixtures/pi-knowledge-absolute.json'),
    readFileSync(absolutePath),
  );
  write(
    join(workspaceRoot, 'src/search/evaluation/pi-knowledge-absolute.test.ts'),
    'temporary copied test target\n',
  );
  sealKnowhowLifecycleSnapshot(workspaceRoot, snapshotPath);
  return snapshotPath;
}

function listFiles(path: string, base = path): string[] {
  if (!existsSync(path)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child, base));
    else files.push(child.slice(base.length + 1).replaceAll('\\', '/'));
  }
  return files.sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-knowledge-absolute-'));
  previousRoot = process.env.MAESTRO_PROJECT_ROOT;
  previousExitCode = process.exitCode;
  process.env.MAESTRO_PROJECT_ROOT = root;
  process.exitCode = undefined;
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
});

describe('Pi canonical migration replay', () => {
  it('keeps explicit identity, created bytes and mtime across fake dates', async () => {
    seedLegacy(root);
    createSnapshot(root);
    const first = await addCanonical();
    expect(first).toMatchObject({
      success: true,
      result: {
        schema_version: 'knowhow-add-result/1.0',
        operation: 'add',
        id: absolute.canonicalId,
        filename: canonicalFilename,
        path: `knowhow/${canonicalFilename}`,
        created: '2026-07-23T01:00:00.000Z',
        replayed: false,
      },
    });

    const path = join(root, canonicalRelativePath);
    const beforeBytes = readFileSync(path);
    const beforeHash = sha256(path);
    const beforeStat = statSync(path);
    vi.setSystemTime(new Date('2026-08-24T02:00:00.000Z'));
    const replay = await addCanonical({
      keywords: [...canonicalPayload.keywords].reverse(),
      tags: [...canonicalPayload.tags].reverse(),
      body: `${canonicalPayload.body}\r\n`,
    });

    expect(replay).toMatchObject({
      success: true,
      result: {
        created: '2026-07-23T01:00:00.000Z',
        replayed: true,
      },
    });
    expect(readFileSync(path)).toEqual(beforeBytes);
    expect(sha256(path)).toBe(beforeHash);
    expect(statSync(path).size).toBe(beforeStat.size);
    expect(statSync(path).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it.each([
    ['type', { type: 'reference' }],
    ['category', { category: 'coding' }],
    ['title', { title: 'Divergent title' }],
    ['keywords', { keywords: ['divergent'] }],
    ['tags', { tags: ['divergent'] }],
    ['body', { body: 'Divergent body' }],
  ])('fails closed without writes for caller divergence in %s', async (_field, change) => {
    seedLegacy(root);
    createSnapshot(root);
    expect((await addCanonical()).success).toBe(true);
    const path = join(root, canonicalRelativePath);
    const beforeBytes = readFileSync(path);
    const beforeListing = listFiles(root);

    const result = await addCanonical(change);

    expect(result.success).toBe(false);
    expect(result.error).toContain('CALLER_PAYLOAD_CONFLICT');
    expect(readFileSync(path)).toEqual(beforeBytes);
    expect(listFiles(root)).toEqual(beforeListing);
  });
});

describe('Pi absolute and external holdout discovery', () => {
  it('locks minimum counts, canonical targets, disjoint queries and fixed thresholds', () => {
    const external = holdouts.queries.filter(query => query.category === 'pi');
    const allQueries = [...absolute.queries, ...external];
    const normalized = (value: string): string =>
      value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');

    expect(absolute.schema_version).toBe('pi-knowledge-absolute/1.0');
    expect(absolute.canonicalId.trim()).toBe(absolute.canonicalId);
    expect(absolute.canonicalId).not.toBe('');
    expect(absolute.thresholds).toEqual({
      topK: 5,
      recallAt: 20,
      minRecall: 0.90,
      maxDeprecatedLeakCount: 0,
    });
    expect(absolute.queries.length).toBeGreaterThanOrEqual(2);
    expect(external.length).toBeGreaterThanOrEqual(2);
    expect(allQueries.every(query => query.id.trim().length > 0)).toBe(true);
    expect(allQueries.every(query => query.query.trim().length > 0)).toBe(true);
    expect(new Set(allQueries.map(query => query.id)).size).toBe(allQueries.length);
    expect(new Set(allQueries.map(query => normalized(query.query))).size).toBe(
      allQueries.length,
    );
    expect(allQueries.every(query => (
      query.targetIds.length > 0
      && new Set(query.targetIds).size === query.targetIds.length
      && query.targetIds.every(targetId => targetId === absolute.canonicalId)
    ))).toBe(true);

    const primaryQueries = new Set(absolute.queries.map(query => normalized(query.query)));
    expect(external.some(query => primaryQueries.has(normalized(query.query)))).toBe(false);
  });

  it('keeps both history directions identical and exposes the CLI machine envelope', async () => {
    await migrateWorkspace(root);
    expect(readFileSync(join(root, canonicalRelativePath))).toEqual(
      readFileSync(canonicalFixturePath),
    );
    const fromLegacy = getKnowhowEvolutionChain(root, absolute.legacyId);
    const fromCanonical = getKnowhowEvolutionChain(root, absolute.canonicalId);
    expect(fromLegacy).toEqual(fromCanonical);
    expect(fromLegacy.map(entry => entry.id)).toEqual([
      absolute.legacyId,
      absolute.canonicalId,
    ]);
    expect(fromLegacy[0]).toMatchObject({
      deprecated: true,
      current: false,
      supersededBy: absolute.canonicalId,
    });
    expect(fromLegacy[1]).toMatchObject({
      deprecated: false,
      current: true,
      supersedes: [absolute.legacyId],
    });

    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => output.push(String(value)));
    const program = new Command();
    registerKnowhowCommand(program);
    await program.parseAsync([
      'node',
      'maestro',
      'knowhow',
      'history',
      absolute.legacyId,
      '--json',
    ]);
    expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
      schema_version: 'knowhow-history-result/1.0',
      operation: 'history',
      id: absolute.legacyId,
      entries: [
        { id: absolute.legacyId, deprecated: true },
        { id: absolute.canonicalId, current: true },
      ],
    });
  });

  it('ranks primary and external Pi holdouts in Top-5 with absolute Recall@20', async () => {
    await migrateWorkspace(root);
    const knowhowDir = join(root, '.workflow', 'knowhow');
    for (let index = 0; index < 8; index += 1) {
      write(
        join(knowhowDir, `TIP-20260723-pi-distractor-${index}.md`),
        [
          '---',
          `title: Pi maintenance distractor ${index}`,
          'type: tip',
          'category: arch',
          '---',
          '',
          'General Pi maintenance notes without the canonical source generation contract.',
        ].join('\n'),
      );
    }

    const indexer = new WikiIndexer({ workflowRoot: join(root, '.workflow') });
    const external = holdouts.queries.filter(query => query.category === 'pi');
    expect(absolute.schema_version).toBe('pi-knowledge-absolute/1.0');
    expect(absolute.queries.length).toBeGreaterThanOrEqual(2);
    expect(external.length).toBeGreaterThanOrEqual(2);
    expect(new Set(external.map(query => query.query))).not.toEqual(
      new Set(absolute.queries.map(query => query.query)),
    );

    let relevant = 0;
    let recalled = 0;
    let deprecatedLeakCount = 0;
    for (const query of [...absolute.queries, ...external]) {
      const result = await indexer.searchWithMeta(
        query.query,
        absolute.thresholds.recallAt,
        { skipEmbedding: true },
      );
      const ids = result.results.map(item => item.entry.id);
      for (const targetId of query.targetIds) {
        relevant += 1;
        if (ids.slice(0, absolute.thresholds.recallAt).includes(targetId)) recalled += 1;
        expect(ids.slice(0, absolute.thresholds.topK)).toContain(targetId);
      }
      deprecatedLeakCount += ids.filter(id => id === absolute.legacyId).length;
    }
    expect(relevant).toBeGreaterThan(0);
    expect(Number.isFinite(recalled / relevant)).toBe(true);
    expect(recalled / relevant).toBeGreaterThanOrEqual(absolute.thresholds.minRecall);
    expect(deprecatedLeakCount).toBeLessThanOrEqual(
      absolute.thresholds.maxDeprecatedLeakCount,
    );

    const fullIndex = await indexer.get();
    expect(fullIndex.byId[absolute.legacyId]).toMatchObject({ status: 'deprecated' });
    expect(fullIndex.byId[absolute.canonicalId]).toBeDefined();
  });

  it('hides the legacy ID by default and exposes it for explicit deprecated audit', async () => {
    await migrateWorkspace(root);
    const indexer = new WikiIndexer({ workflowRoot: join(root, '.workflow') });
    const query = 'pi mirror maestro flow';
    const defaults = await indexer.searchWithMeta(query, 50, { skipEmbedding: true });
    const audited = await indexer.query({ type: 'knowhow', q: query });
    expect(defaults.results.map(result => result.entry.id)).not.toContain(absolute.legacyId);
    expect(audited.map(result => result.id)).toContain(absolute.legacyId);
  });
});

describe('frozen relative judgments and anti-special-case guards', () => {
  it('keeps relative qrels byte-identical and outside TASK-007 snapshot targets', async () => {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      qrelsSha256: string;
    };
    expect(await sha256File(qrelsPath)).toBe(baseline.qrelsSha256);
    seedLegacy(root);
    const snapshot = JSON.parse(
      readFileSync(createSnapshot(root), 'utf8'),
    ) as KnowhowLifecycleSnapshot;
    expect(snapshot.targets.map(target => target.path)).not.toContain(
      'src/search/evaluation/fixtures/search-ranking-qrels.json',
    );
  });

  it('keeps production scan clean and hard-fails both injected fault classes', async () => {
    const productionPaths = [
      join(projectRoot, 'src/commands/search.ts'),
      join(projectRoot, 'dashboard/src/server/wiki/search.ts'),
      join(projectRoot, 'dashboard/src/server/wiki/wiki-indexer.ts'),
      join(projectRoot, 'src/graph/kg/query/search.ts'),
      join(projectRoot, 'src/graph/kg/query/scoring.ts'),
    ];
    const clean = await assertNoQuerySpecialCases({
      queryFiles: [absolutePath, holdoutsPath],
      productionPaths,
    });
    expect(clean.querySpecialCaseHits).toBe(0);
    expect(clean.scannedFiles).toBeGreaterThanOrEqual(5);

    const literalPath = join(root, 'faults/literal.ts');
    const branchPath = join(root, 'faults/branch.ts');
    write(
      literalPath,
      `export const preferred = ${JSON.stringify(absolute.queries[0].query)};\n`,
    );
    write(
      branchPath,
      "export function rank(query: string): number {\n  if (query.includes('pi')) return 10;\n  return 0;\n}\n",
    );
    await expect(assertNoQuerySpecialCases({
      queryFiles: [absolutePath, holdoutsPath],
      productionPaths: [literalPath],
    })).rejects.toThrow(/production query special cases detected/);
    await expect(assertNoQuerySpecialCases({
      queryFiles: [absolutePath, holdoutsPath],
      productionPaths: [branchPath],
    })).rejects.toThrow(/production query special cases detected/);
  });
});

describe('temporary-copy restore crash matrix', () => {
  let restoreSeedRoot: string;

  beforeAll(async () => {
    restoreSeedRoot = mkdtempSync(join(tmpdir(), 'pi-restore-seed-'));
    const previousProjectRoot = process.env.MAESTRO_PROJECT_ROOT;
    try {
      await migrateWorkspace(restoreSeedRoot);
    } finally {
      if (previousProjectRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
      else process.env.MAESTRO_PROJECT_ROOT = previousProjectRoot;
    }
  });

  afterAll(() => {
    rmSync(restoreSeedRoot, { recursive: true, force: true });
  });

  function copyMigratedWorkspace(): string {
    cpSync(restoreSeedRoot, root, { recursive: true });
    process.env.MAESTRO_PROJECT_ROOT = root;
    return join(root, snapshotRelativePath);
  }

  it.each(restoreCrashPoints)(
    'reconciles every target written before its completed checkpoint (target %i)',
    async crashBefore => {
      const snapshotPath = copyMigratedWorkspace();
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as KnowhowLifecycleSnapshot;
      const writtenBeforeCrash: string[] = [];
      const crashed = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
        claimedRun: `pi-before-checkpoint-${crashBefore}`,
        beforeTargetCheckpoint: (path, completed) => {
          writtenBeforeCrash.push(path);
          if (completed === crashBefore) {
            throw new Error('injected restore before-checkpoint crash');
          }
        },
      });
      expect(crashed.success).toBe(false);
      expect(writtenBeforeCrash).toHaveLength(crashBefore);
      const interruptedPath = writtenBeforeCrash.at(-1)!;

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
          schema_version: 'knowhow-restore-receipt/1.0',
          operation: 'restore',
          status: 'completed',
          claimedRun: `pi-before-checkpoint-${crashBefore}`,
        },
      });
      expect(replay.receipt?.targets.every(target => target.completed)).toBe(true);
      expect(replayWrites).toHaveLength(snapshot.targets.length - crashBefore);
      expect(replayWrites.some(path => writtenBeforeCrash.includes(path))).toBe(false);
      expect(replayCheckpoints).toContain(interruptedPath);
      expect(readFileSync(join(root, legacyRelativePath))).toEqual(
        snapshotBeforeBytes(legacyRelativePath),
      );
      expect(existsSync(join(root, canonicalRelativePath))).toBe(false);
      expect(existsSync(join(
        root,
        'src/search/evaluation/fixtures/pi-knowledge-absolute.json',
      ))).toBe(false);
      expect(existsSync(join(
        root,
        'src/search/evaluation/pi-knowledge-absolute.test.ts',
      ))).toBe(false);
    },
  );

  it.each(restoreCrashPoints)(
    'replays only pending targets after every per-target crash (target %i)',
    async crashAfter => {
      const snapshotPath = copyMigratedWorkspace();
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as KnowhowLifecycleSnapshot;
      const completedBeforeCrash: string[] = [];
      const crashed = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
        claimedRun: `pi-crash-${crashAfter}`,
        afterTarget: (path, completed) => {
          completedBeforeCrash.push(path);
          if (completed === crashAfter) throw new Error('injected restore crash');
        },
      });
      expect(crashed.success).toBe(false);
      expect(completedBeforeCrash).toHaveLength(crashAfter);

      const replayedPaths: string[] = [];
      const replay = restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
        claimedRun: 'must-not-replace-original',
        afterTarget: path => replayedPaths.push(path),
      });
      expect(replay).toMatchObject({
        success: true,
        replayed: true,
        receipt: {
          schema_version: 'knowhow-restore-receipt/1.0',
          operation: 'restore',
          status: 'completed',
          claimedRun: `pi-crash-${crashAfter}`,
        },
      });
      expect(replay.receipt?.targets.every(target => target.completed)).toBe(true);
      expect(replayedPaths).toHaveLength(snapshot.targets.length - crashAfter);
      expect(replayedPaths.some(path => completedBeforeCrash.includes(path))).toBe(false);
      expect(readFileSync(join(root, legacyRelativePath))).toEqual(
        snapshotBeforeBytes(legacyRelativePath),
      );
      expect(existsSync(join(root, canonicalRelativePath))).toBe(false);
      expect(existsSync(join(
        root,
        'src/search/evaluation/fixtures/pi-knowledge-absolute.json',
      ))).toBe(false);
      expect(existsSync(join(
        root,
        'src/search/evaluation/pi-knowledge-absolute.test.ts',
      ))).toBe(false);
    },
  );

  it.each(['completed', 'pending'] as const)(
    'preserves %s target hash conflicts for audit without overwriting',
    async conflictKind => {
      const seedRoot = mkdtempSync(join(tmpdir(), `pi-conflict-${conflictKind}-`));
      try {
        cpSync(restoreSeedRoot, seedRoot, { recursive: true });
        process.env.MAESTRO_PROJECT_ROOT = seedRoot;
        const snapshotPath = join(seedRoot, snapshotRelativePath);
        let completedPath = '';
        const crashed = restoreKnowhowLifecycleSnapshot(seedRoot, snapshotPath, {
          claimedRun: `pi-${conflictKind}-conflict`,
          afterTarget: (path, completed) => {
            completedPath = path;
            if (completed === 1) throw new Error('injected restore crash');
          },
        });
        expect(crashed.success).toBe(false);

        const intentPath = `${snapshotPath}.restore.intent.json`;
        const pendingIntent = JSON.parse(readFileSync(intentPath, 'utf8')) as {
          targets: Array<{ path: string; completed: boolean }>;
        };
        const targetPath = conflictKind === 'completed'
          ? completedPath
          : pendingIntent.targets.find(target => !target.completed)?.path;
        expect(targetPath).toBeTruthy();
        const absoluteTarget = join(seedRoot, targetPath!);
        write(absoluteTarget, `third-party ${conflictKind} content`);

        const conflict = restoreKnowhowLifecycleSnapshot(seedRoot, snapshotPath);
        expect(conflict).toMatchObject({
          success: false,
          code: 'KNOWHOW_RESTORE_CONFLICT',
          intent: { status: 'conflict' },
          receipt: {
            schema_version: 'knowhow-restore-receipt/1.0',
            status: 'conflict',
            claimedRun: `pi-${conflictKind}-conflict`,
          },
        });
        expect(readFileSync(absoluteTarget, 'utf8')).toBe(
          `third-party ${conflictKind} content`,
        );
        expect(existsSync(intentPath)).toBe(true);
        expect(existsSync(`${snapshotPath}.restore.receipt.json`)).toBe(true);
      } finally {
        rmSync(seedRoot, { recursive: true, force: true });
      }
    },
  );

  it('rejects stale terminal conflict evidence', async () => {
    const qrelsBefore = sha256(qrelsPath);
    const fixtureBefore = sha256(legacyBeforePath);
    const snapshotPath = copyMigratedWorkspace();
    let completedPath = '';
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath, {
      claimedRun: 'pi-stale-terminal-conflict',
      afterTarget: (path, completed) => {
        completedPath = path;
        if (completed === 1) throw new Error('persist partial Pi restore');
      },
    }).success).toBe(false);

    const intentPath = `${snapshotPath}.restore.intent.json`;
    const pending = JSON.parse(readFileSync(intentPath, 'utf8')) as {
      targets: Array<{ path: string; completed: boolean }>;
    };
    const conflictPath = pending.targets.find(target => !target.completed)!.path;
    write(join(root, conflictPath), 'Pi terminal conflict evidence');
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_CONFLICT',
      receipt: { status: 'conflict' },
    });

    const completedAbsolute = join(root, completedPath);
    write(completedAbsolute, 'Pi post-receipt target drift');
    expect(restoreKnowhowLifecycleSnapshot(root, snapshotPath)).toMatchObject({
      success: false,
      code: 'KNOWHOW_RESTORE_FAILED',
      error: expect.stringContaining('Restore terminal replay drift'),
    });
    expect(readFileSync(completedAbsolute, 'utf8')).toBe('Pi post-receipt target drift');
    expect(sha256(qrelsPath)).toBe(qrelsBefore);
    expect(sha256(legacyBeforePath)).toBe(fixtureBefore);
  });
});

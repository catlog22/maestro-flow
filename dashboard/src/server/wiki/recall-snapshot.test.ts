import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WikiIndexer } from './wiki-indexer.js';
import { recallSnapshotSchema } from './wiki-types.js';

let workflowRoot: string;

async function write(rel: string, body: string): Promise<void> {
  const target = join(workflowRoot, rel);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, body, 'utf-8');
}

beforeEach(async () => {
  workflowRoot = await mkdtemp(join(tmpdir(), 'wiki-recall-'));
});

afterEach(async () => {
  await rm(workflowRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('Wiki recall snapshot provider', () => {
  it('returns deterministic read-only raw BM25 candidates with stable ID tie-breaking', async () => {
    await write('knowhow/a.md', '---\ntitle: Equal alpha\n---\nalpha beta');
    await write('knowhow/b.md', '---\ntitle: Equal alpha\n---\nalpha beta');
    const indexer = new WikiIndexer({ workflowRoot });
    const asOf = '2026-07-18T12:00:00.000Z';

    const first = await indexer.recallSnapshot('alpha', asOf, 10);
    const second = await indexer.recallSnapshot('alpha', asOf, 10);

    expect(second).toEqual(first);
    expect(first.as_of).toBe(asOf);
    expect(first.automatic).toBe(false);
    expect(first.mutation_authorized).toBe(false);
    expect(first.scoring).toEqual({ provider: 'bm25', embedding_weight_bp: 0, tie_break: 'entry_id_asc' });
    expect(first.candidates.map(candidate => candidate.entry_id)).toEqual(
      [...first.candidates].sort((a, b) => b.score_bp - a.score_bp || a.entry_id.localeCompare(b.entry_id))
        .map(candidate => candidate.entry_id),
    );
    expect(first.candidates.every(candidate => Number.isInteger(candidate.score_bp))).toBe(true);
    expect(first.candidates.every(candidate => !candidate.fork_authorized && !candidate.resume_authorized)).toBe(true);
  });

  it('validates positive snapshots and rejects mutation-capable or non-integer variants', async () => {
    await write('knowhow/one.md', '---\ntitle: Recall target\n---\nrecall target');
    const snapshot = await new WikiIndexer({ workflowRoot })
      .recallSnapshot('recall', '2026-07-18T12:00:00.000Z');
    expect(recallSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(recallSnapshotSchema.safeParse({ ...snapshot, automatic: true }).success).toBe(false);
    expect(recallSnapshotSchema.safeParse({
      ...snapshot,
      candidates: snapshot.candidates.map(candidate => ({ ...candidate, score_bp: candidate.score_bp + 0.5 })),
    }).success).toBe(false);
  });
});

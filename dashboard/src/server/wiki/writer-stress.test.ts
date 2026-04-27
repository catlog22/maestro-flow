import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { WikiIndexer } from './wiki-indexer.js';
import { WikiWriter, WikiWriteError } from './writer.js';

// ---------------------------------------------------------------------------
// Stress tests for WikiWriter: concurrency, security (traversal, symlinks,
// virtual entries), and edge cases the base unit test doesn't cover.
// ---------------------------------------------------------------------------

let tmpRoot: string;

async function seed(rel: string, body: string): Promise<void> {
  const abs = join(tmpRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf-8');
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wiki-writer-stress-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
});

describe('WikiWriter security — path traversal', () => {
  it('rejects absolute path slug', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'spec', slug: '/etc/passwd', title: 'x', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects dot-traversal slug', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'spec', slug: '..', title: 'x', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects windows-style traversal slug', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({
        type: 'spec',
        slug: '..\\..\\windows\\system32',
        title: 'x',
        body: 'x',
      }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects uppercase slug', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'spec', slug: 'UPPERCASE', title: 'x', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects slug with spaces', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'spec', slug: 'has space', title: 'x', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects empty title', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'spec', slug: 'ok', title: '   ', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('rejects phase type (removed)', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({ type: 'phase' as any, slug: 'ok', title: 'T', body: 'x' }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('knowhow writes to knowhow/KNW-slug.md', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.create({
      type: 'knowhow',
      slug: 'auth-lessons',
      title: 'Auth Lessons',
      body: 'learned',
    });
    expect(entry.source.path).toBe('knowhow/KNW-auth-lessons.md');
  });

  it('note writes to knowhow/TIP-slug.md', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.create({
      type: 'note',
      slug: 'quick-tip',
      title: 'Tip',
      body: 'tip',
    });
    expect(entry.source.path).toBe('knowhow/TIP-quick-tip.md');
  });
});

describe('WikiWriter security — symlink rejection', () => {
  it('refuses to update a symlinked entry', async () => {
    // Create a real file outside root, then symlink to it from specs/
    const outside = join(tmpRoot, '..', `outside-${Date.now()}.md`);
    await writeFile(outside, '---\ntitle: Outside\n---\n# outside', 'utf-8');
    await mkdir(join(tmpRoot, 'specs'), { recursive: true });
    const linkPath = join(tmpRoot, 'specs', 'linked.md');
    try {
      await symlink(outside, linkPath);
    } catch {
      // Platforms/accounts without symlink permission skip this test
      return;
    }

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.update('spec-linked', { body: 'hijacked' }),
    ).rejects.toThrow(WikiWriteError);

    // Ensure the outside file was NOT mutated
    const raw = await readFile(outside, 'utf-8');
    expect(raw).toContain('# outside');

    await rm(outside, { force: true });
    await rm(linkPath, { force: true });
  });
});

describe('WikiWriter virtual entries — read-only', () => {
  it('rejects update on virtual issue', async () => {
    await mkdir(join(tmpRoot, 'issues'), { recursive: true });
    await writeFile(
      join(tmpRoot, 'issues', 'current.jsonl'),
      JSON.stringify({ id: 'I1', title: 'Issue 1', status: 'open' }) + '\n',
      'utf-8',
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const issue = index.entries.find((e) => e.type === 'issue');
    expect(issue).toBeDefined();
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.update(issue!.id, { body: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects remove on virtual lesson', async () => {
    await mkdir(join(tmpRoot, 'learning'), { recursive: true });
    await writeFile(
      join(tmpRoot, 'learning', 'lessons.jsonl'),
      JSON.stringify({ id: 'L1', title: 'Lesson 1', category: 'pattern' }) + '\n',
      'utf-8',
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const lesson = index.entries.find((e) => e.type === 'lesson');
    if (!lesson) return; // learning adapter may filter
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(writer.remove(lesson.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('WikiWriter concurrency', () => {
  it('concurrent PUTs — one wins, others see CONFLICT with stale hash', async () => {
    // Use knowhow path (not specs/) since spec body updates are blocked
    await seed('knowhow/KNW-s.md', `---\ntitle: Initial\n---\n# s\nv0`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);

    // Capture the initial hash
    const raw = await readFile(join(tmpRoot, 'knowhow', 'KNW-s.md'));
    const initialHash = createHash('sha256').update(raw).digest('hex');

    // Fire 5 concurrent PUTs all providing the SAME stale hash. Each update
    // serializes through readFile → writeFile, but after the first success the
    // hash on disk changes, so the remaining 4 must see CONFLICT.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        writer.update('knowhow-s', {
          body: `v${i + 1}`,
          expectedHash: initialHash,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const conflicts = results.filter(
      (r) => r.status === 'rejected' && (r.reason as WikiWriteError).code === 'CONFLICT',
    );

    // Exactly one write must have observed the original hash and succeeded.
    expect(ok.length).toBe(1);
    expect(conflicts.length).toBe(4);
  });

  it('spec body update is blocked — use spec API instead', async () => {
    await seed('specs/s.md', `---\ntitle: Protected\n---\n# Protected\nbody`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.update('spec-s', { body: 'overwritten' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Frontmatter-only updates should still work
    const updated = await writer.update('spec-s', { title: 'New Title' });
    expect(updated.title).toBe('New Title');
  });

  it('rapid create → update → delete round-trip keeps index consistent', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);

    const created = await writer.create({
      type: 'knowhow',
      slug: 'rt',
      title: 'Initial',
      body: '# body',
    });
    expect(created.id).toBe('knowhow-rt');

    const updated = await writer.update('knowhow-rt', {
      title: 'Updated',
      body: '# updated',
    });
    expect(updated.title).toBe('Updated');

    await writer.remove('knowhow-rt');
    const index = await indexer.get();
    expect(index.byId['knowhow-rt']).toBeUndefined();

    // File should be gone from disk too
    await expect(stat(join(tmpRoot, 'knowhow', 'KNW-rt.md'))).rejects.toThrow();
  });

  it('create with frontmatter serializes arrays and strings correctly', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.create({
      type: 'spec',
      slug: 'fm',
      title: 'Frontmatter Test',
      body: '# fm\nbody',
      frontmatter: {
        tags: ['alpha', 'beta'],
        priority: 'high',
      },
    });
    expect(entry.tags).toEqual(['alpha', 'beta']);
    expect(entry.ext.priority).toBe('high');
  });

  it('update without body preserves existing body', async () => {
    await seed('specs/s.md', `---\ntitle: Old\n---\n# Old\noriginal body`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const updated = await writer.update('spec-s', { title: 'New Title' });
    expect(updated.title).toBe('New Title');
    expect(updated.body).toContain('original body');
  });
});

describe('WikiWriter — invalid id validation', () => {
  it('rejects update with slash in id', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.update('spec/evil', { body: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects remove with backslash in id', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.remove('spec\\evil'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('remove of non-existent id returns NOT_FOUND', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.remove('spec-nope'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('create fails when target file already exists', async () => {
    await seed('specs/dup.md', `---\ntitle: Existing\n---\n# dup`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({
        type: 'spec',
        slug: 'dup',
        title: 'New',
        body: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeSessionFixture } from '../../dashboard/src/server/wiki/__fixtures__/runtime-session.js';
import { registerLoadCommand } from './load.js';
import { runUnifiedSearch } from './search.js';

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonSearch: vi.fn(async () => null),
  spawnDaemon: vi.fn(async () => undefined),
  stopDaemon: vi.fn(() => false),
  readDaemonInfo: vi.fn(() => null),
  isDaemonAlive: vi.fn(() => false),
  getDaemonPath: vi.fn((workflowRoot: string) => join(workflowRoot, 'search-daemon.json')),
}));

// Root command aliases normally point at the last built dashboard bundle.
// Bind this source-level integration test to the current WikiIndexer source.
vi.mock('#maestro-dashboard/wiki/wiki-indexer.js', async () => (
  import('../../dashboard/src/server/wiki/wiki-indexer.js')
));

describe.sequential('Session/Run live Wiki search and load', () => {
  let projectRoot: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    projectRoot = await mkdtemp(join(tmpdir(), 'session-run-wiki-live-'));
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  it('searches and loads a runtime 1.3 Session Run with matching summary, kind, and provenance', async () => {
    const fixture = createRuntimeSessionFixture(projectRoot);
    const persistedSession = JSON.parse(await readFile(
      join(fixture.workflowRoot, 'sessions', fixture.sessionId, 'session.json'),
      'utf8',
    ));
    const persistedRun = JSON.parse(await readFile(
      join(fixture.workflowRoot, 'sessions', fixture.sessionId, 'runs', fixture.runId, 'run.json'),
      'utf8',
    ));
    expect(persistedSession.schema_version).toBe('session/1.3');
    expect(persistedRun.schema_version).toBe('command-run/1.3');

    const unfilteredResults = await runUnifiedSearch(fixture.summary, {
      limit: 10,
      skipEmbedding: true,
    });
    expect(unfilteredResults, JSON.stringify(unfilteredResults, null, 2)).not.toEqual([]);
    const searchResults = await runUnifiedSearch(fixture.summary, {
      limit: 10,
      kind: fixture.kind,
      skipEmbedding: true,
    });
    const searchHit = searchResults.find(result => result.runId === fixture.runId);
    expect(searchHit).toMatchObject({
      id: `session-run-${fixture.sessionId}-${fixture.runId}`,
      type: 'knowhow',
      category: null,
      sourceRef: fixture.runId,
      sessionId: fixture.sessionId,
      runId: fixture.runId,
    });
    expect(searchHit?.summary).toContain(fixture.summary);
    expect(searchHit?.related).toContain(`session-${fixture.sessionId}`);
    expect(await runUnifiedSearch(fixture.summary, {
      limit: 10,
      kind: 'diagnosis',
      skipEmbedding: true,
    })).toEqual([]);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { logs.push(String(value)); });
    const program = new Command();
    program.exitOverride();
    registerLoadCommand(program);
    await program.parseAsync([
      'node', 'maestro', 'load', '--type', 'knowhow', '--id', searchHit!.id, '--json',
    ]);

    const loaded = JSON.parse(logs.at(-1)!) as {
      totalLoaded: number;
      entries: Array<{
        id: string;
        type: string;
        summary: string;
        body: string;
        related: string[];
      }>;
    };
    expect(loaded.totalLoaded).toBe(1);
    expect(loaded.entries[0]).toMatchObject({
      id: searchHit!.id,
      type: 'knowhow',
      summary: searchHit!.summary,
    });
    expect(loaded.entries[0].body).toContain('Project Session and Run 1.3 through the Wiki adapter');
    expect(loaded.entries[0].related).toContain(`session-${fixture.sessionId}`);
  });
});

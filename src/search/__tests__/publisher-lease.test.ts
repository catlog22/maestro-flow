import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireWikiPublisherLease,
  getWikiPublisherLeasePath,
  hasWikiPublisherLease,
  readWikiPublisherLease,
  releaseWikiPublisherLease,
} from '../publisher-lease.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wiki-publisher-lease-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Wiki publisher lease', () => {
  it('atomically grants one owner and rejects a second owner', () => {
    const first = acquireWikiPublisherLease(root);
    const second = acquireWikiPublisherLease(root);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(hasWikiPublisherLease(root)).toBe(true);
    expect(readWikiPublisherLease(root)).toMatchObject({
      pid: process.pid,
      token: first!.token,
    });

    releaseWikiPublisherLease(first);
    expect(hasWikiPublisherLease(root)).toBe(false);
    expect(acquireWikiPublisherLease(root)).not.toBeNull();
  });

  it('reclaims a lease held by a process that is no longer alive', () => {
    const path = getWikiPublisherLeasePath(root);
    writeFileSync(path, JSON.stringify({
      pid: Number.MAX_SAFE_INTEGER,
      token: 'dead-owner',
      startedAt: new Date(0).toISOString(),
    }));

    const lease = acquireWikiPublisherLease(root);
    expect(lease).not.toBeNull();
    expect(readWikiPublisherLease(root)).toMatchObject({
      pid: process.pid,
      token: lease!.token,
    });
    releaseWikiPublisherLease(lease);
  });

  it.each([
    ['not-json', 'malformed JSON'],
    [JSON.stringify({ pid: process.pid, token: 'missing-started-at' }), 'missing fields'],
    [JSON.stringify({ pid: 'dead', token: 'bad', startedAt: new Date().toISOString() }), 'bad pid'],
  ])('fails closed for %s (%s)', (_contents) => {
    const path = getWikiPublisherLeasePath(root);
    writeFileSync(path, _contents);

    expect(acquireWikiPublisherLease(root)).toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(_contents);
  });

  it('compare-deletes only the lease that the caller acquired', () => {
    const first = acquireWikiPublisherLease(root);
    expect(first).not.toBeNull();

    const path = getWikiPublisherLeasePath(root);
    const successor = JSON.stringify({
      pid: process.pid,
      token: 'successor',
      startedAt: new Date().toISOString(),
    });
    writeFileSync(path, successor);

    releaseWikiPublisherLease(first);
    expect(readFileSync(path, 'utf8')).toBe(successor);
    expect(acquireWikiPublisherLease(root)).toBeNull();
    rmSync(path, { force: true });
  });
});

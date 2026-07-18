import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handler } from '../store-knowhow.js';

describe('store-knowhow atomic creation', () => {
  let root: string;
  let previousRoot: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-'));
    previousRoot = process.env.MAESTRO_PROJECT_ROOT;
    process.env.MAESTRO_PROJECT_ROOT = root;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
    else process.env.MAESTRO_PROJECT_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  it('does not overwrite an existing same-day entry with the same title', async () => {
    const first = await handler({
      operation: 'add',
      type: 'tip',
      title: 'Atomic lifecycle policy',
      body: 'original body',
    });
    const second = await handler({
      operation: 'add',
      type: 'tip',
      title: 'Atomic lifecycle policy',
      body: 'replacement body',
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error).toContain('already exists');

    const filename = (first.result as { filename: string }).filename;
    const filePath = join(root, '.workflow', 'knowhow', filename);
    expect(readFileSync(filePath, 'utf-8')).toContain('original body');
    expect(readFileSync(filePath, 'utf-8')).not.toContain('replacement body');
    expect(existsSync(`${filePath}.lock`)).toBe(false);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});

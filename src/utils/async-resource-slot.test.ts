import { describe, expect, it, vi } from 'vitest';

import { AsyncResourceSlot } from './async-resource-slot.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

describe('AsyncResourceSlot', () => {
  it('constructs one resource for concurrent same-key borrowers', async () => {
    const slot = new AsyncResourceSlot<string, { close(): Promise<void> }>();
    const resource = { close: vi.fn(async () => undefined) };
    const create = vi.fn(async () => resource);

    const values = await Promise.all(Array.from({ length: 20 }, () =>
      slot.run('same', create, async current => current)));

    expect(create).toHaveBeenCalledTimes(1);
    expect(values.every(value => value === resource)).toBe(true);
    await slot.close();
    expect(resource.close).toHaveBeenCalledTimes(1);
  });

  it('waits for a borrower before closing a superseded resource', async () => {
    const slot = new AsyncResourceSlot<string, { id: string; close(): Promise<void> }>();
    const release = deferred<void>();
    const first = { id: 'first', close: vi.fn(async () => undefined) };
    const second = { id: 'second', close: vi.fn(async () => undefined) };
    const firstUse = slot.run('first', async () => first, async () => {
      await release.promise;
      return 'done';
    });
    const secondUse = slot.run('second', async () => second, async resource => resource.id);

    await Promise.resolve();
    expect(first.close).not.toHaveBeenCalled();
    release.resolve();
    await expect(firstUse).resolves.toBe('done');
    await expect(secondUse).resolves.toBe('second');
    expect(first.close).toHaveBeenCalledTimes(1);
    await slot.close();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('does not publish a replacement when closing the previous resource fails', async () => {
    const slot = new AsyncResourceSlot<string, { id: string; close(): Promise<void> }>();
    const first = { id: 'first', close: vi.fn(async () => { throw new Error('close failed'); }) };
    const second = { id: 'second', close: vi.fn(async () => undefined) };
    await slot.run('first', async () => first, async resource => resource.id);

    await expect(slot.run('second', async () => second, async resource => resource.id))
      .rejects.toThrow('close failed');
    expect(second.close).toHaveBeenCalledTimes(1);
  });
});

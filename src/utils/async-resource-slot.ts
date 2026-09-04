export interface AsyncClosable {
  close(): Promise<void>;
}

interface SlotEntry<K, R extends AsyncClosable> {
  key: K;
  resource: R;
}

/**
 * Serializes use and replacement of one keyed async resource.
 * A superseded resource is closed only after its current borrower finishes.
 */
export class AsyncResourceSlot<K, R extends AsyncClosable> {
  private current: SlotEntry<K, R> | null = null;
  private tail: Promise<void> = Promise.resolve();

  run<T>(
    key: K,
    create: () => Promise<R>,
    use: (resource: R) => Promise<T>,
  ): Promise<T> {
    const operation = this.tail.then(async () => {
      if (!this.current || !Object.is(this.current.key, key)) {
        const replacement = await create();
        const previous = this.current;
        if (previous) {
          try {
            await previous.resource.close();
          } catch (error) {
            await replacement.close().catch(() => undefined);
            throw error;
          }
        }
        this.current = { key, resource: replacement };
      }
      return use(this.current.resource);
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(): Promise<void> {
    await this.tail;
    const current = this.current;
    this.current = null;
    if (current) await current.resource.close();
  }
}

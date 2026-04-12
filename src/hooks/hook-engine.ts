// ---------------------------------------------------------------------------
// Hook Engine — Lightweight tapable-inspired hook system
// 4 hook types: SyncHook, AsyncSeriesHook, AsyncSeriesBailHook,
// AsyncSeriesWaterfallHook. Zero external dependencies.
// ---------------------------------------------------------------------------

interface TapEntry<F> {
  name: string;
  fn: F;
}

// ---------------------------------------------------------------------------
// SyncHook — call() iterates handlers synchronously, returns void
// ---------------------------------------------------------------------------

export class SyncHook<T extends unknown[] = []> {
  readonly handlers: TapEntry<(...args: T) => void>[] = [];

  tap(name: string, fn: (...args: T) => void): void {
    this.handlers.push({ name, fn });
  }

  call(...args: T): void {
    for (const h of this.handlers) {
      h.fn(...args);
    }
  }
}

// ---------------------------------------------------------------------------
// AsyncSeriesHook — call() awaits each handler in registration order
// ---------------------------------------------------------------------------

export class AsyncSeriesHook<T extends unknown[] = []> {
  readonly handlers: TapEntry<(...args: T) => void | Promise<void>>[] = [];

  tap(name: string, fn: (...args: T) => void | Promise<void>): void {
    this.handlers.push({ name, fn });
  }

  async call(...args: T): Promise<void> {
    for (const h of this.handlers) {
      await h.fn(...args);
    }
  }
}

// ---------------------------------------------------------------------------
// AsyncSeriesBailHook — returns early if a handler returns non-undefined
// ---------------------------------------------------------------------------

export class AsyncSeriesBailHook<T extends unknown[] = []> {
  readonly handlers: TapEntry<(...args: T) => unknown | Promise<unknown>>[] = [];

  tap(name: string, fn: (...args: T) => unknown | Promise<unknown>): void {
    this.handlers.push({ name, fn });
  }

  async call(...args: T): Promise<unknown | undefined> {
    for (const h of this.handlers) {
      const result = await h.fn(...args);
      if (result !== undefined) return result;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// AsyncSeriesWaterfallHook — passes return value through chain
// ---------------------------------------------------------------------------

export class AsyncSeriesWaterfallHook<T = unknown> {
  readonly handlers: TapEntry<(value: T) => T | Promise<T>>[] = [];

  tap(name: string, fn: (value: T) => T | Promise<T>): void {
    this.handlers.push({ name, fn });
  }

  async call(initial: T): Promise<T> {
    let current = initial;
    for (const h of this.handlers) {
      current = await h.fn(current);
    }
    return current;
  }
}

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SyncHook,
  AsyncSeriesHook,
  AsyncSeriesBailHook,
  AsyncSeriesWaterfallHook,
} from '../hook-engine.js';

// ---------------------------------------------------------------------------
// SyncHook
// ---------------------------------------------------------------------------

describe('SyncHook', () => {
  it('calls handlers in registration order', () => {
    const hook = new SyncHook<[string]>();
    const calls: string[] = [];
    hook.tap('a', (v) => calls.push(`a:${v}`));
    hook.tap('b', (v) => calls.push(`b:${v}`));
    hook.call('x');
    assert.deepStrictEqual(calls, ['a:x', 'b:x']);
  });

  it('returns void', () => {
    const hook = new SyncHook();
    const result = hook.call();
    assert.strictEqual(result, undefined);
  });

  it('works with zero handlers', () => {
    const hook = new SyncHook<[number]>();
    hook.call(42); // should not throw
  });

  it('supports multiple arguments', () => {
    const hook = new SyncHook<[string, number]>();
    let captured: [string, number] | undefined;
    hook.tap('t', (a, b) => { captured = [a, b]; });
    hook.call('hello', 5);
    assert.deepStrictEqual(captured, ['hello', 5]);
  });
});

// ---------------------------------------------------------------------------
// AsyncSeriesHook
// ---------------------------------------------------------------------------

describe('AsyncSeriesHook', () => {
  it('awaits handlers in order', async () => {
    const hook = new AsyncSeriesHook<[string]>();
    const calls: string[] = [];

    hook.tap('slow', async (v) => {
      await delay(10);
      calls.push(`slow:${v}`);
    });
    hook.tap('fast', (v) => { calls.push(`fast:${v}`); });

    await hook.call('y');
    assert.deepStrictEqual(calls, ['slow:y', 'fast:y']);
  });

  it('works with zero handlers', async () => {
    const hook = new AsyncSeriesHook<[number]>();
    await hook.call(1); // should not throw
  });

  it('propagates errors', async () => {
    const hook = new AsyncSeriesHook();
    hook.tap('bad', () => { throw new Error('boom'); });
    await assert.rejects(() => hook.call(), { message: 'boom' });
  });
});

// ---------------------------------------------------------------------------
// AsyncSeriesBailHook
// ---------------------------------------------------------------------------

describe('AsyncSeriesBailHook', () => {
  it('returns undefined when no handler bails', async () => {
    const hook = new AsyncSeriesBailHook<[string]>();
    hook.tap('a', () => undefined);
    hook.tap('b', () => undefined);
    const result = await hook.call('z');
    assert.strictEqual(result, undefined);
  });

  it('returns early when handler returns non-undefined', async () => {
    const hook = new AsyncSeriesBailHook<[string]>();
    const calls: string[] = [];

    hook.tap('first', (v) => {
      calls.push('first');
      return `bailed:${v}`;
    });
    hook.tap('second', () => {
      calls.push('second');
      return undefined;
    });

    const result = await hook.call('w');
    assert.strictEqual(result, 'bailed:w');
    assert.deepStrictEqual(calls, ['first']);
  });

  it('does not bail on explicit undefined return', async () => {
    const hook = new AsyncSeriesBailHook<[number]>();
    const calls: string[] = [];

    hook.tap('pass', () => { calls.push('pass'); return undefined; });
    hook.tap('bail', () => { calls.push('bail'); return 'stop'; });
    hook.tap('skip', () => { calls.push('skip'); return undefined; });

    const result = await hook.call(1);
    assert.strictEqual(result, 'stop');
    assert.deepStrictEqual(calls, ['pass', 'bail']);
  });

  it('bails on falsy non-undefined values', async () => {
    const hook = new AsyncSeriesBailHook();

    // null is non-undefined, should bail
    hook.tap('null', () => null);
    const result = await hook.call();
    assert.strictEqual(result, null);
  });

  it('bails on false', async () => {
    const hook = new AsyncSeriesBailHook();
    hook.tap('false', () => false);
    assert.strictEqual(await hook.call(), false);
  });

  it('bails on zero', async () => {
    const hook = new AsyncSeriesBailHook();
    hook.tap('zero', () => 0);
    assert.strictEqual(await hook.call(), 0);
  });

  it('bails on empty string', async () => {
    const hook = new AsyncSeriesBailHook();
    hook.tap('empty', () => '');
    assert.strictEqual(await hook.call(), '');
  });

  it('works with zero handlers', async () => {
    const hook = new AsyncSeriesBailHook();
    assert.strictEqual(await hook.call(), undefined);
  });
});

// ---------------------------------------------------------------------------
// AsyncSeriesWaterfallHook
// ---------------------------------------------------------------------------

describe('AsyncSeriesWaterfallHook', () => {
  it('passes return value through chain', async () => {
    const hook = new AsyncSeriesWaterfallHook<number>();
    hook.tap('double', (v) => v * 2);
    hook.tap('add1', (v) => v + 1);

    const result = await hook.call(5);
    assert.strictEqual(result, 11); // (5*2)+1
  });

  it('returns initial value with zero handlers', async () => {
    const hook = new AsyncSeriesWaterfallHook<string>();
    const result = await hook.call('unchanged');
    assert.strictEqual(result, 'unchanged');
  });

  it('supports async handlers in chain', async () => {
    const hook = new AsyncSeriesWaterfallHook<string>();
    hook.tap('upper', async (v) => {
      await delay(5);
      return v.toUpperCase();
    });
    hook.tap('exclaim', (v) => `${v}!`);

    const result = await hook.call('hello');
    assert.strictEqual(result, 'HELLO!');
  });

  it('works with object values', async () => {
    const hook = new AsyncSeriesWaterfallHook<{ count: number }>();
    hook.tap('inc', (v) => ({ count: v.count + 1 }));
    hook.tap('inc2', (v) => ({ count: v.count + 10 }));

    const result = await hook.call({ count: 0 });
    assert.deepStrictEqual(result, { count: 11 });
  });

  it('propagates errors', async () => {
    const hook = new AsyncSeriesWaterfallHook<number>();
    hook.tap('ok', (v) => v + 1);
    hook.tap('bad', () => { throw new Error('waterfall boom'); });
    hook.tap('unreached', (v) => v + 100);

    await assert.rejects(() => hook.call(0), { message: 'waterfall boom' });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

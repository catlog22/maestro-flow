import { describe, expect, it } from 'vitest';
import { truncateMaestroContext } from '../context-format.js';

describe('truncateMaestroContext', () => {
  it('preserves the closing tag without exceeding the exact limit', () => {
    const content = `<maestro-context>\n${'x'.repeat(200)}\n</maestro-context>`;
    const truncated = truncateMaestroContext(content, 80);
    expect(truncated).toHaveLength(80);
    expect(truncated).toMatch(/\.\.\.\n<\/maestro-context>$/);
  });

  it('returns content unchanged when it is already within budget', () => {
    expect(truncateMaestroContext('<maestro-context />', 80)).toBe('<maestro-context />');
  });
});

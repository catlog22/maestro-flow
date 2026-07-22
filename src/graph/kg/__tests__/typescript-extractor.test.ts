import { describe, it, expect, beforeAll } from 'vitest';
import { CodeParseRunner } from '../extraction/code/worker-parser.js';
import { isTreeSitterAvailable } from '../extraction/code/tree-sitter.js';
import type { ExtractedSymbol } from '../extraction/code/tree-sitter-types.js';

// ---------------------------------------------------------------------------
// Fixture — TS source exercising JSDoc, decorators, and generics.
// ---------------------------------------------------------------------------

const SOURCE = `
/**
 * A generic repository.
 * Manages entities.
 */
@Injectable
@Component({ selector: 'app' })
export class Repository<T, U extends Entity> {
  /** Find an item by id. */
  async findById(id: string): Promise<T> {
    return null as unknown as T;
  }
}

/**
 * Standalone transform function.
 */
export function transform<Input, Output>(input: Input): Output {
  return null as unknown as Output;
}
`;

let symbols: ExtractedSymbol[] = [];
let parsed = false;

beforeAll(async () => {
  if (!isTreeSitterAvailable()) return;
  const runner = new CodeParseRunner();
  try {
    const result = await runner.extract(SOURCE, 'typescript', 'repo.ts');
    symbols = result?.symbols ?? [];
    parsed = result !== null;
  } finally {
    runner.dispose();
  }
});

function findSymbol(name: string): ExtractedSymbol | undefined {
  return symbols.find((s) => s.name === name);
}

// Skip the whole suite when the WASM runtime is unavailable in this env.
describe.skipIf(!isTreeSitterAvailable())('typescriptExtractor: JSDoc / decorator / typeParameters', () => {
  it('parses the fixture (sanity)', () => {
    expect(parsed).toBe(true);
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('extracts a multi-line JSDoc docstring for an exported class', () => {
    const repo = findSymbol('Repository');
    expect(repo).toBeDefined();
    expect(repo!.docstring).toContain('A generic repository');
    expect(repo!.docstring).toContain('Manages entities');
    // Comment markers must be stripped.
    expect(repo!.docstring).not.toContain('/**');
    expect(repo!.docstring).not.toContain('*/');
  });

  it('extracts decorator names (without @ or arguments)', () => {
    const repo = findSymbol('Repository');
    expect(repo).toBeDefined();
    expect(repo!.decorators).toContain('Injectable');
    expect(repo!.decorators).toContain('Component');
  });

  it('extracts generic type parameter names from a class', () => {
    const repo = findSymbol('Repository');
    expect(repo).toBeDefined();
    expect(repo!.typeParameters).toEqual(['T', 'U']);
  });

  it('extracts JSDoc + type parameters for an exported function', () => {
    const transform = findSymbol('transform');
    expect(transform).toBeDefined();
    expect(transform!.docstring).toContain('Standalone transform function');
    expect(transform!.typeParameters).toEqual(['Input', 'Output']);
  });

  it('extracts a single-line JSDoc for a class method', () => {
    const findById = findSymbol('findById');
    expect(findById).toBeDefined();
    expect(findById!.docstring).toContain('Find an item by id');
  });

  it('leaves docstring/decorators/typeParameters empty when absent', () => {
    const findById = findSymbol('findById');
    expect(findById).toBeDefined();
    expect(findById!.decorators).toEqual([]);
    expect(findById!.typeParameters).toEqual([]);
  });
});

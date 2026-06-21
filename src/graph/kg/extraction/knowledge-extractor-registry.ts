import { resolve } from 'node:path';
import type { ExtractionResult, SourceType } from '../db/types.js';
import { extractDomain } from './knowledge/domain-extractor.js';
import { extractSpec } from './knowledge/spec-extractor.js';
import { extractWiki } from './knowledge/wiki-extractor.js';
import { extractCodebase } from './knowledge/codebase-extractor.js';
import { extractIssues } from './knowledge/issue-extractor.js';

export type ExtractorFunction = (sourcePath: string, workflowRoot: string) => ExtractionResult;
export type PathResolver = (workflowRoot: string) => string;

export interface KnowledgeExtractorEntry {
  name: string;
  sourceType: SourceType;
  extractFn: ExtractorFunction;
  resolvePath: PathResolver;
}

class KnowledgeExtractorRegistryImpl {
  private registry = new Map<string, KnowledgeExtractorEntry>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      name: 'domain',
      sourceType: 'domain',
      extractFn: extractDomain,
      resolvePath: (wr) => resolve(wr, 'domain', 'glossary.json'),
    });
    this.register({
      name: 'spec',
      sourceType: 'spec',
      extractFn: extractSpec,
      resolvePath: (wr) => resolve(wr, 'specs'),
    });
    this.register({
      name: 'knowhow',
      sourceType: 'knowhow',
      extractFn: extractWiki,
      resolvePath: (wr) => resolve(wr, 'knowhow'),
    });
    this.register({
      name: 'codebase',
      sourceType: 'codebase',
      extractFn: extractCodebase,
      resolvePath: (wr) => resolve(wr, 'codebase'),
    });
    this.register({
      name: 'issue',
      sourceType: 'issue',
      extractFn: extractIssues,
      resolvePath: (wr) => resolve(wr, 'issues', 'issues.jsonl'),
    });
  }

  register(entry: KnowledgeExtractorEntry): void {
    this.registry.set(entry.name, entry);
  }

  unregister(name: string): boolean {
    return this.registry.delete(name);
  }

  get(name: string): KnowledgeExtractorEntry | undefined {
    return this.registry.get(name);
  }

  getAll(): KnowledgeExtractorEntry[] {
    return Array.from(this.registry.values());
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  get size(): number {
    return this.registry.size;
  }
}

export const KnowledgeExtractorRegistry = new KnowledgeExtractorRegistryImpl();
export type { KnowledgeExtractorRegistryImpl };

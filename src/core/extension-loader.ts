import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Extension, ExtensionContext, Tool } from '../types/index.js';
import type { ToolRegistry } from './tool-registry.js';
import { NodeKindRegistry } from '../graph/kg/db/node-kind-registry.js';
import { KnowledgeExtractorRegistry } from '../graph/kg/extraction/knowledge-extractor-registry.js';
import type { KnowledgeExtractorEntry } from '../graph/kg/extraction/knowledge-extractor-registry.js';

export class ExtensionLoader {
  private loaded = new Map<string, Extension>();

  constructor(private registry: ToolRegistry) {}

  async loadFromDir(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extPath = join(dir, entry.name);
      await this.loadExtension(extPath);
    }
  }

  async loadExtension(extPath: string): Promise<void> {
    const entryFile = join(extPath, 'index.js');
    if (!existsSync(entryFile)) {
      console.warn(`Extension at ${extPath} missing index.js, skipping`);
      return;
    }

    try {
      const mod = await import(`file://${entryFile}`);
      const ext: Extension = mod.default ?? mod;

      const ctx: ExtensionContext = {
        registerTool: (tool: Tool) => this.registry.register(tool),
        registerNodeKind: (kind, meta) => NodeKindRegistry.register(kind, meta),
        registerKnowledgeExtractor: (entry) => KnowledgeExtractorRegistry.register(entry as KnowledgeExtractorEntry),
        config: {},
        log: (msg: string) => console.log(`[ext:${ext.name}] ${msg}`),
      };

      await ext.activate(ctx);
      this.loaded.set(ext.name, ext);
      console.log(`Loaded extension: ${ext.name}@${ext.version}`);
    } catch (err) {
      console.error(`Failed to load extension at ${extPath}:`, err);
    }
  }

  async unloadAll(): Promise<void> {
    for (const [name, ext] of this.loaded) {
      if (ext.deactivate) {
        await ext.deactivate();
      }
      this.loaded.delete(name);
    }
  }

  listLoaded(): string[] {
    return Array.from(this.loaded.keys());
  }
}

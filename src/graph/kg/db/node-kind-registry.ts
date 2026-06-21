import { CODE_NODE_KINDS, KNOWLEDGE_NODE_KINDS } from './types.js';

export interface NodeKindMeta {
  category: 'code' | 'knowledge' | 'custom';
  description?: string;
}

class NodeKindRegistryImpl {
  private registry = new Map<string, NodeKindMeta>();

  constructor() {
    for (const kind of CODE_NODE_KINDS) {
      this.registry.set(kind, { category: 'code' });
    }
    for (const kind of KNOWLEDGE_NODE_KINDS) {
      this.registry.set(kind, { category: 'knowledge' });
    }
  }

  register(kind: string, meta?: Partial<NodeKindMeta>): void {
    if (this.registry.has(kind)) return;
    this.registry.set(kind, { category: 'custom', ...meta });
  }

  unregister(kind: string): boolean {
    const meta = this.registry.get(kind);
    if (!meta || meta.category !== 'custom') return false;
    return this.registry.delete(kind);
  }

  isValid(kind: string): boolean {
    return this.registry.has(kind);
  }

  getAll(): string[] {
    return Array.from(this.registry.keys());
  }

  getByCategory(category: NodeKindMeta['category']): string[] {
    return Array.from(this.registry.entries())
      .filter(([, meta]) => meta.category === category)
      .map(([kind]) => kind);
  }

  getMeta(kind: string): NodeKindMeta | undefined {
    return this.registry.get(kind);
  }

  get size(): number {
    return this.registry.size;
  }
}

export const NodeKindRegistry = new NodeKindRegistryImpl();
export type { NodeKindRegistryImpl };

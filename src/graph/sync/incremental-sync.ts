import { execSync } from 'node:child_process';
import { join, extname, basename, relative, dirname } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import type { DatabaseConnection } from '../db/connection.js';
import { QueryBuilder } from '../db/queries.js';
import { computeFileHash } from './content-hash.js';
import type { EnhancedNode, EnhancedEdge, FileRecord, Language, NodeKind } from '../types.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.py', '.go', '.java', '.rs',
]);

const EXT_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.mjs': 'javascript', '.cjs': 'javascript', '.vue': 'vue', '.py': 'python',
  '.go': 'go', '.java': 'java', '.rs': 'rust',
};

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export interface SyncResult {
  filesChanged: number;
  nodesAdded: number;
  edgesAdded: number;
  durationMs: number;
}

export class IncrementalSync {
  private projectRoot: string;
  private conn: DatabaseConnection;
  private queries: QueryBuilder;

  constructor(projectRoot: string, conn: DatabaseConnection) {
    this.projectRoot = projectRoot;
    this.conn = conn;
    this.queries = new QueryBuilder(conn);
  }

  sync(): SyncResult {
    const start = Date.now();
    const changedFiles = this.detectChanges();

    if (changedFiles.added.length === 0 && changedFiles.modified.length === 0 && changedFiles.deleted.length === 0) {
      return { filesChanged: 0, nodesAdded: 0, edgesAdded: 0, durationMs: Date.now() - start };
    }

    let nodesAdded = 0;
    let edgesAdded = 0;

    this.conn.transaction(() => {
      for (const path of changedFiles.deleted) {
        this.queries.deleteEdgesForFile(path);
        this.queries.deleteNodesByFile(path);
        this.queries.deleteUnresolvedRefsForFile(path);
        this.queries.deleteFile(path);
      }

      const allSourceFiles = this.getAllSourceFiles();
      const fileSet = new Set(allSourceFiles.map(f => f.relPath));

      const toProcess = [...changedFiles.added, ...changedFiles.modified];
      const allExtracted: Array<{ relPath: string; nodes: EnhancedNode[]; edges: EnhancedEdge[] }> = [];

      // Phase 1: Extract all files and collect nodes + edges
      for (const relPath of toProcess) {
        this.queries.deleteEdgesForFile(relPath);
        this.queries.deleteNodesByFile(relPath);
        this.queries.deleteUnresolvedRefsForFile(relPath);

        const absPath = join(this.projectRoot, relPath);
        const result = this.extractFile(absPath, relPath, fileSet);
        if (result) allExtracted.push({ relPath, ...result });
      }

      // Phase 2: Insert all nodes first (so FK constraints are satisfied)
      const allNodeIds = new Set<string>();
      for (const { nodes } of allExtracted) {
        this.queries.insertNodes(nodes);
        nodesAdded += nodes.length;
        for (const n of nodes) allNodeIds.add(n.id);
      }

      // Phase 3: Insert edges, filtering out any with missing targets
      for (const { edges } of allExtracted) {
        const validEdges = edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target));
        if (validEdges.length > 0) {
          this.queries.insertEdges(validEdges);
          edgesAdded += validEdges.length;
        }
      }

      // Phase 4: Update file records
      for (const { relPath, nodes } of allExtracted) {
        const absPath = join(this.projectRoot, relPath);
        const hash = computeFileHash(absPath);
        const stat = statSync(absPath);
        this.queries.upsertFile({
          path: relPath,
          contentHash: hash ?? '',
          language: EXT_LANGUAGE[extname(relPath).toLowerCase()] ?? 'unknown',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          indexedAt: new Date().toISOString(),
          nodeCount: nodes.length,
          errors: [],
        });
      }
    });

    this.conn.runMaintenance();

    return {
      filesChanged: changedFiles.added.length + changedFiles.modified.length + changedFiles.deleted.length,
      nodesAdded,
      edgesAdded,
      durationMs: Date.now() - start,
    };
  }

  private detectChanges(): { added: string[]; modified: string[]; deleted: string[] } {
    const dbFiles = this.queries.getAllFiles();

    // If DB is empty, treat all source files as "added" (initial full index)
    if (dbFiles.length === 0) {
      const allFiles = this.getAllSourceFiles();
      return { added: allFiles.map(f => f.relPath), modified: [], deleted: [] };
    }

    // Git fast-path: if repo is clean, use content hashes against DB
    const gitChanges = this.getGitChangedFiles();
    if (gitChanges && gitChanges.length > 0) return this.classifyGitChanges(gitChanges);

    // Fallback: compare content hashes for all files
    const currentFiles = this.getAllSourceFiles();
    const currentHashes = new Map<string, string>();
    for (const file of currentFiles) {
      const hash = computeFileHash(file.absolutePath);
      if (hash) currentHashes.set(file.relPath, hash);
    }
    return this.queries.getStaleFiles(currentHashes);
  }

  private getGitChangedFiles(): Array<{ status: string; path: string }> | null {
    try {
      const output = execSync('git status --porcelain', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!output.trim()) return [];
      return output.trim().split('\n').map(line => {
        const status = line.slice(0, 2).trim();
        const path = line.slice(3).trim();
        return { status, path };
      }).filter(f => {
        const ext = extname(f.path).toLowerCase();
        return SOURCE_EXTENSIONS.has(ext);
      });
    } catch {
      return null;
    }
  }

  private classifyGitChanges(changes: Array<{ status: string; path: string }>): {
    added: string[]; modified: string[]; deleted: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const change of changes) {
      const rel = change.path.replace(/\\/g, '/');
      if (change.status === 'D') deleted.push(rel);
      else if (change.status === '??' || change.status === 'A') added.push(rel);
      else modified.push(rel);
    }
    return { added, modified, deleted };
  }

  private getAllSourceFiles(): Array<{ absolutePath: string; relPath: string }> {
    try {
      const output = execSync('git ls-files -z -co --exclude-standard', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.split('\0').filter(f => f.length > 0).filter(f => {
        const ext = extname(f).toLowerCase();
        return SOURCE_EXTENSIONS.has(ext);
      }).map(f => ({
        absolutePath: join(this.projectRoot, f),
        relPath: f.replace(/\\/g, '/'),
      }));
    } catch {
      return [];
    }
  }

  private extractFile(
    absolutePath: string, relPath: string, fileSet: Set<string>,
  ): { nodes: EnhancedNode[]; edges: EnhancedEdge[] } | null {
    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch {
      return null;
    }

    const ext = extname(relPath).toLowerCase();
    const language = EXT_LANGUAGE[ext] ?? 'unknown';
    const name = basename(relPath);
    const lineCount = content.split('\n').length;

    const nodes: EnhancedNode[] = [];
    const edges: EnhancedEdge[] = [];

    const fileId = `file:${relPath}`;
    nodes.push({
      id: fileId,
      kind: 'file',
      name,
      qualifiedName: relPath,
      filePath: relPath,
      language: language as Language,
      startLine: 1,
      endLine: lineCount,
      startColumn: 0,
      endColumn: 0,
      docstring: '',
      signature: '',
      visibility: '',
      isExported: false,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: [],
      typeParameters: [],
      updatedAt: new Date().toISOString(),
    });

    const symbols = this.extractSymbols(content, relPath, language as Language);
    for (const sym of symbols) {
      nodes.push(sym);
      edges.push({ source: fileId, target: sym.id, kind: 'contains' });
    }

    const importTargets = this.extractImports(content);
    for (const target of importTargets) {
      const resolvedId = this.resolveImport(target, relPath, fileSet);
      if (resolvedId) {
        edges.push({ source: fileId, target: resolvedId, kind: 'imports' });
      }
    }

    return { nodes, edges };
  }

  private extractSymbols(content: string, filePath: string, language: Language): EnhancedNode[] {
    const symbols: EnhancedNode[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    const patterns: Array<{
      regex: RegExp;
      kind: NodeKind;
      nameGroup: number;
      signatureFromMatch?: boolean;
    }> = [
      { regex: /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, kind: 'function', nameGroup: 1, signatureFromMatch: true },
      { regex: /export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g, kind: 'class', nameGroup: 1, signatureFromMatch: true },
      { regex: /export\s+(?:default\s+)?interface\s+(\w+)/g, kind: 'interface', nameGroup: 1, signatureFromMatch: true },
      { regex: /export\s+(?:default\s+)?type\s+(\w+)\s*=/g, kind: 'type_alias', nameGroup: 1, signatureFromMatch: true },
      { regex: /export\s+(?:default\s+)?enum\s+(\w+)/g, kind: 'enum', nameGroup: 1, signatureFromMatch: true },
      { regex: /export\s+(?:const|let|var)\s+(\w+)/g, kind: 'variable', nameGroup: 1 },
      { regex: /(?:async\s+)?function\s+(\w+)\s*\(/g, kind: 'function', nameGroup: 1, signatureFromMatch: true },
      { regex: /(?:abstract\s+)?class\s+(\w+)/g, kind: 'class', nameGroup: 1, signatureFromMatch: true },
      { regex: /interface\s+(\w+)/g, kind: 'interface', nameGroup: 1, signatureFromMatch: true },
      { regex: /type\s+(\w+)\s*=/g, kind: 'type_alias', nameGroup: 1, signatureFromMatch: true },
      { regex: /enum\s+(\w+)/g, kind: 'enum', nameGroup: 1, signatureFromMatch: true },
    ];

    for (const { regex, kind, nameGroup, signatureFromMatch } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[nameGroup];
        if (!name) continue;
        const id = `${kind}:${filePath}:${name}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const offset = match.index;
        let startLine = 1;
        for (let i = 0; i < offset && i < content.length; i++) {
          if (content[i] === '\n') startLine++;
        }

        const fullLine = lines[startLine - 1] ?? '';
        const isExported = fullLine.trimStart().startsWith('export');
        const isAsync = fullLine.includes('async ');
        const isStatic = fullLine.includes('static ');
        const isAbstract = fullLine.includes('abstract ');

        let visibility: EnhancedNode['visibility'] = '';
        if (fullLine.includes('private ')) visibility = 'private';
        else if (fullLine.includes('protected ')) visibility = 'protected';
        else if (fullLine.includes('public ') || isExported) visibility = 'public';

        const decorators: string[] = [];
        if (startLine >= 2) {
          const prevLine = (lines[startLine - 2] ?? '').trim();
          if (prevLine.startsWith('@')) {
            const decMatch = prevLine.match(/@(\w+)/);
            if (decMatch) decorators.push(decMatch[1]);
          }
        }

        symbols.push({
          id,
          kind,
          name,
          qualifiedName: `${filePath}::${name}`,
          filePath,
          language,
          startLine,
          endLine: startLine,
          startColumn: 0,
          endColumn: 0,
          docstring: '',
          signature: signatureFromMatch ? fullLine.trim() : '',
          visibility,
          isExported,
          isAsync,
          isStatic,
          isAbstract,
          decorators,
          typeParameters: [],
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return symbols;
  }

  private extractImports(content: string): string[] {
    const targets: string[] = [];
    const esmRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = esmRegex.exec(content)) !== null) targets.push(match[1]);
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = cjsRegex.exec(content)) !== null) targets.push(match[1]);
    return targets;
  }

  private resolveImport(specifier: string, sourceRelPath: string, fileSet: Set<string>): string | null {
    if (!specifier.startsWith('.')) return null;
    const sourceDir = dirname(sourceRelPath);
    let resolved = posix.normalize(posix.join(sourceDir, specifier));
    if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3);
    if (fileSet.has(resolved)) return `file:${resolved}`;
    for (const ext of RESOLVE_EXTENSIONS) {
      if (fileSet.has(resolved + ext)) return `file:${resolved + ext}`;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexPath = posix.join(resolved, `index${ext}`);
      if (fileSet.has(indexPath)) return `file:${indexPath}`;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// fs-analyzer.ts -- Filesystem-based code analyzer.
//
// Recursively walks a project directory, extracts file nodes, import edges,
// exported symbols, module groupings, and architectural layers.
//
// No external dependencies -- uses only Node.js built-in modules.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, dirname, sep, posix } from 'node:path';
import { execSync } from 'node:child_process';

import type {
  CodeAnalyzer,
  AnalyzerOptions,
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  Layer,
  TourStep,
  ProjectMeta,
} from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.py', '.go', '.java', '.rs',
]);

/** Extensions that are recognized as config/doc/infra (non-source) files. */
const NON_SOURCE_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini',
  '.md', '.txt', '.rst',
  '.dockerfile',
]);

const DEFAULT_EXCLUDES = [
  'node_modules', 'dist', '.git', '.workflow',
];

const LAYER_PATTERNS: Record<string, { name: string; description: string }> = {
  'commands':    { name: 'CLI Commands',          description: 'Command-line interface entry points' },
  'coordinator': { name: 'Workflow Coordinator',  description: 'Workflow orchestration and coordination' },
  'hooks':       { name: 'Hook System',           description: 'Plugin and extensibility hooks' },
  'tools':       { name: 'Tool Layer',            description: 'External tool integrations' },
  'core':        { name: 'Core Infrastructure',   description: 'Core modules and shared infrastructure' },
  'graph':       { name: 'Graph Module',          description: 'Knowledge graph data structures and queries' },
  'agents':      { name: 'Agent Management',      description: 'Agent lifecycle and orchestration' },
  'async':       { name: 'Async Delegation',      description: 'Asynchronous task delegation' },
  'tui':         { name: 'Terminal UI',           description: 'Terminal user interface components' },
  'db':          { name: 'Backend',               description: 'Backend services, data, and middleware' },
  'services':    { name: 'Backend',               description: 'Backend services, data, and middleware' },
  'routes':      { name: 'Backend',               description: 'Backend services, data, and middleware' },
  'middleware':  { name: 'Backend',               description: 'Backend services, data, and middleware' },
  'config':      { name: 'Utilities',             description: 'Configuration, utilities, and i18n' },
  'utils':       { name: 'Utilities',             description: 'Configuration, utilities, and i18n' },
  'i18n':        { name: 'Utilities',             description: 'Configuration, utilities, and i18n' },
};

const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.vue': 'Vue', '.py': 'Python',
  '.go': 'Go', '.java': 'Java', '.rs': 'Rust',
};

// ---------------------------------------------------------------------------
// File category classification
// ---------------------------------------------------------------------------

/** Config file names and patterns. */
const CONFIG_NAMES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.prettierrc', '.prettierrc.js', '.prettierrc.json',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
  'webpack.config.js', 'vite.config.ts', 'rollup.config.js',
  '.babelrc', 'babel.config.js',
  'Makefile', 'CMakeLists.txt',
  'pyproject.toml', 'setup.py', 'setup.cfg',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
]);

/** Infra directory patterns. */
const INFRA_DIRS = new Set([
  '.github', '.gitlab', '.circleci', 'k8s', 'kubernetes',
  'terraform', 'helm', 'deploy', 'docker', 'infra',
]);

const INFRA_NAMES = new Set([
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.dockerignore', 'Vagrantfile',
]);

/** Test directory patterns. */
const TEST_DIRS = new Set([
  '__tests__', 'test', 'tests', 'spec', 'specs',
]);

const TEST_INFIXES = ['.test.', '.spec.', '_test.', 'test_'];

/** Classify a file into a category based on name, extension, and path. */
function classifyFileCategory(relPath: string, name: string, ext: string): string {
  // Test files
  const parts = relPath.split(posix.sep);
  if (parts.some(p => TEST_DIRS.has(p))) return 'test';
  if (TEST_INFIXES.some(infix => name.includes(infix))) return 'test';
  if (name.startsWith('test_') || name.endsWith('_test' + ext)) return 'test';

  // Config files
  if (CONFIG_NAMES.has(name)) return 'config';
  if (name.startsWith('.') && (ext === '.json' || ext === '.js' || ext === '.cjs' || ext === '.yaml' || ext === '.yml')) return 'config';

  // Infra files
  if (INFRA_NAMES.has(name)) return 'infra';
  if (parts.some(p => INFRA_DIRS.has(p))) return 'infra';

  // Docs
  if (ext === '.md' || ext === '.txt' || ext === '.rst') return 'docs';

  // Default: code
  return 'code';
}

// ---------------------------------------------------------------------------
// Test file detection (aligned with merger.ts)
// ---------------------------------------------------------------------------

/** Check if a relative path looks like a test file (aligned with merger.ts isTestPath). */
function isTestFile(relPath: string): boolean {
  const name = basename(relPath);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);

  // JS/TS family: infix pattern
  if (SOURCE_EXTENSIONS.has(ext)) {
    if (stem.endsWith('.test') || stem.endsWith('.spec')) return true;
  }

  // Go
  if (ext === '.go' && stem.endsWith('_test')) return true;

  // Python
  if (ext === '.py' && (stem.startsWith('test_') || stem.endsWith('_test'))) return true;

  // Java/Kotlin/C#
  if ((ext === '.java' || ext === '.kt' || ext === '.cs') &&
    (stem.endsWith('Test') || stem.endsWith('Tests') || stem.endsWith('IT'))) return true;

  // Directory-based
  const parts = relPath.split(posix.sep);
  if (parts.some(p => TEST_DIRS.has(p))) return true;

  return false;
}

/**
 * For a test file, compute candidate production file paths.
 * Simplified version of merger.ts productionCandidates, covering the
 * most common patterns: sibling de-infix, walk out of test dir, mirrored tree.
 */
function findProductionFile(testPath: string, fileSet: Set<string>): string | null {
  const name = basename(testPath);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const dir = dirname(testPath);
  const dirParts = dir.split(posix.sep).filter(s => s !== '.' && s !== '');

  const JS_TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  // Helper: try candidate path
  function tryPath(candidate: string): string | null {
    const norm = posix.normalize(candidate);
    return fileSet.has(norm) ? norm : null;
  }

  // Helper: try all JS/TS extensions for a stem in a directory
  function tryStem(dir: string, baseStem: string): string | null {
    for (const e of JS_TS_EXTS) {
      const result = tryPath(dir ? `${dir}/${baseStem}${e}` : `${baseStem}${e}`);
      if (result) return result;
    }
    return null;
  }

  // JS/TS family: strip .test / .spec infix
  if (SOURCE_EXTENSIONS.has(ext)) {
    let baseStem: string | null = null;
    if (stem.endsWith('.test')) baseStem = stem.slice(0, -5);
    else if (stem.endsWith('.spec')) baseStem = stem.slice(0, -5);

    if (baseStem) {
      // 1. Sibling
      const sibling = tryStem(dir === '.' ? '' : dir, baseStem);
      if (sibling) return sibling;

      // 2. Walk out of __tests__ / test / spec directory
      if (dirParts.length > 0 && TEST_DIRS.has(dirParts[dirParts.length - 1])) {
        const parentDir = dirParts.slice(0, -1).join('/');
        const result = tryStem(parentDir, baseStem);
        if (result) return result;
      }

      // 3. Mirrored tree (tests/... -> src/...)
      if (dirParts.length > 0 && TEST_DIRS.has(dirParts[0])) {
        const tailPath = dirParts.slice(1).join('/');
        for (const root of ['src', 'app', 'lib', '']) {
          const newDir = [root, tailPath].filter(Boolean).join('/');
          const result = tryStem(newDir, baseStem);
          if (result) return result;
        }
      }
    }
  }

  // Go
  if (ext === '.go' && stem.endsWith('_test')) {
    const baseStem = stem.slice(0, -5);
    return tryPath(dir === '.' ? `${baseStem}.go` : `${dir}/${baseStem}.go`);
  }

  // Python
  if (ext === '.py') {
    let baseStem: string | null = null;
    if (stem.startsWith('test_')) baseStem = stem.slice(5);
    else if (stem.endsWith('_test')) baseStem = stem.slice(0, -5);
    if (baseStem) {
      const candidate = dir === '.' ? `${baseStem}.py` : `${dir}/${baseStem}.py`;
      return tryPath(candidate);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize path separators to forward slashes. */
function toForward(p: string): string {
  return p.split(sep).join(posix.sep);
}

/** Simple glob-like match: supports leading *, trailing *, and exact. */
function simpleMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern.startsWith('*') && value.endsWith(pattern.slice(1))) return true;
  if (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))) return true;
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    return value.includes(pattern.slice(1, -1));
  }
  // Support *.test.* style patterns
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    );
    return regex.test(value);
  }
  return false;
}

/** Check whether a file or directory should be excluded. */
function shouldExclude(name: string, relPath: string, excludes: string[]): boolean {
  for (const pattern of excludes) {
    if (simpleMatch(pattern, name)) return true;
    if (simpleMatch(pattern, relPath)) return true;
    // Also check if any path segment matches (e.g. "node_modules" deep in tree)
    const segments = relPath.split(posix.sep);
    if (segments.some(seg => simpleMatch(pattern, seg))) return true;
  }
  return false;
}

/** Determine complexity heuristic from line count (legacy, kept for backward compat). */
function complexityFromLines(lineCount: number): string {
  if (lineCount < 100) return 'simple';
  if (lineCount <= 300) return 'moderate';
  return 'complex';
}

/**
 * Enhanced complexity heuristic factoring in line count, exports, imports,
 * and nesting depth. Returns a score-based classification.
 */
function enhancedComplexity(
  lineCount: number,
  exportCount: number,
  importCount: number,
  content: string,
): string {
  // Base score from lines
  let score = 0;
  if (lineCount >= 300) score += 3;
  else if (lineCount >= 100) score += 2;
  else score += 1;

  // Export complexity: more public surface = more complex interface
  if (exportCount >= 10) score += 2;
  else if (exportCount >= 5) score += 1;

  // Import coupling: many dependencies = higher complexity
  if (importCount >= 10) score += 2;
  else if (importCount >= 5) score += 1;

  // Nesting depth heuristic: count deeply nested blocks
  let depth = 0;
  let maxDepth = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (content[i] === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  if (maxDepth >= 6) score += 2;
  else if (maxDepth >= 4) score += 1;

  if (score <= 2) return 'simple';
  if (score <= 5) return 'moderate';
  return 'complex';
}

/** Derive tags from directory name and file extension. */
function deriveTags(relPath: string, ext: string): string[] {
  const tags: string[] = [];
  const parts = relPath.split(posix.sep);
  // Add first meaningful directory as tag
  if (parts.length > 1) {
    tags.push(parts[0]);
  }
  // Add language tag
  const lang = EXT_LANGUAGE[ext];
  if (lang) tags.push(lang.toLowerCase());
  return tags;
}

// ---------------------------------------------------------------------------
// Git-aware file enumeration
// ---------------------------------------------------------------------------

/**
 * Use `git ls-files` to enumerate tracked + untracked (non-ignored) files.
 * Returns null if git is unavailable or the directory is not a git repo.
 */
function gitLsFiles(root: string): string[] | null {
  try {
    const output = execSync('git ls-files -z -co --exclude-standard', {
      cwd: root,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\0').filter(f => f.length > 0);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/** Extract import targets from source code. */
function extractImports(content: string): string[] {
  const targets: string[] = [];

  // ESM: import ... from '...'
  const esmRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = esmRegex.exec(content)) !== null) {
    targets.push(match[1]);
  }

  // CJS: require('...')
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsRegex.exec(content)) !== null) {
    targets.push(match[1]);
  }

  return targets;
}

/** Structured import with named symbols for call graph extraction. */
interface ImportInfo {
  specifier: string;
  symbols: string[];  // named imports (e.g., { foo, bar } from '...')
  defaultImport?: string;
}

/** Extract imports with named symbols for call graph analysis. */
function extractImportsWithSymbols(content: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  // ESM: import { foo, bar } from '...'
  // ESM: import DefaultName from '...'
  // ESM: import DefaultName, { foo } from '...'
  const esmRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = esmRegex.exec(content)) !== null) {
    const clause = match[1];
    const specifier = match[2];
    const symbols: string[] = [];
    let defaultImport: string | undefined;

    // Extract named imports: { foo, bar, baz as qux }
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const parts = namedMatch[1].split(',');
      for (const p of parts) {
        const trimmed = p.trim();
        if (!trimmed) continue;
        // handle "foo as bar" -> use the local name "bar"
        const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
        if (asMatch) {
          symbols.push(asMatch[2]);
        } else if (/^\w+$/.test(trimmed)) {
          symbols.push(trimmed);
        }
      }
    }

    // Extract default import
    const defaultMatch = clause.match(/^(\w+)/);
    if (defaultMatch && defaultMatch[1] !== 'type') {
      defaultImport = defaultMatch[1];
    }

    results.push({ specifier, symbols, defaultImport });
  }

  return results;
}

/** Extract exported symbol names from source code. */
function extractExports(content: string): Array<{ name: string; kind: string }> {
  const exports: Array<{ name: string; kind: string }> = [];
  const seen = new Set<string>();

  // export function/class/interface/type/const/enum
  const namedRegex = /export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|var|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = namedRegex.exec(content)) !== null) {
    const kind = match[1];
    const name = match[2];
    if (!seen.has(name)) {
      seen.add(name);
      exports.push({ name, kind });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Call graph extraction
// ---------------------------------------------------------------------------

/**
 * Find call sites in content that reference imported symbols.
 * Returns the set of symbol names that are actually called.
 */
function extractCallSites(content: string, importedSymbols: Set<string>): Set<string> {
  const called = new Set<string>();
  if (importedSymbols.size === 0) return called;

  // Build a regex that matches any imported symbol followed by '('
  // This catches: symbolName(, obj.symbolName( patterns
  for (const sym of importedSymbols) {
    // Match: word boundary + symbol + optional whitespace + '('
    // Exclude: import/export/from/type keywords followed by the symbol
    const pattern = new RegExp(`(?<!\\.)\\b${escapeRegex(sym)}\\s*\\(`, 'g');
    if (pattern.test(content)) {
      called.add(sym);
    }
  }

  return called;
}

/** Escape special regex characters. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/** Entry-point file names that should appear first in tour. */
const ENTRY_POINT_NAMES = new Set([
  'index.ts', 'index.js', 'index.tsx', 'index.jsx',
  'main.ts', 'main.js', 'cli.ts', 'cli.js',
  'app.ts', 'app.js', 'server.ts', 'server.js',
]);

/**
 * Topological sort of module names using Kahn's algorithm.
 * Modules with no incoming edges (entry points) come first.
 * Falls back to alphabetical for cycles.
 */
function topologicalSortModules(
  modules: string[],
  moduleEdges: Array<{ source: string; target: string }>,
  entryModules: Set<string>,
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const m of modules) {
    inDegree.set(m, 0);
    adjacency.set(m, []);
  }

  for (const edge of moduleEdges) {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Priority queue: entry modules first, then by in-degree (ascending)
  const queue: string[] = [];
  const result: string[] = [];
  const visited = new Set<string>();

  // Seed with zero-degree nodes, prioritizing entry modules
  const zeroDegree = modules.filter(m => (inDegree.get(m) ?? 0) === 0);
  const entryFirst = zeroDegree.filter(m => entryModules.has(m));
  const rest = zeroDegree.filter(m => !entryModules.has(m)).sort();
  queue.push(...entryFirst, ...rest);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    const neighbors = (adjacency.get(current) ?? []).sort();
    for (const neighbor of neighbors) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0 && !visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Add any remaining nodes (cycles) in alphabetical order
  for (const m of modules.sort()) {
    if (!visited.has(m)) {
      result.push(m);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

/** Known source extensions for resolution attempts. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Resolve a relative import specifier to a file: node ID.
 * Returns null if the import is a package (not relative).
 */
function resolveImport(
  importSpecifier: string,
  sourceRelPath: string,
  fileSet: Set<string>,
): string | null {
  // Only resolve relative imports
  if (!importSpecifier.startsWith('.')) return null;

  const sourceDir = dirname(sourceRelPath);
  let resolved = posix.normalize(posix.join(sourceDir, importSpecifier));

  // Strip .js extension that TypeScript uses in ESM imports
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3);
  }

  // Try exact match first
  if (fileSet.has(resolved)) return `file:${resolved}`;

  // Try adding extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(resolved + ext)) return `file:${resolved + ext}`;
  }

  // Try index file in directory
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = posix.join(resolved, `index${ext}`);
    if (fileSet.has(indexPath)) return `file:${indexPath}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

interface FileEntry {
  absolutePath: string;
  relPath: string;  // forward-slash relative path
}

function walkDirectory(
  root: string,
  options: { includes: string[]; excludes: string[] },
): FileEntry[] {
  const entries: FileEntry[] = [];

  function walk(dir: string): void {
    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = join(dir, item);
      const rel = toForward(relative(root, fullPath));

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!shouldExclude(item, rel, options.excludes)) {
          walk(fullPath);
        }
        continue;
      }

      if (!stat.isFile()) continue;

      const ext = extname(item).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext) && !NON_SOURCE_EXTENSIONS.has(ext)) continue;

      if (shouldExclude(item, rel, options.excludes)) continue;

      // Apply include filter if specified
      if (options.includes.length > 0) {
        const matched = options.includes.some(p => simpleMatch(p, rel) || simpleMatch(p, item));
        if (!matched) continue;
      }

      entries.push({ absolutePath: fullPath, relPath: rel });
    }
  }

  walk(root);
  return entries;
}

/**
 * Git-aware file enumeration. Uses `git ls-files` for accurate file listing
 * that respects .gitignore. Falls back to walkDirectory on failure.
 */
function gitWalkDirectory(
  root: string,
  options: { includes: string[]; excludes: string[] },
): FileEntry[] {
  const gitFiles = gitLsFiles(root);
  if (!gitFiles) return walkDirectory(root, options);

  const entries: FileEntry[] = [];
  for (const relFile of gitFiles) {
    const rel = toForward(relFile);
    const name = basename(rel);
    const ext = extname(name).toLowerCase();

    // Filter by known extensions
    if (!SOURCE_EXTENSIONS.has(ext) && !NON_SOURCE_EXTENSIONS.has(ext)) continue;

    // Apply exclusion rules
    if (shouldExclude(name, rel, options.excludes)) continue;

    // Apply include filter
    if (options.includes.length > 0) {
      const matched = options.includes.some(p => simpleMatch(p, rel) || simpleMatch(p, name));
      if (!matched) continue;
    }

    entries.push({ absolutePath: join(root, relFile), relPath: rel });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// FsAnalyzer
// ---------------------------------------------------------------------------

export class FsAnalyzer implements CodeAnalyzer {
  readonly name = 'fs-analyzer';

  async analyze(projectRoot: string, options?: AnalyzerOptions): Promise<KnowledgeGraph> {
    const root = projectRoot;
    const excludes = options?.exclude ?? DEFAULT_EXCLUDES;
    const includes = options?.include ?? [];

    // 1. Walk filesystem -- prefer git ls-files when available
    const files = gitWalkDirectory(root, { includes, excludes });
    const fileSet = new Set(files.map(f => f.relPath));

    // 2. Build nodes, edges, and collect metadata
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const languagesFound = new Set<string>();
    const moduleFiles = new Map<string, string[]>(); // module dir -> file node IDs

    // Track exported symbols per file for call graph extraction
    const fileExportedSymbols = new Map<string, Set<string>>(); // fileId -> Set<symbolName>
    // Track imports with symbols per file for call graph
    const fileImportSymbols = new Map<string, Array<{ targetFileId: string; symbols: string[] }>>();
    // Track test files for tested_by linking
    const testFiles: Array<{ relPath: string; fileId: string }> = [];
    // Track module-level import edges for topological sort
    const moduleImportEdges: Array<{ source: string; target: string }> = [];
    // Track entry-point modules
    const entryModules = new Set<string>();

    for (const file of files) {
      const ext = extname(file.relPath).toLowerCase();
      const name = basename(file.relPath);
      const parts = file.relPath.split(posix.sep);
      const moduleDir = parts.length > 1 ? parts[0] : '_root';
      const isSource = SOURCE_EXTENSIONS.has(ext);

      // Track language
      const lang = EXT_LANGUAGE[ext];
      if (lang) languagesFound.add(lang);

      // Classify file category
      const category = classifyFileCategory(file.relPath, name, ext);

      // For non-source files, create lightweight nodes without parsing
      if (!isSource) {
        const fileId = `file:${file.relPath}`;
        const tags = deriveTags(file.relPath, ext);
        tags.push(category);

        nodes.push({
          id: fileId,
          type: 'file',
          name,
          filePath: file.relPath,
          summary: `${category} file: ${name}`,
          tags,
          complexity: 'simple',
        });

        if (!moduleFiles.has(moduleDir)) moduleFiles.set(moduleDir, []);
        moduleFiles.get(moduleDir)!.push(fileId);
        continue;
      }

      // Read file content (source files only)
      let content: string;
      try {
        content = readFileSync(file.absolutePath, 'utf-8');
      } catch {
        continue;
      }
      const lineCount = content.split('\n').length;

      // Extract exports and imports for enhanced complexity
      const exportedSymbols = extractExports(content);
      const importTargets = extractImports(content);
      const importInfos = extractImportsWithSymbols(content);

      // Create file node with enhanced complexity and category tag
      const fileId = `file:${file.relPath}`;
      const tags = deriveTags(file.relPath, ext);
      tags.push(category);
      const complexity = enhancedComplexity(lineCount, exportedSymbols.length, importTargets.length, content);

      // Detect entry points
      if (ENTRY_POINT_NAMES.has(name)) {
        entryModules.add(moduleDir);
      }

      // Track test files for tested_by linking
      const isTest = isTestFile(file.relPath);
      if (isTest && !tags.includes('test')) {
        tags.push('test');
      }

      nodes.push({
        id: fileId,
        type: 'file',
        name,
        filePath: file.relPath,
        summary: `${lang ?? 'Source'} file in ${moduleDir} module`,
        tags,
        complexity,
      });

      if (isTest) {
        testFiles.push({ relPath: file.relPath, fileId });
      }

      // Track module membership
      if (!moduleFiles.has(moduleDir)) moduleFiles.set(moduleDir, []);
      moduleFiles.get(moduleDir)!.push(fileId);

      // Track exported symbols for call graph
      const exportNames = new Set(exportedSymbols.map(s => s.name));
      fileExportedSymbols.set(fileId, exportNames);

      // Extract exports as child nodes
      for (const sym of exportedSymbols) {
        const symId = `${sym.kind}:${file.relPath}:${sym.name}`;
        nodes.push({
          id: symId,
          type: sym.kind,
          name: sym.name,
          filePath: file.relPath,
          summary: `Exported ${sym.kind} "${sym.name}" in ${name}`,
          tags: [...tags.filter(t => t !== 'test' && t !== category), sym.kind],
        });
        edges.push({
          source: fileId,
          target: symId,
          type: 'contains',
          direction: 'forward',
          weight: 1,
        });
      }

      // Extract imports as edges + track for call graph
      const importSymbolsForFile: Array<{ targetFileId: string; symbols: string[] }> = [];
      for (const target of importTargets) {
        const resolvedId = resolveImport(target, file.relPath, fileSet);
        if (resolvedId) {
          edges.push({
            source: fileId,
            target: resolvedId,
            type: 'imports',
            direction: 'forward',
            weight: 1,
          });

          // Track module-level dependencies for topological sort
          const targetRelPath = resolvedId.slice('file:'.length);
          const targetParts = targetRelPath.split(posix.sep);
          const targetModule = targetParts.length > 1 ? targetParts[0] : '_root';
          if (moduleDir !== targetModule && moduleDir !== '_root' && targetModule !== '_root') {
            moduleImportEdges.push({ source: moduleDir, target: targetModule });
          }
        }
      }

      // Track named import symbols for call graph extraction
      for (const info of importInfos) {
        const resolvedId = resolveImport(info.specifier, file.relPath, fileSet);
        if (resolvedId && info.symbols.length > 0) {
          importSymbolsForFile.push({ targetFileId: resolvedId, symbols: info.symbols });
        }
      }
      if (importSymbolsForFile.length > 0) {
        fileImportSymbols.set(fileId, importSymbolsForFile);
      }
    }

    // 2b. Call graph extraction: find call sites for imported symbols
    for (const file of files) {
      const ext = extname(file.relPath).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const fileId = `file:${file.relPath}`;
      const importedRefs = fileImportSymbols.get(fileId);
      if (!importedRefs || importedRefs.length === 0) continue;

      let content: string;
      try {
        content = readFileSync(file.absolutePath, 'utf-8');
      } catch {
        continue;
      }

      // Collect all imported symbols and their source files
      const symbolToFile = new Map<string, string>();
      for (const ref of importedRefs) {
        for (const sym of ref.symbols) {
          symbolToFile.set(sym, ref.targetFileId);
        }
      }

      const calledSymbols = extractCallSites(content, new Set(symbolToFile.keys()));
      for (const sym of calledSymbols) {
        const targetFileId = symbolToFile.get(sym);
        if (!targetFileId) continue;
        edges.push({
          source: fileId,
          target: targetFileId,
          type: 'calls',
          direction: 'forward',
          weight: 0.9,
          description: `Calls imported symbol "${sym}"`,
        });
      }
    }

    // 2c. Test file pairing: create tested_by edges
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    for (const test of testFiles) {
      const prodPath = findProductionFile(test.relPath, fileSet);
      if (prodPath) {
        const prodFileId = `file:${prodPath}`;
        edges.push({
          source: prodFileId,
          target: test.fileId,
          type: 'tested_by',
          direction: 'forward',
          weight: 0.8,
        });
        const prodNode = nodeById.get(prodFileId);
        if (prodNode && !prodNode.tags.includes('tested')) {
          prodNode.tags.push('tested');
        }
      }
    }

    // 3. Create module nodes
    for (const [moduleDir, memberIds] of moduleFiles) {
      if (moduleDir === '_root') continue;
      const moduleId = `module:${moduleDir}`;
      nodes.push({
        id: moduleId,
        type: 'module',
        name: moduleDir,
        summary: `Module: ${moduleDir} (${memberIds.length} files)`,
        tags: [moduleDir],
      });
      for (const memberId of memberIds) {
        edges.push({
          source: moduleId,
          target: memberId,
          type: 'contains',
          direction: 'forward',
          weight: 1,
        });
      }
    }

    // 4. Build layers from directory patterns
    const layerMap = new Map<string, Layer>();
    for (const [moduleDir] of moduleFiles) {
      if (moduleDir === '_root') continue;
      const patternEntry = LAYER_PATTERNS[moduleDir];
      if (!patternEntry) continue;

      const layerId = `layer:${patternEntry.name.toLowerCase().replace(/\s+/g, '-')}`;
      if (!layerMap.has(layerId)) {
        layerMap.set(layerId, {
          id: layerId,
          name: patternEntry.name,
          description: patternEntry.description,
          nodeIds: [],
        });
      }
      const layer = layerMap.get(layerId)!;
      // Add module node and its file nodes
      layer.nodeIds.push(`module:${moduleDir}`);
      const memberIds = moduleFiles.get(moduleDir);
      if (memberIds) {
        layer.nodeIds.push(...memberIds);
      }
    }
    const layers = Array.from(layerMap.values());

    // 5. Generate tour using topological sort
    const tour: TourStep[] = [];
    let order = 1;
    const moduleList = Array.from(moduleFiles.keys()).filter(m => m !== '_root');
    const sortedModules = topologicalSortModules(moduleList, moduleImportEdges, entryModules);
    for (const moduleDir of sortedModules) {
      const memberIds = moduleFiles.get(moduleDir) ?? [];
      const patternEntry = LAYER_PATTERNS[moduleDir];
      const layerName = patternEntry?.name ?? moduleDir;
      tour.push({
        order: order++,
        title: layerName,
        description: patternEntry?.description ?? `Files in the ${moduleDir} directory`,
        nodeIds: [`module:${moduleDir}`, ...memberIds.slice(0, 5)],
      });
    }

    // 6. Assemble project metadata
    const project: ProjectMeta = {
      name: this.detectProjectName(root),
      languages: Array.from(languagesFound).sort(),
      frameworks: [],
      description: `Code analysis of ${files.length} source files`,
      analyzedAt: new Date().toISOString(),
    };

    // Try to detect frameworks from package.json
    project.frameworks = this.detectFrameworks(root);

    return {
      version: '1.0.0',
      valid: true,
      project,
      nodes,
      edges,
      layers,
      tour,
    };
  }

  /** Read project name from package.json or use directory name. */
  private detectProjectName(root: string): string {
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) return pkg.name;
      } catch { /* fallback */ }
    }
    return basename(root);
  }

  /** Detect frameworks from package.json dependencies. */
  private detectFrameworks(root: string): string[] {
    const pkgPath = join(root, 'package.json');
    if (!existsSync(pkgPath)) return [];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      const frameworks: string[] = [];
      const checks: [string, string][] = [
        ['react', 'React'],
        ['vue', 'Vue'],
        ['angular', 'Angular'],
        ['express', 'Express'],
        ['fastify', 'Fastify'],
        ['next', 'Next.js'],
        ['nuxt', 'Nuxt'],
        ['commander', 'Commander'],
        ['ink', 'Ink'],
      ];
      for (const [pkg, name] of checks) {
        if (allDeps?.[pkg]) frameworks.push(name);
      }
      return frameworks;
    } catch {
      return [];
    }
  }
}

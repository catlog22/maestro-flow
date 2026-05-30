#!/usr/bin/env node
// ---------------------------------------------------------------------------
// merge-batch-graphs.mjs -- Merge and normalize batch analysis results.
//
// Node.js port of merge-batch-graphs.py from Understand-Anything.
// Combines batch-*.json files from the intermediate directory into a single
// assembled graph with normalized IDs, complexity values, and cleaned edges.
//
// Usage:
//   node scripts/merge-batch-graphs.mjs <project-root>
//   node scripts/merge-batch-graphs.mjs <project-root> --intermediate-dir <path>
//
// Input:
//   <project-root>/.understand-anything/intermediate/batch-*.json
//
// Output:
//   <project-root>/.understand-anything/intermediate/assembled-graph.json
//
// No external dependencies -- uses only Node.js built-in modules.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename, extname, dirname } from 'node:path';

// ── Configuration ──────────────────────────────────────────────────────────

const VALID_NODE_PREFIXES = new Set([
  'file', 'func', 'function', 'class', 'module', 'concept',
  'config', 'document', 'service', 'table', 'endpoint',
  'pipeline', 'schema', 'resource',
  'domain', 'flow', 'step',
  // Knowledge-base node types (schema.ts NodeType enum)
  'article', 'entity', 'topic', 'claim', 'source',
]);

/** node.type -> canonical ID prefix */
const TYPE_TO_PREFIX = {
  file: 'file',
  function: 'function',
  func: 'function',
  class: 'class',
  module: 'module',
  concept: 'concept',
  config: 'config',
  document: 'document',
  service: 'service',
  table: 'table',
  endpoint: 'endpoint',
  pipeline: 'pipeline',
  schema: 'schema',
  resource: 'resource',
  domain: 'domain',
  flow: 'flow',
  step: 'step',
  // Knowledge-base node types
  article: 'article',
  entity: 'entity',
  topic: 'topic',
  claim: 'claim',
  source: 'source',
};

const COMPLEXITY_MAP = {
  low: 'simple',
  easy: 'simple',
  medium: 'moderate',
  intermediate: 'moderate',
  high: 'complex',
  hard: 'complex',
  difficult: 'complex',
};

const VALID_COMPLEXITY = new Set(['simple', 'moderate', 'complex']);

// ── tested_by linker configuration ─────────────────────────────────────────

const _JS_TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'];
const _JS_TS_TEST_EXTS = new Set(_JS_TS_EXTS);

const _MIRROR_PRODUCTION_ROOTS = ['src', 'app', 'lib', ''];

// Per-extension test-name patterns: ext -> [prefixes, suffixes]
const _TEST_NAME_PATTERNS = {
  '.go': [[], ['_test']],
  '.py': [['test_'], ['_test']],
  '.java': [[], ['Test', 'Tests', 'IT']],
  '.kt': [[], ['Test', 'Tests']],
  '.cs': [[], ['Test', 'Tests']],
  '.c': [['test_'], ['_test']],
  '.cpp': [['test_'], ['_test']],
  '.cc': [['test_'], ['_test']],
};

const _DIRECTION_ALIASES = { both: 'bidirectional', mutual: 'bidirectional' };
const _VALID_DIRECTIONS = new Set(['forward', 'backward', 'bidirectional']);


// ── Utility functions ──────────────────────────────────────────────────────

/**
 * Canonicalize an edge `direction` value to one of the schema enum members.
 * @param {*} value
 * @returns {string}
 */
function normalizeDirection(value) {
  const candidate = typeof value === 'string' ? value.toLowerCase() : '';
  const mapped = _DIRECTION_ALIASES[candidate] ?? candidate;
  return _VALID_DIRECTIONS.has(mapped) ? mapped : 'forward';
}

/**
 * Coerce a value to number for safe comparison (handles string weights).
 * @param {*} v
 * @returns {number}
 */
function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Batch loading ──────────────────────────────────────────────────────────

/**
 * Load a batch JSON file, tolerating malformed files.
 * @param {string} filePath
 * @returns {object|null}
 */
function loadBatch(filePath) {
  let data;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`  Warning: skipping ${basename(filePath)}: ${e.message}\n`);
    return null;
  }

  if (!Array.isArray(data?.nodes)) {
    process.stderr.write(`  Warning: skipping ${basename(filePath)}: missing or invalid 'nodes' array\n`);
    return null;
  }
  if (!Array.isArray(data?.edges)) {
    process.stderr.write(`  Warning: skipping ${basename(filePath)}: missing or invalid 'edges' array\n`);
    return null;
  }

  return data;
}

// ── ID normalization ───────────────────────────────────────────────────────

/**
 * Return a human-readable pattern label for an ID correction.
 * @param {string} original
 * @param {string} corrected
 * @returns {string}
 */
function classifyIdFix(original, corrected) {
  // Double prefix: "file:file:..." -> "file:..."
  for (const prefix of VALID_NODE_PREFIXES) {
    if (original.startsWith(`${prefix}:${prefix}:`)) {
      return `${prefix}:${prefix}: -> ${prefix}: (double prefix)`;
    }
  }

  // Project-name prefix: "my-project:file:..." -> "file:..."
  const parts = original.split(':');
  if (parts.length >= 3 && !VALID_NODE_PREFIXES.has(parts[0]) && VALID_NODE_PREFIXES.has(parts[1])) {
    return `<project>:${parts[1]}: -> ${parts[1]}: (project-name prefix)`;
  }

  // Legacy func: -> function:
  if (original.startsWith('func:') && corrected.startsWith('function:')) {
    return 'func: -> function: (prefix canonicalization)';
  }

  // Bare path -> prefixed
  let hasPrefix = false;
  for (const p of VALID_NODE_PREFIXES) {
    if (original.startsWith(`${p}:`)) { hasPrefix = true; break; }
  }
  if (!hasPrefix) {
    const prefix = corrected.split(':')[0];
    return `bare path -> ${prefix}: (missing prefix)`;
  }

  return `${original} -> ${corrected}`;
}

/**
 * Build a regex pattern that matches any valid prefix followed by a colon.
 * Used in normalize_node_id for project-name prefix stripping.
 */
const _VALID_PREFIX_PATTERN = new RegExp(
  '^[^:]+:(' + [...VALID_NODE_PREFIXES].map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + '):(.+)$'
);

/**
 * Normalize a node ID, returning the corrected version.
 * @param {string} nodeId
 * @param {object} node
 * @returns {string}
 */
function normalizeNodeId(nodeId, node) {
  let nid = nodeId;

  // Strip double prefix: "file:file:src/foo.ts" -> "file:src/foo.ts"
  for (const prefix of VALID_NODE_PREFIXES) {
    const double = `${prefix}:${prefix}:`;
    if (nid.startsWith(double)) {
      nid = nid.slice(prefix.length + 1);
      break;
    }
  }

  // Strip project-name prefix: "my-project:file:src/foo.ts" -> "file:src/foo.ts"
  const match = nid.match(_VALID_PREFIX_PATTERN);
  if (match) {
    const firstSeg = nid.split(':')[0];
    if (!VALID_NODE_PREFIXES.has(firstSeg)) {
      nid = `${match[1]}:${match[2]}`;
    }
  }

  // Canonicalize legacy prefix: func: -> function:
  if (nid.startsWith('func:') && !nid.startsWith('function:')) {
    nid = 'function:' + nid.slice(5);
  }

  // Add missing prefix for bare file paths
  let hasPrefix = false;
  for (const p of VALID_NODE_PREFIXES) {
    if (nid.startsWith(`${p}:`)) { hasPrefix = true; break; }
  }
  if (!hasPrefix) {
    const nodeType = node.type || 'file';
    const prefix = TYPE_TO_PREFIX[nodeType] || 'file';
    if (nodeType === 'function' || nodeType === 'class') {
      const filePath = node.filePath || '';
      const name = node.name || nid;
      if (filePath) {
        nid = `${prefix}:${filePath}:${name}`;
      } else {
        nid = `${prefix}:__nofilepath__:${name}`;
      }
    } else {
      nid = `${prefix}:${nid}`;
    }
  }

  return nid;
}

/**
 * Normalize a complexity value.
 * @param {*} value
 * @returns {[string, string]} [normalized, status]
 *   status: "valid" | "mapped" | "unknown"
 */
function normalizeComplexity(value) {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (VALID_COMPLEXITY.has(lower)) return [lower, 'valid'];
    if (COMPLEXITY_MAP[lower] !== undefined) return [COMPLEXITY_MAP[lower], 'mapped'];
    return ['moderate', 'unknown'];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n <= 3) return ['simple', 'mapped'];
    if (n <= 6) return ['moderate', 'mapped'];
    return ['complex', 'mapped'];
  }
  return ['moderate', 'unknown'];
}


// ── Deterministic tested_by linker ─────────────────────────────────────────

/**
 * Split a relative POSIX-style path into segments (ignoring empties).
 * @param {string} p
 * @returns {string[]}
 */
function _pathSegments(p) {
  return p.split('/').filter(s => s !== '');
}

/**
 * @param {string} p
 * @returns {string}
 */
function _basename(p) {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * Get stem (filename without extension) and extension.
 * @param {string} filename
 * @returns {[string, string]}
 */
function _splitext(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return [filename, ''];
  return [filename.slice(0, dot), filename.slice(dot)];
}

/**
 * Return true if `path` looks like a test file by basename convention.
 * @param {string} p
 * @returns {boolean}
 */
function isTestPath(p) {
  const name = _basename(p);
  const [stem, ext] = _splitext(name);

  // JS/TS family: the test marker is an infix on the stem
  if (_JS_TS_TEST_EXTS.has(ext)) {
    return stem.endsWith('.test') || stem.endsWith('.spec');
  }

  const patterns = _TEST_NAME_PATTERNS[ext];
  if (!patterns) return false;
  const [prefixes, suffixes] = patterns;
  return prefixes.some(pre => stem.startsWith(pre)) ||
         suffixes.some(suf => stem.endsWith(suf));
}

/**
 * For a JS/TS-family stem like `foo.test` or `foo.spec`, strip the
 * trailing `.test` / `.spec`. Returns null if no infix is present.
 * @param {string} stem
 * @returns {string|null}
 */
function _stripTestInfix(stem) {
  for (const infix of ['.test', '.spec']) {
    if (stem.endsWith(infix)) {
      return stem.slice(0, -infix.length);
    }
  }
  return null;
}

/**
 * @param {string} dirPath
 * @param {string} name
 * @returns {string}
 */
function _joinPath(dirPath, name) {
  return dirPath ? `${dirPath}/${name}` : name;
}

/**
 * Append path to out unless it is empty or already present.
 * @param {string[]} out
 * @param {string} p
 */
function _addUnique(out, p) {
  if (p && !out.includes(p)) out.push(p);
}

/**
 * Build sibling candidates for a JS/TS family base stem.
 * @param {string} dirPath
 * @param {string} baseStem
 * @returns {string[]}
 */
function _jsTsSiblingCandidates(dirPath, baseStem) {
  return _JS_TS_EXTS.map(e => _joinPath(dirPath, `${baseStem}${e}`));
}

/**
 * For a test file path, return ordered candidate production paths.
 * @param {string} testPath
 * @returns {string[]}
 */
function productionCandidates(testPath) {
  const name = _basename(testPath);
  const [stem, ext] = _splitext(name);
  const segs = _pathSegments(testPath);
  const dirSegs = segs.slice(0, -1);
  const dirPath = dirSegs.join('/');

  /** @type {string[]} */
  const candidates = [];

  // ── JS/TS family ───────────────────────────────────────────────────
  if (_JS_TS_TEST_EXTS.has(ext)) {
    const baseStem = _stripTestInfix(stem);
    if (baseStem !== null) {
      // 1. Sibling de-infix
      _addUnique(candidates, _joinPath(dirPath, `${baseStem}${ext}`));
      for (const c of _jsTsSiblingCandidates(dirPath, baseStem)) {
        _addUnique(candidates, c);
      }

      // 2. Walk out of test-segregating subdir
      if (dirSegs.length > 0 && ['__tests__', 'test', 'spec', 'tests'].includes(dirSegs[dirSegs.length - 1])) {
        const parentDir = dirSegs.slice(0, -1).join('/');
        _addUnique(candidates, _joinPath(parentDir, `${baseStem}${ext}`));
        for (const c of _jsTsSiblingCandidates(parentDir, baseStem)) {
          _addUnique(candidates, c);
        }
      }

      // 3. Mirrored tree
      if (dirSegs.length > 0 && ['tests', 'test', '__tests__'].includes(dirSegs[0])) {
        const tailPath = dirSegs.slice(1).join('/');
        for (const root of _MIRROR_PRODUCTION_ROOTS) {
          const newDir = [root, tailPath].filter(Boolean).join('/');
          _addUnique(candidates, _joinPath(newDir, `${baseStem}${ext}`));
          for (const c of _jsTsSiblingCandidates(newDir, baseStem)) {
            _addUnique(candidates, c);
          }
        }
      }
    }
  }
  // ── Go ─────────────────────────────────────────────────────────────
  else if (ext === '.go' && stem.endsWith('_test')) {
    const baseStem = stem.slice(0, -'_test'.length);
    _addUnique(candidates, _joinPath(dirPath, `${baseStem}.go`));
  }
  // ── Python ─────────────────────────────────────────────────────────
  else if (ext === '.py' && (stem.startsWith('test_') || stem.endsWith('_test'))) {
    const baseStem = stem.startsWith('test_')
      ? stem.slice('test_'.length)
      : stem.slice(0, -'_test'.length);

    // Sibling
    _addUnique(candidates, _joinPath(dirPath, `${baseStem}.py`));

    // Walk out of in-package tests/ or test/
    if (dirSegs.length > 0 && ['tests', 'test'].includes(dirSegs[dirSegs.length - 1])) {
      const parentDir = dirSegs.slice(0, -1).join('/');
      _addUnique(candidates, _joinPath(parentDir, `${baseStem}.py`));
    }

    // Mirrored
    if (dirSegs.length > 0 && ['tests', 'test'].includes(dirSegs[0])) {
      const tailPath = dirSegs.slice(1).join('/');
      for (const root of _MIRROR_PRODUCTION_ROOTS) {
        const newDir = [root, tailPath].filter(Boolean).join('/');
        _addUnique(candidates, _joinPath(newDir, `${baseStem}.py`));
      }
    }
  }
  // ── Java ───────────────────────────────────────────────────────────
  else if (ext === '.java') {
    for (const suffix of ['Tests', 'Test', 'IT']) {
      if (stem.endsWith(suffix)) {
        const baseStem = stem.slice(0, -suffix.length);
        // Maven/Gradle layout
        if (
          dirSegs.length >= 3 &&
          dirSegs[0] === 'src' &&
          dirSegs[1] === 'test' &&
          dirSegs[2] === 'java'
        ) {
          const newDir = ['src', 'main', 'java', ...dirSegs.slice(3)].join('/');
          _addUnique(candidates, `${newDir}/${baseStem}.java`);
        }
        // Sibling fallback
        _addUnique(candidates, _joinPath(dirPath, `${baseStem}.java`));
        break;
      }
    }
  }
  // ── Kotlin ─────────────────────────────────────────────────────────
  else if (ext === '.kt') {
    for (const suffix of ['Tests', 'Test']) {
      if (stem.endsWith(suffix)) {
        const baseStem = stem.slice(0, -suffix.length);
        if (
          dirSegs.length >= 3 &&
          dirSegs[0] === 'src' &&
          dirSegs[1] === 'test' &&
          dirSegs[2] === 'kotlin'
        ) {
          const newDir = ['src', 'main', 'kotlin', ...dirSegs.slice(3)].join('/');
          _addUnique(candidates, `${newDir}/${baseStem}.kt`);
        }
        _addUnique(candidates, _joinPath(dirPath, `${baseStem}.kt`));
        break;
      }
    }
  }
  // ── C# ─────────────────────────────────────────────────────────────
  else if (ext === '.cs') {
    for (const suffix of ['Tests', 'Test']) {
      if (stem.endsWith(suffix)) {
        const baseStem = stem.slice(0, -suffix.length);
        // Sibling fallback
        _addUnique(candidates, _joinPath(dirPath, `${baseStem}.cs`));

        // Walk out of in-service tests/ directory
        let testsIdx = null;
        for (let i = dirSegs.length - 1; i >= 0; i--) {
          if (['tests', 'test'].includes(dirSegs[i].toLowerCase())) {
            testsIdx = i;
            break;
          }
        }
        if (testsIdx !== null) {
          const parentSegs = dirSegs.slice(0, testsIdx);
          const tailSegs = dirSegs.slice(testsIdx + 1);
          const parentDir = parentSegs.join('/');
          // <parent>/<base_stem>.cs
          _addUnique(candidates, _joinPath(parentDir, `${baseStem}.cs`));
          // <parent>/src/<tail>/<base_stem>.cs
          const srcDir = [...parentSegs, 'src', ...tailSegs].join('/');
          _addUnique(candidates, _joinPath(srcDir, `${baseStem}.cs`));
        }

        // .NET-style sibling-project mirror
        if (dirSegs.length > 0) {
          const top = dirSegs[0];
          let sibling = null;
          if (top.endsWith('.Tests')) {
            sibling = top.slice(0, -'.Tests'.length);
          } else if (top.endsWith('.Test')) {
            sibling = top.slice(0, -'.Test'.length);
          }
          if (sibling) {
            const mirrorDir = [sibling, ...dirSegs.slice(1)].join('/');
            _addUnique(candidates, _joinPath(mirrorDir, `${baseStem}.cs`));
          }
        }
        break;
      }
    }
  }
  // ── C/C++ ──────────────────────────────────────────────────────────
  else if (['.c', '.cpp', '.cc'].includes(ext)) {
    let baseStem = null;
    if (stem.startsWith('test_')) {
      baseStem = stem.slice('test_'.length);
    } else if (stem.endsWith('_test')) {
      baseStem = stem.slice(0, -'_test'.length);
    }
    if (baseStem !== null) {
      _addUnique(candidates, _joinPath(dirPath, `${baseStem}${ext}`));
    }
  }

  return candidates;
}

/**
 * Return the relative project path for a `file:`-prefixed node, else null.
 * @param {object} node
 * @returns {string|null}
 */
function _fileNodePath(node) {
  const nid = node.id;
  if (typeof nid !== 'string' || !nid.startsWith('file:')) return null;
  if (typeof node.filePath === 'string' && node.filePath) return node.filePath;
  return nid.slice('file:'.length);
}

/**
 * Flip an inverted tested_by edge so source becomes production and
 * target becomes the test file. Mutates edge in place.
 * @param {object} edge
 * @param {string} originalSrc
 * @param {string} originalTgt
 */
function _swapTestedByInPlace(edge, originalSrc, originalTgt) {
  edge.source = originalTgt;
  edge.target = originalSrc;
  edge.direction = 'forward';
  const prev = edge.description;
  edge.description = prev
    ? `${prev} [direction corrected]`
    : 'Direction corrected (was test -> production)';
}

/**
 * Append "tested" to node.tags, coercing malformed tags to a fresh list.
 * Returns true if the tag was newly added.
 * @param {object} node
 * @returns {boolean}
 */
function _ensureTestedTag(node) {
  if (!Array.isArray(node.tags)) {
    node.tags = [];
  }
  if (node.tags.includes('tested')) return false;
  node.tags.push('tested');
  return true;
}

/**
 * Canonicalize tested_by edges and link unmatched test files.
 *
 * Two-pass linker:
 *   Pass 1: Fix LLM-emitted tested_by edges (flip if source is test + target is production)
 *   Pass 2: Supplement with path-convention pairings
 *
 * Mutates nodesById (adds "tested" tag) and edges (rewrites in place).
 *
 * @param {Map<string, object>} nodesById
 * @param {object[]} edges
 * @returns {{added: number, dropped: number, tagged: number, swapped: number}}
 */
function linkTests(nodesById, edges) {
  // Index file nodes by relative path; classify each as test/production.
  /** @type {Map<string, object>} */
  const filePathsToNodes = new Map();
  /** @type {Map<string, string>} id -> "test" | "prod" */
  const nodeIdToClassification = new Map();
  /** @type {Array<[string, object]>} */
  const testNodes = [];

  for (const node of nodesById.values()) {
    const path = _fileNodePath(node);
    if (path === null) continue;
    filePathsToNodes.set(path, node);
    if (isTestPath(path)) {
      nodeIdToClassification.set(node.id, 'test');
      testNodes.push([path, node]);
    } else {
      nodeIdToClassification.set(node.id, 'prod');
    }
  }

  // ── Pass 1: walk existing tested_by edges, canonicalize or drop.
  /** @type {Set<string>} serialized (prod_id, test_id) pairs */
  const covered = new Set();
  /** @type {Map<string, number>} pair key -> index in edges */
  const pairToIdx = new Map();
  /** @type {Set<string>} pairs that came from a swap */
  const swappedPairs = new Set();
  let dropped = 0;
  let writeIdx = 0;

  for (const edge of edges) {
    if (edge.type !== 'tested_by') {
      edges[writeIdx] = edge;
      writeIdx++;
      continue;
    }

    const src = edge.source || '';
    const tgt = edge.target || '';
    const srcClass = nodeIdToClassification.get(src);
    const tgtClass = nodeIdToClassification.get(tgt);

    let pair;
    let needsSwap;

    if (srcClass === 'prod' && tgtClass === 'test') {
      pair = `${src}\0${tgt}`;
      needsSwap = false;
    } else if (srcClass === 'test' && tgtClass === 'prod') {
      pair = `${tgt}\0${src}`;
      needsSwap = true;
    } else {
      dropped++;
      continue;
    }

    if (covered.has(pair)) {
      // Duplicate pair: keep the heavier-weight edge
      const existingIdx = pairToIdx.get(pair);
      const existing = edges[existingIdx];
      if (_num(edge.weight ?? 0) > _num(existing.weight ?? 0)) {
        if (needsSwap) {
          _swapTestedByInPlace(edge, src, tgt);
          swappedPairs.add(pair);
        } else {
          swappedPairs.delete(pair);
        }
        edges[existingIdx] = edge;
      }
      dropped++;
      continue;
    }

    if (needsSwap) {
      _swapTestedByInPlace(edge, src, tgt);
      swappedPairs.add(pair);
    }
    covered.add(pair);
    pairToIdx.set(pair, writeIdx);
    edges[writeIdx] = edge;
    writeIdx++;
  }
  edges.length = writeIdx;
  const swapped = swappedPairs.size;

  // ── Pass 2: path-convention supplement for tests not yet paired.
  const pairedTestIds = new Set();
  for (const pairKey of covered) {
    const testId = pairKey.split('\0')[1];
    pairedTestIds.add(testId);
  }

  let added = 0;
  for (const [testPath, testNode] of testNodes) {
    if (pairedTestIds.has(testNode.id)) continue;
    for (const candPath of productionCandidates(testPath)) {
      const prodNode = filePathsToNodes.get(candPath);
      if (!prodNode) continue;
      if (isTestPath(candPath)) continue;
      const pair = `${prodNode.id}\0${testNode.id}`;
      if (covered.has(pair)) continue;
      edges.push({
        source: prodNode.id,
        target: testNode.id,
        type: 'tested_by',
        direction: 'forward',
        weight: 0.5,
        description: 'Path-based pairing (deterministic)',
      });
      covered.add(pair);
      added++;
      break;
    }
  }

  // ── Tag every production node that ended up sourcing a tested_by edge.
  let tagged = 0;
  for (const pairKey of covered) {
    const prodId = pairKey.split('\0')[0];
    const prodNode = nodesById.get(prodId);
    if (!prodNode) continue;
    if (_ensureTestedTag(prodNode)) tagged++;
  }

  return { added, dropped, tagged, swapped };
}


// ── Main merge + normalize ─────────────────────────────────────────────────

/**
 * Merge batch results and normalize.
 * @param {object[]} batches
 * @returns {{ assembled: object, report: string[] }}
 */
export function mergeGraphs(batches) {
  // ── Pattern counters ────────────────────────────────────────────────
  /** @type {Map<string, number>} */
  const idFixPatterns = new Map();
  /** @type {Map<string, number>} */
  const complexityFixPatterns = new Map();
  /** @type {string[]} */
  const unfixable = [];

  function incCounter(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  // ── Step 1: Combine all nodes and edges ──────────────────────────
  /** @type {object[]} */
  const allNodes = [];
  /** @type {object[]} */
  const allEdges = [];
  for (const batch of batches) {
    if (Array.isArray(batch.nodes)) allNodes.push(...batch.nodes);
    if (Array.isArray(batch.edges)) allEdges.push(...batch.edges);
  }

  const totalInputNodes = allNodes.length;
  const totalInputEdges = allEdges.length;

  // ── Step 2: Normalize node IDs and build ID mapping ──────────────
  /** @type {Map<string, string>} original -> corrected */
  const idMapping = new Map();
  /** @type {object[]} */
  const nodesWithIds = [];
  /** @type {Map<string, number>} */
  const unknownNodeTypes = new Map();

  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    const originalId = node.id;
    if (!originalId) {
      unfixable.push(`Node[${i}] has no 'id' field (name=${node.name ?? '?'}, type=${node.type ?? '?'})`);
      continue;
    }

    // Flag unknown node types
    const nodeType = node.type || '';
    if (nodeType && !(nodeType in TYPE_TO_PREFIX)) {
      incCounter(unknownNodeTypes, nodeType);
    }

    nodesWithIds.push(node);
    const correctedId = normalizeNodeId(originalId, node);
    if (correctedId !== originalId) {
      const pattern = classifyIdFix(originalId, correctedId);
      incCounter(idFixPatterns, pattern);
      idMapping.set(originalId, correctedId);
      node.id = correctedId;
    }
  }

  // ── Step 3: Normalize complexity ─────────────────────────────────
  /** @type {Map<string, number>} */
  const complexityUnknownPatterns = new Map();

  for (const node of nodesWithIds) {
    const original = node.complexity;
    const [normalized, status] = normalizeComplexity(original);

    if (status === 'mapped') {
      const origRepr = typeof original !== 'string' ? JSON.stringify(original) : `"${original}"`;
      incCounter(complexityFixPatterns, `${origRepr} -> "${normalized}"`);
    } else if (status === 'unknown') {
      const origRepr = typeof original !== 'string' ? JSON.stringify(original) : `"${original}"`;
      incCounter(complexityUnknownPatterns, `complexity ${origRepr} -> defaulted to "moderate"`);
    }

    node.complexity = normalized;
  }

  // ── Step 4: Rewrite edge references ──────────────────────────────
  let edgesRewritten = 0;
  for (const edge of allEdges) {
    const src = edge.source || '';
    const tgt = edge.target || '';
    const newSrc = idMapping.get(src) ?? src;
    const newTgt = idMapping.get(tgt) ?? tgt;
    if (newSrc !== src || newTgt !== tgt) {
      edgesRewritten++;
      edge.source = newSrc;
      edge.target = newTgt;
    }
  }

  // ── Step 5: Deduplicate nodes by ID (keep last) ─────────────────
  let duplicateCount = 0;
  /** @type {Map<string, object>} */
  const nodesById = new Map();
  for (const node of nodesWithIds) {
    const nid = node.id || '';
    if (nodesById.has(nid)) duplicateCount++;
    nodesById.set(nid, node);
  }

  // ── Step 5b: Deterministic tested_by linker ──────────────────────
  const { added: testedByAdded, dropped: testedByDropped, tagged: testedByTagged, swapped: testedBySwapped } =
    linkTests(nodesById, allEdges);

  // ── Step 6: Deduplicate edges, drop dangling ─────────────────────
  const nodeIds = new Set(nodesById.keys());
  /** @type {Map<string, object>} */
  const edgesByKey = new Map();
  for (const edge of allEdges) {
    const src = edge.source || '';
    const tgt = edge.target || '';
    const etype = edge.type || '';
    const direction = normalizeDirection(edge.direction);
    edge.direction = direction;

    if (!nodeIds.has(src) || !nodeIds.has(tgt)) {
      const missing = [];
      if (!nodeIds.has(src)) missing.push(`source '${src}'`);
      if (!nodeIds.has(tgt)) missing.push(`target '${tgt}'`);
      unfixable.push(`Edge ${src} -> ${tgt} (${etype}): dropped, missing ${missing.join(', ')}`);
      continue;
    }

    const key = `${src}\0${tgt}\0${etype}\0${direction}`;
    const existing = edgesByKey.get(key);
    if (!existing || _num(edge.weight ?? 0) > _num(existing.weight ?? 0)) {
      edgesByKey.set(key, edge);
    }
  }

  // ── Build report ─────────────────────────────────────────────────
  /** @type {string[]} */
  const report = [];
  report.push(`Input: ${totalInputNodes} nodes, ${totalInputEdges} edges`);

  // Sort counters by count descending
  function sortedEntries(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  // Fixed section
  const fixedLines = [];
  if (idFixPatterns.size > 0) {
    for (const [pattern, count] of sortedEntries(idFixPatterns)) {
      fixedLines.push(`  ${String(count).padStart(4)} x ${pattern}`);
    }
  }
  if (complexityFixPatterns.size > 0) {
    for (const [pattern, count] of sortedEntries(complexityFixPatterns)) {
      fixedLines.push(`  ${String(count).padStart(4)} x complexity ${pattern}`);
    }
  }
  if (edgesRewritten) {
    fixedLines.push(`  ${String(edgesRewritten).padStart(4)} x edge references rewritten after ID normalization`);
  }
  if (duplicateCount) {
    fixedLines.push(`  ${String(duplicateCount).padStart(4)} x duplicate node IDs removed (kept last)`);
  }
  if (testedBySwapped) {
    fixedLines.push(`  ${String(testedBySwapped).padStart(4)} x tested_by edges flipped (test -> production became production -> test)`);
  }
  if (testedByDropped) {
    fixedLines.push(`  ${String(testedByDropped).padStart(4)} x tested_by edges dropped (orphan endpoint or test<->test / prod<->prod pair)`);
  }

  if (fixedLines.length > 0) {
    const totalFixes =
      sumValues(idFixPatterns) +
      sumValues(complexityFixPatterns) +
      edgesRewritten +
      duplicateCount +
      testedBySwapped +
      testedByDropped;
    report.push('');
    report.push(`Fixed (${totalFixes} corrections):`);
    report.push(...fixedLines);
  }

  // Tested-by linker section
  if (testedByAdded || testedByTagged) {
    report.push('');
    report.push('Tested-by linker:');
    report.push(`  ${String(testedByAdded).padStart(4)} x tested_by edges produced (path-convention supplement, production -> test)`);
    report.push(`  ${String(testedByTagged).padStart(4)} x production nodes tagged "tested"`);
  }

  // Could not fix section
  const unfixableTotal =
    unfixable.length +
    sumValues(complexityUnknownPatterns) +
    sumValues(unknownNodeTypes);
  if (unfixableTotal) {
    report.push('');
    report.push(`Could not fix (${unfixableTotal} issues -- needs agent review):`);
    for (const [ntype, count] of sortedEntries(unknownNodeTypes)) {
      report.push(`  ${String(count).padStart(4)} x unknown node type "${ntype}" (not in schema, kept as-is)`);
    }
    for (const [pattern, count] of sortedEntries(complexityUnknownPatterns)) {
      report.push(`  ${String(count).padStart(4)} x ${pattern}`);
    }
    for (const detail of unfixable) {
      report.push(`  - ${detail}`);
    }
  }

  // Output stats
  report.push('');
  report.push(`Output: ${nodesById.size} nodes, ${edgesByKey.size} edges`);

  const assembled = {
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
  };

  return { assembled, report };
}

function sumValues(map) {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}


// ── Imports-edge recovery from importMap ────────────────────────────────────

/**
 * Re-emit any `imports` edges that exist in scan-result.json#importMap
 * but never made it into a batch's output.
 * @param {object} assembled
 * @param {string} scanResultPath
 * @returns {{ recovered: number, reportLines: string[] }}
 */
function recoverImportsFromScan(assembled, scanResultPath) {
  if (!existsSync(scanResultPath)) {
    return {
      recovered: 0,
      reportLines: [`  importMap recovery skipped -- ${basename(scanResultPath)} not found`],
    };
  }

  let scan;
  try {
    scan = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
  } catch (e) {
    return {
      recovered: 0,
      reportLines: [`  importMap recovery skipped -- could not parse ${basename(scanResultPath)}: ${e.message}`],
    };
  }

  const importMap = scan?.importMap;
  if (!importMap || typeof importMap !== 'object' || Array.isArray(importMap)) {
    return {
      recovered: 0,
      reportLines: [`  importMap recovery skipped -- no importMap field in ${basename(scanResultPath)}`],
    };
  }

  // Build the set of file: node ids
  const fileNodeIds = new Set();
  for (const node of assembled.nodes) {
    if (node.type === 'file') fileNodeIds.add(node.id || '');
  }

  // Build the set of existing (source, target) imports edges
  const existing = new Set();
  for (const edge of assembled.edges) {
    if (edge.type === 'imports') {
      existing.add(`${edge.source || ''}\0${edge.target || ''}`);
    }
  }

  let recovered = 0;
  let skippedNoSrcNode = 0;
  let skippedNoTgtNode = 0;

  for (const [srcPath, targets] of Object.entries(importMap)) {
    if (!Array.isArray(targets)) continue;
    const srcId = `file:${srcPath}`;
    if (!fileNodeIds.has(srcId)) {
      if (targets.length > 0) skippedNoSrcNode++;
      continue;
    }
    for (const tgtPath of targets) {
      if (typeof tgtPath !== 'string' || !tgtPath) continue;
      const tgtId = `file:${tgtPath}`;
      if (!fileNodeIds.has(tgtId)) {
        skippedNoTgtNode++;
        continue;
      }
      if (srcId === tgtId) continue;
      const key = `${srcId}\0${tgtId}`;
      if (existing.has(key)) continue;
      assembled.edges.push({
        source: srcId,
        target: tgtId,
        type: 'imports',
        direction: 'forward',
        weight: 0.7,
        recoveredFromImportMap: true,
      });
      existing.add(key);
      recovered++;
    }
  }

  const lines = [];
  lines.push(
    `  Recovered ${recovered} \`imports\` edges from importMap (${Object.keys(importMap).length} entries scanned)`
  );
  if (skippedNoSrcNode) {
    lines.push(`  Skipped ${skippedNoSrcNode} importMap source files with no \`file:\` node in graph`);
  }
  if (skippedNoTgtNode) {
    lines.push(`  Skipped ${skippedNoTgtNode} importMap target paths with no \`file:\` node in graph`);
  }
  return { recovered, reportLines: lines };
}


// ── Main ───────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
merge-batch-graphs.mjs -- Merge and normalize batch analysis results.

Combines batch-*.json files from the intermediate directory into a single
assembled graph with normalized IDs, complexity values, and cleaned edges.

Usage:
  node scripts/merge-batch-graphs.mjs <project-root> [options]

Options:
  --intermediate-dir <path>   Custom intermediate directory
                              (default: <project-root>/.understand-anything/intermediate)
  --help                      Show this help message

Input:
  <project-root>/.understand-anything/intermediate/batch-*.json
  (or custom intermediate directory)

Output:
  <intermediate-dir>/assembled-graph.json

Processing Steps:
  1. Load all batch-*.json and batch-*-part-*.json files
  2. Normalize node IDs (strip double prefixes, project-name prefixes, etc.)
  3. Normalize complexity values (low->simple, medium->moderate, high->complex)
  4. Rewrite edge references to use normalized IDs
  5. Deduplicate nodes by ID (keep last occurrence)
  6. Link test files to production files (tested_by linker)
  7. Deduplicate edges by (source, target, type, direction)
  8. Remove dangling edges (source/target not in node set)
  9. Recover imports edges from scan-result.json importMap
  10. Write assembled-graph.json
`.trim();
  console.log(help);
}

function main() {
  const args = process.argv.slice(2);

  // Handle --help
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Parse arguments
  let projectRoot = null;
  let customIntermediateDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--intermediate-dir' && i + 1 < args.length) {
      customIntermediateDir = args[++i];
    } else if (!args[i].startsWith('-')) {
      projectRoot = args[i];
    }
  }

  if (!projectRoot) {
    process.stderr.write('Usage: node merge-batch-graphs.mjs <project-root> [--intermediate-dir <path>]\n');
    process.exit(1);
  }

  projectRoot = resolve(projectRoot);
  const intermediateDir = customIntermediateDir
    ? resolve(customIntermediateDir)
    : join(projectRoot, '.understand-anything', 'intermediate');

  if (!existsSync(intermediateDir)) {
    process.stderr.write(`Error: ${intermediateDir} does not exist\n`);
    process.exit(1);
  }

  // Discover batch files
  const allFiles = readdirSync(intermediateDir);
  const batchFileNames = allFiles
    .filter(f => f.startsWith('batch-') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = a.match(/batch-(\d+)/);
      const numB = b.match(/batch-(\d+)/);
      return (numA ? parseInt(numA[1]) : 0) - (numB ? parseInt(numB[1]) : 0);
    });

  if (batchFileNames.length === 0) {
    process.stderr.write('Error: no batch-*.json files found in intermediate/\n');
    process.exit(1);
  }

  // Group by logical batch index
  /** @type {Map<number, Array<{name: string, part: number|null}>>} */
  const byBatch = new Map();
  /** @type {string[]} */
  const unrecognizedBatchFiles = [];
  const batchPattern = /^batch-(\d+)(?:-part-(\d+))?\.json$/;

  for (const f of batchFileNames) {
    const m = f.match(batchPattern);
    if (m) {
      const batchIdx = parseInt(m[1]);
      if (!byBatch.has(batchIdx)) byBatch.set(batchIdx, []);
      byBatch.get(batchIdx).push({
        name: f,
        part: m[2] !== undefined ? parseInt(m[2]) : null,
      });
    } else {
      unrecognizedBatchFiles.push(f);
    }
  }

  if (unrecognizedBatchFiles.length > 0) {
    const preview = unrecognizedBatchFiles.slice(0, 5).join(', ');
    const suffix = unrecognizedBatchFiles.length > 5
      ? ` (+${unrecognizedBatchFiles.length - 5} more)`
      : '';
    process.stderr.write(
      `Warning: merge-batch-graphs: ${unrecognizedBatchFiles.length} ` +
      `batch file(s) with unrecognized filenames will be DROPPED -- ` +
      `files: ${preview}${suffix} -- fix the file-analyzer agent to use ` +
      `only batch-<N>.json or batch-<N>-part-<K>.json patterns\n`
    );
  }

  const logicalCount = byBatch.size;
  const multiPart = [...byBatch.values()].filter(entries => entries.length > 1).length;
  process.stderr.write(
    `Found ${batchFileNames.length} batch files ` +
    `(${logicalCount} logical batches, ${multiPart} multi-part):\n`
  );

  // Missing-part detection
  const missingPartWarnings = [];
  for (const [idx, entries] of byBatch) {
    const partNums = entries.map(e => e.part).filter(p => p !== null);
    if (partNums.length === 0) continue;
    const present = new Set(partNums);
    const maxPart = Math.max(...partNums);
    const missing = [];
    for (let i = 1; i <= maxPart; i++) {
      if (!present.has(i)) missing.push(i);
    }
    if (missing.length > 0) {
      const msg =
        `batch ${idx} has parts [${[...present].sort((a, b) => a - b).join(', ')}] but ` +
        `missing part [${missing.join(', ')}] -- possible truncated write -- ` +
        `affected nodes/edges may be lost`;
      process.stderr.write(`Warning: merge: ${msg}\n`);
      missingPartWarnings.push(msg);
    }
  }

  // Load batches
  const unrecognizedSet = new Set(unrecognizedBatchFiles);
  const batches = [];
  for (const f of batchFileNames) {
    if (unrecognizedSet.has(f)) continue;
    const filePath = join(intermediateDir, f);
    const batch = loadBatch(filePath);
    if (batch !== null) {
      batches.push(batch);
      const n = Array.isArray(batch.nodes) ? batch.nodes.length : 0;
      const e = Array.isArray(batch.edges) ? batch.edges.length : 0;
      process.stderr.write(`  ${f}: ${n} nodes, ${e} edges\n`);
    }
  }

  if (batches.length === 0) {
    process.stderr.write('Error: no valid batch files loaded\n');
    process.exit(1);
  }

  // Merge and normalize
  const { assembled, report } = mergeGraphs(batches);

  // Surface missing multi-part files to the report
  if (missingPartWarnings.length > 0) {
    report.push('');
    report.push(
      `Warning: ${missingPartWarnings.length} batch(es) with missing parts ` +
      `-- some nodes/edges silently dropped:`
    );
    for (const w of missingPartWarnings) {
      report.push(`  - ${w}`);
    }
  }

  // Surface unrecognized-filename drops to the report
  if (unrecognizedBatchFiles.length > 0) {
    const preview = unrecognizedBatchFiles.slice(0, 5).join(', ');
    const suffix = unrecognizedBatchFiles.length > 5
      ? ` (+${unrecognizedBatchFiles.length - 5} more)`
      : '';
    report.push('');
    report.push(
      `Warning: dropped ${unrecognizedBatchFiles.length} batch file(s) ` +
      `with unrecognized filenames -- files: ${preview}${suffix} -- ` +
      `fix the file-analyzer agent to use only batch-<N>.json or ` +
      `batch-<N>-part-<K>.json patterns (every node/edge in these ` +
      `files was excluded from the final graph)`
    );
  }

  // Recover imports edges from scan-result.json
  const scanResultPath = join(intermediateDir, 'scan-result.json');
  const { recovered, reportLines: recoveryReport } = recoverImportsFromScan(assembled, scanResultPath);
  if (recoveryReport.length > 0) {
    report.push('');
    report.push('Imports edge recovery:');
    report.push(...recoveryReport);
  }

  // Print report
  process.stderr.write('\n');
  for (const line of report) {
    process.stderr.write(line + '\n');
  }

  // Write output
  const outputPath = join(intermediateDir, 'assembled-graph.json');
  writeFileSync(outputPath, JSON.stringify(assembled, null, 2), 'utf-8');

  const sizeKb = statSync(outputPath).size / 1024;
  process.stderr.write(`\nWritten to ${outputPath} (${Math.round(sizeKb)} KB)\n`);
}


// Run main if invoked directly
main();

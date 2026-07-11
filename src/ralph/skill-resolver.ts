// ---------------------------------------------------------------------------
// Skill resolver — parses a command/skill .md file:
//   - YAML frontmatter (name, description, argument-hint, allowed-tools)
//   - <required_reading> block @paths (must all be readable)
//   - <deferred_reading> block @paths (recorded only)
//
// Path expansion:
//   - `@~/foo` and `~/foo` → `<homedir>/foo`
//   - relative `@foo` resolves against the .md file's directory
//   - absolute paths kept as-is
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string[];
  orchestration_kind?: 'atomic' | 'terminal_pipeline';
  nested_spawn?: boolean;
  [key: string]: unknown;
}

export interface SkillManifest {
  filePath: string;
  frontmatter: SkillFrontmatter;
  body: string;                    // .md content with frontmatter stripped
  requiredPaths: string[];         // expanded absolute paths
  deferredPaths: string[];         // expanded absolute paths
  missingRequired: string[];       // subset of requiredPaths that do not exist
}

export interface LoadedSkill extends SkillManifest {
  requiredBodies: Array<{ path: string; content: string }>;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const REQUIRED_BLOCK_RE = /<required_reading>([\s\S]*?)<\/required_reading>/i;
const DEFERRED_BLOCK_RE = /<deferred_reading>([\s\S]*?)<\/deferred_reading>/i;

/** Expand `~/`, `@~/`, and resolve relative paths.
 *
 * Resolution rules (first match wins):
 *   1. `~/foo` / `@~/foo`             → `<homedir>/foo`
 *   2. absolute path                   → as-is
 *   3. starts with `.claude/`          → scope-root-relative (walk up baseDir
 *      until we find the parent that contains the `.claude/` segment, treat
 *      that parent as root). Used by skill SKILL.md files that reference
 *      sibling files via `@.claude/skills/<name>/specs/...`.
 *   4. otherwise                       → relative to baseDir (.md's directory)
 */
/** Normalize a stored absolute-ish path: expand `~/` to homedir, leave others. */
export function normalizeStoredPath(p: string): string {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

export function expandPath(raw: string, baseDir: string): string {
  let p = raw.trim();
  if (p.startsWith('@')) p = p.slice(1);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = join(homedir(), p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1));
  }
  if (isAbsolute(p)) return p;
  if (p.startsWith('.claude/') || p.startsWith('.claude\\')) {
    // Find the deepest `.claude` segment in baseDir and treat its parent as root.
    const matches = [...baseDir.matchAll(/[\\/]\.claude[\\/]/g)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      return resolve(baseDir.slice(0, last.index), p);
    }
    // baseDir ends in `.claude` with no trailing separator (rare; skill at root)
    const trailing = /(.*)[\\/]\.claude$/.exec(baseDir);
    if (trailing) return resolve(trailing[1], p);
  }
  return resolve(baseDir, p);
}

/** Minimal YAML frontmatter parser — supports scalar + bracket-list arrays. */
function parseFrontmatter(raw: string): SkillFrontmatter {
  const out: SkillFrontmatter = {};
  const lines = raw.split(/\r?\n/);
  let currentListKey: string | null = null;
  for (const line of lines) {
    if (!line.trim()) { currentListKey = null; continue; }
    // List continuation (`  - value`)
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && currentListKey) {
      const arr = (out[currentListKey] as unknown[] | undefined) ?? [];
      arr.push(listItem[1].trim().replace(/^["']|["']$/g, ''));
      out[currentListKey] = arr as string[];
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) { currentListKey = null; continue; }
    const key = kv[1];
    const val = kv[2];
    if (val === '' || val === '|' || val === '>') {
      // Treat empty-value key as start of a list (next lines have `- ...`)
      out[key] = [];
      currentListKey = key;
      continue;
    }
    // Inline array: `[a, b]`
    const arrMatch = /^\[(.*)\]$/.exec(val);
    if (arrMatch) {
      out[key] = arrMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      currentListKey = null;
      continue;
    }
    out[key] = val.replace(/^["']|["']$/g, '');
    currentListKey = null;
  }
  return out;
}

function extractPathsFromBlock(block: string): string[] {
  // Match `@path` tokens AND lines starting with `- ` containing paths.
  const out: string[] = [];
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Direct @path tokens
    const atMatches = trimmed.match(/@[^\s,()<>]+/g);
    if (atMatches) {
      for (const m of atMatches) out.push(m);
      continue;
    }
    // Markdown-style `- [label](path)` or `- path` (deferred)
    const mdLink = /^-\s+\[[^\]]*\]\(([^)]+)\)/.exec(trimmed);
    if (mdLink) { out.push(mdLink[1]); continue; }
    const bullet = /^-\s+(\S+)/.exec(trimmed);
    if (bullet) out.push(bullet[1]);
  }
  return out;
}

/** Parse manifest only — does NOT read required files. */
export function parseSkillManifest(filePath: string): SkillManifest {
  const text = readFileSync(filePath, 'utf-8');
  const fmMatch = FRONTMATTER_RE.exec(text);
  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;
  const baseDir = dirname(filePath);

  const reqMatch = REQUIRED_BLOCK_RE.exec(body);
  const defMatch = DEFERRED_BLOCK_RE.exec(body);
  const requiredRaw = reqMatch ? extractPathsFromBlock(reqMatch[1]) : [];
  const deferredRaw = defMatch ? extractPathsFromBlock(defMatch[1]) : [];

  const requiredPaths = requiredRaw.map(p => expandPath(p, baseDir));
  const deferredPaths = deferredRaw.map(p => expandPath(p, baseDir));
  const missingRequired = requiredPaths.filter(p => !existsSync(p));

  return { filePath, frontmatter, body, requiredPaths, deferredPaths, missingRequired };
}

/** Parse + read all required files. Throws on first missing required. */
export function loadSkill(filePath: string): LoadedSkill {
  const manifest = parseSkillManifest(filePath);
  if (manifest.missingRequired.length > 0) {
    const list = manifest.missingRequired.map(p => `  - ${p}`).join('\n');
    throw new Error(`E007: required_reading file(s) missing for ${filePath}:\n${list}`);
  }
  const requiredBodies = manifest.requiredPaths.map(p => ({
    path: p,
    content: readFileSync(p, 'utf-8'),
  }));
  return { ...manifest, requiredBodies };
}

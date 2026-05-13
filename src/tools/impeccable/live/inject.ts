// Copyright 2024 Paul Bakaus (https://github.com/pbakaus/impeccable)
// Licensed under the Apache License, Version 2.0
// Modifications: Converted to TypeScript, adapted for maestro CLI architecture.

/**
 * CLI helper: insert/remove the live variant mode script tag in the project's
 * main HTML entry point.
 *
 * On first live run, the agent generates `.workflow/impeccable/live/config.json`
 * with the project's insertion target (framework-specific). On
 * every subsequent run, this script handles insert/remove deterministically
 * with zero LLM involvement.
 *
 * Converted from live-inject.mjs to TypeScript.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveLiveConfigPath } from '../paths.js';

const MARKER_OPEN_TEXT = 'impeccable-live-start';
const MARKER_CLOSE_TEXT = 'impeccable-live-end';

/**
 * Hard-excluded directory patterns. These are NEVER user-facing pages and
 * matching them would silently inject tracking scripts into third-party
 * code. The user cannot turn these off via config — they are the floor.
 */
const HARD_EXCLUDES: string[] = [
  '**/node_modules/**',
  '**/.git/**',
];

interface InjectOpts {
  port?: string;
  remove?: boolean;
  check?: boolean;
}

export interface LiveConfig {
  files: string[];
  exclude?: string[];
  insertBefore?: string;
  insertAfter?: string;
  commentSyntax: 'html' | 'jsx';
  cspChecked?: boolean;
}

interface FileResult {
  file: string;
  error?: string;
  inserted?: boolean;
  removed?: boolean;
  note?: string;
  anchor?: string;
  cspPatched?: boolean;
  cspReverted?: boolean;
}

const CSP_MARKER_ATTR = 'data-impeccable-csp-original';

export async function injectCli(opts: InjectOpts = {}): Promise<void> {
  const CONFIG_PATH = resolveLiveConfigPath({ cwd: process.cwd() });

  if (opts.check) {
    if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) {
      console.log(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH }));
      process.exit(0);
    }
    let cfg: LiveConfig;
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
      const error = err as Error;
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: error.message, path: CONFIG_PATH }));
      return;
    }
    try {
      validateConfig(cfg);
    } catch (err) {
      const error = err as Error;
      console.log(JSON.stringify({ ok: false, error: 'config_invalid', message: error.message, path: CONFIG_PATH }));
      return;
    }
    console.log(JSON.stringify({ ok: true, config: cfg, path: CONFIG_PATH }));
    return;
  }

  // Load config
  if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) {
    console.error(JSON.stringify({ ok: false, error: 'config_missing', path: CONFIG_PATH }));
    process.exit(1);
  }
  const config: LiveConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  validateConfig(config);

  const resolvedFiles = resolveFiles(process.cwd(), config);

  if (opts.remove) {
    const results = resolvedFiles.map((relFile): FileResult => {
      const absFile = path.resolve(process.cwd(), relFile);
      if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
      const content = fs.readFileSync(absFile, 'utf-8');
      const detagged = removeTag(content, config.commentSyntax);
      const updated = revertCspMeta(detagged);
      if (updated === content) return { file: relFile, removed: false, note: 'no tag present' };
      fs.writeFileSync(absFile, updated, 'utf-8');
      return {
        file: relFile,
        removed: detagged !== content,
        cspReverted: updated !== detagged,
      };
    });
    console.log(JSON.stringify({ ok: true, results }));
    return;
  }

  // Insert mode — need port
  const port = parseInt(opts.port || '', 10);
  if (!Number.isFinite(port)) {
    console.error(JSON.stringify({ ok: false, error: 'missing_port' }));
    process.exit(1);
  }

  const results = resolvedFiles.map((relFile): FileResult => {
    const absFile = path.resolve(process.cwd(), relFile);
    if (!fs.existsSync(absFile)) return { file: relFile, error: 'file_not_found' };
    const content = fs.readFileSync(absFile, 'utf-8');
    const withoutOld = revertCspMeta(removeTag(content, config.commentSyntax));
    const withTag = insertTag(withoutOld, config, port);
    if (withTag === withoutOld) {
      return { file: relFile, error: 'insertion_point_not_found', anchor: config.insertBefore || config.insertAfter };
    }
    const updated = patchCspMeta(withTag, port);
    fs.writeFileSync(absFile, updated, 'utf-8');
    return {
      file: relFile,
      inserted: true,
      cspPatched: updated !== withTag,
    };
  });
  const anyInserted = results.some((r) => r.inserted);
  console.log(JSON.stringify({ ok: anyInserted, port, results }));
  if (!anyInserted) process.exit(1);
}

/**
 * Expand config.files (which may contain glob patterns) into a literal list
 * of existing file paths relative to rootDir. Literal entries pass through;
 * glob patterns are expanded via fs.globSync. HARD_EXCLUDES and config.exclude
 * are applied as filters. Duplicates are removed. Order is preserved by
 * first appearance.
 */
export function resolveFiles(rootDir: string, config: LiveConfig): string[] {
  const patterns = config.files;
  const userExcludes: string[] = Array.isArray(config.exclude) ? config.exclude : [];
  const allExcludes = [...HARD_EXCLUDES, ...userExcludes];
  const excludeRegexes = allExcludes.map(globToRegex);

  const isExcluded = (relPath: string): boolean => excludeRegexes.some((re) => re.test(relPath));
  const isGlob = (s: string): boolean => /[*?[]/.test(s);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const pat of patterns) {
    if (!isGlob(pat)) {
      // Literal path — include even if it doesn't exist yet; the caller
      // reports file_not_found per-entry. Exclude list doesn't apply to
      // explicit literal entries (user named it on purpose).
      if (!seen.has(pat)) {
        seen.add(pat);
        out.push(pat);
      }
      continue;
    }
    let matches: fs.Dirent[];
    try {
      matches = fs.globSync(pat, { cwd: rootDir, withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of matches) {
      if (!(ent as unknown as { isFile(): boolean }).isFile || !(ent as unknown as { isFile(): boolean }).isFile()) continue;
      const abs = path.join((ent as unknown as { parentPath?: string; path?: string }).parentPath || (ent as unknown as { parentPath?: string; path?: string }).path || rootDir, ent.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');
      if (isExcluded(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/**
 * Convert a glob pattern to a RegExp. Supports:
 *   **  → any number of path segments (including zero)
 *   *   → any chars except `/`
 *   ?   → any single char except `/`
 * Paths are normalized to forward slashes before matching.
 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** — any number of segments, including zero. Handle the common
        // **/ and /** forms so `a/**/b` matches `a/b` as well as `a/x/y/b`.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

function validateConfig(cfg: LiveConfig): void {
  if (!cfg || typeof cfg !== 'object') throw new Error('config.json must be an object');
  if (!Array.isArray(cfg.files) || cfg.files.length === 0) {
    throw new Error('config.files (non-empty string array) required');
  }
  if (!cfg.files.every((f) => typeof f === 'string' && f.length > 0)) {
    throw new Error('config.files must contain only non-empty strings');
  }
  if (cfg.exclude !== undefined) {
    if (!Array.isArray(cfg.exclude)) {
      throw new Error('config.exclude, if present, must be a string array');
    }
    if (!cfg.exclude.every((f) => typeof f === 'string' && f.length > 0)) {
      throw new Error('config.exclude must contain only non-empty strings');
    }
  }
  if (typeof cfg.insertBefore !== 'string' && typeof cfg.insertAfter !== 'string') {
    throw new Error('config.insertBefore or config.insertAfter (string) required');
  }
  if (cfg.commentSyntax !== 'html' && cfg.commentSyntax !== 'jsx') {
    throw new Error("config.commentSyntax must be 'html' or 'jsx'");
  }
  if (cfg.cspChecked !== undefined && typeof cfg.cspChecked !== 'boolean') {
    throw new Error("config.cspChecked, if present, must be a boolean");
  }
}

function commentOpen(syntax: string): string { return syntax === 'jsx' ? '{/*' : '<!--'; }
function commentClose(syntax: string): string { return syntax === 'jsx' ? '*/}' : '-->'; }

export function buildTagBlock(syntax: string, port: number): string {
  const open = commentOpen(syntax);
  const close = commentClose(syntax);
  return (
    open + ' ' + MARKER_OPEN_TEXT + ' ' + close + '\n' +
    '<script src="http://localhost:' + port + '/live.js"></script>\n' +
    open + ' ' + MARKER_CLOSE_TEXT + ' ' + close + '\n'
  );
}

export function insertTag(content: string, config: LiveConfig, port: number): string {
  const block = buildTagBlock(config.commentSyntax, port);
  // insertBefore: match the LAST occurrence. Anchors like `</body>` naturally
  // belong at the end, and the same literal can appear earlier in code blocks
  // within rendered documentation pages.
  if (config.insertBefore) {
    const idx = content.lastIndexOf(config.insertBefore);
    if (idx === -1) return content;
    return content.slice(0, idx) + block + content.slice(idx);
  }
  // insertAfter: match the FIRST occurrence — typical anchors like `<head>` or
  // `<body>` open near the top of the document.
  const idx = content.indexOf(config.insertAfter!);
  if (idx === -1) return content;
  const after = idx + config.insertAfter!.length;
  // Preserve a single trailing newline if the anchor didn't end with one
  const prefix = content[after] === '\n' ? content.slice(0, after + 1) : content.slice(0, after) + '\n';
  return prefix + block + content.slice(prefix.length);
}

/**
 * Remove the live script block. Matches either HTML or JSX comment markers
 * regardless of config (so stale tags from a wrong config can still be cleaned).
 *
 * Indent-preserving: captures any whitespace immediately preceding the opener
 * marker and re-emits it in place of the removed block. `insertTag` inserted
 * the block *after* the original line's indent and *before* the anchor (e.g.
 * `</body>`), which moved the indent onto the opener line and left the anchor
 * unindented. Replacing the whole block (plus its trailing newline) with just
 * the captured indent hands the indent back to the anchor that follows.
 */
export function removeTag(content: string, _syntax: string): string {
  const patterns: RegExp[] = [
    /([ \t]*)<!--\s*impeccable-live-start\s*-->[\s\S]*?<!--\s*impeccable-live-end\s*-->[ \t]*\n/,
    /([ \t]*)\{\/\*\s*impeccable-live-start\s*\*\/\}[\s\S]*?\{\/\*\s*impeccable-live-end\s*\*\/\}[ \t]*\n/,
  ];
  for (const pat of patterns) {
    const next = content.replace(pat, '$1');
    if (next !== content) return next;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Content-Security-Policy meta-tag patcher
//
// When the user's HTML carries `<meta http-equiv="Content-Security-Policy">`,
// the cross-origin load of /live.js (and the SSE/POST connection back to
// localhost:PORT) is blocked unless the CSP explicitly allows that origin.
//
// On insert: append `http://localhost:PORT` to `script-src` and `connect-src`,
// and stash the original `content` value in a `data-impeccable-csp-original`
// attribute (base64) so revert is exact.
//
// On remove: detect the marker attribute, decode it, restore the original
// content value verbatim, drop the marker.
//
// Header-based CSP (Next.js headers, Nuxt routeRules, SvelteKit kit.csp,
// shared helpers) is NOT patched here — those need framework-specific config
// edits and are handled via the existing detect-csp.mjs reference output.
// Only the in-source meta-tag form gets the auto-patch.
// ---------------------------------------------------------------------------

interface CspTag {
  start: number;
  end: number;
  full: string;
  attrs: string;
}

interface AttrMatch {
  quote: string;
  value: string;
  full: string;
}

function findCspMetaTags(content: string): CspTag[] {
  const out: CspTag[] = [];
  const tagRe = /<meta\s+([^>]*?)\/?>/gis;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const attrs = m[1];
    if (!/(http-equiv|httpEquiv)\s*=\s*(['"])Content-Security-Policy\2/i.test(attrs)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, full: m[0], attrs });
  }
  return out;
}

function getAttr(attrs: string, name: string): AttrMatch | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i');
  const m = attrs.match(re);
  return m ? { quote: m[1], value: m[2], full: m[0] } : null;
}

function appendOriginToDirective(csp: string, directive: string, origin: string): string {
  const re = new RegExp(`(^|;)(\\s*)(${directive})\\s+([^;]*)`, 'i');
  const m = csp.match(re);
  if (m) {
    const tokens = m[4].trim().split(/\s+/);
    if (tokens.includes(origin)) return csp;
    return csp.replace(re, `${m[1]}${m[2]}${m[3]} ${[...tokens, origin].join(' ')}`);
  }
  // Directive missing — add it. Use 'self' + origin so we don't inadvertently
  // narrow the policy compared to the default-src fallback (most users with
  // an explicit CSP have 'self' there).
  return csp.trim().replace(/;?\s*$/, '') + `; ${directive} 'self' ${origin}`;
}

export function patchCspMeta(content: string, port: number): string {
  const tags = findCspMetaTags(content);
  if (tags.length === 0) return content;
  const origin = `http://localhost:${port}`;

  // Walk last-to-first so prior splices don't invalidate later indices.
  let result = content;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    const attrs = tag.attrs;
    if (getAttr(attrs, CSP_MARKER_ATTR)) continue; // already patched
    const contentAttr = getAttr(attrs, 'content');
    if (!contentAttr) continue;

    const original = contentAttr.value;
    let patched = original;
    patched = appendOriginToDirective(patched, 'script-src', origin);
    patched = appendOriginToDirective(patched, 'connect-src', origin);
    // The shader overlay during 'generating' creates a screenshot via
    // URL.createObjectURL, producing a `blob:` URL — img-src 'self' rejects
    // those. Add `blob:` so the overlay doesn't throw a CSP violation.
    patched = appendOriginToDirective(patched, 'img-src', 'blob:');
    if (patched === original) continue;

    const newContentAttr = `content=${contentAttr.quote}${patched}${contentAttr.quote}`;
    const marker = `${CSP_MARKER_ATTR}="${Buffer.from(original, 'utf-8').toString('base64')}"`;
    // The tagRe captures any whitespace between the last attribute and the
    // closing `/>` as part of `attrs`. Naively appending ` ${marker}` after
    // a replace would land it BEFORE that trailing space, leaving a double
    // space inside attrs and clobbering the space before `/>`. Split off
    // the trailing whitespace, splice the marker into the attribute body,
    // and re-append the original trailing whitespace so a self-closing
    // `<meta … />` round-trips byte-for-byte.
    const trailingWs = (attrs.match(/[ \t]*$/) || [''])[0];
    const attrsBody = attrs.slice(0, attrs.length - trailingWs.length);
    const newAttrs = attrsBody.replace(contentAttr.full, newContentAttr) + ' ' + marker + trailingWs;
    const newTag = tag.full.replace(attrs, newAttrs);

    result = result.slice(0, tag.start) + newTag + result.slice(tag.end);
  }
  return result;
}

export function revertCspMeta(content: string): string {
  const tags = findCspMetaTags(content);
  if (tags.length === 0) return content;

  let result = content;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    const origAttr = getAttr(tag.attrs, CSP_MARKER_ATTR);
    if (!origAttr) continue;
    const contentAttr = getAttr(tag.attrs, 'content');
    if (!contentAttr) continue;

    let originalValue: string;
    try { originalValue = Buffer.from(origAttr.value, 'base64').toString('utf-8'); }
    catch { continue; }

    const newContentAttr = `content=${contentAttr.quote}${originalValue}${contentAttr.quote}`;
    let newAttrs = tag.attrs.replace(contentAttr.full, newContentAttr);
    // Drop the marker attribute and any single space immediately preceding it.
    newAttrs = newAttrs.replace(new RegExp(`\\s*${origAttr.full}`), '');
    const newTag = tag.full.replace(tag.attrs, newAttrs);

    result = result.slice(0, tag.start) + newTag + result.slice(tag.end);
  }
  return result;
}

export { validateConfig };

/**
 * CLI helper: find an element in source and wrap it in a variant container.
 *
 * Searches project files for the element matching the query (class name, ID, or
 * text snippet), wraps it with the variant scaffolding, and prints the file path
 * + line range where the agent should insert variant HTML.
 *
 * This replaces 3-4 agent tool calls (grep + read + edit) with a single CLI call.
 *
 * Converted from live-wrap.mjs to TypeScript.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isGeneratedFile } from '../is-generated.js';

const EXTENSIONS = ['.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro'];

interface WrapOpts {
  id: string;
  count: number;
  elementId?: string;
  classes?: string;
  tag?: string;
  query?: string;
  file?: string;
  text?: string;
}

interface ElementMatch {
  startLine: number;
  endLine: number;
}

interface CommentSyntax {
  open: string;
  close: string;
}

interface StyleMode {
  mode: string;
  styleTag: string;
}

interface CssAuthoring {
  mode: string;
  styleTag: string;
  strategy: string;
  rulePattern: string;
  selectorExamples: string[];
  requirements: string[];
  forbidden: string[];
}

/**
 * Regex that matches a tag opener on a line. Allows the tag name to be
 * followed by whitespace, `>`, `/`, or end-of-line so that multi-line JSX
 * openers (e.g. `<section\n  className="..."\n>`) are recognised.
 */
const OPENER_RE = /<([A-Za-z][A-Za-z0-9]*)(?=[\s/>]|$)/;

export async function wrapCli(opts: WrapOpts): Promise<void> {
  const { id, count, elementId, classes, tag, query, text } = opts;
  let { file: filePath } = opts;

  if (!id) { console.error('Missing --id'); process.exit(1); }
  if (!elementId && !classes && !query) {
    console.error('Need at least one of: --element-id, --classes, --query');
    process.exit(1);
  }

  // Build search queries in priority order (most specific first)
  const queries = buildSearchQueries(elementId, classes, tag, query);

  const genOpts = { cwd: process.cwd() };

  // Find the source file. Generated files are excluded from auto-search so we
  // don't silently write variants into a file the next build will wipe.
  let targetFile: string | null | undefined = filePath;
  let matchedQuery: string | null = null;
  if (!targetFile) {
    for (const q of queries) {
      targetFile = findFileWithQuery(q, process.cwd(), genOpts);
      if (targetFile) { matchedQuery = q; break; }
    }
    if (!targetFile) {
      // Nothing in source. Did the element show up in a generated file? That
      // tells the agent "fall back to the agent-driven flow" vs "element just
      // doesn't exist in this project."
      let generatedHit: string | null = null;
      for (const q of queries) {
        generatedHit = findFileWithQuery(q, process.cwd(), { ...genOpts, includeGenerated: true });
        if (generatedHit) break;
      }
      if (generatedHit) {
        console.error(JSON.stringify({
          error: 'element_not_in_source',
          fallback: 'agent-driven',
          generatedMatch: path.relative(process.cwd(), generatedHit),
          hint: 'Element found only in a generated file. See "Handle fallback" in live.md.',
        }));
      } else {
        console.error(JSON.stringify({
          error: 'element_not_found',
          fallback: 'agent-driven',
          hint: 'Element not found in any project file. It may be runtime-injected (JS component, etc.). See "Handle fallback" in live.md.',
        }));
      }
      process.exit(1);
    }
  } else {
    if (isGeneratedFile(targetFile, genOpts)) {
      console.error(JSON.stringify({
        error: 'file_is_generated',
        fallback: 'agent-driven',
        file: path.relative(process.cwd(), path.resolve(process.cwd(), targetFile)),
        hint: 'Explicit --file points at a generated file. Writing here gets wiped by the next build. See "Handle fallback" in live.md.',
      }));
      process.exit(1);
    }
    matchedQuery = queries[0];
  }

  const content = fs.readFileSync(targetFile, 'utf-8');
  const lines = content.split('\n');

  // Find the element, trying each query in priority order. When `--text` is
  // supplied, collect every candidate the queries surface and disambiguate
  // by the picked element's textContent. Without `--text`, fall back to the
  // legacy first-match behavior so unmodified callers keep working.
  let match: ElementMatch | null = null;
  if (text) {
    const candidates: ElementMatch[] = [];
    for (const q of queries) {
      const all = findAllElements(lines, q, tag);
      for (const c of all) {
        if (!candidates.some((x) => x.startLine === c.startLine)) {
          candidates.push(c);
        }
      }
      // Once a more-specific query (ID, full className combo) yielded a unique
      // result, stop — falling through to the loose tag+single-class query
      // would readmit the siblings we just disambiguated past.
      if (candidates.length === 1) break;
    }
    if (candidates.length === 0) {
      console.error(JSON.stringify({ error: 'Found file but could not locate element in ' + targetFile + '. Searched for: ' + queries.join(', ') }));
      process.exit(1);
    }
    if (candidates.length === 1) {
      match = candidates[0];
    } else {
      const filtered = filterByText(candidates, lines, text);
      if (filtered.length === 1) {
        match = filtered[0];
      } else if (filtered.length === 0) {
        // Source uses dynamic content (`<h1>{title}</h1>` etc.) so the
        // browser-side textContent doesn't appear literally in source. Fall
        // back to first-match rather than refusing — this is the same
        // behavior unmodified callers see, just preserved.
        match = candidates[0];
      } else {
        // Multiple candidates ALSO match the text. Truly ambiguous — refuse
        // rather than pick wrong, and hand the agent the candidate locations
        // so it can disambiguate by reading the file.
        console.error(JSON.stringify({
          error: 'element_ambiguous',
          fallback: 'agent-driven',
          file: path.relative(process.cwd(), targetFile),
          candidates: filtered.map((c) => ({
            startLine: c.startLine + 1,
            endLine: c.endLine + 1,
          })),
          hint: 'Multiple source elements match both classes/tag and textContent. Pass --element-id, a more specific --text, or write the wrapper manually. See "Handle fallback" in live.md.',
        }));
        process.exit(1);
      }
    }
  } else {
    for (const q of queries) {
      match = findElement(lines, q, tag);
      if (match) break;
    }
    if (!match) {
      console.error(JSON.stringify({ error: 'Found file but could not locate element in ' + targetFile + '. Searched for: ' + queries.join(', ') }));
      process.exit(1);
    }
  }

  const { startLine, endLine } = match;
  const commentSyntax = detectCommentSyntax(targetFile);
  const styleMode = detectStyleMode(targetFile);
  const isJsx = commentSyntax.open === '{/*';
  const indent = lines[startLine].match(/^(\s*)/)![1];

  // Extract the original element. Reindent under the wrapper while preserving
  // the relative depth between lines — `l.trimStart()` would strip ALL leading
  // whitespace and collapse e.g. `<aside>`/`  <h1>`/`</aside>` (6/8/6 spaces)
  // to a single uniform indent, so on accept/discard the round-trip restores
  // the inner element at its parent's depth instead of nested inside it.
  // Strip only the COMMON minimum leading whitespace across the picked lines;
  // `deindentContent` on the accept side already mirrors this convention.
  const originalLines = lines.slice(startLine, endLine + 1);
  const originalBaseIndent = minLeadingSpaces(originalLines);
  const reindentOriginal = (extra: string): string => originalLines
    .map((l) => (l.trim() === '' ? '' : indent + extra + l.slice(originalBaseIndent)))
    .join('\n');
  const originalIndented = reindentOriginal('    ');

  // Wrapper attributes differ by syntax. HTML allows plain string attrs;
  // JSX requires object-literal style and parses string attrs as HTML (which
  // either type-errors or renders a literal CSS string).
  const styleContents = isJsx ? 'style={{ display: "contents" }}' : 'style="display: contents"';

  // JSX/TSX guard: the picked element occupies a single JSX child slot
  // (inside `return (...)`, an array `.map(...)`, an `asChild` branch, or
  // any other expression position). Replacing it with `comment + <div> +
  // comment` yields three adjacent siblings — invalid JSX. We can't use a
  // Fragment `<></>` either: parents that clone children (Radix `asChild`,
  // Headless UI, etc.) hit "Invalid prop supplied to React.Fragment" when
  // they try to pass an `id` through.
  //
  // Solution: keep the wrapper `<div>` as the single JSX-slot child and
  // tuck both marker comments INSIDE it. accept/discard then expands its
  // replacement range to include the wrapper's `<div>` open / close lines
  // so the entire scaffold gets removed cleanly.
  const wrapperLines: string[] = isJsx ? [
    indent + '<div data-impeccable-variants="' + id + '" data-impeccable-variant-count="' + count + '" ' + styleContents + '>',
    indent + '  ' + commentSyntax.open + ' impeccable-variants-start ' + id + ' ' + commentSyntax.close,
    indent + '  ' + commentSyntax.open + ' Original ' + commentSyntax.close,
    indent + '  <div data-impeccable-variant="original">',
    reindentOriginal('    '),
    indent + '  </div>',
    indent + '  ' + commentSyntax.open + ' Variants: insert below this line ' + commentSyntax.close,
    indent + '  ' + commentSyntax.open + ' impeccable-variants-end ' + id + ' ' + commentSyntax.close,
    indent + '</div>',
  ] : [
    indent + commentSyntax.open + ' impeccable-variants-start ' + id + ' ' + commentSyntax.close,
    indent + '<div data-impeccable-variants="' + id + '" data-impeccable-variant-count="' + count + '" ' + styleContents + '>',
    indent + '  ' + commentSyntax.open + ' Original ' + commentSyntax.close,
    indent + '  <div data-impeccable-variant="original">',
    originalIndented,
    indent + '  </div>',
    indent + '  ' + commentSyntax.open + ' Variants: insert below this line ' + commentSyntax.close,
    indent + '</div>',
    indent + commentSyntax.open + ' impeccable-variants-end ' + id + ' ' + commentSyntax.close,
  ];

  // Replace the original element with the wrapper
  const newLines = [
    ...lines.slice(0, startLine),
    ...wrapperLines,
    ...lines.slice(endLine + 1),
  ];
  fs.writeFileSync(targetFile, newLines.join('\n'), 'utf-8');

  // Calculate insert line (the "insert below this line" comment).
  // 0-indexed file position. Both HTML and JSX wrappers have 6 lines above
  // the insert marker (HTML: start-comment + outer-div + Original-comment +
  // original-div + content + close-original-div; JSX: outer-div +
  // start-comment + Original-comment + original-div + content +
  // close-original-div). Multi-line originals push the marker by their
  // extra line count.
  const insertLine = startLine + 6 + (originalLines.length - 1);

  console.log(JSON.stringify({
    file: path.relative(process.cwd(), targetFile),
    startLine: startLine + 1,       // 1-indexed for the agent
    // wrapperLines is an array but one element (the original-content slot)
    // is a `\n`-joined multi-line string, so the actual file-row count is
    // wrapperLines.length + (originalLines.length - 1). Without the offset,
    // endLine pointed inside the wrapper for any picked element that
    // spanned more than one source line.
    endLine: startLine + wrapperLines.length + (originalLines.length - 1), // 1-indexed
    insertLine: insertLine + 1,     // 1-indexed: where variants go
    commentSyntax: commentSyntax,
    styleMode: styleMode.mode,
    styleTag: styleMode.styleTag,
    cssSelectorPrefixExamples: buildCssSelectorPrefixExamples(styleMode.mode, count),
    cssAuthoring: buildCssAuthoring(styleMode, count),
    originalLineCount: originalLines.length,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build search query strings in priority order (most specific first).
 * ID is most reliable, then specific class combos, then single classes, then raw query.
 */
function buildSearchQueries(elementId?: string, classes?: string, tag?: string, query?: string): string[] {
  const queries: string[] = [];

  // 1. ID is the most specific
  if (elementId) {
    queries.push('id="' + elementId + '"');
  }

  // 2. Full class attribute match (for elements with distinctive multi-class combos).
  // Emit both class="..." (HTML) and className="..." (React/JSX) so whichever
  // convention the file uses will match.
  if (classes) {
    const classList = classes.split(',').map(c => c.trim()).filter(Boolean);
    if (classList.length > 1) {
      const joined = classList.join(' ');
      const sorted = [...classList].sort((a, b) => b.length - a.length);
      queries.push('class="' + joined + '"');
      queries.push('className="' + joined + '"');
      queries.push(sorted[0]); // most distinctive single class, fallback
    } else if (classList.length === 1) {
      queries.push(classList[0]);
    }
  }

  // 3. Tag + class combo (e.g., <section class="hero">).
  // Same dual-emit for JSX compatibility.
  if (tag && classes) {
    const firstClass = classes.split(',')[0].trim();
    queries.push('<' + tag + ' class="' + firstClass);
    queries.push('<' + tag + ' className="' + firstClass);
  }

  // 4. Raw fallback query
  if (query) {
    queries.push(query);
  }

  return queries;
}

export function detectCommentSyntax(filePath: string): CommentSyntax {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsx' || ext === '.tsx') {
    return { open: '{/*', close: '*/}' };
  }
  // HTML, Vue, Svelte, Astro all use HTML comments
  return { open: '<!--', close: '-->' };
}

function detectStyleMode(filePath: string): StyleMode {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.astro') {
    return {
      mode: 'astro-global-prefixed',
      styleTag: '<style is:inline data-impeccable-css="SESSION_ID">',
    };
  }
  return {
    mode: 'scoped',
    styleTag: '<style data-impeccable-css="SESSION_ID">',
  };
}

function buildCssSelectorPrefixExamples(styleMode: string, count: number): string[] {
  if (styleMode !== 'astro-global-prefixed') return [];
  return Array.from({ length: count }, (_, i) => `[data-impeccable-variant="${i + 1}"]`);
}

function buildCssAuthoring(styleMode: StyleMode, count: number): CssAuthoring {
  const variantNumbers = Array.from({ length: count }, (_, i) => i + 1);
  if (styleMode.mode === 'astro-global-prefixed') {
    return {
      mode: styleMode.mode,
      styleTag: styleMode.styleTag,
      strategy: 'global-prefixed',
      rulePattern: '[data-impeccable-variant="N"] > .variant-class { ... }',
      selectorExamples: variantNumbers.map((n) => `[data-impeccable-variant="${n}"] > .variant-class`),
      requirements: [
        'Use the styleTag exactly; the is:inline attribute is required for this file.',
        'Prefix every preview selector with the matching [data-impeccable-variant="N"] selector.',
        'Keep selectors anchored to the generated variant wrapper; do not rely on component CSS scoping for preview rules.',
      ],
      forbidden: [
        'Do not use @scope for this styleMode.',
      ],
    };
  }
  return {
    mode: styleMode.mode,
    styleTag: styleMode.styleTag,
    strategy: 'scope-rule',
    rulePattern: '@scope ([data-impeccable-variant="N"]) { :scope > .variant-class { ... } }',
    selectorExamples: variantNumbers.map((n) => `@scope ([data-impeccable-variant="${n}"]) { :scope > .variant-class { ... } }`),
    requirements: [
      'Use @scope blocks keyed to each [data-impeccable-variant="N"] wrapper.',
      'Inside each @scope block, make :scope rules step into the replacement element with a descendant combinator.',
      'Use the styleTag exactly; do not add framework-specific style attributes unless this object says to.',
    ],
    forbidden: [
      'Do not use global [data-impeccable-variant="N"] selector prefixes for this styleMode.',
      'Do not add is:inline to the style tag for this styleMode.',
    ],
  };
}

/**
 * Search project files for the query string (class name, ID, etc.)
 * Returns the first matching file path, or null.
 */
function findFileWithQuery(query: string, cwd: string, genOpts: { cwd?: string; includeGenerated?: boolean } = {}): string | null {
  const searchDirs = ['src', 'app', 'pages', 'components', 'public', 'views', 'templates', '.'];
  const seen = new Set<string>();

  for (const dir of searchDirs) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) continue;
    const result = searchDir(absDir, query, seen, 0, genOpts);
    if (result) return result;
  }
  return null;
}

function searchDir(dir: string, query: string, seen: Set<string>, depth: number, genOpts: { cwd?: string; includeGenerated?: boolean }): string | null {
  if (depth > 5) return null; // don't go too deep
  const realDir = fs.realpathSync(dir);
  if (seen.has(realDir)) return null;
  seen.add(realDir);

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }

  // Check files first
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSIONS.includes(ext)) continue;

    const filePath = path.join(dir, entry.name);
    if (!genOpts.includeGenerated && isGeneratedFile(filePath, genOpts)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes(query)) return filePath;
    } catch { /* skip unreadable files */ }
  }

  // Then recurse into directories. Always skip node_modules and .git (never
  // project content). dist/build/out are left to the isGeneratedFile guard so
  // the includeGenerated second-pass can still find the element there and
  // report `generatedMatch`.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const result = searchDir(path.join(dir, entry.name), query, seen, depth + 1, genOpts);
    if (result) return result;
  }

  return null;
}

/**
 * Return the smallest leading-whitespace count across a set of lines,
 * ignoring blank lines (whose indent isn't load-bearing). Used to compute
 * the common base indent of a multi-line picked element so reindenting
 * under the wrapper preserves the relative depth between lines.
 */
function minLeadingSpaces(lines: string[]): number {
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    const m = l.match(/^(\s*)/);
    if (m && m[1].length < min) min = m[1].length;
  }
  return min === Infinity ? 0 : min;
}

export function findElement(lines: string[], query: string, tag?: string | null): ElementMatch | null {
  // Iterate all matches — the first substring hit isn't always the right one.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(query)) continue;

    const stripped = lines[i].trim();
    if (stripped.startsWith('<!--') || stripped.startsWith('{/*') || stripped.startsWith('//')) continue;
    // Skip lines already inside a variant wrapper
    if (lines[i].includes('data-impeccable-variant')) continue;

    const openerLine = findOpenerLine(lines, i, tag);
    if (openerLine === -1) continue;

    const endLine = findClosingLine(lines, openerLine);
    return { startLine: openerLine, endLine };
  }

  return null;
}

/**
 * Like findElement, but returns every match. Used for ambiguity detection
 * when the agent passes --text: when the same className appears on multiple
 * sibling elements (a list of cards, repeated section variants, etc.),
 * first-match silently lands on the wrong branch. Returning all matches lets
 * the caller narrow by textContent or fail with a structured ambiguity error.
 */
function findAllElements(lines: string[], query: string, tag?: string | null): ElementMatch[] {
  const out: ElementMatch[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(query)) continue;
    const stripped = lines[i].trim();
    if (stripped.startsWith('<!--') || stripped.startsWith('{/*') || stripped.startsWith('//')) continue;
    if (lines[i].includes('data-impeccable-variant')) continue;
    const openerLine = findOpenerLine(lines, i, tag);
    if (openerLine === -1) continue;
    if (seen.has(openerLine)) continue; // multiple matches inside the same element
    seen.add(openerLine);
    const endLine = findClosingLine(lines, openerLine);
    out.push({ startLine: openerLine, endLine });
  }
  return out;
}

/**
 * Narrow a candidate set to those whose source body matches a meaningful
 * prefix of the picked element's textContent. The compare strips tags and
 * JSX expressions, then checks two whitespace normalizations side-by-side:
 *
 *   - single-space ("hero two second card body")
 *   - no-whitespace ("herotwosecondcardbody")
 *
 * Both are needed because `el.textContent` concatenates sibling text without
 * inserting whitespace (e.g. `<h1>Hero Two</h1><p>Second…</p>` reads as
 * `"Hero TwoSecond…"`), while the source has whitespace between tags. If
 * EITHER normalization matches, the candidate keeps. A snippet shorter than
 * 8 chars after stripping is too weak to disambiguate — the caller falls
 * back to first-match.
 */
function filterByText(candidates: ElementMatch[], lines: string[], text: string): ElementMatch[] {
  const trimmed = text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
  // Too short to disambiguate. Return [] so the caller's `filtered.length
  // === 0` branch fires (fall back to first-match) — the previous
  // `candidates.slice()` return forced `filtered.length > 1` and surfaced
  // a spurious `element_ambiguous` error on every short-text picker event
  // with multiple candidates.
  if (trimmed.length < 8) return [];
  const targetSpaced = trimmed;
  const targetCompact = trimmed.replace(/\s+/g, '');

  return candidates.filter((c) => {
    const body = lines.slice(c.startLine, c.endLine + 1).join(' ');
    const inner = body
      .replace(/<[^>]*>/g, ' ')   // strip HTML/JSX tags
      .replace(/\{[^}]*\}/g, ' ')  // strip JSX expressions
      .toLowerCase();
    const sourceSpaced = inner.replace(/\s+/g, ' ').trim();
    const sourceCompact = inner.replace(/\s+/g, '');
    return sourceSpaced.includes(targetSpaced) || sourceCompact.includes(targetCompact);
  });
}

/**
 * Resolve a match line to the real tag opener. If the match line itself opens
 * a tag, return it. Otherwise walk up to 10 lines backward looking for the
 * first tag opener. If `tag` is specified, the opener must match that tag
 * name; an opener with a different tag name aborts the backward walk for this
 * match (we don't jump across element boundaries).
 *
 * Returns the line index of the opener, or -1 if none can be resolved.
 */
function findOpenerLine(lines: string[], matchLine: number, tag?: string | null): number {
  const self = lines[matchLine].match(OPENER_RE);
  if (self) {
    if (!tag || self[1] === tag) return matchLine;
    return -1;
  }
  const MAX_BACKWALK = 10;
  for (let i = matchLine - 1; i >= Math.max(0, matchLine - MAX_BACKWALK); i--) {
    const opener = lines[i].match(OPENER_RE);
    if (!opener) continue;
    if (!tag || opener[1] === tag) return i;
    // Different tag name than requested — abort; we're inside a non-target opener.
    return -1;
  }
  return -1;
}

/**
 * Starting from a line with an opening tag, find the line with the matching
 * closing tag by counting tag nesting depth.
 */
export function findClosingLine(lines: string[], start: number): number {
  const openMatch = lines[start].match(OPENER_RE);
  if (!openMatch) return start; // caller passed a non-opener; nothing to span

  const tagName = openMatch[1];
  let depth = 0;
  const openRe = new RegExp('<' + tagName + '(?=[\\s/>]|$)', 'g');
  const selfCloseRe = new RegExp('<' + tagName + '[^>]*/>', 'g');
  const closeRe = new RegExp('</' + tagName + '\\s*>', 'g');

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(openRe) || []).length;
    const selfCloses = (line.match(selfCloseRe) || []).length;
    const closes = (line.match(closeRe) || []).length;

    depth += opens - selfCloses - closes;

    if (depth <= 0) return i;
  }

  // If we can't find the close, return a reasonable guess
  return Math.min(start + 50, lines.length - 1);
}

export { buildSearchQueries };

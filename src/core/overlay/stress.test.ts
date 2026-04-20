// ---------------------------------------------------------------------------
// Stress tests — exercise the overlay pipeline at scale.
//
// Covers:
//   - High overlay count on a single target
//   - High patch count in a single overlay
//   - Large content blocks
//   - Many targets per overlay
//   - Priority ordering under load
//   - Repeated apply/remove cycles
//   - Mixed EOL across targets
//   - Export/import round-trip at scale
//   - Round-trip fidelity with user edits preserved
//   - Section-parser scaling on large files
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// `paths.home` is frozen at module import time from MAESTRO_HOME env.
// Mock it so each test gets a fresh temp-based home directory.
let mockHome: string;
vi.mock('../../config/paths.js', () => ({
  paths: {
    get home() { return mockHome; },
  },
}));

import {
  applyOverlays,
  exportOverlayFile,
  importOverlayFile,
  removeOverlayFromTargets,
} from './applier.js';
import {
  applyOverlay as applyOverlayPure,
  removeOverlay as removePure,
} from './patcher.js';
import { parseSections } from './section-parser.js';
import type { OverlayFile, OverlayMeta, OverlayMode } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CMD = [
  '---',
  'name: target',
  '---',
  '<purpose>',
  'base purpose',
  '</purpose>',
  '',
  '<execution>',
  'base execution step',
  '</execution>',
  '',
].join('\n');

function makeCmd(name: string): string {
  return BASE_CMD.replace('name: target', `name: ${name}`);
}

function makeOverlay(
  name: string,
  patches: OverlayMeta['patches'],
  opts: { priority?: number; targets?: string[]; enabled?: boolean } = {},
): OverlayFile {
  const meta: OverlayMeta = {
    name,
    targets: opts.targets ?? ['target'],
    priority: opts.priority,
    enabled: opts.enabled,
    patches,
  };
  return {
    meta,
    sourcePath: `/fake/${name}.json`,
    raw: JSON.stringify(meta),
    hash: 'fakehash',
  };
}

function writeOverlayJson(
  dir: string,
  name: string,
  patches: OverlayMeta['patches'],
  opts: { priority?: number; targets?: string[]; enabled?: boolean } = {},
): string {
  const obj = {
    name,
    targets: opts.targets ?? ['target-1'],
    priority: opts.priority ?? 50,
    enabled: opts.enabled ?? true,
    patches,
  };
  const fp = join(dir, `${name}.json`);
  writeFileSync(fp, JSON.stringify(obj), 'utf-8');
  return fp;
}

function setupScope(
  tmp: string,
  commandNames: string[],
): { targetBase: string; overlayDir: string; commandsDir: string } {
  const targetBase = join(tmp, 'target');
  const commandsDir = join(targetBase, '.claude', 'commands');
  mkdirSync(commandsDir, { recursive: true });
  for (const name of commandNames) {
    writeFileSync(join(commandsDir, `${name}.md`), makeCmd(name), 'utf-8');
  }
  const overlayDir = join(tmp, 'overlays');
  mkdirSync(overlayDir, { recursive: true });
  return { targetBase, overlayDir, commandsDir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stress: overlay pipeline', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'overlay-stress-'));
    mockHome = join(tmp, 'maestro-home');
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. High overlay count on a single section (pure patcher, no filesystem)
  // -------------------------------------------------------------------------

  it('stacks 100 overlays into one section with correct ordering', () => {
    const N = 100;
    let text = BASE_CMD;
    // Apply in reverse priority order to confirm each insert goes directly
    // before </execution>, pushing earlier ones upward.
    for (let i = 0; i < N; i++) {
      const overlay = makeOverlay(`o-${String(i).padStart(3, '0')}`, [
        { section: 'execution', mode: 'append', content: `CONTENT-${i}` },
      ]);
      const result = applyOverlayPure(text, overlay, 'target', '/fake/target.md');
      text = result.text;
    }

    // All 100 markers present.
    for (let i = 0; i < N; i++) {
      const tag = `maestro-overlay:o-${String(i).padStart(3, '0')}#0`;
      expect(text.includes(`<!-- ${tag}`)).toBe(true);
      expect(text.includes(`<!-- /${tag}`)).toBe(true);
    }

    // Each was inserted at closeLine, so last-applied sits directly above </execution>.
    // Verify ordering by finding each marker and checking monotonic positions.
    const positions: number[] = [];
    for (let i = 0; i < N; i++) {
      const tag = `<!-- maestro-overlay:o-${String(i).padStart(3, '0')}#0`;
      positions.push(text.indexOf(tag));
    }
    for (let i = 1; i < N; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }

    // Round-trip: remove them all in reverse, yields original.
    for (let i = N - 1; i >= 0; i--) {
      const { text: stripped } = removePure(text, `o-${String(i).padStart(3, '0')}`);
      text = stripped;
    }
    const norm = (s: string) => s.replace(/\r?\n+$/, '') + '\n';
    expect(norm(text)).toBe(norm(BASE_CMD));
  });

  // -------------------------------------------------------------------------
  // 2. Many patches inside a single overlay
  // -------------------------------------------------------------------------

  it('applies a single overlay with 50 patches across two sections', () => {
    const N = 50;
    const patches: OverlayMeta['patches'] = [];
    for (let i = 0; i < N; i++) {
      patches.push({
        section: i % 2 === 0 ? 'execution' : 'purpose',
        mode: 'append',
        content: `P-${i}`,
      });
    }
    const overlay = makeOverlay('multi', patches);
    const result = applyOverlayPure(BASE_CMD, overlay, 'target', '/fake/target.md');

    expect(result.applied.markerIds).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      expect(result.text).toContain(`<!-- maestro-overlay:multi#${i}`);
      expect(result.text).toContain(`P-${i}`);
    }

    // Round-trip by overlay name removes all 50 marker blocks.
    const { text: cleaned, removed } = removePure(result.text, 'multi');
    expect(removed.sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
    const norm = (s: string) => s.replace(/\r?\n+$/, '') + '\n';
    expect(norm(cleaned)).toBe(norm(BASE_CMD));
  });

  // -------------------------------------------------------------------------
  // 3. Large content blocks (10 KB)
  // -------------------------------------------------------------------------

  it('handles a 10 KB content block through apply/remove', () => {
    const big = 'X'.repeat(10_000) + '\nfinal';
    const overlay = makeOverlay('bigblock', [
      { section: 'execution', mode: 'append', content: big },
    ]);
    const applied = applyOverlayPure(BASE_CMD, overlay, 'target', '/fake');
    expect(applied.text.length).toBeGreaterThan(10_000);
    expect(applied.text).toContain('X'.repeat(100)); // spot-check
    expect(applied.text).toContain('final');

    const { text: stripped } = removePure(applied.text, 'bigblock');
    expect(stripped).not.toContain('X'.repeat(100));
    const norm = (s: string) => s.replace(/\r?\n+$/, '') + '\n';
    expect(norm(stripped)).toBe(norm(BASE_CMD));
  });

  // -------------------------------------------------------------------------
  // 4. Many targets in a single overlay (filesystem applier)
  // -------------------------------------------------------------------------

  it('fans out to 20 target files via applyOverlays', () => {
    const names = Array.from({ length: 20 }, (_, i) => `cmd-${i}`);
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, names);
    writeOverlayJson(overlayDir, 'fanout', [
      { section: 'execution', mode: 'append', content: 'FANOUT' },
    ], { targets: names });

    const report = applyOverlays({
      targetBase,
      scope: 'global',
      overlayDir,
      logger: () => {},
    });
    expect(report.filesChanged).toBe(20);
    expect(report.overlaysApplied).toBe(1);

    for (const name of names) {
      const body = readFileSync(join(commandsDir, `${name}.md`), 'utf-8');
      expect(body).toContain('FANOUT');
      expect(body).toContain('<!-- maestro-overlay:fanout#0');
    }
  });

  // -------------------------------------------------------------------------
  // 5. Priority ordering under load
  // -------------------------------------------------------------------------

  it('respects priority ordering across 30 overlays on one target', () => {
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, ['target-1']);
    // 30 overlays at priorities 10..99 (random-ish), each injecting a unique marker.
    const priorities = [
      10, 20, 30, 40, 50, 60, 70, 80, 90, 99,
      15, 25, 35, 45, 55, 65, 75, 85, 95, 11,
      22, 33, 44, 66, 77, 88, 12, 23, 34, 56,
    ];
    priorities.forEach((p, i) => {
      writeOverlayJson(
        overlayDir,
        `p${String(i).padStart(2, '0')}`,
        [
          {
            section: 'execution',
            mode: 'append',
            content: `TAG-${i}-prio-${p}`,
          },
        ],
        { priority: p },
      );
    });

    const report = applyOverlays({
      targetBase,
      scope: 'global',
      overlayDir,
      logger: () => {},
    });
    expect(report.overlaysApplied).toBe(30);
    expect(report.filesChanged).toBe(1);

    const body = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');

    // Sort (priority asc, name asc) — that's the expected application order,
    // which for append means earlier = further from </execution> (higher in file).
    const indexed = priorities
      .map((p, i) => ({ p, name: `p${String(i).padStart(2, '0')}`, tag: `TAG-${i}-prio-${p}` }))
      .sort((a, b) => (a.p - b.p) || a.name.localeCompare(b.name));

    const positions = indexed.map((x) => body.indexOf(x.tag));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Repeated apply cycles are byte-stable (idempotent churn test)
  // -------------------------------------------------------------------------

  it('remains byte-stable across 50 repeated applyOverlays cycles', () => {
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, ['target-1']);
    writeOverlayJson(overlayDir, 'stable', [
      { section: 'execution', mode: 'append', content: 'A' },
      { section: 'purpose', mode: 'prepend', content: 'B' },
    ]);
    const logger = () => {};

    applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
    const baseline = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');

    for (let i = 0; i < 50; i++) {
      const report = applyOverlays({
        targetBase,
        scope: 'global',
        overlayDir,
        logger,
      });
      // After the first apply, every subsequent run should report zero changes.
      expect(report.filesChanged).toBe(0);
      const body = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');
      expect(body).toBe(baseline);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Mixed EOL across targets — each file preserves its own line endings
  // -------------------------------------------------------------------------

  it('preserves per-file EOL when applying to LF and CRLF files together', () => {
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, []);
    // Write one LF and one CRLF target directly to avoid the LF-only helper.
    writeFileSync(join(commandsDir, 'lf-cmd.md'), makeCmd('lf-cmd'), 'utf-8');
    writeFileSync(
      join(commandsDir, 'crlf-cmd.md'),
      makeCmd('crlf-cmd').replace(/\n/g, '\r\n'),
      'utf-8',
    );
    writeOverlayJson(
      overlayDir,
      'eol-mix',
      [{ section: 'execution', mode: 'append', content: 'EOL-MIX' }],
      { targets: ['lf-cmd', 'crlf-cmd'] },
    );

    applyOverlays({ targetBase, scope: 'global', overlayDir, logger: () => {} });

    const lfBody = readFileSync(join(commandsDir, 'lf-cmd.md'), 'utf-8');
    const crlfBody = readFileSync(join(commandsDir, 'crlf-cmd.md'), 'utf-8');

    expect(lfBody).toContain('EOL-MIX');
    expect(crlfBody).toContain('EOL-MIX');

    // LF file must have no bare \r
    expect(lfBody).not.toMatch(/\r/);
    // CRLF file must not contain any lone \n (every \n is preceded by \r)
    expect(crlfBody).not.toMatch(/[^\r]\n/);
  });

  // -------------------------------------------------------------------------
  // 8. User edits outside markers survive 10 re-apply cycles
  // -------------------------------------------------------------------------

  it('preserves user edits outside markers across 10 apply cycles', () => {
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, ['target-1']);
    writeOverlayJson(overlayDir, 'user-edits', [
      { section: 'execution', mode: 'append', content: 'INJECTED' },
    ]);
    const logger = () => {};
    applyOverlays({ targetBase, scope: 'global', overlayDir, logger });

    // User hand-edit outside markers but inside the section
    const cmdPath = join(commandsDir, 'target-1.md');
    const edited = readFileSync(cmdPath, 'utf-8').replace(
      'base execution step',
      'base execution step\nHAND EDITED LINE',
    );
    writeFileSync(cmdPath, edited, 'utf-8');

    for (let i = 0; i < 10; i++) {
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
      const body = readFileSync(cmdPath, 'utf-8');
      expect(body).toContain('HAND EDITED LINE');
      expect(body).toContain('INJECTED');
    }
  });

  // -------------------------------------------------------------------------
  // 9. Export/import round-trip at scale
  // -------------------------------------------------------------------------

  it('export 25 overlays → wipe → import back → re-apply yields identical bytes', () => {
    const { targetBase, overlayDir, commandsDir } = setupScope(tmp, ['target-1']);
    const names: string[] = [];
    for (let i = 0; i < 25; i++) {
      const name = `bulk-${String(i).padStart(2, '0')}`;
      names.push(name);
      writeOverlayJson(
        overlayDir,
        name,
        [
          {
            section: i % 2 === 0 ? 'execution' : 'purpose',
            mode: 'append',
            content: `BULK-${i}`,
          },
        ],
        { priority: 50 + (i % 5) },
      );
    }

    const logger = () => {};
    applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
    const baseline = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');

    // Export each to a portable staging directory.
    const staging = join(tmp, 'staging');
    mkdirSync(staging, { recursive: true });
    for (const name of names) {
      exportOverlayFile(overlayDir, name, staging);
      expect(existsSync(join(staging, `${name}.json`))).toBe(true);
    }

    // Wipe everything: remove markers, delete overlay files.
    for (const name of names) {
      removeOverlayFromTargets(name, 'global', targetBase);
      rmSync(join(overlayDir, `${name}.json`));
    }
    const wiped = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');
    expect(wiped).not.toContain('BULK-');

    // Import all 25 back.
    for (const name of names) {
      importOverlayFile(join(staging, `${name}.json`), overlayDir);
    }
    applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
    const after = readFileSync(join(commandsDir, 'target-1.md'), 'utf-8');
    expect(after).toBe(baseline);
  });

  // -------------------------------------------------------------------------
  // 10. Performance bound: 40 overlays × 10 targets under 3 seconds
  // -------------------------------------------------------------------------

  it('applies 40 overlays across 10 targets within performance budget', () => {
    const targets = Array.from({ length: 10 }, (_, i) => `t-${i}`);
    const { targetBase, overlayDir } = setupScope(tmp, targets);

    for (let i = 0; i < 40; i++) {
      writeOverlayJson(
        overlayDir,
        `perf-${String(i).padStart(2, '0')}`,
        [
          {
            section: 'execution',
            mode: 'append',
            content: `PERF-${i}`,
          },
        ],
        { priority: 10 + (i % 90), targets },
      );
    }

    const start = Date.now();
    const report = applyOverlays({
      targetBase,
      scope: 'global',
      overlayDir,
      logger: () => {},
    });
    const elapsed = Date.now() - start;

    expect(report.overlaysApplied).toBe(40);
    expect(report.filesChanged).toBe(10);
    // Soft budget — 40 * 10 = 400 patch insertions.
    expect(elapsed).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// Section-parser scaling
// ---------------------------------------------------------------------------

describe('stress: section-parser', () => {
  it('parses a 200-section file correctly', () => {
    const parts: string[] = ['---', 'name: big', '---'];
    for (let i = 0; i < 200; i++) {
      const tag = `section_${i}`;
      parts.push(`<${tag}>`, `body ${i}`, `</${tag}>`, '');
    }
    const text = parts.join('\n');
    const parsed = parseSections(text);
    expect(parsed.sections).toHaveLength(200);
    expect(parsed.sections[0].name).toBe('section_0');
    expect(parsed.sections[199].name).toBe('section_199');
  });

  it('ignores fenced code blocks even in a 5000-line file', () => {
    const parts: string[] = ['<execution>'];
    for (let i = 0; i < 1000; i++) {
      parts.push('```');
      parts.push('<fakeSection>');
      parts.push('body');
      parts.push('</fakeSection>');
      parts.push('```');
    }
    parts.push('real body');
    parts.push('</execution>');
    const text = parts.join('\n');
    const parsed = parseSections(text);
    expect(parsed.sections.map((s) => s.name)).toEqual(['execution']);
  });
});

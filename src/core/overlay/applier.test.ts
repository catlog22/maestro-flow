import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CMD = [
  '---',
  'name: test-cmd',
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

const OVERLAY_JSON = {
  name: 'cli-verify',
  description: 'Run CLI verify after execute',
  targets: ['test-cmd'],
  priority: 50,
  enabled: true,
  patches: [
    {
      section: 'execution',
      mode: 'append',
      content: 'INJECTED: run ccw cli --mode analysis',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupScope(
  tmp: string,
  cmdFiles: Record<string, string>,
): { targetBase: string; overlayDir: string } {
  const targetBase = join(tmp, 'target');
  const commandsDir = join(targetBase, '.claude', 'commands');
  mkdirSync(commandsDir, { recursive: true });
  for (const [name, body] of Object.entries(cmdFiles)) {
    writeFileSync(join(commandsDir, `${name}.md`), body, 'utf-8');
  }
  const overlayDir = join(tmp, 'overlays');
  mkdirSync(overlayDir, { recursive: true });
  return { targetBase, overlayDir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applier', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'overlay-applier-'));
    mockHome = join(tmp, 'maestro-home');
    mkdirSync(mockHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('applyOverlays', () => {
    it('applies overlay, injects markers, writes manifest', () => {
      const { targetBase, overlayDir } = setupScope(tmp, { 'test-cmd': BASE_CMD });
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );

      const report = applyOverlays({
        targetBase,
        scope: 'global',
        overlayDir,
        logger: () => {},
      });

      expect(report.overlaysLoaded).toBe(1);
      expect(report.overlaysApplied).toBe(1);
      expect(report.filesChanged).toBe(1);

      const text = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(text).toContain('<!-- maestro-overlay:cli-verify#0');
      expect(text).toContain('INJECTED: run ccw cli');
      expect(text).toContain('base execution step'); // original preserved
    });

    it('second apply is byte-identical (idempotent)', () => {
      const { targetBase, overlayDir } = setupScope(tmp, { 'test-cmd': BASE_CMD });
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      const logger = () => {};
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
      const after1 = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
      const after2 = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(after2).toBe(after1);
    });

    it('skips missing targets with reason', () => {
      const { targetBase, overlayDir } = setupScope(tmp, {});
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      const report = applyOverlays({
        targetBase,
        scope: 'global',
        overlayDir,
        logger: () => {},
      });
      expect(report.filesChanged).toBe(0);
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0].reason).toBe('missing');
    });

    it('skips .md.disabled targets', () => {
      const { targetBase, overlayDir } = setupScope(tmp, {});
      const cmdsDir = join(targetBase, '.claude', 'commands');
      writeFileSync(join(cmdsDir, 'test-cmd.md.disabled'), BASE_CMD, 'utf-8');
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      const report = applyOverlays({
        targetBase,
        scope: 'global',
        overlayDir,
        logger: () => {},
      });
      expect(report.skipped[0].reason).toBe('disabled');
    });

    it('disabled overlay is not applied', () => {
      const { targetBase, overlayDir } = setupScope(tmp, { 'test-cmd': BASE_CMD });
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify({ ...OVERLAY_JSON, enabled: false }),
        'utf-8',
      );
      const report = applyOverlays({
        targetBase,
        scope: 'global',
        overlayDir,
        logger: () => {},
      });
      expect(report.overlaysApplied).toBe(0);
      const text = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(text).not.toContain('maestro-overlay');
    });
  });

  describe('removeOverlayFromTargets', () => {
    it('strips markers and updates manifest', () => {
      const { targetBase, overlayDir } = setupScope(tmp, { 'test-cmd': BASE_CMD });
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger: () => {} });

      const result = removeOverlayFromTargets('cli-verify', 'global', targetBase);
      expect(result.filesChanged).toBe(1);

      const text = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(text).not.toContain('maestro-overlay');
      expect(text).not.toContain('INJECTED');
      expect(text).toContain('base execution step');
    });
  });

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  describe('exportOverlayFile', () => {
    it('exports to an explicit file path', () => {
      const overlayDir = join(tmp, 'overlays');
      mkdirSync(overlayDir, { recursive: true });
      const src = join(overlayDir, 'cli-verify.json');
      writeFileSync(src, JSON.stringify(OVERLAY_JSON), 'utf-8');

      const out = join(tmp, 'exports', 'my-overlay.json');
      const result = exportOverlayFile(overlayDir, 'cli-verify', out);

      expect(result.dest).toBe(out);
      expect(result.overlayName).toBe('cli-verify');
      expect(existsSync(out)).toBe(true);

      const roundTrip = JSON.parse(readFileSync(out, 'utf-8'));
      expect(roundTrip.name).toBe('cli-verify');
      expect(roundTrip.patches[0].content).toBe(OVERLAY_JSON.patches[0].content);
    });

    it('exports to a directory — uses <name>.json', () => {
      const overlayDir = join(tmp, 'overlays');
      mkdirSync(overlayDir, { recursive: true });
      writeFileSync(
        join(overlayDir, 'disk-name.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );

      const exportDir = join(tmp, 'exports');
      mkdirSync(exportDir, { recursive: true });
      const result = exportOverlayFile(overlayDir, 'cli-verify', exportDir);

      // The overlay's declared name (not the source filename) drives output
      expect(result.dest).toBe(join(exportDir, 'cli-verify.json'));
      expect(existsSync(result.dest)).toBe(true);
    });

    it('throws when the overlay name is not found', () => {
      const overlayDir = join(tmp, 'overlays');
      mkdirSync(overlayDir, { recursive: true });
      expect(() =>
        exportOverlayFile(overlayDir, 'ghost', join(tmp, 'out.json')),
      ).toThrow(/not found/i);
    });

    it('skips underscore-prefixed files during lookup', () => {
      const overlayDir = join(tmp, 'overlays');
      mkdirSync(overlayDir, { recursive: true });
      // _shipped file has the target name but must be invisible to export
      writeFileSync(
        join(overlayDir, '_shipped.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      expect(() =>
        exportOverlayFile(overlayDir, 'cli-verify', join(tmp, 'out.json')),
      ).toThrow(/not found/i);
    });
  });

  describe('importOverlayFile', () => {
    it('validates and copies into overlayDir using the declared name', () => {
      const overlayDir = join(tmp, 'overlays');
      const src = join(tmp, 'inbox', 'arbitrary-filename.json');
      mkdirSync(join(tmp, 'inbox'), { recursive: true });
      writeFileSync(src, JSON.stringify(OVERLAY_JSON), 'utf-8');

      const result = importOverlayFile(src, overlayDir);
      // Destination uses the overlay's declared name, not the source filename
      expect(result.dest).toBe(join(overlayDir, 'cli-verify.json'));
      expect(result.overlayName).toBe('cli-verify');
      expect(result.overwritten).toBe(false);
      expect(existsSync(result.dest)).toBe(true);
    });

    it('rejects an invalid overlay file without copying', () => {
      const overlayDir = join(tmp, 'overlays');
      const src = join(tmp, 'inbox.json');
      writeFileSync(src, JSON.stringify({ name: 'x' }), 'utf-8'); // missing fields

      expect(() => importOverlayFile(src, overlayDir)).toThrow();
      // Nothing written to overlayDir
      const contents = existsSync(overlayDir) ? readdirSync(overlayDir) : [];
      expect(contents.filter((f) => f.endsWith('.json'))).toHaveLength(0);
    });

    it('sets overwritten=true when replacing an existing overlay', () => {
      const overlayDir = join(tmp, 'overlays');
      mkdirSync(overlayDir, { recursive: true });
      // Pre-seed with a different version
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify({
          ...OVERLAY_JSON,
          patches: [{ section: 'execution', mode: 'append', content: 'OLD' }],
        }),
        'utf-8',
      );
      const src = join(tmp, 'new.json');
      writeFileSync(src, JSON.stringify(OVERLAY_JSON), 'utf-8');

      const result = importOverlayFile(src, overlayDir);
      expect(result.overwritten).toBe(true);
      const body = JSON.parse(readFileSync(result.dest, 'utf-8'));
      expect(body.patches[0].content).toBe(OVERLAY_JSON.patches[0].content);
    });

    it('throws on missing source file', () => {
      expect(() =>
        importOverlayFile(join(tmp, 'nope.json'), join(tmp, 'overlays')),
      ).toThrow(/not found/i);
    });
  });

  describe('export → import round-trip', () => {
    it('apply → export → remove → import → apply yields same markers', () => {
      const { targetBase, overlayDir } = setupScope(tmp, { 'test-cmd': BASE_CMD });
      writeFileSync(
        join(overlayDir, 'cli-verify.json'),
        JSON.stringify(OVERLAY_JSON),
        'utf-8',
      );
      const logger = () => {};

      // 1. Apply
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
      const firstText = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(firstText).toContain('<!-- maestro-overlay:cli-verify#0');

      // 2. Export
      const exportPath = join(tmp, 'bundle.json');
      exportOverlayFile(overlayDir, 'cli-verify', exportPath);

      // 3. Remove: strip markers + delete source file
      removeOverlayFromTargets('cli-verify', 'global', targetBase);
      rmSync(join(overlayDir, 'cli-verify.json'));
      const strippedText = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(strippedText).not.toContain('maestro-overlay');

      // 4. Import the bundle back
      const importResult = importOverlayFile(exportPath, overlayDir);
      expect(importResult.overlayName).toBe('cli-verify');

      // 5. Re-apply → text should match the first applied state
      applyOverlays({ targetBase, scope: 'global', overlayDir, logger });
      const secondText = readFileSync(
        join(targetBase, '.claude', 'commands', 'test-cmd.md'),
        'utf-8',
      );
      expect(secondText).toBe(firstText);
    });
  });
});

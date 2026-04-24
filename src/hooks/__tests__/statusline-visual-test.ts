/**
 * Visual test for statusline — colored text mode.
 *
 * Generates an HTML preview that accurately matches the actual terminal output.
 * Uses the same Unicode icons, segment structure, and TEXT_COLORS as the real renderer.
 *
 * Usage: npx tsx src/hooks/__tests__/statusline-visual-test.ts
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TEXT_COLORS, ICONS, GIT_ICONS, getCtxLevel } from '../constants.js';

// ---------------------------------------------------------------------------
// Types & Helpers
// ---------------------------------------------------------------------------

type SegKey = 'model' | 'milestone' | 'phase' | 'coord' | 'task' | 'team' | 'dir' | 'ctxOk' | 'ctxWarn' | 'ctxAlert' | 'ctxCrit';

interface Seg {
  text: string;
  key: SegKey;
}

interface Scenario { label: string; segments: Seg[]; }

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function ctxKey(pct: number): SegKey {
  const level = getCtxLevel(pct);
  return `ctx${level.charAt(0).toUpperCase()}${level.slice(1)}` as SegKey;
}

function bar(pct: number): string {
  const f = Math.floor(pct / 10);
  return '\u2588'.repeat(f) + '\u2591'.repeat(10 - f);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Scenarios — segment structure matches formatStatusline() exactly
// ---------------------------------------------------------------------------

const scenarios: Scenario[] = [
  {
    label: '1. Minimal — solo, no workflow',
    segments: [
      { key: 'model', text: `${ICONS.model} Opus 4` },
      { key: 'dir', text: `${ICONS.dir} maestro2  ${ICONS.git} master ${GIT_ICONS.clean}` },
      { key: ctxKey(30), text: `${ICONS.ctx} ${bar(30)} 30%` },
    ],
  },
  {
    label: '2. With milestone + phase — context warn',
    segments: [
      { key: 'model', text: `${ICONS.model} Sonnet 4` },
      { key: 'milestone', text: `${ICONS.milestone} MVP 1/4` },
      { key: 'phase', text: `${ICONS.phase} P2.1 [2plan 1run]` },
      { key: 'dir', text: `${ICONS.dir} maestro2  ${ICONS.git} master ${GIT_ICONS.dirty}` },
      { key: ctxKey(54), text: `${ICONS.ctx} ${bar(54)} 54%` },
    ],
  },
  {
    label: '3. Full — coordinator + task + team',
    segments: [
      { key: 'model', text: `${ICONS.model} Opus 4` },
      { key: 'milestone', text: `${ICONS.milestone} MVP 2/4` },
      { key: 'phase', text: `${ICONS.phase} P3 [3plan]` },
      { key: 'coord', text: `${ICONS.coord} full-lifecycle verify [3/6]` },
      { key: 'task', text: `${ICONS.task} Fixing auth module` },
      { key: 'team', text: `${ICONS.team} alice (P3/001) | bob +2` },
      { key: 'dir', text: `${ICONS.dir} maestro2  ${ICONS.git} feat/auth ${GIT_ICONS.dirty}${GIT_ICONS.ahead}2` },
      { key: ctxKey(66), text: `${ICONS.ctx} ${bar(66)} 66%` },
    ],
  },
  {
    label: '4. Critical context — 92%',
    segments: [
      { key: 'model', text: `${ICONS.model} Haiku 4.5` },
      { key: 'milestone', text: `${ICONS.milestone} Production 3/4` },
      { key: 'phase', text: `${ICONS.phase} P4` },
      { key: 'dir', text: `${ICONS.dir} maestro2  ${ICONS.git} main ${GIT_ICONS.clean}` },
      { key: ctxKey(92), text: `${ICONS.ctx} ${bar(92)} 92%` },
    ],
  },
  {
    label: '5. No workflow, no context',
    segments: [
      { key: 'model', text: `${ICONS.model} Claude` },
      { key: 'dir', text: `${ICONS.dir} my-project  ${ICONS.git} develop ${GIT_ICONS.conflict}${GIT_ICONS.behind}3` },
    ],
  },
];

// ---------------------------------------------------------------------------
// Renderer — matches renderColoredText() logic exactly
// ---------------------------------------------------------------------------

function renderPreview(segs: Seg[]): string {
  const pipeColor = rgb(TEXT_COLORS.separator);
  const pipe = `<span style="color:${pipeColor}"> | </span>`;

  const parts = segs.map((seg) => {
    const colorKey = seg.key as keyof typeof TEXT_COLORS;
    const color = TEXT_COLORS[colorKey] ?? TEXT_COLORS.model;
    return `<span style="color:${rgb(color)}">${esc(seg.text)}</span>`;
  });

  return `<div class="line">${parts.join(pipe)}</div>`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const rows = scenarios.map(s => `
  <div class="scenario">
    <div class="label">${s.label}</div>
    ${renderPreview(s.segments)}
  </div>`).join('\n');

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Maestro Statusline — Preview</title>
<style>
* { box-sizing: border-box; }
  body {
    background: #1e1e2e; color: #cdd6f4; padding: 32px 40px;
    font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
    font-size: 13px; line-height: 1.5;
  }
  h1 { color: #89b4fa; font-size: 18px; margin-bottom: 8px; font-weight: 500; }
  .subtitle { color: #585b70; font-size: 11px; margin-bottom: 28px; }

  .scenario { margin-bottom: 24px; }
  .label { color: #a6adc8; font-size: 12px; margin-bottom: 6px; }

  .line {
    display: inline-flex; align-items: center;
    background: #181825; padding: 4px 14px; border-radius: 6px; height: 28px;
    white-space: nowrap;
  }
  .line > span { white-space: nowrap; }

  .footer { margin-top: 32px; color: #45475a; font-size: 11px; }
</style>
</head><body>
  <h1>Maestro Statusline</h1>
  <div class="subtitle">Colored text mode — Unicode icons, pipe separators (matches actual terminal output)</div>
  ${rows}
  <div class="footer">
    <p>Segments are conditionally shown — empty segments are omitted.</p>
    <p>Colors from TEXT_COLORS in constants.ts, icons from ICONS (Unicode set).</p>
  </div>
</body></html>`;

const outPath = join(tmpdir(), 'maestro-statusline-test.html');
writeFileSync(outPath, html);
console.log(`Written to: ${outPath}`);

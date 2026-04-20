/**
 * Visual test for dual-mode statusline with custom SVG icons.
 *
 * Usage: npx tsx src/hooks/__tests__/statusline-visual-test.ts
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SEGMENT_BG, SEGMENT_FG, TEXT_COLORS, getCtxLevel,
} from '../constants.js';

// ---------------------------------------------------------------------------
// SVG Icon Library — unified minimalist line style, 14x14 viewBox
// ---------------------------------------------------------------------------

const SVG_ICONS: Record<string, string> = {
  // Model — sparkle/star
  model: `<svg viewBox="0 0 14 14" class="icon"><path d="M7 1l1.5 4H13l-3.5 2.5L11 12 7 9.5 3 12l1.5-4.5L1 5h4.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  // Milestone — flag
  milestone: `<svg viewBox="0 0 14 14" class="icon"><path d="M3 2v10M3 2h7l-2 3 2 3H3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  // Phase — diamond
  phase: `<svg viewBox="0 0 14 14" class="icon"><path d="M7 2l5 5-5 5-5-5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  // Coordinator — gear
  coord: `<svg viewBox="0 0 14 14" class="icon"><circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M11.2 2.8l-1 1M3.8 10.2l-1 1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>`,
  // Task — pencil/edit
  task: `<svg viewBox="0 0 14 14" class="icon"><path d="M2 12l1-4L10 1l3 3-7 7zm7-9l3 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Team — people
  team: `<svg viewBox="0 0 14 14" class="icon"><circle cx="5" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="10" cy="4" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1 12c0-2.5 2-4 4-4s4 1.5 4 4M8 12c0-1.8 1-3 2.5-3s2.5 1.2 2.5 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  // Directory — folder
  dir: `<svg viewBox="0 0 14 14" class="icon"><path d="M2 3h4l1 1.5H12v7H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  // Git — branch
  git: `<svg viewBox="0 0 14 14" class="icon"><circle cx="4" cy="4" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="4" cy="11" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="10" cy="6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M4 5.5v4M8.5 6C7 6 4 6 4 8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  // Context — gauge/meter
  ctx: `<svg viewBox="0 0 14 14" class="icon"><path d="M2 10a5.5 5.5 0 1 1 10 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M7 10V5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10" r="1" fill="currentColor"/></svg>`,
};

// ---------------------------------------------------------------------------
// Types & Helpers
// ---------------------------------------------------------------------------

interface Seg {
  text: string;
  icon: string;  // key into SVG_ICONS
  key: string;   // key into color maps
  bg: readonly [number, number, number];
  fg: readonly [number, number, number];
}

interface Scenario { label: string; segments: Seg[]; }

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const ctxBg = (pct: number) => {
  const m = { ok: SEGMENT_BG.ctxOk, warn: SEGMENT_BG.ctxWarn, alert: SEGMENT_BG.ctxAlert, crit: SEGMENT_BG.ctxCrit };
  return m[getCtxLevel(pct)];
};
const ctxFg = (pct: number) => {
  const m = { ok: SEGMENT_FG.ctxOk, warn: SEGMENT_FG.ctxWarn, alert: SEGMENT_FG.ctxAlert, crit: SEGMENT_FG.ctxCrit };
  return m[getCtxLevel(pct)];
};
const ctxKey = (pct: number) => `ctx${getCtxLevel(pct).charAt(0).toUpperCase()}${getCtxLevel(pct).slice(1)}`;

function bar(pct: number): string {
  const f = Math.floor(pct / 10);
  return '\u2588'.repeat(f) + '\u2591'.repeat(10 - f);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const scenarios: Scenario[] = [
  {
    label: '1. Minimal — solo, no workflow',
    segments: [
      { icon: 'model', key: 'model', text: 'Opus 4', bg: SEGMENT_BG.model, fg: SEGMENT_FG.model },
      { icon: 'dir', key: 'dir', text: 'maestro2', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'git', key: 'dir', text: 'master ✓', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'ctx', key: ctxKey(30), text: `${bar(30)} 30%`, bg: ctxBg(30), fg: ctxFg(30) },
    ],
  },
  {
    label: '2. With milestone + phase — context warn',
    segments: [
      { icon: 'model', key: 'model', text: 'Sonnet 4', bg: SEGMENT_BG.model, fg: SEGMENT_FG.model },
      { icon: 'milestone', key: 'milestone', text: 'MVP 1/4', bg: SEGMENT_BG.milestone, fg: SEGMENT_FG.milestone },
      { icon: 'phase', key: 'phase', text: 'P2.1 [2plan 1run]', bg: SEGMENT_BG.phase, fg: SEGMENT_FG.phase },
      { icon: 'dir', key: 'dir', text: 'maestro2', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'git', key: 'dir', text: 'master ●', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'ctx', key: ctxKey(54), text: `${bar(54)} 54%`, bg: ctxBg(54), fg: ctxFg(54) },
    ],
  },
  {
    label: '3. Full — coordinator + task + team',
    segments: [
      { icon: 'model', key: 'model', text: 'Opus 4', bg: SEGMENT_BG.model, fg: SEGMENT_FG.model },
      { icon: 'milestone', key: 'milestone', text: 'MVP 2/4', bg: SEGMENT_BG.milestone, fg: SEGMENT_FG.milestone },
      { icon: 'phase', key: 'phase', text: 'P3 [3plan]', bg: SEGMENT_BG.phase, fg: SEGMENT_FG.phase },
      { icon: 'coord', key: 'coord', text: 'full-lifecycle verify [3/6]', bg: SEGMENT_BG.coord, fg: SEGMENT_FG.coord },
      { icon: 'task', key: 'task', text: 'Fixing auth module', bg: SEGMENT_BG.task, fg: SEGMENT_FG.task },
      { icon: 'team', key: 'team', text: 'alice (P3/001) | bob +2', bg: SEGMENT_BG.team, fg: SEGMENT_FG.team },
      { icon: 'dir', key: 'dir', text: 'maestro2', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'git', key: 'dir', text: 'feat/auth ●↑2', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'ctx', key: ctxKey(66), text: `${bar(66)} 66%`, bg: ctxBg(66), fg: ctxFg(66) },
    ],
  },
  {
    label: '4. Critical context — 92%',
    segments: [
      { icon: 'model', key: 'model', text: 'Haiku 4.5', bg: SEGMENT_BG.model, fg: SEGMENT_FG.model },
      { icon: 'milestone', key: 'milestone', text: 'Production 3/4', bg: SEGMENT_BG.milestone, fg: SEGMENT_FG.milestone },
      { icon: 'phase', key: 'phase', text: 'P4', bg: SEGMENT_BG.phase, fg: SEGMENT_FG.phase },
      { icon: 'dir', key: 'dir', text: 'maestro2', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'git', key: 'dir', text: 'main ✓', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'ctx', key: ctxKey(92), text: `${bar(92)} 92%`, bg: ctxBg(92), fg: ctxFg(92) },
    ],
  },
  {
    label: '5. No workflow, no context',
    segments: [
      { icon: 'model', key: 'model', text: 'Claude', bg: SEGMENT_BG.model, fg: SEGMENT_FG.model },
      { icon: 'dir', key: 'dir', text: 'my-project', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
      { icon: 'git', key: 'dir', text: 'develop ⚠↓3', bg: SEGMENT_BG.dir, fg: SEGMENT_FG.dir },
    ],
  },
];

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function svgIcon(key: string): string {
  return SVG_ICONS[key] || '';
}

/** Powerline — colored bg + SVG dovetail arrows */
function renderPowerline(segs: Seg[]): string {
  // Merge consecutive same-bg segments (dir + git)
  const merged = mergeAdjacentDir(segs);
  let html = '<div class="pl-line">';
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i];
    html += `<span class="pl-seg" style="background:${rgb(s.bg)};color:${rgb(s.fg)}">${s.iconHtml}<span class="seg-text">${esc(s.text)}</span></span>`;
    const nextBg = i < merged.length - 1 ? rgb(merged[i + 1].bg) : '#1e1e2e';
    // Classic Powerline dovetail: right-pointing arrow (current color) on next-bg
    html += `<svg class="pl-arrow" viewBox="0 0 14 28" preserveAspectRatio="none">` +
      `<rect width="14" height="28" fill="${nextBg}"/>` +
      `<polygon points="0,0 14,14 0,28" fill="${rgb(s.bg)}"/>` +
    `</svg>`;
  }
  html += '</div>';
  return html;
}

/** Colored text — colored text on dark bg + pipe separators */
function renderText(segs: Seg[]): string {
  const merged = mergeAdjacentDir(segs);
  const parts = merged.map((s) => {
    const ck = s.key as keyof typeof TEXT_COLORS;
    const color = TEXT_COLORS[ck] ?? TEXT_COLORS.model;
    return `<span style="color:${rgb(color)}">${s.iconHtml}<span class="seg-text">${esc(s.text)}</span></span>`;
  });
  const pipe = `<span class="pipe">|</span>`;
  return `<div class="txt-line">${parts.join(pipe)}</div>`;
}

interface MergedSeg extends Seg { iconHtml: string; }

/** Merge dir+git into one segment to avoid redundant separators */
function mergeAdjacentDir(segs: Seg[]): MergedSeg[] {
  const result: MergedSeg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.icon === 'dir' && i + 1 < segs.length && segs[i + 1].icon === 'git') {
      const g = segs[i + 1];
      result.push({
        ...s,
        text: `${s.text}  ${g.text}`,
        iconHtml: svgIcon('dir') + `<span class="seg-text">${esc(s.text)}</span>  ` + svgIcon('git'),
      });
      // Override: we already embedded text in iconHtml, clear the text field
      result[result.length - 1].text = g.text;
      i++; // skip git segment
    } else {
      result.push({ ...s, iconHtml: svgIcon(s.icon) });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const rows = scenarios.map(s => `
  <div class="scenario">
    <div class="label">${s.label}</div>
    <div class="mode-tag">POWERLINE</div>
    ${renderPowerline(s.segments)}
    <div class="mode-tag">COLORED TEXT</div>
    ${renderText(s.segments)}
  </div>`).join('\n');

const iconRef = Object.entries(SVG_ICONS).map(([k, v]) =>
  `<div class="icon-item"><span class="icon-preview" style="color:#89b4fa">${v}</span><span class="icon-name">${k}</span></div>`
).join('');

const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Maestro Statusline — Dual Mode + SVG Icons</title>
<style>
* { box-sizing: border-box; }
  body {
    background: #1e1e2e; color: #cdd6f4; padding: 32px 40px;
    font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
    font-size: 13px; line-height: 1.5;
  }
  h1 { color: #89b4fa; font-size: 18px; margin-bottom: 8px; font-weight: 500; }
  h2 { color: #a6adc8; font-size: 14px; margin: 32px 0 12px; font-weight: 400; }
  .subtitle { color: #585b70; font-size: 11px; margin-bottom: 28px; }

  .scenario { margin-bottom: 28px; }
  .label { color: #a6adc8; font-size: 12px; margin-bottom: 8px; }
  .mode-tag { color: #45475a; font-size: 9px; letter-spacing: 1.5px; margin: 4px 0 3px; text-transform: uppercase; }

  /* Powerline */
  .pl-line { display: inline-flex; align-items: stretch; height: 28px; }
  .pl-seg { padding: 0 10px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
  .pl-arrow { width: 14px; height: 28px; flex-shrink: 0; display: block; margin: 0; padding: 0; }

  /* Colored text */
  .txt-line { display: inline-flex; align-items: center; background: #181825; padding: 4px 14px; border-radius: 6px; height: 28px; gap: 0; }
  .txt-line > span { display: inline-flex; align-items: center; gap: 4px; }
  .pipe { color: rgb(${TEXT_COLORS.separator.join(',')}); margin: 0 8px; }

  .seg-text { white-space: nowrap; }

  /* SVG icons */
  .icon { width: 14px; height: 14px; flex-shrink: 0; vertical-align: middle; }

  /* Icon reference */
  .icon-grid { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; }
  .icon-item { display: flex; align-items: center; gap: 6px; }
  .icon-preview .icon { width: 20px; height: 20px; }
  .icon-name { color: #585b70; font-size: 11px; }

  .footer { margin-top: 32px; color: #45475a; font-size: 11px; }
  .footer code { color: #89b4fa; }
</style>
</head><body>
  <h1>Maestro Statusline</h1>
  <div class="subtitle">Dual-mode rendering with unified SVG icons</div>
  ${rows}
  <h2>Icon Reference</h2>
  <div class="icon-grid">${iconRef}</div>
  <div class="footer">
    <p><code>MAESTRO_STATUSLINE_STYLE=powerline|text</code> (default: text)</p>
    <p><code>MAESTRO_NERD_FONT=1</code> for Nerd Font terminal icons (default: Unicode)</p>
  </div>
</body></html>`;

const outPath = join(tmpdir(), 'maestro-statusline-test.html');
writeFileSync(outPath, html);
console.log(`Written to: ${outPath}`);

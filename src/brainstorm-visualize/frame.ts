// ---------------------------------------------------------------------------
// HTML frame + inline styles for the brainstorm visualizer.
//
// Design system aligned with dashboard (Notion-style warm palette, Inter +
// JetBrains Mono, light/dark via prefers-color-scheme + data-theme).
//
// Semantic class names (.options, .cards, .mockup, .split, .pros-cons) are
// used by the agent when writing prototype fragments; the CSS below is the
// canonical styling. Full-document prototypes are served as-is.
// ---------------------------------------------------------------------------

const STYLES = `
/* ===== Reset ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ===== Light mode (default) ===== */
:root, [data-theme="light"] {
  --bg-primary: #FAF8F5;
  --bg-secondary: #F3F0EA;
  --bg-card: #FFFFFF;
  --bg-elevated: #FFFFFF;
  --bg-hover: rgba(55, 53, 47, 0.04);
  --bg-active: rgba(55, 53, 47, 0.08);
  --bg-tertiary: #EBE8E1;

  --text-primary: #2D2A26;
  --text-secondary: #78756F;
  --text-tertiary: #A09D97;
  --text-placeholder: #D1CEC8;

  --border: #E8E5DE;
  --border-divider: #ECEAE4;

  --accent-blue: #5B8DB8;
  --accent-green: #5A9E78;
  --accent-orange: #C8863A;
  --accent-yellow: #B89540;
  --accent-purple: #9178B5;
  --accent-red: #C46555;

  --brand: #10a37f;
  --brand-light: #e8faf4;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(15,15,15,0.05);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(15,15,15,0.04);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(15,15,15,0.03);

  --code-bg: #2C2723;
  --code-text: #D9D0C4;

  --scrollbar-thumb: rgba(55, 53, 47, 0.16);
  --scrollbar-thumb-hover: rgba(55, 53, 47, 0.28);
}

/* ===== Dark mode ===== */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg-primary: #191919;
    --bg-secondary: #202020;
    --bg-card: #252525;
    --bg-elevated: #2F2F2F;
    --bg-hover: rgba(255,255,255,0.055);
    --bg-active: rgba(255,255,255,0.08);
    --bg-tertiary: #2A2A2A;

    --text-primary: rgba(255,255,255,0.9);
    --text-secondary: rgba(255,255,255,0.6);
    --text-tertiary: rgba(255,255,255,0.4);
    --text-placeholder: rgba(255,255,255,0.3);

    --border: rgba(255,255,255,0.08);
    --border-divider: rgba(255,255,255,0.06);

    --accent-blue: #529CCA;
    --accent-green: #3A8660;
    --accent-orange: #C47539;
    --accent-yellow: #C4963A;
    --accent-purple: #8E6FBF;
    --accent-red: #C4554D;

    --brand: #10a37f;
    --brand-light: #0f2b22;

    --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04);
    --shadow-md: 0 4px 8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);

    --code-bg: #1a1a1a;
    --code-text: #D9D0C4;

    --scrollbar-thumb: rgba(255,255,255,0.12);
    --scrollbar-thumb-hover: rgba(255,255,255,0.22);
  }
}
[data-theme="dark"] {
  --bg-primary: #191919;
  --bg-secondary: #202020;
  --bg-card: #252525;
  --bg-elevated: #2F2F2F;
  --bg-hover: rgba(255,255,255,0.055);
  --bg-active: rgba(255,255,255,0.08);
  --bg-tertiary: #2A2A2A;
  --text-primary: rgba(255,255,255,0.9);
  --text-secondary: rgba(255,255,255,0.6);
  --text-tertiary: rgba(255,255,255,0.4);
  --text-placeholder: rgba(255,255,255,0.3);
  --border: rgba(255,255,255,0.08);
  --border-divider: rgba(255,255,255,0.06);
  --accent-blue: #529CCA;
  --accent-green: #3A8660;
  --accent-orange: #C47539;
  --accent-yellow: #C4963A;
  --accent-purple: #8E6FBF;
  --accent-red: #C4554D;
  --brand: #10a37f;
  --brand-light: #0f2b22;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  --code-bg: #1a1a1a;
  --code-text: #D9D0C4;
  --scrollbar-thumb: rgba(255,255,255,0.12);
  --scrollbar-thumb-hover: rgba(255,255,255,0.22);
}

/* ===== Base ===== */
body {
  font-family: 'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 0.875rem;
  line-height: 1.5;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }

.wrap { max-width: 960px; margin: 0 auto; padding: 40px 28px; }

/* ===== Header ===== */
header {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 16px; border-bottom: 1px solid var(--border-divider); margin-bottom: 28px;
}
header h1 {
  margin: 0; font-size: 0.8125rem; font-weight: 500;
  color: var(--text-secondary); letter-spacing: -0.01em;
}
header .status {
  font-size: 0.6875rem; color: var(--text-tertiary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
header .status.live::before { content: "● "; color: var(--accent-green); }
header .status.idle::before { content: "○ "; color: var(--text-tertiary); }

/* ===== Typography ===== */
h1, h2, h3 { color: var(--text-primary); margin-top: 0; }
h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; }
.subtitle { color: var(--text-secondary); font-size: 0.8125rem; margin: -2px 0 22px; }
.section { margin: 28px 0; }
.label {
  font-size: 0.6875rem; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;
}

/* ===== Options (A/B/C) ===== */
.options { display: flex; flex-direction: column; gap: 8px; }
.option {
  padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px;
  cursor: pointer; background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms cubic-bezier(0.2,0,0,1), background 150ms cubic-bezier(0.2,0,0,1), transform 100ms;
}
.option:hover { border-color: var(--accent-blue); background: var(--bg-hover); }
.option.selected { border-color: var(--accent-green); background: var(--brand-light); }
.option.selected::before { content: "✓ "; color: var(--accent-green); font-weight: 600; }
.option[data-choice]::after {
  content: attr(data-choice); float: right; color: var(--text-tertiary);
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.6875rem;
}
.option.selected[data-choice]::after { color: var(--accent-green); }

/* ===== Cards ===== */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.card {
  padding: 16px; border: 1px solid var(--border); border-radius: 12px;
  cursor: pointer; background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms, background 150ms, transform 200ms cubic-bezier(0.2,0,0,1), box-shadow 200ms;
}
.card:hover { border-color: var(--accent-blue); background: var(--bg-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); }
.card.selected { border-color: var(--accent-green); background: var(--brand-light); }
.card h3 { margin: 0 0 6px; font-size: 0.875rem; font-weight: 600; }
.card p { margin: 0; color: var(--text-secondary); font-size: 0.8125rem; }

/* ===== Mockup ===== */
.mockup {
  border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
  background: var(--bg-secondary); margin: 12px 0; box-shadow: var(--shadow-sm);
}
.mockup-header {
  padding: 10px 14px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-divider);
  font-size: 0.6875rem; color: var(--text-tertiary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.mockup-body { padding: 16px; min-height: 160px; }

/* ===== Split comparison ===== */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .split { grid-template-columns: 1fr; } }

/* ===== Pros/Cons ===== */
.pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
.pros, .cons {
  padding: 14px 16px; border-radius: 8px;
  border: 1px solid var(--border);
}
.pros { background: rgba(90, 158, 120, 0.08); border-color: rgba(90, 158, 120, 0.2); }
.cons { background: rgba(196, 101, 85, 0.08); border-color: rgba(196, 101, 85, 0.2); }
.pros h4, .cons h4 { margin: 0 0 8px; font-size: 0.6875rem; letter-spacing: 0.05em; text-transform: uppercase; }
.pros h4 { color: var(--accent-green); }
.cons h4 { color: var(--accent-red); }
.pros ul, .cons ul { margin: 0; padding-left: 18px; font-size: 0.8125rem; color: var(--text-secondary); }

/* ===== Wireframe primitives ===== */
.mock-nav {
  display: flex; gap: 16px; padding: 10px 16px;
  border-bottom: 1px solid var(--border-divider); color: var(--text-tertiary); font-size: 0.8125rem;
}
.mock-sidebar {
  width: 180px; padding: 16px; border-right: 1px solid var(--border-divider);
  color: var(--text-tertiary); font-size: 0.8125rem; display: inline-block; vertical-align: top;
}
.mock-content { padding: 16px; display: inline-block; color: var(--text-secondary); font-size: 0.8125rem; vertical-align: top; }
.mock-button {
  display: inline-block; padding: 6px 14px; border-radius: 6px;
  background: var(--brand); color: #fff; font-size: 0.8125rem; font-weight: 500;
  border: none;
}
.mock-input {
  display: inline-block; padding: 6px 10px; border-radius: 6px;
  background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-tertiary);
  font-size: 0.8125rem; min-width: 180px;
}
.placeholder {
  background: var(--bg-tertiary);
  border-radius: 6px; min-height: 60px; display: block;
}

/* ===== Screen list (index) ===== */
.screen-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.screen-list li { margin: 0; }
.screen-list a {
  display: block; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-card); color: var(--text-primary); text-decoration: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.8125rem;
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms, background 150ms, box-shadow 150ms;
}
.screen-list a:hover { border-color: var(--accent-blue); background: var(--bg-hover); box-shadow: var(--shadow-md); }
.back-link {
  display: inline-block; margin-bottom: 18px; color: var(--text-tertiary);
  text-decoration: none; font-size: 0.8125rem;
  transition: color 150ms;
}
.back-link:hover { color: var(--accent-blue); }

/* ===== Compare toolbar ===== */
.compare-toolbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; margin-bottom: 16px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--bg-primary);
}
.compare-toolbar .label { margin-bottom: 0; }
.layout-controls { display: flex; gap: 4px; }
.layout-btn {
  appearance: none; border: 1px solid var(--border); background: var(--bg-card);
  width: 32px; height: 28px; border-radius: 6px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 2px;
  color: var(--text-tertiary); transition: all 150ms;
}
.layout-btn:hover { border-color: var(--accent-blue); color: var(--text-secondary); }
.layout-btn.active { border-color: var(--accent-blue); background: var(--bg-active); color: var(--accent-blue); }
.layout-btn .col-bar {
  width: 4px; height: 14px; border-radius: 1px; background: currentColor;
}

/* ===== Compare grid ===== */
.compare-grid { display: grid; gap: 16px; }
.compare-panel {
  border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
  background: var(--bg-card); box-shadow: var(--shadow-sm);
  transition: border-color 200ms, box-shadow 200ms, transform 200ms cubic-bezier(0.2,0,0,1);
  animation: card-enter 300ms cubic-bezier(0.2,0,0,1) backwards;
}
.compare-panel:hover { border-color: var(--accent-blue); box-shadow: var(--shadow-md); transform: translateY(-1px); }
@keyframes card-enter {
  from { opacity: 0; transform: translateY(5px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.compare-label {
  padding: 8px 14px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-divider);
  font-size: 0.6875rem; color: var(--text-tertiary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  display: flex; align-items: center; justify-content: space-between;
}
.compare-label .panel-id {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px;
  background: var(--accent-blue); color: #fff;
  font-size: 0.625rem; font-weight: 600; margin-right: 8px; flex-shrink: 0;
}
.compare-label-actions { display: flex; gap: 4px; }
.compare-label-actions a, .compare-label-actions button {
  appearance: none; border: none; background: var(--bg-hover); cursor: pointer;
  width: 24px; height: 24px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 12px; text-decoration: none;
  transition: background 150ms, color 150ms;
}
.compare-label-actions a:hover, .compare-label-actions button:hover {
  background: var(--bg-active); color: var(--text-primary);
}
.compare-body { padding: 16px; min-height: 200px; }

/* ===== Expand overlay ===== */
.expand-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  display: none; align-items: center; justify-content: center;
  animation: overlay-in 200ms;
}
.expand-overlay.visible { display: flex; }
@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
.expand-content {
  width: 90vw; max-width: 1100px; max-height: 90vh;
  background: var(--bg-card); border-radius: 12px; overflow: auto;
  box-shadow: var(--shadow-lg);
  animation: modal-enter 250ms cubic-bezier(0.2,0,0,1);
}
@keyframes modal-enter {
  from { opacity: 0; transform: scale(0.95) translateY(-10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.expand-header {
  position: sticky; top: 0; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-divider);
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.8125rem; color: var(--text-secondary);
}
.expand-close {
  appearance: none; border: none; background: var(--bg-hover); cursor: pointer;
  width: 28px; height: 28px; border-radius: 6px;
  color: var(--text-tertiary); font-size: 16px; transition: background 150ms;
}
.expand-close:hover { background: var(--bg-active); color: var(--text-primary); }
.expand-body { padding: 24px; }

/* ===== Code blocks ===== */
code, .mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.8125rem;
}

/* ===== Empty state ===== */
.empty {
  padding: 60px 20px; text-align: center; color: var(--text-tertiary);
  border: 1px dashed var(--border); border-radius: 12px;
}

/* ===== Theme toggle ===== */
.theme-toggle {
  appearance: none; border: none; background: var(--bg-hover); cursor: pointer;
  width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 14px; transition: background 150ms;
}
.theme-toggle:hover { background: var(--bg-active); }

/* ===== Entrance animation ===== */
@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.wrap { animation: fade-in 300ms cubic-bezier(0.2,0,0,1); }
@media (prefers-reduced-motion: reduce) { .wrap { animation: none; } }
`.trim();

const TITLE = 'Maestro Brainstorm Visualizer';

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const THEME_SCRIPT = `<script>
(function(){
  var t = localStorage.getItem('bv-theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  window.__toggleTheme = function() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    if (!cur) next = 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('bv-theme', next);
    var btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = next === 'dark' ? '☀' : '☾';
  };
})();
</script>`;

function themeButton(): string {
  return `<button class="theme-toggle" onclick="__toggleTheme()" title="Toggle theme">☾</button>`;
}

export function emptyPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TITLE}</title>
${FONTS}
<style>${STYLES}</style>
${THEME_SCRIPT}
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="status idle">waiting</span>
      ${themeButton()}
    </div>
  </header>
  <div class="empty">
    <p>No screen files in this session yet.</p>
    <p class="subtitle">Write <code>*.html</code> files into the screen directory, then reload.</p>
  </div>
</div>
</body>
</html>`;
}

export function indexPage(screens: string[]): string {
  const items = screens.map((s) => {
    const href = `/screen/${encodeURIComponent(s)}`;
    return `    <li><a href="${href}">${escapeHtml(s)}</a></li>`;
  }).join('\n');
  const compareHref = `/compare?files=${screens.map(encodeURIComponent).join(',')}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TITLE}</title>
${FONTS}
<style>${STYLES}</style>
${THEME_SCRIPT}
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="status live">${screens.length} screen${screens.length === 1 ? '' : 's'}</span>
      ${themeButton()}
    </div>
  </header>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
    <div class="label" style="margin-bottom:0;">Screens</div>
    <a href="${compareHref}" style="font-size:0.8125rem;color:var(--accent-blue);text-decoration:none;">Compare all →</a>
  </div>
  <ul class="screen-list">
${items}
  </ul>
</div>
</body>
</html>`;
}

export function wrapScreen(screenName: string, body: string): string {
  // Full HTML documents are served as-is.
  if (/^\s*<!doctype/i.test(body) || /^\s*<html/i.test(body)) {
    return body;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TITLE} — ${escapeHtml(screenName)}</title>
${FONTS}
<style>${STYLES}</style>
${THEME_SCRIPT}
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="status live">${escapeHtml(screenName)}</span>
      ${themeButton()}
    </div>
  </header>
  <a href="/" class="back-link">← back to index</a>
  ${body}
</div>
</body>
</html>`;
}

export function comparePage(screens: { name: string; body: string }[]): string {
  const defaultCols = screens.length <= 2 ? screens.length : screens.length <= 4 ? 2 : 3;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const panels = screens.map((s, i) => {
    const letter = letters[i] ?? String(i + 1);
    const isFullDoc = /^\s*<!doctype/i.test(s.body) || /^\s*<html/i.test(s.body);
    const content = isFullDoc
      ? `<iframe srcdoc="${escapeAttr(s.body)}" style="width:100%;height:100%;border:0;min-height:400px;background:var(--bg-primary);border-radius:6px;"></iframe>`
      : s.body;
    const singleHref = `/screen/${encodeURIComponent(s.name)}`;
    return `    <div class="compare-panel" style="animation-delay:${i * 60}ms" data-panel="${letter}">
      <div class="compare-label">
        <span><span class="panel-id">${letter}</span>${escapeHtml(s.name)}</span>
        <span class="compare-label-actions">
          <button onclick="__expand('${letter}')" title="Expand">⤢</button>
          <a href="${singleHref}" title="Open full page">↗</a>
        </span>
      </div>
      <div class="compare-body">${content}</div>
    </div>`;
  }).join('\n');

  // Build layout button SVGs (1/2/3 col indicators using simple bars)
  const layoutBtns = [1, 2, 3].map((n) => {
    const bars = Array.from({ length: n }, () => '<span class="col-bar"></span>').join('');
    const active = n === defaultCols ? ' active' : '';
    return `<button class="layout-btn${active}" onclick="__setLayout(${n})" title="${n} column${n > 1 ? 's' : ''}">${bars}</button>`;
  }).join('\n          ');

  // Build expand overlay panel contents (hidden, shown on click)
  const expandPanels = screens.map((s, i) => {
    const letter = letters[i] ?? String(i + 1);
    const isFullDoc = /^\s*<!doctype/i.test(s.body) || /^\s*<html/i.test(s.body);
    const content = isFullDoc
      ? `<iframe srcdoc="${escapeAttr(s.body)}" style="width:100%;height:70vh;border:0;background:var(--bg-primary);border-radius:6px;"></iframe>`
      : s.body;
    return `<div class="expand-panel" data-expand="${letter}" style="display:none;">
      <div class="expand-header">
        <span>${letter} — ${escapeHtml(s.name)}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="expand-close" onclick="__expandNav(-1)" title="Previous">←</button>
          <span style="font-size:0.6875rem;color:var(--text-tertiary);">${i + 1} / ${screens.length}</span>
          <button class="expand-close" onclick="__expandNav(1)" title="Next">→</button>
          <button class="expand-close" onclick="__closeExpand()" title="Close">✕</button>
        </div>
      </div>
      <div class="expand-body">${content}</div>
    </div>`;
  }).join('\n  ');

  const compareScript = `<script>
(function(){
  var grid = document.querySelector('.compare-grid');
  var wrap = document.querySelector('.wrap');
  var overlay = document.querySelector('.expand-overlay');
  var panels = ${JSON.stringify(screens.map((_, i) => letters[i] ?? String(i + 1)))};
  var currentIdx = 0;

  window.__setLayout = function(cols) {
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    wrap.style.maxWidth = cols > 2 ? '1400px' : '960px';
    document.querySelectorAll('.layout-btn').forEach(function(b, i) {
      b.classList.toggle('active', i + 1 === cols);
    });
  };

  window.__expand = function(letter) {
    currentIdx = panels.indexOf(letter);
    showPanel(letter);
    overlay.classList.add('visible');
    document.addEventListener('keydown', onKey);
  };

  window.__closeExpand = function() {
    overlay.classList.remove('visible');
    document.querySelectorAll('.expand-panel').forEach(function(p) { p.style.display = 'none'; });
    document.removeEventListener('keydown', onKey);
  };

  window.__expandNav = function(dir) {
    currentIdx = (currentIdx + dir + panels.length) % panels.length;
    showPanel(panels[currentIdx]);
  };

  function showPanel(letter) {
    document.querySelectorAll('.expand-panel').forEach(function(p) {
      p.style.display = p.dataset.expand === letter ? 'block' : 'none';
    });
  }

  function onKey(e) {
    if (e.key === 'Escape') __closeExpand();
    else if (e.key === 'ArrowLeft') __expandNav(-1);
    else if (e.key === 'ArrowRight') __expandNav(1);
  }

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) __closeExpand();
  });
})();
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TITLE} — Compare</title>
${FONTS}
<style>${STYLES}
.compare-grid { grid-template-columns: repeat(${defaultCols}, 1fr); }
@media (max-width: 720px) { .compare-grid { grid-template-columns: 1fr; } }
</style>
${THEME_SCRIPT}
</head>
<body>
<div class="wrap" style="max-width:${defaultCols > 2 ? 1400 : 960}px;">
  <header>
    <h1>${TITLE}</h1>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="status live">${screens.length} screen${screens.length === 1 ? '' : 's'}</span>
      ${themeButton()}
    </div>
  </header>
  <a href="/" class="back-link">← back to index</a>
  <div class="compare-toolbar">
    <div class="label">Comparing ${screens.length} screens</div>
    <div class="layout-controls">
      ${layoutBtns}
    </div>
  </div>
  <div class="compare-grid">
${panels}
  </div>
</div>
<div class="expand-overlay">
  <div class="expand-content">
  ${expandPanels}
  </div>
</div>
${compareScript}
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&"]/g, (c) => c === '&' ? '&amp;' : '&quot;');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;'
  ));
}

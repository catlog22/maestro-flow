// ---------------------------------------------------------------------------
// HTML frame + inline styles for the brainstorm visualizer.
//
// The frame wraps user-supplied content fragments with a consistent dark
// theme. Semantic class names (.options, .cards, .mockup, .split, .pros-cons)
// are meant to be used by the agent when writing screens; the CSS below is
// the canonical styling for them.
//
// Selection is out-of-band: the parent conversation uses AskUserQuestion to
// capture the user's choice after they review these pages in the browser.
// ---------------------------------------------------------------------------

const STYLES = `
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0e1116;
  color: #e6edf3;
  line-height: 1.55;
}
.wrap { max-width: 960px; margin: 0 auto; padding: 40px 28px; }
header {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 16px; border-bottom: 1px solid #30363d; margin-bottom: 28px;
}
header h1 { margin: 0; font-size: 15px; font-weight: 500; color: #7d8590; letter-spacing: 0.02em; }
header .status { font-size: 12px; color: #7d8590; font-variant-numeric: tabular-nums; }
header .status.live::before { content: "● "; color: #3fb950; }
header .status.idle::before { content: "○ "; color: #7d8590; }
h1, h2, h3 { color: #f0f6fc; margin-top: 0; }
h2 { font-size: 22px; margin-bottom: 6px; }
.subtitle { color: #7d8590; font-size: 14px; margin: -2px 0 22px; }
.section { margin: 28px 0; }
.label { font-size: 12px; color: #7d8590; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }

/* ---------------- options (A/B/C) ---------------- */
.options { display: flex; flex-direction: column; gap: 10px; }
.option {
  padding: 14px 18px; border: 1px solid #30363d; border-radius: 8px;
  cursor: pointer; transition: border-color 0.12s, background 0.12s, transform 0.08s;
  background: #161b22;
}
.option:hover { border-color: #58a6ff; background: #1c232d; }
.option.selected { border-color: #3fb950; background: #1a2d23; }
.option.selected::before { content: "✓ "; color: #3fb950; font-weight: 600; }
.option[data-choice]::after {
  content: attr(data-choice); float: right; color: #7d8590;
  font-family: ui-monospace, monospace; font-size: 12px;
}
.option.selected[data-choice]::after { color: #3fb950; }

/* ---------------- cards ---------------- */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.card {
  padding: 18px; border: 1px solid #30363d; border-radius: 10px;
  cursor: pointer; background: #161b22;
  transition: border-color 0.12s, background 0.12s, transform 0.1s;
}
.card:hover { border-color: #58a6ff; background: #1c232d; transform: translateY(-1px); }
.card.selected { border-color: #3fb950; background: #1a2d23; }
.card h3 { margin: 0 0 8px; font-size: 15px; }
.card p { margin: 0; color: #b8c0c8; font-size: 13px; }

/* ---------------- mockup ---------------- */
.mockup {
  border: 1px solid #30363d; border-radius: 10px; overflow: hidden;
  background: #0b0f14; margin: 12px 0;
}
.mockup-header {
  padding: 10px 14px; background: #161b22; border-bottom: 1px solid #30363d;
  font-size: 12px; color: #7d8590; font-family: ui-monospace, monospace;
}
.mockup-body { padding: 18px; min-height: 160px; }

/* ---------------- split comparison ---------------- */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 720px) { .split { grid-template-columns: 1fr; } }

/* ---------------- pros/cons ---------------- */
.pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
.pros, .cons { padding: 14px 18px; border-radius: 8px; border: 1px solid #30363d; }
.pros { background: #0f2117; border-color: #1a3d2a; }
.cons { background: #2a1515; border-color: #4d1f1f; }
.pros h4, .cons h4 { margin: 0 0 8px; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
.pros h4 { color: #3fb950; }
.cons h4 { color: #f85149; }
.pros ul, .cons ul { margin: 0; padding-left: 18px; font-size: 13px; color: #b8c0c8; }

/* ---------------- wireframe primitives ---------------- */
.mock-nav {
  display: flex; gap: 16px; padding: 10px 16px;
  border-bottom: 1px dashed #30363d; color: #7d8590; font-size: 13px;
}
.mock-sidebar {
  width: 180px; padding: 16px; border-right: 1px dashed #30363d;
  color: #7d8590; font-size: 13px; display: inline-block; vertical-align: top;
}
.mock-content { padding: 16px; display: inline-block; color: #b8c0c8; font-size: 13px; vertical-align: top; }
.mock-button {
  display: inline-block; padding: 6px 14px; border-radius: 6px;
  background: #238636; color: #fff; font-size: 13px; font-weight: 500;
  border: 1px solid #2ea043;
}
.mock-input {
  display: inline-block; padding: 6px 10px; border-radius: 6px;
  background: #0d1117; border: 1px solid #30363d; color: #7d8590;
  font-size: 13px; min-width: 180px;
}
.placeholder {
  background: repeating-linear-gradient(45deg, #161b22 0, #161b22 8px, #1c232d 8px, #1c232d 16px);
  border-radius: 6px; min-height: 60px; display: block;
}

/* ---------------- index ---------------- */
.screen-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.screen-list li { margin: 0; }
.screen-list a {
  display: block; padding: 12px 18px; border: 1px solid #30363d; border-radius: 8px;
  background: #161b22; color: #e6edf3; text-decoration: none;
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 14px;
  transition: border-color 0.12s, background 0.12s;
}
.screen-list a:hover { border-color: #58a6ff; background: #1c232d; }
.back-link {
  display: inline-block; margin-bottom: 18px; color: #7d8590;
  text-decoration: none; font-size: 13px;
}
.back-link:hover { color: #58a6ff; }

/* ---------------- typography helpers ---------------- */
.empty {
  padding: 60px 20px; text-align: center; color: #6e7681;
  border: 1px dashed #30363d; border-radius: 10px;
}
code, .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; }
`.trim();

const TITLE = 'Maestro Brainstorm Visualizer';

export function emptyPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <span class="status idle">waiting</span>
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <span class="status live">${screens.length} screen${screens.length === 1 ? '' : 's'}</span>
  </header>
  <div class="label">Screens</div>
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
<title>${TITLE} — ${escapeHtml(screenName)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${TITLE}</h1>
    <span class="status live">${escapeHtml(screenName)}</span>
  </header>
  <a href="/" class="back-link">← back to index</a>
  ${body}
</div>
</body>
</html>`;
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

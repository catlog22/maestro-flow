#!/usr/bin/env node
/**
 * render-prototype.js
 *
 * Reads one or more MASTER.md files and renders HTML prototypes by injecting
 * extracted design tokens into prototype-template.html.
 *
 * Zero external dependencies — uses only Node.js built-ins.
 *
 * Usage:
 *   node render-prototype.js <master1.md> [master2.md ...] --output <dir> [--project <name>]
 *   node render-prototype.js --dir <folder-with-masters> --output <dir> [--project <name>]
 *
 * Output:
 *   <dir>/prototype_1.html, prototype_2.html, ...
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { files: [], output: "", project: "Project", dir: "" };
  let i = 2; // skip node + script
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--output" || a === "-o") { args.output = argv[++i]; }
    else if (a === "--project" || a === "-p") { args.project = argv[++i]; }
    else if (a === "--dir" || a === "-d") { args.dir = argv[++i]; }
    else if (!a.startsWith("-")) { args.files.push(a); }
    i++;
  }
  // Expand --dir to individual files
  if (args.dir && fs.existsSync(args.dir)) {
    const entries = fs.readdirSync(args.dir)
      .filter(f => f.endsWith(".md") && f.toUpperCase().includes("MASTER"))
      .map(f => path.join(args.dir, f));
    args.files.push(...entries);
  }
  return args;
}

// ---------------------------------------------------------------------------
// MASTER.md parser — extracts design tokens
// ---------------------------------------------------------------------------
function parseMaster(content) {
  const tokens = {
    projectName: "",
    styleName: "",
    colors: {},
    fontHeading: "Inter",
    fontBody: "Inter",
    googleFontsUrl: "",
    googleFontsLink: "",
  };

  // Project name
  const projMatch = content.match(/\*\*Project:\*\*\s*(.+)/);
  if (projMatch) tokens.projectName = projMatch[1].trim();

  // Style name
  const styleMatch = content.match(/\*\*Style:\*\*\s*(.+)/);
  if (styleMatch) tokens.styleName = styleMatch[1].trim();

  // Color palette table: | Role | `#hex` | `--css-var` |
  const colorPattern = /\|\s*([^|]+?)\s*\|\s*`(#[0-9A-Fa-f]{3,8})`\s*\|\s*`(--[^`]+)`\s*\|/g;
  let m;
  while ((m = colorPattern.exec(content)) !== null) {
    const cssVar = m[3].trim();
    const hex = m[2].trim();
    // Map --color-primary → primary
    const key = cssVar.replace(/^--color-/, "");
    tokens.colors[key] = hex;
  }

  // Typography
  const headingMatch = content.match(/\*\*Heading Font:\*\*\s*(.+)/);
  if (headingMatch) tokens.fontHeading = headingMatch[1].trim();

  const bodyMatch = content.match(/\*\*Body Font:\*\*\s*(.+)/);
  if (bodyMatch) tokens.fontBody = bodyMatch[1].trim();

  // Google Fonts URL
  const gfMatch = content.match(/\*\*Google Fonts:\*\*\s*\[.*?\]\((https:\/\/fonts\.googleapis\.com\/[^)]+)\)/);
  if (gfMatch) {
    tokens.googleFontsUrl = gfMatch[1];
    tokens.googleFontsLink = `<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="${gfMatch[1]}" rel="stylesheet">`;
  } else {
    // Fallback: build Google Fonts link from font names
    const families = [tokens.fontHeading, tokens.fontBody]
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .map(f => `family=${f.replace(/\s+/g, "+")}:wght@400;500;600;700`)
      .join("&");
    const url = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    tokens.googleFontsLink = `<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="${url}" rel="stylesheet">`;
  }

  // CSS import block (alternative font loading)
  const cssImportMatch = content.match(/\*\*CSS Import:\*\*[\s\S]*?```css\n([\s\S]*?)```/);
  if (cssImportMatch && !gfMatch) {
    // Extract URL from @import
    const importUrl = cssImportMatch[1].match(/url\(['"]?(https:\/\/[^'")\s]+)['"]?\)/);
    if (importUrl) {
      tokens.googleFontsLink = `<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="${importUrl[1]}" rel="stylesheet">`;
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------
function render(template, tokens, projectOverride) {
  const project = projectOverride || tokens.projectName || "Project";
  const colors = tokens.colors;

  let html = template
    .replace(/\{\{PROJECT_NAME\}\}/g, project)
    .replace(/\{\{STYLE_NAME\}\}/g, tokens.styleName || "Default")
    .replace(/\{\{GOOGLE_FONTS_LINK\}\}/g, tokens.googleFontsLink || "")
    .replace(/\{\{FONT_HEADING\}\}/g, tokens.fontHeading)
    .replace(/\{\{FONT_BODY\}\}/g, tokens.fontBody)
    .replace(/\{\{COLOR_PRIMARY\}\}/g, colors.primary || "#2563EB")
    .replace(/\{\{COLOR_ON_PRIMARY\}\}/g, colors["on-primary"] || "#FFFFFF")
    .replace(/\{\{COLOR_SECONDARY\}\}/g, colors.secondary || "#7C3AED")
    .replace(/\{\{COLOR_ACCENT\}\}/g, colors["accent"] || colors["accent/cta"] || "#F97316")
    .replace(/\{\{COLOR_BACKGROUND\}\}/g, colors.background || "#FFFFFF")
    .replace(/\{\{COLOR_FOREGROUND\}\}/g, colors.foreground || "#1E293B")
    .replace(/\{\{COLOR_MUTED\}\}/g, colors.muted || "#94A3B8")
    .replace(/\{\{COLOR_BORDER\}\}/g, colors.border || "#E2E8F0")
    .replace(/\{\{COLOR_DESTRUCTIVE\}\}/g, colors.destructive || "#EF4444")
    .replace(/\{\{COLOR_RING\}\}/g, colors.ring || "#3B82F6");

  return html;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);

  if (args.files.length === 0) {
    console.error("Usage: node render-prototype.js <master1.md> [master2.md ...] --output <dir> [--project <name>]");
    console.error("       node render-prototype.js --dir <folder> --output <dir> [--project <name>]");
    process.exit(1);
  }

  if (!args.output) {
    console.error("Error: --output <dir> is required");
    process.exit(1);
  }

  // Load template
  const templatePath = path.join(__dirname, "prototype-template.html");
  if (!fs.existsSync(templatePath)) {
    console.error(`Error: Template not found at ${templatePath}`);
    process.exit(1);
  }
  const template = fs.readFileSync(templatePath, "utf-8");

  // Ensure output directory
  fs.mkdirSync(args.output, { recursive: true });

  const results = [];

  for (let i = 0; i < args.files.length; i++) {
    const file = args.files[i];
    if (!fs.existsSync(file)) {
      console.error(`Warning: ${file} not found, skipping`);
      continue;
    }

    const content = fs.readFileSync(file, "utf-8");
    const tokens = parseMaster(content);
    const html = render(template, tokens, args.project);

    const label = String.fromCharCode(65 + i); // A, B, C, ...
    const outName = `prototype_${label}.html`;
    const outPath = path.join(args.output, outName);
    fs.writeFileSync(outPath, html, "utf-8");

    results.push({
      file: outName,
      style: tokens.styleName,
      fonts: `${tokens.fontHeading} + ${tokens.fontBody}`,
      colors: Object.keys(tokens.colors).length,
    });

    console.log(`  [${label}] ${outName} — ${tokens.styleName} (${tokens.fontHeading}/${tokens.fontBody}, ${Object.keys(tokens.colors).length} colors)`);
  }

  // Write manifest for downstream tools
  const manifestPath = path.join(args.output, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    generated: new Date().toISOString(),
    project: args.project,
    prototypes: results,
  }, null, 2), "utf-8");

  console.log(`\n  ${results.length} prototype(s) written to ${args.output}/`);
  console.log(`  manifest: ${manifestPath}`);
}

main();

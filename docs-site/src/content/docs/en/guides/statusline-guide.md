---
title: "Maestro Statusline Guide"
---

Maestro Statusline is a custom status bar for Claude Code, providing multi-line real-time information display: model, token usage, Git status, context consumption, as well as workflow milestones and session dependency chains.

## Table of Contents

- [Quick Start](#quick-start)
- [Multi-Line Layout](#multi-line-layout)
- [Line 1 — Status Bar](#line-1--status-bar)
- [Line 2+ — Workflow Timeline](#line-2--workflow-timeline)
- [Icon System](#icon-system)
- [Color Themes](#color-themes)
- [Configuration](#configuration)
- [Data Sources](#data-sources)
- [FAQ](#faq)

---

## Quick Start

### Installation

Statusline is configured via Claude Code's `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "maestro-statusline"
  }
}
```

Or install with one command via `maestro install` (includes theme selection).

### How It Works

```
Claude Code → stdin JSON → maestro-statusline → stdout ANSI → Status bar rendering
```

After each interaction, Claude Code passes session data (JSON) via stdin to `maestro-statusline`. The script parses it and outputs ANSI-formatted text, which Claude Code renders as the status bar.

---

## Multi-Line Layout

Statusline supports intelligent multi-line display, automatically determining line count based on workflow state and session chain count:

**No Workflow (single line):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
```

**With Workflow, ≤2 Chains (double line):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2 | auth A→P→E→V ✓ · user-mgmt A→P ●
```

**With Workflow, 3+ Chains (multi-line expanded):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2
  auth A→P→E→R→D→T→V ✓
  user-mgmt A→P→E ●
  settings A ○
```

| Chain Count | Display |
|-------------|---------|
| 0 (no workflow) | Single status line |
| 1–2 | Double line, chains separated by ` · ` |
| 3+ | Expanded to multiple lines, each chain indented |

---

## Line 1 — Status Bar

Segments are displayed left to right (conditionally shown, empty values auto-hidden):

| Segment | Description | Example |
|---------|-------------|---------|
| Model | Current model name | `⚡ Opus 4.6` |
| Coordinator | Chain coordinator progress | `⚙ full-lifecycle verify [3/6]` |
| Task | Current task in progress | `▸ Fixing auth module` |
| Team | Active team members | `👥 alice (P3/001) \| bob +2` |
| Dir + Git | Directory name + Git branch status | `📁 maestro2 ⎇ master △↑1` |
| Tokens + Lines | Token usage + code changes | `↑12k ↓3k Σ15k +342 -87` |
| Context | Context consumption progress bar | `📈 ██████░░░░ 62%` |

### Git Status Markers

| Marker | Meaning |
|--------|---------|
| (none) | Clean workspace |
| `△` | Uncommitted changes (dirty) |
| `⚠` | Merge conflicts exist |
| `↑n` | Ahead of remote by n commits (needs push) |
| `↓n` | Behind remote by n commits (needs pull) |

### Token Usage

| Marker | Meaning |
|--------|---------|
| `↑` | Cumulative input tokens |
| `↓` | Cumulative output tokens |
| `Σ` | Total (input + output) |

Values are auto-formatted: `1234` → `1.2k`, `123456` → `123k`.

### Code Changes

| Marker | Meaning | Color |
|--------|---------|-------|
| `+N` | Lines added | Green |
| `-N` | Lines removed | Red |

Data sourced from `cost.total_lines_added` / `total_lines_removed`. Only displayed when there are changes.

### Context Colors

| Range | Color |
|-------|-------|
| 0–49% | Green (safe) |
| 50–64% | Yellow (notice) |
| 65–79% | Orange (warning) |
| 80%+ | Red (critical) |

> Maestro's context percentage deducts Claude Code's ~16.5% autocompact buffer, showing the consumption ratio of **available context**.

---

## Line 2+ — Workflow Timeline

Only displayed when the project has `.workflow/state.json` containing milestones.

**Structure:** `🏁 MVP 1/2 ◆P2 | auth A→P→E→R→D→T→V ✓ · user-mgmt A→P ●`

| Part | Description |
|------|-------------|
| `🏁 MVP 1/2` | Milestone name + completed/total phase count |
| `◆P2` | Currently active phase |
| Session chains | Artifact dependency chains built from `depends_on` |

### Session Chain Format

Session chains use a **readable slug + type flow** format: `auth A→P→E→R→D→T→V ✓`

- **slug** (`auth`): A human-readable name auto-extracted from the artifact path
- **Type letters** (`A→P→E→V`): Type abbreviations for each artifact, arranged in dependency order
- **Arrows** (`→`): Indicate execution dependency order
- **Status suffix**: Shows the overall chain status at the end

<details>
<summary>Slug Extraction Rules</summary>

Extracts readable names from artifact `path` fields:

| Original Path | Extracted Result |
|---------------|------------------|
| `scratch/analyze-auth-2026-04-20` | `auth` |
| `phases/01-auth-multi-tenant` | `auth-multi-tenant` |
| `scratch/20260421-review-P1-auth` | `auth` |

Sequentially removes: numeric prefixes, `YYYYMMDD-` date prefixes, type name prefixes (analyze/plan/execute etc.), trailing dates, `-P1` phase numbers.

</details>

### 9 Artifact Types

| Type | Abbreviation | Color | Meaning |
|------|--------------|-------|---------|
| analyze | A | Cyan | Analysis & exploration |
| plan | P | Gold | Planning & design |
| execute | E | Green | Implementation |
| verify | V | Blue | Verification |
| brainstorm | B | Purple | Brainstorming |
| spec | S | Yellow | Specification |
| review | R | Orange | Code review |
| debug | D | Red | Debugging |
| test | T | Green | Testing |

### Chain Status Markers

| Marker | Meaning | Color |
|--------|---------|-------|
| `✓` | All artifacts in chain completed | Green |
| `●` | Last artifact in progress | Yellow |
| `✗` | Last artifact failed | Red |
| `○` | Last artifact pending | Gray |

### Chain Building Algorithm

1. Filter artifacts for the current milestone from `state.json.artifacts[]`
2. Find root artifacts (no `depends_on` or `depends_on` not in current set)
3. Build chains from roots by following `depends_on` forward links
4. Chain status depends on whether all artifacts are completed
5. Artifacts not visited by any chain are classified as orphans

---

## Icon System

Statusline supports two icon sets, switchable via configuration:

| Segment | Nerd Font | Unicode (fallback) |
|---------|-----------|---------------------|
| Model | `` (bolt) | `✎` (pencil) |
| Milestone | `` (flag_checkered) | `⚑` (flag) |
| Phase | `◆` (BLACK DIAMOND) | `◆` (diamond) |
| Coordinator | `󰑌` (check_circle) | `⚙` (gear) |
| Task | `` (terminal_cmd) | `▸` (triangle) |
| Team | `󰡉` (account_group) | `👥` (people) |
| Dir | `` (folder) | `■` (square) |
| Git | `` (git_branch) | `⎇` (branch) |
| Context | `` (line_chart) | `◔` (circle) |

Nerd Font icons require the terminal to have a Nerd Font installed and configured (e.g., JetBrainsMono Nerd Font).

- **Windows Terminal**: Settings → Profile → Appearance → Font face → `JetBrainsMono Nerd Font`
- **VS Code**: Settings → `terminal.integrated.fontFamily` → `'JetBrainsMono Nerd Font'`

> Claude Code desktop/web versions do not support custom fonts and automatically use Unicode fallback icons. Default `nerdFont: false`.

---

## Color Themes

5 built-in color themes:

| Theme | Style | Characteristics |
|-------|-------|-----------------|
| `notion` | Default | Soft warm tones, Catppuccin style |
| `cyberpunk` | Tech | Neon high contrast, cyberpunk |
| `pastel` | Soft | Soft pink/blue/green, low saturation |
| `nord` | Nordic cool | Icy blue-gray-green, calm |
| `monokai` | Classic editor | Pink/green/blue/purple, high recognition |

<details>
<summary>Theme Color Comparison</summary>

```
Notion:    Model(cyan)  Milestone(gold)  Phase(green)  Dir(yellow) Context(green→yellow→orange→red)
Cyberpunk: Model(neon cyan) Milestone(neon red) Phase(neon yellow) Dir(electric blue) Context(fluorescent green→yellow→orange→red)
Pastel:    Model(sky blue)  Milestone(peach pink)  Phase(mint green)  Dir(sand) Context(sage→cream→pink-orange→rose)
Nord:      Model(ice blue)  Milestone(aurora orange) Phase(aurora green)  Dir(aurora yellow) Context(green→yellow→orange→red)
Monokai:   Model(blue)   Milestone(pink)   Phase(fluorescent green)  Dir(yellow)   Context(green→yellow→orange→pink)
```

</details>

### Runtime Switching

Modify `~/.maestro/config.json`:

```json
{
  "statusline": {
    "theme": "cyberpunk"
  }
}
```

---

## Configuration

### Maestro Configuration (`~/.maestro/config.json`)

```json
{
  "statusline": {
    "theme": "notion",
    "nerdFont": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `theme` | string | `"notion"` | Color theme |
| `nerdFont` | boolean | `false` | Enable Nerd Font icons |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MAESTRO_STATUSLINE_THEME=nord` | Force specify theme |
| `MAESTRO_NERD_FONT=1` | Force enable Nerd Font |
| `MAESTRO_NERD_FONT=0` | Force disable Nerd Font |

Priority: Environment variables > config.json > defaults.

---

## Data Sources

### Claude Code stdin JSON

| Field | Description |
|-------|-------------|
| `model.display_name` | Current model name |
| `workspace.current_dir` | Current working directory |
| `session_id` | Session ID |
| `context_window.remaining_percentage` | Context remaining percentage |
| `context_window.total_input_tokens` | Cumulative input tokens |
| `context_window.total_output_tokens` | Cumulative output tokens |
| `cost.total_lines_added` | Cumulative lines added |
| `cost.total_lines_removed` | Cumulative lines removed |

### Maestro Internal Data

| Data Source | Path | Purpose |
|-------------|------|---------|
| state.json | `.workflow/state.json` | Milestones, artifact registry |
| Coordinator bridge | `$TMPDIR/maestro-coord-{session}.json` | Coordinator progress |
| Context bridge | `$TMPDIR/maestro-ctx-{session}.json` | Context monitoring bridge |
| Team activity | `.workflow/.maestro/activity.ndjson` | Team member activity |
| Claude todos | `~/.claude/todos/{session}-agent-*.json` | Current tasks |

---

## FAQ

### Icons Display as Squares

Terminal font doesn't support Nerd Font. Fix: install Nerd Font (`winget install DEVCOM.JetBrainsMonoNerdFont`), configure terminal font, set `statusline.nerdFont: true`. Claude Code desktop keeps `nerdFont: false`.

### Second Line Not Displaying

Requires: `.workflow/state.json` exists, has `current_milestone` field, has registered artifacts.

### Context Percentage Differs from Claude Code Built-in

Maestro deducts ~16.5% autocompact buffer, showing **available context** consumption ratio.

### Token Usage Not Displaying

`total_input_tokens` / `total_output_tokens` may be null before first API call.

### Session Chain Displays as Empty

Ensure artifacts contain `id`, `type`, `status`, `path` fields, and `milestone` matches `current_milestone`.

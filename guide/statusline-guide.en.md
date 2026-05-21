---
title: "Maestro Statusline Guide"
---

Maestro Statusline is a custom status bar for Claude Code, providing multi-line real-time information display: model, token usage, Git status, context consumption, as well as workflow milestones and session dependency chains.

## Table of Contents

- [Quick Start](#quick-start)
- [Multi-line Layout](#multi-line-layout)
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

Or install it with one click (including theme selection) via `maestro install`.

### How It Works

```
Claude Code → stdin JSON → maestro-statusline → stdout ANSI → Status Bar Rendering
```

After each interaction, Claude Code passes session data (JSON) via stdin to `maestro-statusline`. The script parses it and outputs ANSI formatted text, which Claude Code renders as a status bar.

---

## Multi-line Layout

Statusline supports smart multi-line display, automatically determining the number of lines based on the workflow status and the number of session chains:

**No workflow (Single line):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
```

**With workflow, ≤2 chains (Double line):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master △↑1 | ↑12k ↓3k Σ15k +342 -87 | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2 | auth A→P→E→V ✓ · user-mgmt A→P ●
```

**With workflow, 3+ chains (Multi-line expanded):**
```
⚡ Opus 4.6 | 📁 maestro2 ⎇ master | ↑12k ↓3k Σ15k | 📈 ███░░░ 28%
🏁 MVP 1/2 ◆P2
  auth A→P→E→R→D→T→V ✓
  user-mgmt A→P→E ●
  settings A ○
```

| Number of Chains | Display Mode |
|--------|----------|
| 0 (No workflow) | Single line status bar |
| 1–2 | Double line, chains separated by ` · ` |
| 3+ | Expanded into multiple lines, each chain indented |

---

## Line 1 — Status Bar

Displays the following segments from left to right (conditionally displayed, automatically hidden if empty):

| Segment | Description | Example |
|---------|------|------|
| Model | Current model name | `⚡ Opus 4.6` |
| Coordinator | Chained coordinator progress | `⚙ full-lifecycle verify [3/6]` |
| Task | Current ongoing task | `▸ Fixing auth module` |
| Team | Active team members | `👥 alice (P3/001) \| bob +2` |
| Dir + Git | Directory name + Git branch status | `📁 maestro2 ⎇ master △↑1` |
| Tokens + Lines | Token usage + Code changes | `↑12k ↓3k Σ15k +342 -87` |
| Context | Context consumption progress bar | `📈 ██████░░░░ 62%` |

### Git Status Indicators

| Marker | Meaning |
|------|------|
| (No marker) | Clean working directory |
| `△` | Uncommitted modifications (dirty) |
| `⚠` | Merge conflict exists |
| `↑n` | Ahead of remote by n commits (push needed) |
| `↓n` | Behind remote by n commits (pull needed) |

### Token Usage

| Marker | Meaning |
|------|------|
| `↑` | Cumulative input tokens |
| `↓` | Cumulative output tokens |
| `Σ` | Total (input + output) |

Values are automatically formatted: `1234` → `1.2k`, `123456` → `123k`.

### Code Changes

| Marker | Meaning | Color |
|------|------|------|
| `+N` | Added lines | Green |
| `-N` | Removed lines | Red |

Data sourced from `cost.total_lines_added` / `total_lines_removed`, displayed only when there are changes.

### Context Colors

| Range | Color |
|------|------|
| 0–49% | Green (Safe) |
| 50–64% | Yellow (Notice) |
| 65–79% | Orange (Warning) |
| 80%+ | Red (Critical) |

> Maestro's context percentage deducts Claude Code's ~16.5% autocompact buffer, displaying the **available context** consumption ratio.

---

## Line 2+ — Workflow Timeline

Displayed only when the project has `.workflow/state.json` and contains a milestone.

**Structure:** `🏁 MVP 1/2 ◆P2 | auth A→P→E→R→D→T→V ✓ · user-mgmt A→P ●`

| Part | Description |
|------|------|
| `🏁 MVP 1/2` | Milestone name + Completed / Total phases |
| `◆P2` | Current active phase |
| Session Chain | Artifact dependency chain built via `depends_on` |

### Session Chain Format

The session chain uses a **Readable slug + Type flow** format: `auth A→P→E→R→D→T→V ✓`

- **slug** (`auth`): Readable name automatically extracted from the artifact path
- **Type letters** (`A→P→E→V`): Type abbreviation of each artifact, ordered by dependencies
- **Arrows** (`→`): Execution dependency order
- **Status suffix**: Chain status displayed at the end of the chain

<details>
<summary>Slug Extraction Rules</summary>

Extract readable names from the artifact's `path` field:

| Original Path | Extracted Result |
|---------|----------|
| `scratch/analyze-auth-2026-04-20` | `auth` |
| `phases/01-auth-multi-tenant` | `auth-multi-tenant` |
| `scratch/20260421-review-P1-auth` | `auth` |

Sequentially removes: Numeric prefixes, `YYYYMMDD-` date prefixes, type name prefixes (analyze/plan/execute, etc.), trailing dates, `-P1` phase numbers.

</details>

### 9 Artifact Types

| Type | Abbreviation | Color | Meaning |
|------|------|------|------|
| analyze | A | Cyan | Analyze & Explore |
| plan | P | Gold | Plan & Design |
| execute | E | Green | Execute & Implement |
| verify | V | Blue | Verify & Confirm |
| brainstorm | B | Purple | Brainstorm |
| spec | S | Yellow | Specification Definition |
| review | R | Orange | Code Review |
| debug | D | Red | Debug & Diagnose |
| test | T | Green | Test & Validate |

### Chain Tail Status Indicators

| Marker | Meaning | Color |
|------|------|------|
| `✓` | All artifacts completed | Green |
| `●` | Last one in progress | Yellow |
| `✗` | Last one failed | Red |
| `○` | Last one pending execution | Gray |

### Chain Build Algorithm

1. Filter artifacts of the current milestone from `state.json.artifacts[]`
2. Find root artifacts (no `depends_on` or `depends_on` not in the current set)
3. Starting from the roots, follow `depends_on` to forward link and build chains
4. The status of each chain depends on whether all artifacts are completed
5. Artifacts not visited by any chain are classified as orphan

---

## Icon System

Statusline supports two icon sets, switchable via configuration:

| Segment | Nerd Font | Unicode (Fallback) |
|---------|-----------|-----------------|
| Model | `` (bolt) | `✎` (pencil) |
| Milestone | `` (flag_checkered) | `⚑` (flag) |
| Phase | `◆` (BLACK DIAMOND) | `◆` (diamond) |
| Coordinator | `󰑌` (check_circle) | `⚙` (gear) |
| Task | `` (terminal_cmd) | `▸` (triangle) |
| Team | `󰡉` (account_group) | `👥` (people) |
| Dir | `` (folder) | `■` (square) |
| Git | `` (git_branch) | `⎇` (branch) |
| Context | `` (line_chart) | `◔` (circle) |

Nerd Font icons require a Nerd Font (like JetBrainsMono Nerd Font) installed in the terminal and configured.

- **Windows Terminal**: Settings → Profile → Appearance → Font face → `JetBrainsMono Nerd Font`
- **VS Code**: Settings → `terminal.integrated.fontFamily` → `'JetBrainsMono Nerd Font'`

> Claude Code Desktop/Web versions do not support custom fonts and automatically use Unicode fallback icons. Defaults to `nerdFont: false`.

---

## Color Themes

5 built-in color themes:

| Theme | Style | Features |
|------|------|------|
| `notion` | Default | Soft warm colors, Catppuccin style |
| `cyberpunk` | Tech | Neon high contrast, Cyberpunk style |
| `pastel` | Fresh | Soft pinks, blues and greens, low saturation |
| `nord` | Nordic | Ice blue and gray-green, calm and restrained |
| `monokai` | Classic Editor | Pink, green, blue and purple, high recognition |

<details>
<summary>Theme Color Comparison</summary>

```
Notion:    Model(Cyan)  Milestone(Gold)  Phase(Green)  Dir(Yellow)  Context(Green→Yellow→Orange→Red)
Cyberpunk: Model(Neon Cyan) Milestone(Neon Red) Phase(Neon Yellow) Dir(Electric Blue) Context(Fluorescent Green→Yellow→Orange→Red)
Pastel:    Model(Sky Blue)  Milestone(Peach)  Phase(Mint Green)  Dir(Sand) Context(Sage→Cream→Pink Orange→Rose)
Nord:      Model(Ice Blue)  Milestone(Aurora Orange) Phase(Aurora Green)  Dir(Aurora Yellow) Context(Green→Yellow→Orange→Red)
Monokai:   Model(Blue)   Milestone(Pink)   Phase(Fluorescent Green)  Dir(Yellow)   Context(Green→Yellow→Orange→Pink)
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
|------|------|--------|------|
| `theme` | string | `"notion"` | Color theme |
| `nerdFont` | boolean | `false` | Enable Nerd Font icons |

### Environment Variables

| Variable | Description |
|------|------|
| `MAESTRO_STATUSLINE_THEME=nord` | Force specified theme |
| `MAESTRO_NERD_FONT=1` | Force enable Nerd Font |
| `MAESTRO_NERD_FONT=0` | Force disable Nerd Font |

Priority: Environment Variables > config.json > Default values.

---

## Data Sources

### Claude Code stdin JSON

| Field | Description |
|------|------|
| `model.display_name` | Current model name |
| `workspace.current_dir` | Current working directory |
| `session_id` | Session ID |
| `context_window.remaining_percentage` | Remaining context percentage |
| `context_window.total_input_tokens` | Cumulative input tokens |
| `context_window.total_output_tokens` | Cumulative output tokens |
| `cost.total_lines_added` | Cumulative lines added |
| `cost.total_lines_removed` | Cumulative lines removed |

### Maestro Internal Data

| Data Source | Path | Purpose |
|--------|------|------|
| state.json | `.workflow/state.json` | Milestone and artifact registry |
| Coordinator bridge | `$TMPDIR/maestro-coord-{session}.json` | Coordinator progress |
| Context bridge | `$TMPDIR/maestro-ctx-{session}.json` | Context monitoring bridge |
| Team activity | `.workflow/.maestro/activity.ndjson` | Team member activity |
| Claude todos | `~/.claude/todos/{session}-agent-*.json` | Current tasks |

---

## FAQ

### Icons display as squares

Your terminal font does not support Nerd Fonts. Solution: Install a Nerd Font (`winget install DEVCOM.JetBrainsMonoNerdFont`), configure your terminal font, and set `statusline.nerdFont: true`. For the Claude Code desktop version, keep `nerdFont: false`.

### The second line is not showing

Ensure the following conditions are met: the project has a `.workflow/state.json`, has a `current_milestone` field, and has registered artifacts.

### Context percentage differs from Claude Code's built-in display

Maestro deducts ~16.5% autocompact buffer, displaying the **available context** consumption ratio, which will appear slightly higher than Claude Code's built-in display.

### Token usage is not displayed

`total_input_tokens` / `total_output_tokens` may be null before the first API call.

### Session chain is empty

Ensure artifacts include `id`, `type`, `status`, and `path` fields, and `milestone` matches the `current_milestone`.
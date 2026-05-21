---
title: "Spec Analytics System Guide"
---

The Spec Analytics System records every spec injection call, keyword match, hook execution, and CLI endpoint usage, providing hit rate statistics and keyword heatmaps.

---

## Overview

The Spec injection system automatically injects project specifications during agent creation and prompt translation. The analytics system answers:
- Which specs were hit? Which ones were never used?
- What is the accuracy of keyword matching?
- Does context budget frequently trigger degradation?
- Which agent type has the lowest injection success rate?

### Architecture

```
Collection Layer (Synchronous, no exceptions thrown)
  spec-injector ──────────┐
  keyword-spec-injector ──┤
  spec-injection-plugin ──┴──> .workflow/spec-analytics.jsonl
  SpecAnalyticsPlugin ────     (JSONL append-only, 5MB rotation)
  Sub-process Hook Tracking ───────┐
  CLI Endpoint Tracking ───────────┴─
                                     │
Consumption Layer                    ▼
  CLI summary  ·  TUI Panel (5 views)  ·  computeStats
```

---

## Log Data Model

The log file `.workflow/spec-analytics.jsonl` contains three types of entries.

### Injection Events (`type: "injection"`)

<details>
<summary>Complete Fields Example</summary>

```json
{
  "type": "injection",
  "id": "SINJ-1715788800000-1",
  "timestamp": "2026-05-15T12:00:00.000Z",
  "source": "spec-injector",
  "agentType": "code-developer",
  "promptSnippet": "Implement the user authentication...",
  "categories": ["coding", "learning", "ui"],
  "specCount": 12,
  "budgetAction": "full",
  "contentLength": 4520,
  "inject": true,
  "reason": null,
  "matchedKeywords": ["auth", "jwt"],
  "matchedEntryIds": ["entry-001", "entry-002"],
  "inferredCategory": "coding"
}
```

</details>

| Key Field | Purpose |
|---------|------|
| `source` | Distinguishes the call source (spec-injector / keyword-spec-injector / plugin) |
| `agentType` | Analyzes which agents triggered the injection |
| `inject` | Calculates the hit rate |
| `reason` | Diagnoses the root cause of injection failure |
| `matchedKeywords` | Analyzes the effectiveness of keyword matching |

**Failure Reasons:**

| reason | Meaning | Improvement Direction |
|--------|------|---------|
| `no-categories` | The agent type has no category mapping | Add the mapping to `AGENT_CATEGORY_MAP` |
| `no-content` | All category specs are empty | Check spec file contents |
| `budget-skip` | Insufficient context budget | Reduce `maxContentLength` |
| `no-keyword-match` | Keywords were not hit | Expand entry `keywords` |
| `all-deduped` | Already injected in this session | Normal phenomenon |

### CLI Events (`type: "cli"`) and Hook Events (`type: "hook"`)

<details>
<summary>CLI Event Example</summary>

```json
{
  "type": "cli",
  "id": "CLI-1715788800000-2",
  "timestamp": "2026-05-15T12:00:01.000Z",
  "command": "spec load",
  "args": { "category": "coding", "scope": "project" }
}
```

Tracked commands: `spec load` · `spec list` · `spec init` · `spec add` · `spec analytics` etc.

</details>

<details>
<summary>Hook Event Example</summary>

```json
{
  "type": "hook",
  "id": "HOOK-1715788800000-3",
  "timestamp": "2026-05-15T12:00:02.000Z",
  "hookName": "spec-injector",
  "pluginName": "subprocess",
  "outcome": "success",
  "durationMs": 45,
  "data": { "event": "PreToolUse", "matcher": "Agent", "level": "minimal" }
}
```

**Tracked Sub-process Hooks (11 total):**

| Hook | Event | Level |
|------|------|------|
| `spec-injector` | PreToolUse [Agent] | minimal |
| `keyword-spec-injector` | UserPromptSubmit | standard |
| `skill-context` | UserPromptSubmit | standard |
| `session-context` | Notification | standard |
| `delegate-monitor` | PostToolUse [Bash\|Agent] | standard |
| `workflow-guard` | PreToolUse [Bash\|Write\|Edit] | full |

**Tracked Coordinator Hooks (9 total):** `beforeRun` · `afterRun` · `beforeNode` · `afterNode` · `beforeCommand` · `afterCommand` · `onError` · `transformPrompt` · `onDecision`

</details>

---

## Collection Points

| # | Collection Point | File | Recorded Content |
|---|--------|------|---------|
| 1 | spec-injector | `src/hooks/spec-injector.ts` | 4 return paths: inject true/false + reason |
| 2 | keyword-spec-injector | `src/hooks/keyword-spec-injector.ts` | 5 return paths + matchedKeywords + dedup |
| 3 | spec-injection-plugin | `src/hooks/plugins/spec-injection-plugin.ts` | inferredCategory + promptSnippet |
| 4 | SpecAnalyticsPlugin | `src/hooks/plugins/spec-analytics-plugin.ts` | All 9 coordinator hooks |
| 5 | Sub-process Hook Tracking | `src/commands/hooks.ts` | hookName + outcome + durationMs |
| 6 | CLI Endpoint Tracking | `src/commands/spec.ts` | command + args |

---

## CLI Usage

```bash
# Statistics summary
maestro spec analytics

# Recent 30 events
maestro spec analytics --recent 30

# JSON format
maestro spec analytics --json
maestro spec analytics --recent 50 --json

# Archive logs
maestro spec analytics --clear

# TUI panel
maestro spec analytics --tui
```

### Hook Dedicated Analytics

```bash
# Hook statistics summary
maestro hooks analytics

# Recent 30 hook events
maestro hooks analytics --recent 30

# View specific hook only
maestro hooks analytics --hook spec-injector

# JSON format
maestro hooks analytics --json
```

---

## TUI Panel

Access via `maestro config` → **Analytics** tab or `maestro spec analytics --tui`.

| Key | Mode | Content |
|------|------|------|
| `s` | Summary | Overview: Hit rate, source/category/budget distribution, hook statistics |
| `r` | Recent | List of recent 100 events, `Enter` to expand details |
| `k` | Keywords | Keyword hit leaderboard (bar chart), dedup statistics |
| `a` | Agents | Agent type dimension: Injection success rate per agent |
| `h` | Hooks | Hook call frequency (bar chart), plugin distribution, average duration |

---

## Configuration

```json
{
  "specInjection": {
    "analytics": {
      "enabled": true,
      "logPath": ".workflow/spec-analytics.jsonl",
      "maxFileSize": 5242880,
      "retentionWeeks": 4
    }
  }
}
```

| Field | Default Value | Description |
|------|--------|------|
| `enabled` | `true` | Enable analytics (set to false for zero overhead) |
| `maxFileSize` | 5MB | Automatically archive to `.workflow/archive/` when exceeded |
| `retentionWeeks` | 4 | Number of weeks to keep archives |

---

## Use Cases

**Analyze keyword matching effectiveness:**
```bash
maestro spec analytics --json | jq '.keywordStats'
# avgMatchedPerPrompt < 1.0 → Expand spec entry keywords
```

**Diagnose injection failures:**
```bash
maestro spec analytics --recent 50 | grep "❌"
# Search by reason: no-categories / no-keyword-match / budget-skip
```

**Track CLI usage habits:**
```bash
maestro spec analytics --json | jq '.cliStats'
```

**Monitor hook system health:**
```bash
maestro hooks analytics --hook spec-injector --json | jq '.byHook["spec-injector"].avgDurationMs'
# View hooks with high error rates
maestro hooks analytics --json | jq '[.byHook | to_entries[] | select(.value.errorRate > 0)]'
```
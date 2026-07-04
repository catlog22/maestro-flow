---
title: "MOA — Mixture of Agents Guide"
---

Mixture of Agents (MOA) — multiple reference models search the same query in parallel, then an aggregator synthesizes their results into a final answer.

---

## Quick Start

```bash
# Use default preset
maestro moa "FIND: auth middleware\nSCOPE: src/"

# Named preset
maestro moa "query" --preset thorough

# Multiple prompts (each runs through MOA)
maestro moa "Find DB patterns" "Check error handling"
```

---

## How It Works

```
prompt ──→ reference 1 (agentLoop + tools) ──┐
       ──→ reference 2 (agentLoop + tools) ──┤ parallel
       ──→ reference 3 (agentLoop + tools) ──┘
                     │
                     ▼
           Aggregate all reference outputs
           Append to aggregator prompt tail
                     │
                     ▼
           aggregator (agentLoop + tools) → final result
```

1. **Reference phase**: Each reference endpoint runs a full agentLoop (with Search/Read tools), independently searching code and generating analysis
2. **Aggregation phase**: All reference outputs are appended to the original prompt tail and passed to the aggregator
3. **Aggregator phase**: The aggregator synthesizes reference analyses, runs its own searches to verify, and produces the final answer

The system prompt is identical across reference and aggregator calls, keeping the provider-side cache prefix stable.

---

## Configuration

Edit `~/.maestro/moa.json` to configure MOA presets (endpoints are defined in `~/.maestro/api.json`):

```json
{
  "endpoints": {
    "qwen": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "sk-xxx",
      "model": "Qwen/Qwen3-8B"
    },
    "gpt-codex": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-yyy",
      "model": "gpt-5.3-codex-spark",
      "extraBody": { "max_completion_tokens": 4000 }
    },
    "sonnet": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxx",
      "model": "claude-sonnet-4-6",
      "format": "anthropic"
    }
  },
  "moa": {
    "defaultPreset": "default",
    "presets": {
      "default": {
        "referenceEndpoints": ["qwen"],
        "aggregatorEndpoint": "gpt-codex"
      },
      "thorough": {
        "referenceEndpoints": ["qwen", "sonnet"],
        "aggregatorEndpoint": "gpt-codex"
      }
    }
  }
}
```

### Preset Fields

| Field | Description | Required |
|-------|-------------|----------|
| `referenceEndpoints` | Reference endpoint names (max 4) | ✅ |
| `aggregatorEndpoint` | Aggregator endpoint name | ✅ |
| `mode` | Orchestration mode: `"initial-only"` (default) | ❌ |
| `enabled` | Whether this preset is active | ❌ |

Model parameters (temperature, max_tokens, etc.) are controlled by each endpoint's `extraBody` — the preset only describes the orchestration flow.

### Design Principles

- **Presets manage flow**: which endpoints are references, which is the aggregator, what mode
- **Endpoints manage model params**: temperature, token limits, special parameters go in endpoint `extraBody`
- **Configure once, apply everywhere**: changing an endpoint's params automatically applies to both explore and moa

---

## Command Usage

```bash
# Basic usage
maestro moa "your search query"

# Named preset
maestro moa "query" --preset thorough

# Limit search turns
maestro moa "query" --max-turns 3

# Specify working directory
maestro moa "query" --cd /path/to/project

# JSON output
maestro moa "query" --json

# Don't save session
maestro moa "query" --no-save
```

### Session Management

```bash
# List recent sessions
maestro moa show

# Show session results
maestro moa output <session-id>
```

---

## Relationship with explore

| Feature | `maestro explore` | `maestro moa` |
|---------|-------------------|---------------|
| Agents | 1 agent / prompt | N reference + 1 aggregator |
| Multi-endpoint | `--all` fan-out (independent) | preset collaboration (reference → aggregator) |
| Tool access | ✅ full | ✅ both reference and aggregator |
| Cost | 1x | (N+1)x |
| Best for | Quick lookups | Complex analysis, cross-verification |

Both share endpoint config (`~/.maestro/api.json`) and session storage (`.workflow/explore/`). MOA presets are configured separately in `~/.maestro/moa.json`.

---

## Degradation Behavior

- **Some references fail**: Failure info injected into aggregator context; flow continues
- **All references fail**: Aggregator runs solo as a single agent (marked `degraded`)
- **Aggregator endpoint missing**: Command exits with error

---

## Best Practices

1. **Cheap references, strong aggregator** — best cost-quality ratio
2. **2-3 references is enough** — diminishing returns beyond that, linear cost increase
3. **Use different models as references** — same-model references produce redundant outputs
4. **Structured prompts work better** — FIND/SCOPE/EXPECTED help each reference search precisely

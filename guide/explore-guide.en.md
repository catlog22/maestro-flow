---
title: "Explore Lightweight Search Guide"
---

API-endpoint-driven lightweight code exploration command with multi-prompt parallel execution, multi-endpoint routing, and structured search.

---

## Quick Start

```bash
# Single prompt search
maestro explore "What test framework is used?"

# Multi-prompt parallel
maestro explore "Find DB query patterns" "Check error handling" "Map API routes"

# Structured prompt
maestro explore "FIND: N+1 query patterns
SCOPE: src/db/
EXCLUDE: test files
EXPECTED: file:line evidence list"
```

---

## Endpoint Configuration

API endpoint config: `~/.maestro/api.json`
MOA preset config: `~/.maestro/moa.json`

> **Deprecation**: `~/.maestro/api-explore.json` is still read as a fallback for one version cycle. Migrate to `api.json` + `moa.json`.

### Multi-Endpoint (Recommended)

```json
{
  "endpoints": {
    "qwen": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "apiKey": "sk-xxx",
      "model": "Qwen/Qwen3-8B",
      "maxTurns": 3
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-yyy",
      "model": "deepseek-chat",
      "maxTurns": 4
    },
    "sonnet": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxx",
      "model": "claude-sonnet-4-6",
      "format": "anthropic",
      "maxTurns": 4
    },
    "local": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "model": "qwen2.5-coder:7b",
      "maxTurns": 3,
      "extraBody": { "temperature": 0.2 }
    }
  },
  "defaults": {
    "maxTurns": 3,
    "concurrency": 4
  }
}
```

### Endpoint Fields

| Field | Description | Required |
|-------|-------------|----------|
| `baseUrl` | API URL | Yes |
| `apiKey` | API key (can differ per endpoint) | Yes |
| `model` | Model name | Yes |
| `format` | API format: `"openai"` (default) or `"anthropic"` | No |
| `maxTurns` | Max search rounds for this endpoint (overrides global) | No |
| `extraBody` | Model-specific params (e.g. `enable_thinking`, `temperature`) | No |
| `concurrency` | Max concurrent jobs on this endpoint (default: 1 = serial) | No |

### API Format

Each endpoint can specify a `format` field:

| Value | Description | Use With |
|-------|-------------|----------|
| `"openai"` | OpenAI Chat Completions format (default) | vLLM, Ollama, SiliconFlow, DeepSeek, OpenRouter, etc. |
| `"anthropic"` | Anthropic Messages API format | Anthropic API (Claude models) |

The `"anthropic"` format handles: `x-api-key` auth header, `tool_use`/`tool_result` message format conversion, and usage field mapping.

Legacy single-endpoint configs also support the top-level `"format"` field. The CLI entry supports `--format` to override.

### Global Defaults

Configure in the `defaults` field of `api.json`:

| Field | Description | Default |
|-------|-------------|---------|
| `maxTurns` | Global max search rounds | `6` |
| `concurrency` | Max parallel endpoint queues | `4` |

### Proxy

Unified proxy config in `api.json` (`cli-tools.json` proxy serves as fallback):

```json
{
  "proxy": {
    "enabled": true,
    "httpProxy": "http://127.0.0.1:7890",
    "noProxy": "127.0.0.1,localhost"
  }
}
```

Priority: `api.json` proxy > `cli-tools.json` proxy.

### MOA Presets

MOA (Mixture-of-Agents) presets are configured separately in `~/.maestro/moa.json`:

```json
{
  "defaultPreset": "default",
  "presets": {
    "default": {
      "referenceEndpoints": ["gpt-mini"],
      "aggregatorEndpoint": "gpt-codex"
    }
  }
}
```

Endpoint names reference named endpoints from `api.json`.

### Legacy Single-Endpoint

```json
{
  "baseUrl": "https://api.siliconflow.cn/v1",
  "apiKey": "sk-xxx",
  "model": "Qwen/Qwen3-8B",
  "maxTurns": 3
}
```

Also supports env vars: `API_EXPLORE_BASE_URL`, `API_EXPLORE_API_KEY`, `API_EXPLORE_MODEL`.

---

## Command Reference

```bash
maestro explore "<PROMPT>" [more prompts...] [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --endpoint <names>` | Endpoint name(s), comma-separated | First available |
| `--all` | Fan out each prompt to all endpoints | — |
| `--parallel <n>` | Max concurrent endpoint queues | Config or `4` |
| `--ep-concurrency <n>` | Max concurrent jobs per endpoint | `1` (serial) |
| `--max-turns <n>` | Max search rounds (overrides config) | Config or `6` |
| `-f, --file <path>` | Load prompts from JSON/text file | — |
| `--cd <dir>` | Working directory | Current |
| `-o, --output-dir <dir>` | Custom session save directory | `.workflow/explore/` |
| `--no-save` | Skip session save | — |
| `--json` | JSON output | — |

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `maestro explore show` | List explore sessions in current workspace |
| `maestro explore output <id>` | View session results |
| `maestro explore output <id> --json` | View in JSON format |

---

## Prompt Format

### Structured Format

```
FIND: [what to search for — core query]
SCOPE: [where to look — file patterns or directories]
EXCLUDE: [what to skip — files, patterns, false positives]
ATTENTION: [what to watch for — edge cases, caveats]
EXPECTED: [output format — evidence list, summary, JSON]
```

Only `FIND` is required. Plain text (without `FIND:` prefix) is also accepted.

### Field Reference

| Field | Purpose | Example |
|-------|---------|---------|
| `FIND` | Search target | `All DB query patterns that could cause N+1` |
| `SCOPE` | Search scope | `src/db/**/*.ts`, `src/api/` |
| `EXCLUDE` | Skip items | `test files, generated code, node_modules` |
| `ATTENTION` | Watch for | `ORM lazy-loading traps, raw SQL in service layer` |
| `EXPECTED` | Output format | `file:line evidence list with severity` |

---

## Multi-Prompt Input

### Inline

```bash
maestro explore "Analyze DB queries" "Review error handling" "Map API routes"
```

### JSON File

```bash
maestro explore -f prompts.json
```

**Simple**: `["prompt1", "prompt2", "prompt3"]`

**Rich** (per-prompt endpoint binding):

```json
[
  { "prompt": "FIND: auth bypass\nSCOPE: src/api/", "endpoint": "deepseek" },
  { "prompt": "FIND: perf bottlenecks\nSCOPE: src/db/", "endpoint": "qwen" },
  { "prompt": "Check config consistency" }
]
```

### Text File

Paragraphs separated by blank lines, each becomes one prompt.

### Mixed

```bash
maestro explore "inline prompt" -f more-prompts.json
```

---

## Execution Model

**Serial within endpoint, parallel across endpoints.**

```
Endpoint A:  [job1] → [job2] → [job3]    ← serial (avoids rate limits)
Endpoint B:  [job4] → [job5]              ← serial
              ↑ parallel ↑
```

- Same API jobs queue and run one-by-one to avoid rate limits
- Different API queues run concurrently
- `--ep-concurrency 2` raises per-endpoint parallelism when the API allows it

---

## Session Management

Results auto-save to `.workflow/explore/{session-id}.json`, scoped per workspace.

```bash
maestro explore show                    # List history
maestro explore output exp-20260624-... # View results
```

`--no-save` to skip. `-o /custom/path` for custom location.

---

## Circuit Breaker

In multi-endpoint scenarios, when an endpoint accumulates consecutive failures reaching the threshold, subsequent jobs are automatically routed to healthy endpoints, preventing a single point of failure from failing the entire batch.

### Behavior

1. Each endpoint tracks its own consecutive failure count
2. When the threshold is reached (default 3) → the endpoint is tripped
3. Subsequent jobs are automatically routed to fallback endpoints
4. If no fallback is available, the job is marked as failed and skipped
5. A successful response resets the failure count
6. Only active when 2 or more endpoints are configured

### Configuration

Add a `circuitBreaker` field in `~/.maestro/api.json`:

```json
{
  "endpoints": {
    "qwen": { "baseUrl": "...", "apiKey": "...", "model": "Qwen/Qwen3-8B" },
    "deepseek": { "baseUrl": "...", "apiKey": "...", "model": "deepseek-chat" },
    "gpt-mini": { "baseUrl": "...", "apiKey": "...", "model": "gpt-5.4-mini" }
  },
  "circuitBreaker": {
    "threshold": 3,
    "fallbackOrder": ["gpt-mini", "deepseek", "qwen"]
  }
}
```

### Fields

| Field | Description | Default |
|-------|-------------|---------|
| `threshold` | Consecutive failures before tripping | `3` |
| `fallbackOrder` | Preferred fallback endpoint names | Config order |

### Runtime Output

When a circuit breaker trips, stderr shows:

```
⚡ Circuit breaker: qwen tripped after 3 consecutive failures
[4/10] qwen tripped, fallback → gpt-mini:gpt-5.4-mini
```

End-of-run summary:

```
Circuit breaker summary: qwen tripped during this run
```

### Notes

- Circuit breaker state is per-run only, not persisted across runs
- Works with `--all` mode: tripped endpoints' remaining jobs switch to fallback
- Without `circuitBreaker` config, original behavior is preserved (no failover)
- Endpoints in `fallbackOrder` can also trip, in which case the next healthy endpoint is used

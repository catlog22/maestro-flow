---
title: "Search System Guide"
---

Maestro Search is based on BM25F algorithm, providing unified knowledge search capabilities across multiple data sources including spec, knowhow, issue, and domain.

---

## Overview

`maestro search` is the unified search entry point for the knowledge system, integrating:
- **WikiIndexer** — BM25F weighted full-text retrieval
- **MaestroGraph** — AST-level code symbol search (optional)
- **Type filtering** — Filter by spec/knowhow/issue/domain types
- **Embedding** — Semantic search via vector similarity (optional)

---

## Basic Usage

```bash
# Keyword search (1-3 core words optimal)
maestro search "authentication"

# With type filter
maestro search "jwt token" --type spec

# Filter by category
maestro search --category coding

# Combined query
maestro search "oauth pkce" --type spec --category arch --limit 10

# Code search (requires MaestroGraph enabled)
maestro search "UserService" --code

# KG unified search (MaestroGraph full-source, replaces deprecated maestro kg search)
maestro search "UserService" --kg

# Search all sources (wiki + code), unified normalized ranking
maestro search "UserService" --all

# Skip embedding, use BM25 only (avoid ONNX cold start)
maestro search "jwt token" --no-emb

# JSON output (for script consumption)
maestro search "jwt token" --json
```

### Query Best Practices

**1-3 core words** is the optimal query length. Beyond 4 words, BM25 scoring gets diluted by irrelevant words:

```bash
# ❌ Stack multiple irrelevant keywords
maestro search "topology display frontend DetailedTopologySVG elk"

# ✅ Split into targeted queries
maestro search "topology layout"
maestro search "DetailedTopologySVG" --code
maestro search "elk layout" --type knowhow
```

**CamelCase identifiers** are auto-split: searching `DetailedTopologySVG` matches `detailed`, `topology`, `svg`, and the full identifier.

**IDF adaptive weighting**: With more than 3 words, the system automatically weights high-specificity words (like symbol names) up and common words down.

---

## BM25F Algorithm

### Field Weights

The search system uses BM25F (Best Match 25 with Field weighting) algorithm with different weights for different fields. The system maintains independent configurations for three document types:

**Default (spec/knowhow/issue and other standard documents)**

| Field | boost | b | Description |
|-------|-------|---|-------------|
| `title` | 3 | 0.3 | Title match has highest weight |
| `tags` | 2 | 0 | Tag match, no length normalization |
| `summary` | 1.5 | 0.75 | Summary match |
| `body` | 1 | 0.75 | Body match (baseline) |

**KG (Knowledge Graph virtual nodes)**

| Field | boost | b | Description |
|-------|-------|---|-------------|
| `title` | 2 | 0.3 | Only title participates in scoring |
| `tags` | 1 | 0 | Tag match |
| `summary` | 0 | 0 | Not scored |
| `body` | 0 | 0 | Not scored |

**Scratch (scratch documents)**

| Field | boost | b | Description |
|-------|-------|---|-------------|
| `title` | 1 | 0.3 | Title match (lower weight) |
| `summary` | 0.5 | 0.75 | Summary match |
| `tags` | 0.5 | 0 | Tag match, no length normalization |
| `body` | 0.3 | 0.75 | Body match |

### Scoring Formula

```
score = Σ_idf(tf~ × (k1 + 1)) / (tf~ + k1)
```

Where `tf~` is cross-field weighted term frequency:

```
tf~ = Σ(boost_f × tf_f / (1 - b + b × dl_f / avgdl_f))
```

- `tf_f` — Term frequency in field f
- `dl_f` — Document length in field f
- `avgdl_f` — Average document length in field f
- `k1 = 1.5` — Saturation parameter
- `boost` / `b` — Set independently per configuration above

### Division-by-Zero Protection

When a field's `avgFieldLength = 0`, that field's calculation is automatically skipped to avoid division-by-zero errors.

---

## Chinese Support

### CJK Tokenization

Chinese characters are automatically tokenized as bigram + trigram (`cjkNgrams`, n=2..3), single characters are not output alone:
- Input `"认证"` → tokens: `["认证"]`
- Input `"用户认证"` → tokens: `["用户", "户认", "认证", "用户认", "户认证"]`
- Input `"JWT认证"` → tokens: `["jwt", "认证"]`

### Bilingual Indexing

doc-site search supports bilingual metadata:
- `name` / `name_zh` — English/Chinese command names
- `description` / `description_zh` — English/Chinese descriptions
- `workflow_zh` — Chinese workflow descriptions

---

## Deduplication

### Source-Level Deduplication

Multiple entries under the same `source.path` (e.g., `spec-entry` and `knowhow-entry`) are **not** deduplicated or merged, but displayed independently.

### Query Term Deduplication

Duplicate query terms are automatically merged to prevent score inflation:
```bash
# "token token jwt" is equivalent to "token jwt"
maestro search "token token jwt"
```

---

## Index Sources

WikiIndexer automatically indexes the following data sources:

| Source | Path | Description |
|--------|------|-------------|
| Spec | `.workflow/spec/` | Specification documents |
| Knowhow | `.workflow/knowhow/` | Knowledge entries |
| Scratch | `.workflow/scratch/` | Temporary documents, uses independent BM25F config (lower weights) |
| Session Archive | `.workflow/session/` | Archived session records |
| Claude Code sessions | `~/.claude/` | Claude Code session history (auto-scanned) |
| Codex sessions | `~/.codex/sessions/` | Codex session history (auto-scanned) |

During index building, WikiIndexer automatically selects the corresponding BM25F configuration (default/kg/scratch) based on entry type.

### Wiki Session Parsing

WikiIndexer automatically parses and indexes Claude Code and Codex session history:

- **Claude Code**: Scans session files under `~/.claude/` directory
- **Codex**: Scans session files under `~/.codex/sessions/` directory
- **Session Archive**: Scans `archive.json` under `.workflow/scratch/` (sessions with lifecycle state `sealed` or `archived`)
- **Auto-detection**: Daemon monitors CLI session directories at startup, automatically discovers new sessions

Session history serves as a searchable knowledge source, filterable with `--type session`.

---

## Credibility and Search Popularity

Search hits asynchronously update node `search_hits` counts (via `CredibilityStore`), used for subsequent credibility scoring. This operation is best-effort and doesn't block search returns.

---

## Search Cache Invalidator Hook

`search-cache-invalidator` is a PostToolUse hook that automatically rebuilds WikiIndexer cache after file modifications:

- **Trigger condition**: After Write or Edit tool calls
- **Scope**: Only active in workspace (`requiresWorkspace: true`)
- **Behavior**: Automatically rebuilds WikiIndexer index, ensuring search results reflect latest file content

This hook is enabled by default in the standard hook collection, no manual configuration needed. When modifying spec/knowhow files under `.workflow/` via Write|Edit, the search index automatically updates.

---

## Performance Characteristics

| Optimization | Improvement | Description |
|--------------|-------------|-------------|
| Cold start optimization | ~3200ms → ~280ms | daemon hot path + BM25-only fallback + background daemon startup |
| Backlinks construction | O(n²) → O(1) | Using Set instead of Array.includes |
| Inverted index | Pre-built | Built on first load, reused subsequently |
| Candidate set pruning | 3x limit | Search candidates are 3x limit, filtered before return |
| Workspace filtering | Applied before limit | Filters before truncation to avoid losing valid entries |
| Embedding skip | Auto-skip for non-embedding queries | Falls back to BM25-only when daemon unavailable, avoiding ONNX cold start penalty |

---

## Search Daemon (Resident Process)

Search daemon is a resident background process that keeps WikiIndexer and ONNX embedding model hot-cached, avoiding cold start overhead for each search.

### Basic Operations

```bash
# Start daemon
maestro search-daemon start

# Stop daemon
maestro search-daemon stop

# View daemon status
maestro search-daemon status
```

### How It Works

- **Protocol**: TCP localhost, line-delimited JSON
- **Lock file**: `.workflow/search-daemon.json` (records PID + port)
- **Idle timeout**: Auto-shuts down after 30 minutes of no requests
- **ONNX hot cache**: Daemon pre-loads embedding model at startup, subsequent searches don't need to reload

### Automatic Fallback Strategy

When daemon is unavailable, search command automatically falls back:

1. Uses BM25-only mode (skips embedding) to avoid ONNX cold start (~1800ms)
2. Automatically spawns daemon in background, so subsequent searches get embedding acceleration

```bash
# When daemon available: hot path, includes embedding
maestro search "query"          # ~280ms

# When daemon unavailable: falls back to BM25-only
maestro search "query"          # ~280ms (BM25-only)
maestro search "query" --no-emb # Explicitly skip embedding
```

---

## Embedding Management

Maestro supports embedding-based semantic search, supplementing BM25 full-text retrieval with vector similarity. For detailed configuration, see [Embedding Model Configuration Guide](embedding-guide.en.md).

```bash
# View embedding model status
maestro embedding status

# Warm up embedding model
maestro embedding warmup

# Rebuild embedding index
maestro embedding rebuild
```

**Quick Setup**:

```bash
# Install dependencies
npm install @huggingface/transformers onnxruntime-node

# Check status
maestro embedding status

# Warm up model (first load is slow)
maestro embedding warmup
```

**Automatic Fallback**: When embedding is unavailable, search automatically falls back to BM25-only mode, no manual intervention needed.

---

## Search Results Structure

```typescript
interface SearchResult {
  id: string;           // Unique identifier
  type: WikiNodeType;   // spec/knowhow/issue/domain/...
  title: string;        // Title
  category: string;     // coding/arch/review/...
  summary: string;      // Summary
  score: number;        // BM25F score
  snippet: string;      // Context snippet (keywords highlighted)
  source: { path: string };  // Source file path
}
```

---

## Filter Syntax

### Filter by Type

```bash
maestro search "query" --type spec       # Search specs only
maestro search "query" --type knowhow    # Search knowhows only
maestro search "query" --type issue      # Search issues only
maestro search "query" --type domain     # Search domains only
```

Valid types: `project`, `roadmap`, `spec`, `issue`, `knowhow`, `note`, `domain`

### Filter by Category

```bash
maestro search "query" --category coding   # Coding standards
maestro search "query" --category arch     # Architecture constraints
maestro search "query" --category review   # Review standards
maestro search "query" --category debug    # Debug notes
maestro search "query" --category test     # Test specifications
maestro search "query" --category learning # Lessons learned
```

### Filter by Workspace

```bash
maestro search "query" --workspace shared  # Search shared workspace
```

---

## Code Search

With `--code` flag enabled, search simultaneously queries MaestroGraph AST index:

```bash
maestro search "UserService" --code
```

Code search results are displayed independently, containing:
- Symbol name and type (function/class/interface/...)
- File path and line number
- Function signature (if available)

---

## Common Issues

### Empty Search Results

1. Confirm `.workflow/wiki-index.json` exists
2. Run `maestro wiki health` to check index status
3. Try broader keywords

### Inaccurate Chinese Search

CJK tokenization is at bigram + trigram level, short queries (2 characters or less) may have insufficient matches. Suggestions:
- Use 3+ character keywords to trigger trigram matching
- Combine with `--category` filter to narrow scope

### Abnormal Scoring

If an entry has abnormally high score, it may be due to:
- Title field hit (3x weight in default config)
- Tag field hit (2x weight, no length normalization)
- Excessive keyword repetition (optimized, but may still affect)

---

## Related Commands

```bash
# Unified search (recommended)
maestro search <query> [--type <type>] [--category <cat>] [--code] [--kg] [--all] [--no-emb] [--json]

# Wiki system search
maestro wiki search <query> [--json]
maestro wiki list [--type <type>] [--category <cat>] [--keyword <kw>]

# Knowledge graph search (deprecated, use maestro search --kg instead)
maestro kg search <symbol>   # [deprecated] Use "maestro search --kg" instead
maestro kg context <node>

# Search Daemon
maestro search-daemon start   # Start resident process
maestro search-daemon stop    # Stop resident process
maestro search-daemon status  # View status

# Embedding management
maestro embedding status   # View embedding model status
maestro embedding warmup   # Warm up embedding model
maestro embedding rebuild  # Rebuild embedding index

# Index health check
maestro wiki health
```

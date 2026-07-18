# Wiki & Spec System — Test Report

> Generated: 2026-04-25 | Total: **174 tests** | Status: **ALL PASS**

## Test Matrix

| # | Test File | Framework | Tests | Layer | Focus |
|---|-----------|-----------|-------|-------|-------|
| 1 | `dashboard/src/server/wiki/wiki-indexer.test.ts` | vitest | 12 | L1 Unit | Indexing, BM25 search, graph, WikiWriter CRUD |
| 2 | `dashboard/src/server/wiki/stress.test.ts` | vitest | 14 | L1 Stress | BM25 2000-doc corpus, graph 500-node topology |
| 3 | `dashboard/src/server/wiki/writer-stress.test.ts` | vitest | 20 | L1 Security | Path traversal, symlinks, concurrency, virtual entries |
| 4 | `dashboard/src/server/routes/wiki.integration.test.ts` | vitest | 30 | L2 Integration | `/api/wiki` 12 endpoints + events |
| 5 | `dashboard/src/server/routes/specs.integration.test.ts` | vitest | 34 | L2 Integration | `/api/specs` 5 endpoints + CRUD cycle |
| 6 | `src/tools/__tests__/spec-entry-parser.test.ts` | node:test | 20 | L1 Unit | `<spec-entry>` parsing, validation, formatting |
| 7 | `src/tools/__tests__/spec-loader.test.ts` | node:test | 11 | L1 Unit | Three-layer spec loading, category filtering |
| 8 | `src/hooks/__tests__/spec-validator.test.ts` | node:test | 14 | L1 Unit | Tag validation, attribute checks |
| 9 | `src/hooks/__tests__/spec-injector.test.ts` | node:test | 13 | L1 Unit | Spec injection by agent type, context budget |

## Run Commands

```bash
# --- All wiki + spec dashboard tests (vitest) ---
cd dashboard && npx vitest run \
  src/server/wiki/ \
  src/server/routes/wiki.integration.test.ts \
  src/server/routes/specs.integration.test.ts
# Expected: 5 files, 116 tests pass

# --- All CLI spec tests (node:test via tsx) ---
npx tsx --test \
  src/tools/__tests__/spec-entry-parser.test.ts \
  src/tools/__tests__/spec-loader.test.ts \
  src/hooks/__tests__/spec-validator.test.ts \
  src/hooks/__tests__/spec-injector.test.ts
# Expected: 4 files, 58 tests pass

# --- Individual suites ---
cd dashboard && npx vitest run src/server/wiki/wiki-indexer.test.ts      # 12 tests
cd dashboard && npx vitest run src/server/wiki/stress.test.ts            # 14 tests
cd dashboard && npx vitest run src/server/wiki/writer-stress.test.ts     # 20 tests
cd dashboard && npx vitest run src/server/routes/wiki.integration.test.ts   # 30 tests
cd dashboard && npx vitest run src/server/routes/specs.integration.test.ts  # 34 tests
npx tsx --test src/tools/__tests__/spec-entry-parser.test.ts  # 20 tests
npx tsx --test src/tools/__tests__/spec-loader.test.ts        # 11 tests
npx tsx --test src/hooks/__tests__/spec-validator.test.ts     # 14 tests
npx tsx --test src/hooks/__tests__/spec-injector.test.ts      # 13 tests
```

---

## Detailed Test Catalog

### 1. WikiIndexer Unit Tests (12 tests)

**File:** `dashboard/src/server/wiki/wiki-indexer.test.ts`

| Suite | Test | What It Verifies |
|-------|------|-----------------|
| WikiIndexer | indexes files across workflow subtrees | Scans specs/, memory/, project.md, roadmap.md; correct types assigned |
| WikiIndexer | filters by type and tag | `query({type, tag})` returns matching subset |
| graph-analysis | detects orphans as entries with no edges | Entries with zero in/out links identified |
| graph-analysis | reports broken links | `[[spec-missing]]` wikilinks flagged |
| graph-analysis | ranks hubs by incoming link count | Most-linked entry at top of hub list |
| graph-analysis | computes health score with penalties | Score < 100 when broken links/orphans exist |
| search (BM25) | tokenizes lowercase and drops stop words | "The quick FOX" → ["quick", "fox"] |
| search (BM25) | ranks exact title match first | Query matching title scores highest |
| search (BM25) | returns empty for stop-word-only query | "the is a" → no results |
| WikiWriter | creates a new spec markdown file | File on disk with correct frontmatter |
| WikiWriter | rejects slug with traversal attempts | `../etc/hosts` → WikiWriteError |
| WikiWriter | returns 409 on stale expectedHash | Optimistic concurrency check works |
| WikiWriter | updates existing entry preserving frontmatter | Title changes, tags preserved |
| WikiWriter | removes an existing spec file | File deleted, index updated |
| WikiWriter | rejects writes on virtual entries | Issue/lesson entries are read-only |

### 2. BM25 & Graph Stress Tests (14 tests)

**File:** `dashboard/src/server/wiki/stress.test.ts`

| Suite | Test | Performance Target |
|-------|------|--------------------|
| BM25 stress — 2000-doc | builds inverted index in under 200ms | < 200ms for 2000 docs |
| BM25 stress — 2000-doc | single-term query returns in <50ms | < 50ms per query |
| BM25 stress — 2000-doc | canonical title-match ranks top-3 | Title match in first 3 results |
| BM25 stress — 2000-doc | multi-term rewards more matching terms | More matching terms → higher score |
| BM25 stress — 2000-doc | stop-word-only query returns empty | No false positives |
| BM25 stress — 2000-doc | unknown-term query returns empty | No false positives |
| BM25 stress — 2000-doc | score stability — same corpus twice | Deterministic ranking |
| BM25 stress — 2000-doc | tokenize handles Unicode | CJK and accented characters work |
| BM25 stress — 2000-doc | tokenize drops stop words and sub-2-char | Noise removal |
| graph stress — 500-doc | builds graph in <100ms | < 100ms for 500-node ring |
| graph stress — 500-doc | hub dominates inDegree ranking | Hub node has highest in-degree |
| graph stress — 500-doc | reports N broken links (one per node) | Broken link detection at scale |
| graph stress — 500-doc | detects no orphans in fully-connected ring | Ring topology = no orphans |
| graph stress — 500-doc | health floored at 0 when > 50 broken | Health score never negative |
| graph stress — disconnected | detects all 20 orphans exactly | Island detection works |
| graph stress — disconnected | cliques have equal inDegree = 4 | Symmetric topology validated |

### 3. WikiWriter Security & Concurrency (20 tests)

**File:** `dashboard/src/server/wiki/writer-stress.test.ts`

| Suite | Test | Security Property |
|-------|------|-------------------|
| path traversal | rejects absolute path slug | `/etc/passwd` → BAD_REQUEST |
| path traversal | rejects dot-traversal slug | `..` → BAD_REQUEST |
| path traversal | rejects windows-style traversal | `..\\..\\windows\\system32` → BAD_REQUEST |
| path traversal | rejects uppercase slug | Case-sensitive slug enforcement |
| path traversal | rejects slug with spaces | No whitespace in slugs |
| path traversal | rejects empty title | Title validation (non-blank) |
| path traversal | rejects phase type (removed) | `phase` type no longer writable |
| path traversal | memory writes to memory/MEM-slug.md | Correct path routing |
| path traversal | note writes to memory/TIP-slug.md | Correct path routing |
| symlink rejection | refuses to update symlinked entry | TOCTOU-safe: symlink → FORBIDDEN |
| virtual entries | rejects update on virtual issue | Issues are read-only (FORBIDDEN) |
| virtual entries | rejects remove on virtual lesson | Lessons are read-only (FORBIDDEN) |
| concurrency | concurrent PUTs — one wins, others CONFLICT | Optimistic locking under contention |
| concurrency | spec body update blocked | Body writes to specs/ → FORBIDDEN |
| concurrency | rapid create→update→delete round-trip | Index consistency after CRUD cycle |
| concurrency | create with frontmatter serializes arrays/strings | Tags array, priority string persisted |
| concurrency | update without body preserves existing | Partial update correctness |
| invalid id | rejects update with slash in id | `/` in id → BAD_REQUEST |
| invalid id | rejects remove with backslash in id | `\` in id → BAD_REQUEST |
| invalid id | remove of non-existent id → NOT_FOUND | 404 for missing entries |
| invalid id | create fails when target already exists | Duplicate → CONFLICT |

### 4. Wiki Routes Integration (30 tests)

**File:** `dashboard/src/server/routes/wiki.integration.test.ts`

| Endpoint | Tests | Coverage |
|----------|-------|----------|
| `GET /api/wiki` | 4 | List, filter by type, filter by tag, BM25 search, grouped output |
| `GET /api/wiki/stats` | 1 | Totals by type, tag counts, lastUpdated |
| `GET /api/wiki/health` | 1 | Score < 100 with broken links & orphans |
| `GET /api/wiki/graph` | 1 | forwardLinks, backlinks, brokenLinks |
| `GET /api/wiki/orphans` | 1 | Unlinked entries identified |
| `GET /api/wiki/hubs` | 2 | In-degree ranking, limit clamping [1,100] |
| `GET /api/wiki/:id` | 3 | Found, 404, invalid chars 400 |
| `GET /api/wiki/:id/backlinks` | 1 | Incoming edges resolved |
| `GET /api/wiki/:id/forward` | 1 | Outgoing edges resolved |
| `POST /api/wiki` | 5 | Create + event, bad slug 400, bad type 400, bad JSON 400, dup 409 |
| `PUT /api/wiki/:id` | 6 | Title-only update, body blocked 403, memory body update, stale hash 409, 404, virtual 403 |
| `DELETE /api/wiki/:id` | 3 | Delete, 404, virtual 403 |
| `workspace:switched` | 1 | Indexer rebinds to new root |

### 5. Specs Routes Integration (34 tests)

**File:** `dashboard/src/server/routes/specs.integration.test.ts`

| Suite | Tests | Coverage |
|-------|-------|----------|
| GET /api/specs | 3 | Empty state, frontmatter parsing, multi-file aggregation |
| GET /api/specs/files | 1 | File metadata with entry counts |
| GET /api/specs/file/:name | 3 | Content + entries, 404, invalid name 400 |
| POST /api/specs | 4 | Create in existing file, create new file, missing content 400, missing file 400 |
| DELETE /api/specs/:id | 3 | Delete + persist, 404, invalid format 400 |
| DELETE fallback heading | 5 | Partial match, extra whitespace, invalid stem, 404 (in file), 404 (no file) |
| POST error paths | 2 | Bad JSON 500, special chars 400 |
| DELETE error path | 1 | Internal error 500 |
| Full CRUD cycle | 1 | create → list → delete → verify empty |
| Unified format | 3 | Parse [type] [date], POST round-trip, DELETE |
| Extended types | 2 | All 12 types from bracket format, POST extended types |
| Type detection boundary | 3 | debug≠bug, preview≠review, latest≠test |
| Clean title extraction | 3 | [type]+[date] stripping, legacy "type:" prefix, bare ISO timestamp |

### 6. Spec Entry Parser (CLI) (20 tests)

**File:** `src/tools/__tests__/spec-entry-parser.test.ts`

| Suite | Tests | Coverage |
|-------|-------|----------|
| parseSpecEntries | 5 | Single block, multiple blocks, optional attrs, mixed format, error reporting |
| validateSpecEntry | 5 | Valid entry, missing category, invalid date, keyword parsing, valid categories list |
| validateCategoryMatch | 3 | Match, mismatch, missing category |
| formatSpecEntries | 4 | Single entry, multiple entries, keyword filter, empty list |
| formatNewEntry | 3 | Full attrs, without keywords, without source |

### 7. Spec Loader (11 tests)

**File:** `src/tools/__tests__/spec-loader.test.ts`

| Suite | Tests | Coverage |
|-------|-------|----------|
| loadSpecs — single dir | 2 | Basic loading, backward compatibility |
| loadSpecs — three-layer | 9 | Baseline+team+personal, category filtering, layer headers, missing layers, uid fallback |

### 8. Spec Validator (14 tests)

**File:** `src/hooks/__tests__/spec-validator.test.ts`

| Suite | Tests | Coverage |
|-------|-------|----------|
| evaluateSpecValidator | 14 | Valid tags, missing category, invalid date, keyword format, Windows paths, stop-word queries, unbalanced tags |

### 9. Spec Injector (13 tests)

**File:** `src/hooks/__tests__/spec-injector.test.ts`

| Suite | Tests | Coverage |
|-------|-------|----------|
| evaluateSpecInjection | 5 | code-developer, workflow-planner, tdd-developer, unknown agent, empty specs |
| evaluateContextBudget | 4 | full/reduced/minimal/skip based on remaining tokens |
| truncateMarkdown | 4 | Preserve headings, first paragraphs, truncation at limit, empty input |

---

## Coverage Summary

### Functional Areas

| Area | L1 Unit | L1 Stress | L2 Integration | Total |
|------|---------|-----------|----------------|-------|
| WikiIndexer (indexing) | 2 | — | 4 | 6 |
| BM25 Search | 3 | 9 | 1 | 13 |
| Graph Analysis | 4 | 7 | 5 | 16 |
| WikiWriter CRUD | 5 | 7 | 14 | 26 |
| Security (traversal/symlink) | — | 11 | 2 | 13 |
| Virtual Entries | 1 | 2 | 2 | 5 |
| Concurrency | — | 5 | — | 5 |
| Spec Entry Parser (dashboard) | — | — | 12 | 12 |
| Spec Entry Parser (CLI) | 20 | — | — | 20 |
| Spec Loader | 11 | — | — | 11 |
| Spec Validator | 14 | — | — | 14 |
| Spec Injector | 13 | — | — | 13 |
| Spec Routes CRUD | — | — | 18 | 18 |
| Workspace Events | — | — | 1 | 1 |
| **Total** | **73** | **41** | **59** | **174** (1 shared) |

### Entry Type Coverage

The parser supports 12 entry types:

| Type | Bracket `[type]` | Colon `type:` | File-based |
|------|:-:|:-:|:-:|
| coding | Y | Y | Y (coding-conventions) |
| arch | Y | Y | Y (architecture-constraints) |
| quality | Y | Y | Y (quality-rules) |
| debug | Y | Y | Y (debug-notes) |
| test | Y | Y | Y (test-conventions) |
| review | Y | Y | Y (review-standards) |
| learning | Y | Y | Y (learnings) |
| bug | Y | Y | — |
| pattern | Y | Y | — |
| decision | Y | Y | — |
| rule | Y | Y | — |
| validation | Y | Y | — |

### Security Properties Tested

| Property | Test Count |
|----------|-----------|
| Path traversal (absolute, relative, Windows) | 3 |
| Slug validation (uppercase, spaces, empty) | 3 |
| Symlink rejection (TOCTOU-safe) | 1 |
| Virtual entry immutability | 4 |
| Spec body write protection | 2 |
| ID injection (slash, backslash) | 2 |
| Invalid JSON handling | 2 |
| File name sanitization | 2 |
| Optimistic concurrency (hash) | 3 |

---

## Architecture Notes

### Two Spec Entry Parsers

The project has **two separate** spec entry parsers that serve different purposes:

| Parser | Path | Used By |
|--------|------|---------|
| Dashboard parser | `dashboard/src/server/wiki/spec-entry-parser.ts` | WikiIndexer, specs routes, wiki routes |
| CLI parser | `src/tools/spec-entry-parser.ts` | spec CLI command, hooks (validator, injector) |

Both parse `<spec-entry>` closed-tag format. The dashboard parser is optimized for WikiEntry generation (id, type, content, category, keywords). The CLI parser is optimized for validation and formatting (lineStart/lineEnd tracking, error reporting).

### Test Framework Split

- **vitest**: Dashboard code (wiki system, routes) — uses ESM imports directly from `.ts` source
- **node:test**: CLI tools/hooks — requires `tsx` loader since source is `.ts` but imports use `.js` extension (NodeNext resolution)

### Write Protection Model

```
WikiWriter
  ├── specs/*.md   → title/frontmatter updates ONLY (body FORBIDDEN)
  ├── memory/*.md  → full CRUD (body + frontmatter)
  ├── virtual/*    → all writes FORBIDDEN
  └── appendEntry  → spec-entry block appended to container
      removeEntry  → spec-entry block surgically removed
```

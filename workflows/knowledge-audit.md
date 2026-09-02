<!-- session-mode: none -->
# Knowledge Audit Workflow

## Purpose

Run the implemented deterministic knowledge-health inspection. `maestro knowledge audit` is always read-only: it reads Spec, Knowhow, pipeline, usage, repository, and compatibility state and emits findings. It never edits, deprecates, supersedes, deletes, purges, backs up, or writes an audit report.

`--prune` only adds a deterministic `prune_plan` to the output. It does not grant mutation authority, and `audit` has no `--apply` option.

---

## Prerequisites

- Run from the project root, or pass `--workflow-root <path>`.
- `.workflow/specs/`, `.workflow/knowhow/`, `.workflow/sessions/`, the graph database, and `.workflow/repository.json` may be absent. The audit reports the state it can inspect; a missing repository manifest is itself a finding.

---

## Command Surface

```bash
maestro knowledge audit --scope all
maestro knowledge audit --scope spec
maestro knowledge audit --scope knowhow
maestro knowledge audit --scope all --prune
maestro knowledge audit --scope all --json
maestro knowledge audit --scope spec --workflow-root <path>
```

| Flag | Effect |
|------|--------|
| `--scope <spec\|knowhow\|all>` | Select corpus detectors; default `all` |
| `--prune` | Include the read-only deterministic soft-action report in `prune_plan` |
| `--json` | Emit the complete `knowledge-audit/1.0` object |
| `--workflow-root <path>` | Select the project root containing `.workflow/` |

Only `spec`, `knowhow`, and `all` are implemented scopes. There is no `artifact` scope and there are no `--apply`, `--delete`, `--purge`, `--interactive`, `--mark`, `--dry-run`, `--report`, `--level`, `--since`, `--milestone`, or timeline flags.

Pipeline and repository diagnostics always run. Usage diagnostics run when MaestroGraph is initialized. `--scope` controls the Spec/Knowhow corpus inspection and compatibility entry selection; it does not suppress those pipeline/usage diagnostics.

---

## Execution

1. Parse `--scope`; reject values outside `spec|knowhow|all`.
2. For `spec` or `all`, parse `.workflow/specs/*.md`, calculate `spec_health`, run the implemented Spec detectors, and build eligible prune suggestions.
3. For `knowhow` or `all`, parse `.workflow/knowhow/*.md`, calculate lifecycle counts, run the implemented Knowhow detectors, and build eligible prune suggestions.
4. Read Session knowledge ledgers without mutation and summarize promotion backlog.
5. If MaestroGraph exists, open it read-only and calculate usage concentration.
6. Inspect compatibility, current/linked repository identity and capabilities, and pending cross-repository promotions.
7. Sort findings by priority, store, normalized target, and stable finding ID. Sort prune suggestions by target ID.
8. Emit human-readable stdout or JSON. When `--prune` is absent, `prune_plan` is empty; when present, the plan is reported only and no files change.

For an unchanged source snapshot, finding IDs, ordering, and `prune_plan` are deterministic. `generated_at` records invocation time, so complete JSON output is not byte-identical across runs.

---

## Implemented Detector Classes

### Spec detectors (`--scope spec|all`)

| Subtype | Priority | Meaning |
|---------|----------|---------|
| `missing-stable-id` | P2 | Entry lacks a stable SID required for safe lifecycle targeting |
| `unsynchronized-supersession` | P1 | An entry has a valid successor but remains active |
| `exact-duplicate` | P1 | Active entries have identical normalized title and content |
| `dangling-supersedes` | P0 | A supersession predecessor reference is missing |
| `dangling-superseded-by` | P0 | A successor reference is missing |
| `supersession-cycle` | P0 | A SID participates in a supersession cycle |
| `stale-active-observation` | P2 | Spec health reports active entries below the freshness threshold |

The JSON result also includes the full `spec_health` report returned by `analyzeSpecHealth()`.

### Knowhow detectors (`--scope knowhow|all`)

| Subtype | Priority | Meaning |
|---------|----------|---------|
| `missing-required-metadata` | P1 | Frontmatter lacks `title` or `type` |
| `ghost-code-reference` | P1 | A project-contained `relatedPaths`/legacy `codePaths` target is missing |
| `invalid-frontmatter` | P1 | The document cannot be parsed |
| `exact-duplicate` | P1 | Active documents have identical normalized title and body |

The result also reports Knowhow `total`, `active`, `deprecated`, and `invalid` counts.

### Pipeline and repository detectors (always inspected)

| Subtype | Priority | Meaning |
|---------|----------|---------|
| `invalid-session-authority` | P1 | A Session is excluded by the read-only Session authority listing |
| `invalid-knowledge-ledger` | P1 | A Session knowledge ledger cannot be summarized strictly |
| `corroborated-promotion-backlog` | P2 | Corroborated candidates await explicit promotion |
| `missing-repository-manifest` | P1 | Stable current-repository identity is not persisted |
| `linked-repository-id-mismatch` | P1 | Cached and live linked repository identity disagree |
| `invalid-linked-repository` | P1 | Another linked repository validation error is present |
| `pending-cross-repo-promotion` | P1 | A Spec/Knowhow promotion to a linked repository remains pending |

Pipeline summary fields are `sessions`, `ledgers`, `pending_observed`, `pending_corroborated`, and `promoted`. Compatibility output includes current/linked repository IDs, cached IDs, validity, per-corpus read/write capabilities, and pending cross-repository promotion details.

### Usage detector (when MaestroGraph is initialized)

| Subtype | Priority | Meaning |
|---------|----------|---------|
| `exposure-concentration` | P2 | Search impressions exist and top-10 share exceeds 75% or Gini exceeds 0.65 |

Usage is observational only. Low usage, age, or exposure never creates a prune action.

### Compatibility states

Compatibility inspection emits one finding per detected legacy state. Implemented states are `legacy-<field>`, `legacy-free-category`, and `legacy-unscoped`; legacy fields include `tags`, `specCategory`, `status`, `source`, `codePaths`, `lang`, and `assetType`, plus Knowhow-only legacy aliases such as `id`, `description`, `body`, and `content`.

`legacy-free-category` is not deterministically normalizable and requires a human-selected canonical category.

---

## Prune Report Semantics

`--prune` may suggest only these soft lifecycle actions:

| Store | Suggested action | Reasons |
|-------|------------------|---------|
| Spec | `deprecate` in favor of a successor | `unsynchronized-supersession`, `exact-duplicate` |
| Knowhow | `supersede` in favor of a canonical document | `exact-duplicate` |

These are suggestions in `prune_plan`, not applied actions. Audit never invokes Spec or Knowhow lifecycle APIs. A human or a separately authorized workflow may review the evidence and later use explicit lifecycle commands; the audit result itself grants no mutation authority.

---

## JSON Contract

```text
knowledge-audit/1.0
  scope
  generated_at
  spec_health
  knowhow
  usage
  pipeline
  findings[]
  prune_plan[]
  compatibility
  safety:
    usage_only_never_pruned: true
    physical_delete: false
    diagnostics_read_only: true
    normalization_requires_prior_report: true
```

Human-readable mode prints summary lines and findings to stdout. It does not create `.workflow/.knowledge-audit/`, audit logs, backups, or report files.

---

## Explicit Normalization Boundary

Audit never normalizes compatibility fields. `knowledge normalize` is the only explicit report-fenced migration apply:

```bash
maestro knowledge normalize --report .workflow/knowledge-normalize.json
# Review the saved dry-run report, then apply that exact unchanged snapshot:
maestro knowledge normalize --report .workflow/knowledge-normalize.json --apply
```

Apply fails closed when the saved report, source fingerprint/hashes, scope, project root, or repository identity no longer matches. It backs up affected files before writing. Free categories remain unresolved until a human selects a canonical category.

---

## Safety Invariants

1. **Audit is read-only** — no audit flag mutates knowledge or runtime-owned state.
2. **Prune is report-only** — `--prune` populates suggestions and never applies them.
3. **No physical deletion** — audit has no delete or purge stage.
4. **Usage is evidence, not authority** — usage-only signals never enter `prune_plan`.
5. **Deterministic findings** — stable IDs and ordering derive from inspected state; invocation time is isolated to `generated_at`.
6. **Normalization is separate and fenced** — only a reviewed `knowledge normalize --report <path>` snapshot may later be explicitly applied with `--apply`.

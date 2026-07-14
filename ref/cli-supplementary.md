# CLI Supplementary Evidence Collection

Optional cross-validation pass that augments an agent's first-pass findings with an independent CLI tool (via `maestro delegate --mode analysis`). Used by debug (Step 5.5) and review (Step 6.5). It never replaces the primary agent — it corroborates, calibrates, and catches misses.

## When to run

- **debug**: after the primary hypothesis pass, when a CLI tool is enabled and the context is more than minimal.
- **review**: at `standard` / `deep` level, on the critical / high findings only.

Skip entirely when no CLI tool is enabled, or (for review) at `quick` level.

## Protocol

Feed the CLI a compact summary (symptoms for debug; the critical/high findings for review) and ask read-only analysis questions:

| Question | Purpose |
|----------|---------|
| Trace the call chain around `<location>` | confirm the failure path / impact radius |
| What recently changed in the related files? | surface a likely regression source |
| Where are error-handling gaps on this path? | find unguarded branches |
| Find similar patterns elsewhere | detect the same defect / calibrate false positives |

Always `--mode analysis` (read-only). Prompt as `PURPOSE / TASK / CONTEXT / EXPECTED / CONSTRAINTS`; scope `CONTEXT` to the affected files, not `**/*`.

## Merging results

- **debug**: append each callback item as evidence with `type: "cli-exploration"`, and pass it as `supplementary_context` to the primary debug agent. It is corroborating evidence, not a conclusion — the agent still confirms the root cause.
- **review**: merge callback items into `all_findings`, prefixing new item ids with `CLI-`, then recompute the severity distribution. The CLI may downgrade a false positive or add a missed finding.

## Constraints

- Read-only only — the CLI never modifies files in this pass.
- CLI output is supplementary. On conflict, the primary agent's evidence-backed conclusion wins; a CLI claim without a `file:line` is discarded.
- On CLI failure (timeout / unavailable / parse error), skip silently and proceed with the primary pass — this step is non-blocking.

# Interview Interaction Mechanics

- **One decision per turn** via AskUserQuestion, 2-4 options, first marked `(Recommended)`. User can redirect via `Other`.
- **Search-first**: resolve via state.json → session artifacts → `maestro spec/wiki` → Glob/Grep/Read → Agent(Explore) / delegate. Never ask what code can answer.
- **Writeback**: each decision **immediately written to disk** before the next question. No batching.
- **Skip**: auto mode (`-y`) → answer per-question via Search-first (do NOT skip the whole interview); only skip a question when the code gives a high-confidence answer. **Exception**: boundary clarification for broad intent is never skipped (even with `-y`); phase ambiguity is never skipped. resume (`-c`) → skip already-answered questions. Unambiguous single-answer input → skip only that question.
- **Decision table**: `| # | Decision | Choice | Source (user / code / default) | Confidence (high / medium / LOW) |`
  - `code` source: derived via Search-first (state.json / spec / Glob / Grep). `code` + non-broad → can auto-decide; `code` + broad → mark `LOW CONFIDENCE`, needs user confirmation; `default` source → always mark `LOW CONFIDENCE`.

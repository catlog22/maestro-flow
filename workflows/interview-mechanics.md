# Interview Interaction Mechanics

- **One decision per turn** via AskUserQuestion, 2-4 options, first marked `(Recommended)`. User can redirect via `Other`.
- **Search-first**: resolve via state.json → session artifacts → `maestro spec/wiki` → Glob/Grep/Read → Agent(Explore) / delegate. Never ask what code can answer.
- **Writeback**: each decision **immediately written to disk** before the next question. No batching.
- **Skip**: auto mode (`-y`) → 逐问题 Search-first 代答（不跳过整段 interview）；仅当代码给出高置信答案时跳过该问题。**例外**：broad intent 的边界澄清永不跳过（即使 `-y`）；phase 歧义永不跳过。resume (`-c`) → 跳过已答问题。unambiguous 单一答案输入 → 仅跳过该问题。
- **Decision table**: `| # | Decision | Choice | Source (user / code / default) | Confidence (high / medium / LOW) |`
  - `code` source：Search-first 派生（state.json / spec / Glob / Grep）。`code` + 非 broad → 可自动定；`code` + broad → 标 `LOW CONFIDENCE` 需用户确认；`default` source → 一律标 `LOW CONFIDENCE`。

# TASK-006: Synchronize tracked Session/Run documentation

## Changes

- `guide/search-system-guide.md`, `guide/search-system-guide.en.md`：同步 runtime writer=`session/1.3` + `command-run/1.3`、Wiki reader=`1.0-1.3`、unknown schema fail closed、live Search/Load 与 `search-cache.json` cache v3。
- `guide/session-run-architecture.md`：补齐 canonical authority、transition request/outcome receipt、`resolve` → `resume` paused recovery、`run next` chain allocation 与完整 `run-response/1.0` operation surface。
- `guide/session-run-structure-guide.md`：将当前 `session.json`/`run.json` source of truth 更新为 `session/1.3`/`command-run/1.3`，记录 `session.json.requests[]` receipt 与 transition pointer，并补齐 recovery/machine matrix。
- `guide/cli-commands-guide.md`, `guide/cli-commands-guide.en.md`：以中英文 parity 增加 Run/Session lifecycle 命令、required recovery flags、lease/revision guards、16-operation matrix 和单行 stdout machine guarantees。

## Verification

- [x] Writer/reader/cache positive grep：中英文 Search guides 均命中 `session/1.3`、`command-run/1.3`、`1.0-1.3`、`cache v3` 与 `version: 3`。
- [x] Recovery/machine positive grep：Architecture、Structure 与中英文 CLI guides 均命中 `run-response/1.0`、`resolve`、`resume`、`run next`、`chain-insert`、`chain-replace`、`chain-skip`、`meta-update`。
- [x] Canonical stale negative scan：current-writer-1.0/cache-v2 pattern 为 0 matches。
- [x] 受保护文件 SHA-256：`docs/session-run-architecture.md` 修改前后均为 `f8eb438eb803d730632d653c121b229d7ff8aa7b346bf3ce5bb1ee74f9017c0a`。
- [x] Scope diff：仅 6 个指定 tracked guides 与本 summary 属于 TASK-006；未触碰工作树中既有 `src/run/artifacts.ts`/`src/run/artifacts.test.ts` 改动。

## Tests

- [x] `npm run check:docs-reference`：exit 0，`reference.md` is in sync。
- [x] `git diff --check`：exit 0；仅显示工作区 LF→CRLF 提示，无 whitespace error。

## Deviations

- Sealed Plan task JSON 按调用方要求保持只读，未更新其中顶层 `status`。

## Notes

- `seal-session` 不是 receipt-backed mutation，因此文档明确其成功 envelope 的 `replay` 为 `null`。
- `resolve` 与 `resume` 均不创建 Run；恢复后的 chain Run 仅由显式 `maestro run next` 分配。

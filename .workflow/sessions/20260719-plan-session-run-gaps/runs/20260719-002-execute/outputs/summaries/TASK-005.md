# TASK-005: Complete run-response machine coverage

## Changes
- `src/run/protocol-schemas.ts`, `src/run/response.ts`: 扩展 `run-response/1.0` operation/error enums，统一 typed domain error 与 legacy message error 的稳定映射，继续 validate-before-write。
- `src/commands/run.ts`: 为 `run check`、`run decide`、`run seal-session` 增加显式 `--json` machine 分支；success、business error 与 decide replay 均携带 locator/next/request/replay 元数据，human mode 保持原输出。
- `src/commands/session.ts`: 为 canonical `resolve/resume`、`chain insert|replace|skip`、`meta update` 增加单行 machine envelope，并从 transition receipt 投影 applied/replayed metadata。
- `src/cli.ts`: 将顶层 machine detection 扩展到显式 `run|session --json`，按真实嵌套 subcommand 推断 operation，并将 Commander missing argument/required option/unknown option 统一为 `COMMANDER_USAGE`、exit 2、空 stderr。
- `src/run/response.test.ts`, `src/commands/run-machine.test.ts`, `src/commands/session-cli.test.ts`: 覆盖全部 16 个 operation、Run/Session success/business/replay，以及新增 command 的 Commander usage matrix。

## Verification
- [x] required operations grep：`check|decide|seal-session|resolve|resume|chain-insert|chain-replace|chain-skip|meta-update` 全部命中 `runOperationSchema`。
- [x] CLI detection grep：`requestedCommand === 'run'`、`requestedCommand === 'session'` 与 `COMMANDER_USAGE` 全部命中。
- [x] Run machine cases：每个 case 均断言 stdout 恰一行、stderr 为空、schema=`run-response/1.0`、body.exit_code=process status。
- [x] Session recovery/chain/meta cases：success、business error、applied/replayed 与 request conflict 均满足单行/空 stderr/exit parity。
- [x] Commander usage：3 个 Run surface 与 6 个 Session surface 的缺参，以及 Run/Session unknown option，均返回 `COMMANDER_USAGE`、exit 2。
- [x] `git diff --check -- <owned files>`：退出 0。

## Tests
- [x] `npm run build`：退出 0。
- [x] `npx vitest run src/run/response.test.ts -t "accepts every required run-response operation"`：1 passed。
- [x] `npx vitest run src/commands/run-machine.test.ts -t "emits one envelope for check decide and seal-session exits"`：1 passed。
- [x] `npx vitest run src/commands/session-cli.test.ts -t "emits one envelope for recovery chain and meta exits"`：1 passed。
- [x] `npx vitest run src/commands/run-machine.test.ts src/commands/session-cli.test.ts -t "captures every Commander usage exit in machine mode"`：2 passed。
- [x] `npx vitest run src/run/response.test.ts src/commands/run-machine.test.ts src/commands/session-cli.test.ts`：3 files，25 tests passed。
- [x] `npx tsc --noEmit`：退出 0。

## Deviations
- Sealed Plan task JSON 按调用方要求保持只读，未更新其中 `status`。
- 无代码范围偏离；未修改 `docs/session-run-architecture.md`、`src/run/artifacts.ts` 或 `src/run/artifacts.test.ts` 的既有 dirty-worktree 内容。

## Notes
- `seal-session` 不是 receipt-backed mutation，因此其成功 envelope 的 `replay` 为 `null`；`decide`、recovery、chain 与 meta 均使用 authority receipt 的 transition ID/status。
- Commander output suppression 仅在顶层命令为 `run|session` 且 argv 显式包含 `--json` 时启用，human usage/help 行为不变。

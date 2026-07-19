# Review Core Findings 修复摘要

## Changes

- `CORR-001`：transition replay 会重算 normalized request hash 与 result hash，并交叉校验 record/payload/outcome 的 request ID、status、operation、subject、request hash 和 claimed Run；schema-valid 内容篡改统一以 `INVALID_TRANSITION_RECEIPT` fail closed。
- `CORR-002`：`complete` request 持久化 `complete-input-snapshot/1.0`，覆盖 report、declared outputs 和 extra artifacts，排除 apply 会修改的 `run.json`/`state.json` authority；operation-specific replay validator 重新读取当前字节，漂移统一返回 `FENCE_CONFLICT`。
- `CORR-003`：`accept-reuse` 纳入 `run-response/1.0` operation matrix 与 built machine CLI；canonical acceptance 强制 actor、reason 和至少一个 evidence，并绑定 normalized request 与 outcome acceptance，同时保留 request/revision/lease guards。
- `CORR-005`：`mutations` 不再声明误导性的 `--json`，传入该 flag 会由 Commander 明确拒绝，不再出现空 stdout 的 silent success。
- Parity gate 现在同时核对 `accept-reuse` schema operation 和真实 Commander command 的 `--json` option；中英文 CLI/架构/结构文档已同步。

## Verification

- [x] Schema-valid receipt 内容篡改：tampered record/payload/outcome tests 返回 `INVALID_TRANSITION_RECEIPT`。
- [x] Complete replay 输入漂移：report、declared output、extra artifact 和 deleted extra artifact tests 返回 `FENCE_CONFLICT`。
- [x] Accept-reuse machine contract：built child success/usage tests 验证单行 stdout、空 stderr、process/envelope exit parity。
- [x] Mutations JSON 边界：built child test 验证 `--json` 被明确拒绝。
- [x] Parity gate：15 项全部通过，包含真实 Commander `accept-reuse --json` 静态检查。

## Tests

- [x] `npm run build`：通过。
- [x] `npx vitest run src/commands/run-machine.test.ts src/run/reuse-acceptance.test.ts src/run/transition-receipts.test.ts src/run/complete-verdict.test.ts scripts/__tests__/session-run-contract-parity.test.mjs`：5 个文件，59 个测试全部通过。
- [x] `npm run check:session-run-contract-parity`：15/15 通过。
- [x] `npx tsc --noEmit`：通过。
- [x] `git diff --check`：通过。

## Deviations

- 无。受保护的 untracked `docs/session-run-architecture.md` 未读取、未修改、未暂存。

## Notes

- `complete` 的通用 receipt 层保持无文件 I/O；字节重验由 runtime 注入的 operation-specific validator 完成。

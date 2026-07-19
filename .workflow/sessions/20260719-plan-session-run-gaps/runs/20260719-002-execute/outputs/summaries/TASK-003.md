# TASK-003: Apply transition receipts to retryable mutations

## Changes
- `src/run/protocol-schemas.ts`, `src/run/transition-receipts.ts`: 扩展 retryable operation，新增共享 `TransitionMutationOptions`、revision fence、request replay 与 receipt metadata helpers。
- `src/run/chain-admin.ts`: chain insert/replace/skip 与 meta update 改为单次 `replayOrApplyTransition()`，authority 与 receipt 同 batch，重放不再重复 step/revision。
- `src/run/decide.ts`: decision authority 与 projection record 同 receipt 提交；`decisions.ndjson` 改为按 `transition_id` 去重的可修复 projection。
- `src/run/runtime.ts`: required consume gate 只认当前 Run 实际 `input.consumes`；complete 使用锁外 prepared hashes、锁内重验和单 StoreTransaction；新增精确 REVIEW acceptance authority 与 revalidation。
- `src/commands/session.ts`, `src/commands/run.ts`: chain/meta/decide/complete 暴露 request/revision/lease flags；新增 canonical `maestro run accept-reuse`。
- `src/run/*test.ts`: 覆盖 operation matrix、fix/meta/decision/complete replay、projection repair、write rollback、hash drift、single-lock、required/optional consume 与 explicit REVIEW acceptance。
- 当前 Execute Run：通过 `maestro run accept-reuse` 将 `ART-001-004` 正式写入 `run.input.consumes`，acceptance receipt 首次 `applied`、同 request 重放为 `replayed`；assessment 仍保持 `REVIEW`。

## Verification
- [x] transition operation literals 包含 `chain-insert|chain-replace|chain-skip|meta-update|decide|complete|accept-reuse`。
- [x] `applyChainMutation`、`applyMetaMutation`、`applyDecideMutation`、`applyCompleteRunMutation`、`ensureDecisionLogProjection` 均已实现并接入 public mutation。
- [x] operation apply/replay/conflict/diverged matrix：精确 focused test 退出 0。
- [x] chain insert replay：最终仅一个 `step-001-fix`，无 `step-001-fix-2`。
- [x] decision projection 首写失败后 authority/receipt 保留，replay 与显式 repair 均恢复恰一行。
- [x] complete authority + receipt 单 StoreTransaction，write fault 全回滚，prepared input drift fail closed，callback 无 nested store mutation/lock。
- [x] required consume 必须存在于 `run.input.consumes`；optional REJECT 非阻塞；精确 accepted REVIEW 可重验且不改写为 REUSE。
- [x] 当前 Execute Run `run brief`：`current-plan=ART-001-004`、assessment=`REVIEW`、`GATE-002-01=passed`。

## Tests
- [x] Plan focused suite + acceptance：6 files，95 tests passed。
- [x] 扩展相关 sweep：10 files，176 tests passed。
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npm run build`：exit 0。
- [x] `git diff --check -- <owned files>`：exit 0。

## Deviations
- Sealed Plan task JSON 保持只读，未更新其中 `status`。
- 经 orchestrator 授权，最小更新 `src/run/runtime.test.ts` 的新增 subcommand 列表，以及 `src/run/runtime-topic-reuse.test.ts` 内与 required consume fail-closed 冲突的单个既有用例。

## Notes
- Canonical acceptance request ID：`req-task-003-accept-reviewed-plan`；transition ID：`tr_143b1977-3f43-4fd4-98a5-ffaf06fc353e`。
- acceptance receipt 精确绑定 assessment hash 与完整 source fence；artifact registry 中仅存在候选不会再让 required consume gate 通过。

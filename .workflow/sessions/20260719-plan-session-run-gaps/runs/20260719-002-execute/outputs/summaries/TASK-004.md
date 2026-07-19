# TASK-004: Promote paused resolve/resume to canonical recovery

## Changes
- `src/run/session-transition.ts`: 固化两段式 paused recovery 守卫，校验非负 revision 与可选 lease triple；resolve 只处理单个目标并保持 paused，resume 在 blocker/concurrency 冲突时 fail closed，成功仅切换为 running。
- `src/run/decide.ts`: escalation 的 suggest-only pointer 明确给出 canonical resolve → resume → explicit run next 顺序。
- `src/commands/session.ts`: 移除 resolve/resume 的 deprecated admin-only 定位，改为 canonical recovery help；所有 audit/revision flags 必填，lease triple 可选且必须完整。
- `src/run/transition-receipts.test.ts`: 覆盖 resolve-keeps-paused、target isolation、replay，以及 escalated/failed/revision/lease/active Run/running step 的 resume 拒绝与无 mutation 保证。
- `src/run/next.test.ts`: 覆盖 paused Session 不参与自动选择，以及 resume 不分配 Run、只有显式 `run next` 才创建并绑定 Run。
- `src/run/decide.test.ts`, `src/commands/session-cli.test.ts`: 覆盖 canonical recovery pointer、无隐式 Run mutation、help flags 与逐项 mandatory audit guard。

## Verification
- [x] `npm run build` 退出 0；dist 来自当前 workspace。
- [x] dist CLI help assertion 退出 0；resolve/resume 无 `[DEPRECATED, ADMIN-ONLY]`，且包含 9 个 audit/revision/lease flags。
- [x] `keeps the Session paused after resolving one recovery target` 退出 0；status=paused、active_run_id=null、未触碰非目标 blocker，并可重放。
- [x] `rejects resume while blockers or concurrency guards remain` 退出 0；覆盖 7 类 blocker/guard，失败前后 Session authority deep-equal。
- [x] `allocates only after an explicit run next following resume` 退出 0；resume 后无 active Run，显式 `runNextStep()` 后才创建并绑定。
- [x] `requires every canonical recovery audit guard` 退出 0；缺少 request/actor/reason/evidence/identity revision/activity revision 任一项均为 Commander usage failure。
- [x] paused recall 排除与 complete/next 既有契约回归通过。

## Tests
- [x] `npx vitest run src/run/transition-receipts.test.ts src/run/next.test.ts src/run/decide.test.ts src/commands/session-cli.test.ts`：4 files，78 tests passed。
- [x] `npx vitest run src/run/recall.test.ts src/run/complete-verdict.test.ts`：2 files，36 tests passed。
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npm run build`：exit 0。
- [x] `git diff --check -- <owned files>`：exit 0。

## Deviations
- Sealed Plan task JSON 按调用方要求保持只读，未更新其中 `status`。
- 无代码范围偏离；`src/run/next.ts` 与 recall 实现已有正确 paused 排除守卫，因此只补回归测试，未作无必要修改。

## Notes
- resolve 与 resume 保持独立 transition receipt；重复同一 request 可安全 replay。
- resume 不清 blocker、不创建 Run、不绑定 chain step；Run allocation 仍唯一位于显式 `maestro run next`。

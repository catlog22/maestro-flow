# SessionStore Windows lock-create transient 修复

## Changes

- `src/run/store.ts`：锁文件以 `wx` 创建时，对 `EPERM`、`EACCES`、`EBUSY` 使用既有 5000 ms deadline 与 15 ms poll 进行 bounded retry；deadline 耗尽后携带 errno 和 lock path fail closed。
- `src/run/store.ts`：`EEXIST` 保持进入 stable snapshot、owner liveness 与 generation fencing；未白名单错误继续立即抛出。
- `src/run/store-durability.test.ts`：扩展精确的 lock-create fault injection，覆盖 3 种 transient-then-success、3 种 deadline exhaustion，以及非 transient `EIO` 不重试、不吞错。

## Reproduction

- 既有 fresh-source harness 失败点为日志 `round=17`，对应 deterministic seed `2127802008`；child 的 `writeFileSync(lock, { flag: 'wx' })` 收到 `EPERM` 后直接退出，继而产生 lost write。
- 修复前本地再跑同一 24×8 计划未再次触发 Windows 瞬时错误；该缺口由 deterministic injected unit tests 固化，不依赖 OS 竞争窗口碰运气。

## Verification

- [x] Transient lock-create：每个 errno 连续注入 2 次后成功进入临界区，fake clock 精确推进 30 ms，release 后无 lock residue。
- [x] Deadline exhaustion：每个 errno 在 5000..5015 ms 内 fail closed，错误包含具体 errno 与 lock path。
- [x] `EEXIST` 分支未改动，继续执行 stable snapshot、liveness 与 replacement-generation fencing。
- [x] `EIO` 立即透传，fake clock 保持 0 ms。
- [x] fresh-source stress 保持原断言：24 rounds × 8 writers，期望 192 次写入、0 child failure、0 lost write、0 residue。

## Tests

- [x] `npx vitest run src/run/store-durability.test.ts -t "lock creation"`：1 file，7 passed。
- [x] `npx vitest run src/run/store-durability.integration.test.ts -t "serializes deterministic high-frequency writers|bounds persistent Windows lock errors"`：1 file，2 passed；包含完整 24×8 stress 和 Windows 真实 5 s timeout。
- [x] `npx vitest run src/run/store-durability.test.ts`：1 file，23 passed。
- [x] `npx tsc --noEmit`：通过。
- [x] `npm run build`：通过。
- [x] `git diff --check -- <owned files>`：通过。

## Deviations

- 无。未修改 integration test 或 child fixture；现有 fresh-source stress 和压力断言保持不变。

## Notes

- Windows transient-create 分支只重试明确白名单 errno；没有将 unknown code 或其他 I/O failure 归类为 contention。

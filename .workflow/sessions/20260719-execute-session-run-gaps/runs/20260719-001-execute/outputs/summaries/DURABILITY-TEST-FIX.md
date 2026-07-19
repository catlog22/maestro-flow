# DURABILITY-TEST-FIX: 绑定 durability 子进程到当前源码

## Changes

- `src/run/store-durability.integration.test.ts`：在 suite 启动前使用仓库本地 TypeScript 编译器，将当前源码编译到 `.workflow/tmp` 下的独立临时输出；移除对仓库 `dist` 是否存在的 skip 条件，并让所有受测子进程只接收临时模块 URL。
- `src/run/store-durability.integration.test.ts`：新增 freshness 用例，先放置 stale sentinel，再验证编译覆盖、当前 `store.ts` SHA-256、临时编译产物 SHA-256，以及实际子进程模块 URL；显式断言不加载仓库 `dist/src/run/store.js`。
- `src/run/__fixtures__/session-store-crash-child.mjs`：移除固定 `dist` import；加载前校验当前源码与临时编译产物哈希，缺少构建元数据或 revision 不一致时直接失败。

## Verification

- [x] multi-process / crash / Windows durability tests 绑定当前 source revision：所有需要 `SessionStore` 的 child mode 通过隔离构建 URL 加载，并校验 source / compiled SHA-256。
- [x] 不依赖仓库已有 `dist`：固定 `dist` import、`describe.skipIf(!hasBuiltStore)`、Windows build skip 和 silent return 均已删除。
- [x] 缺少构建条件 fail closed：`beforeAll` 调用本地 `typescript/bin/tsc`；compiler error、非零退出、未 emit、stale sentinel 未覆盖、编译期间源码变化均抛错。
- [x] freshness assertion：子进程回报实际 module URL 与哈希；测试验证临时 stale 产物被覆盖且 URL 不等于仓库 `dist`。
- [x] diff boundary：`git diff --check` 通过；代码变更仅涉及 2 个 ownership 文件，未触碰 `src/run/store.ts` 或 `docs/session-run-architecture.md`。

## Tests

- [x] `npx vitest run src/run/store-durability.integration.test.ts --reporter=dot`：通过，1 个文件、11 个测试全部通过；24 轮、192 个 writer，最终 counter 192，无 child failure。
- [x] `npx vitest run src/run/store-durability.integration.test.ts -t "binds child processes to a fresh isolated build" --reporter=verbose`：在完整 `npm run build` 之后通过，证明仓库 `dist` 存在时仍使用临时 current-source build。
- [x] `npx tsc --noEmit --pretty false`：通过。
- [x] `npm run build`：通过。
- [x] `git diff --check -- src/run/store-durability.integration.test.ts src/run/__fixtures__/session-store-crash-child.mjs`：通过。

## Deviations

- None。

## Notes

- 首次完整复跑在 Windows 压力轮次 20 遇到一次产品层 `EPERM` lock-open 瞬态失败；未放宽断言，原命令再次完整复跑后 11/11 通过。该观察说明修复后的测试会暴露当前源码行为，而不会由 stale `dist` 或 skip 产生 false green。
- Finding BP-001 已关闭：durability test freshness 现在是可执行断言，不再依赖预构建仓库产物。

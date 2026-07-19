# TASK-007: Add Session/Run contract parity release gate

## Changes
- `scripts/check-session-run-contract-parity.mjs`：新增支持 `--root <path>` 的独立 release gate，以 14 个稳定 check ID 核对 writer 1.3、Wiki reader 1.0–1.3、cache v3、完整 `run-response/1.0` operation matrix、6 份 tracked canonical guides 与 package wiring；逐项输出实际值/期望值并 fail closed。
- `scripts/__tests__/session-run-contract-parity.test.mjs`：新增当前仓库正向测试，以及 writer、reader、cache、operation、docs、package 6 类独立临时 fixture 漂移矩阵；每类均断言非零退出与精确 FAIL check ID。
- `package.json`：新增 `check:session-run-contract-parity`，并把 gate 接入 `prepublishOnly` 的 build 与 build:mirrors 之前。
- `vitest.config.ts`：按 orchestrator 授权将 `scripts/**/*.test.mjs` 加入既有 root Vitest include，不改变 exclude、environment 或其他测试行为。
- `scripts/lint-invocation-policy.mjs`：按 orchestrator 对当前 command intent 的裁决，将可直接调用且可由 maestro-next 路由的 `maestro-companion` 加入 automatic allowlist，并同步稳定成功输出。
- `.codex/skills/maestro-companion/SKILL.md`：通过现有 `buildCodexSkills` 生成，再由 `sync-codex-run-mode.mjs --write --only maestro-companion` 规范化；未手写或修改 `.agy`/`.agents` mirror。

## Verification
- [x] Writer/reader/cache/operation/docs source grep：gate 源码命中 `session/1.3`、`command-run/1.3`、`SEARCH_CACHE_VERSION`、`runOperationSchema` 与 `guide/search-system-guide`。
- [x] Package wiring assertion：script 精确等于 `node scripts/check-session-run-contract-parity.mjs`，且 prepublish 包含 gate。
- [x] Current parity：14/14 稳定 check ID 均为 PASS。
- [x] Six drift dimensions：writer、reader、cache、operation、docs、package fixture 均非零退出并报告对应 check ID。
- [x] Protected-path negative scan：gate/test 中无受保护 untracked architecture doc 路径引用。
- [x] Release order：完整 prepublish 输出证明 parity gate 在 build 与 build:mirrors 前执行。
- [x] Mirror boundary：`sync-codex-run-mode.mjs --write --only maestro-companion` 后，`.agy`/`.agents` 无 tracked 变更，mirror lint 通过。

## Tests
- [x] `npm run check:session-run-contract-parity`：14 checks passed。
- [x] `npx vitest run scripts/__tests__/session-run-contract-parity.test.mjs -t "fails each independent Session Run contract drift dimension"`：1 passed，1 skipped。
- [x] `npx vitest run scripts/__tests__/session-run-contract-parity.test.mjs`：2/2 passed。
- [x] `npx tsc --noEmit`：exit 0。
- [x] `npm run lint:invocation-policy`：exit 0。
- [x] `npm run prepublishOnly`：exit 0；prompt/docs/parity/build/mirror 全链通过。
- [x] `git diff --check -- <TASK-007 files>`：exit 0。

## Deviations
- 原 task focus 仅列 gate、test、package；root Vitest include 排除了计划指定的 `.mjs` test。经 orchestrator 明确授权，最小修改 `vitest.config.ts`。
- 完整 prepublish 先暴露当前 HEAD 的 invocation allowlist 与 Codex companion mirror 漂移。经 orchestrator 分两次明确授权，最小更新 `scripts/lint-invocation-policy.mjs` 并由 canonical converter 生成唯一缺失的 `.codex/skills/maestro-companion/SKILL.md`，未改 companion command 或其他 mirror。
- Sealed Plan task JSON 按调用方要求保持只读，未更新其中顶层 `status`。

## Notes
- Gate 只读取明确列出的 source-of-truth 与 tracked `guide/` files，不扫描历史 plan/checklist 或受保护的 untracked doc。
- 共享工作树中的 `src/run/artifacts.ts`、`src/run/artifacts.test.ts`、`src/run/runtime.ts`、`src/run/protocol-schemas.ts` 与 untracked architecture doc 均未修改、回退或纳入本任务暂存。

# Review Round 2 Fixes

## Changes

- `src/run/artifacts.ts`：将 artifact 文件读取改为 `openSync` + `fstatSync` identity 校验；在读取前后重新执行 `lstatSync` / `realpathSync` containment 校验。JSON、Markdown、hash 和 size 均使用同一个已验证 `Buffer`，不再按 path 重开文件。目录遍历在列举前后及递归完成后重新验证目录 identity。
- `src/run/artifacts.test.ts`：新增确定性 TOCTOU 回归，在检查后、读取前将内部普通文件原子替换为外部 symlink；覆盖直接文件和目录 artifact，均 fail closed 且不注册外部字节。
- `scripts/check-session-run-release-machine.mjs`：新增 build-backed release smoke，通过真实 child process 验证 `accept-reuse` applied/replayed、Commander usage envelope，以及 `mutations --json` rejection 的 stdout/stderr/exit parity。
- `package.json`：新增 `check:session-run-release-machine`，并将其接入 `prepublishOnly` 的 `build` 后、`build:mirrors` 前。
- `scripts/check-session-run-contract-parity.mjs`：parity gate 现在同时验证 `acceptRunReuse` business handler、machine success/error handler、release smoke 覆盖和 package wiring/order，不再只检查 `.option('--json')`。
- `scripts/__tests__/session-run-contract-parity.test.mjs`：新增失效 business handler、release smoke 漂移、package command 与 ordering 漂移回归。
- `src/commands/run-machine.test.ts`：收紧 `mutations --json` 的 exit/stderr 断言，并执行 build-backed release machine smoke。

## Verification

- [x] CORR-004-R1：安全读取使用 fd/fstat identity，并在读取前后验证 path identity、realpath containment；解析与 hash 共用同一 Buffer。
- [x] CORR-004-R1：目录递归在 entry listing 前后和递归完成后重新验证 identity；nested file 使用同一安全读取链。
- [x] CORR-004-R1：deterministic swap 回归 fail closed，artifact 列表为空且 expected output 保持 blocking warning。
- [x] CORR-003-R1：release smoke 在 build 产物上真实执行 `accept-reuse` applied/replayed/usage 与 `mutations --json` rejection。
- [x] CORR-003-R1：parity gate 验证 business/success/error handler 及 `check parity -> build -> release machine -> build:mirrors` 顺序。

## Tests

- [x] `npx vitest run src/run/artifacts.test.ts`：11/11 passed。
- [x] `npx vitest run scripts/__tests__/session-run-contract-parity.test.mjs`：2/2 passed（包含 11 个独立 drift mutation case）。
- [x] `npm run check:session-run-contract-parity`：17 checks passed。
- [x] `npm run build`：passed。
- [x] `npm run check:session-run-release-machine`：passed。
- [x] `npx vitest run src/commands/run-machine.test.ts src/run/reuse-acceptance.test.ts`：15/15 passed。
- [x] `npx vitest run src/run/artifacts.test.ts src/run/runtime.test.ts src/run/complete-verdict.test.ts`：77/77 passed。
- [x] prepublish prefix through build/machine：invocation policy、prompt lint、docs reference、contract parity、build、release machine 全部 passed。

## Deviations

- 未执行 `build:mirrors`：该命令包含对 `.codex` / `.agy` / `.agents` mirrors 的写操作，而共享工作树这些路径存在他人未提交改动，超出本任务 ownership。package parity gate 已验证它位于 release machine smoke 之后；未修改、暂存或回退任何 mirror 文件。

## Notes

- `src/run/runtime.ts` 与 `src/run/complete-verdict.test.ts` 无需修改。
- 仅本 summary 与指定 ownership 文件应进入本任务 commit。

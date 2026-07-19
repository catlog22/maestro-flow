# Review Round 2 Fixes

## Changes

- `src/run/artifacts.ts`：artifact 文件读取改为 `openSync` + `fstatSync` identity 校验；读取前后重验 `lstatSync` / `realpathSync` containment。JSON、Markdown、hash 与 size 共用同一个已验证 `Buffer`。
- `src/run/artifacts.test.ts`：新增确定性 TOCTOU 回归，在检查后、读取前把内部普通文件原子替换为外部 symlink；直接文件和目录 artifact 均 fail closed。
- `scripts/check-session-run-release-machine.mjs`：用真实 child process 验证 `accept-reuse` applied/replayed、Commander usage envelope，以及 `mutations --json` rejection 的 stdout/stderr/exit parity。
- `package.json`：新增 `check:session-run-release-machine`，并接入 `prepublishOnly` 的 build 后、`build:mirrors` 前。
- Contract parity gate 同时验证 business/success/error handler、release smoke 覆盖和 package wiring/order。

## Verification

- [x] Artifact 安全读取使用 fd/fstat identity，并在读取前后验证 path identity 与 realpath containment。
- [x] Directory recursion 在 listing 前后与递归完成后重新验证 identity。
- [x] Deterministic swap 回归 fail closed，外部字节未注册。
- [x] Release smoke 在当前 build 上执行 accept-reuse applied/replayed/usage 与 mutations rejection。
- [x] Parity gate 验证 `check parity -> build -> release machine -> build:mirrors` 顺序。

## Tests

- [x] Artifact/runtime tests：77/77 passed。
- [x] Machine/reuse tests：15/15 passed。
- [x] Parity drift tests：2/2 passed。
- [x] Parity gate：17/17 passed。
- [x] Build 与 release machine smoke passed。

## Notes

- 本摘要属于当前 Execute Run；旧失败 Run 保持不变。
- `build:mirrors` 留待共享 mirror 工作树稳定后执行，未覆盖他人改动。

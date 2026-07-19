# TASK-008: Bootstrap declared output path template scanning

## Changes

- `src/run/artifacts.ts`: 保留 `outputs/tasks/TASK-{NNN}.json` template 递归发现，并增加 `lstat`、`realpath` 与 canonical `outputsDir` containment 校验；拒绝 symlink、Windows junction／reparse alias 和越界候选，只注册实际匹配 declared template 的文件。
- `src/run/artifacts.ts`: 普通 collection hashing 同样跳过 link／reparse alias，避免读取目录边界之外的文件；缺失 required template 继续产生 blocking warning。
- `src/run/artifacts.test.ts`: 增加跨平台 nested directory symlink 回归测试（Windows 无创建权限时仅对 `EPERM`／`EACCES` 明确降级）以及 Windows junction 可执行测试。

## Verification

- [x] Template scanner 逐文件注册 `TASK-001.json`／`TASK-002.json`：focused suite 通过。
- [x] Symlink／junction 外部文件未被扫描或注册：跨平台 symlink 与 Windows junction 测试通过，结果保持 `artifacts=[]`、`errors=[]`。
- [x] 缺失 required template 保持 blocking：warning 精确为 `Expected outputs/tasks/TASK-{NNN}.json was not produced`。
- [x] CORR-004 已关闭：候选的每一路径段都经过 link 拒绝、canonical path 等值与 outputs containment 校验。

## Tests

- [x] `npx vitest run src/run/artifacts.test.ts`: 9/9 passed。
- [x] `npx vitest run src/run/artifacts.test.ts -t "declared path templates|nested directory symlink|Windows junction|missing declared path template"`: 4 passed，5 skipped（未匹配 filter）。
- [x] `npx tsc --noEmit`: exit 0。
- [x] `npm run build`: exit 0。
- [x] `git diff --check -- src/run/artifacts.ts src/run/artifacts.test.ts`: exit 0（仅 Git 的 LF→CRLF 提示）。

## Deviations

- None。

## Notes

- Caller 限定 ownership 为 scanner 两个源文件与本 summary；已完成的 TASK-008 JSON 未改动。
- 工作区既有 `docs/session-run-architecture.md` 未跟踪文件未触碰、未 stage。

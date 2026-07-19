# TASK-008: Bootstrap declared output path template scanning

## Changes

- `src/run/artifacts.ts`: 保留 `outputs/tasks/TASK-{NNN}.json` template 递归发现，并增加 `lstat`、`realpath` 与 canonical `outputsDir` containment 校验；拒绝 symlink、Windows junction／reparse alias 和越界候选，只注册实际匹配 declared template 的文件。
- `src/run/artifacts.ts`: 普通 collection hashing 同样跳过 link／reparse alias，避免读取目录边界之外的文件；缺失 required template 继续产生 blocking warning。
- `src/run/artifacts.test.ts`: 增加跨平台 nested directory symlink 回归测试（Windows 无创建权限时仅对 `EPERM`／`EACCES` 明确降级）以及 Windows junction 可执行测试。

## Verification

- [x] Template scanner 逐文件注册 `TASK-001.json`／`TASK-002.json`。
- [x] Symlink／junction 外部文件未被扫描或注册。
- [x] 缺失 required template 保持 blocking。
- [x] CORR-004 已关闭：候选的每一路径段都经过 link 拒绝、canonical path 等值与 outputs containment 校验。

## Tests

- [x] `npx vitest run src/run/artifacts.test.ts`: 9/9 passed。
- [x] Scanner focused cases: 4 passed。
- [x] `npx tsc --noEmit`: exit 0。
- [x] `npm run build`: exit 0。

## Notes

- Sealed Plan artifacts 保持只读；本摘要属于当前 Execute Run。

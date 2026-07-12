# Session/Run 全量迁移

## 1. Requirement & Criteria

目标：以 `guide/session-run-structure-guide.md` 为目标模型，在当前项目内完成 Session → Run → Artifact 的可运行迁移，而非仅替换 prompt 文本。

已确认范围：

- 实现 `maestro run create/check/complete`、SessionStore、Artifact Runtime 与 legacy shim。
- 审计全部 68 个 command，迁移所有会话/产物写入型 command，并新增独立 verify Run。
- 同步迁移 commands 引用的项目 `workflows/`。
- 审计全部 45 个 skill，迁移其中 28 个有状态 skill。
- 优化 Maestro Search，使其增量索引 sealed/archived Session 与 typed artifacts，避免 draft、临时目录和投影重复。
- 通过 lint、typecheck、单元/集成测试与端到端 pilot 验收。

验收标准为 `session.json.acceptance_criteria` 中 AC1–AC7，用户已选择“全量迁移”。

## 2. Plan

待 S_PLAN 填写。

## 3. Execution

待 S_EXECUTE 填写。

## 4. Verification

待 S_VERIFY 填写。

## 5. Fix Log

待 S_FIX 填写。

## 6. Generalization

待 S_GENERALIZE 填写。

## 7. Discoveries

待 S_DISCOVER 填写。

## 8. Learnings

待 S_RECORD 填写。

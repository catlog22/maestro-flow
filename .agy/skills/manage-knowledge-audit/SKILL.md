---
name: manage-knowledge-audit
description: Audit and prune knowledge across spec / knowhow / artifact stores
argument-hint: --scope <spec|knowhow|artifact|all> [--level P0|P1|P2] [--timeline T1..T6] [--since YYYY-MM-DD] [--milestone <name>] [--include-archive] [--interactive] [--mark|--delete|--purge] [--dry-run] [--report]
allowed-tools:
  - ask_question
  - define_subagent
  - grep_search
  - invoke_subagent
  - manage_subagents
  - replace_file_content
  - run_command
  - send_message
  - view_file
  - write_to_file
---
<purpose>
对称于 `manage-harvest`（写入入口）的知识淘汰入口。harvest 负责把 artifact 抽取为 spec/wiki/issue；audit 负责审查这三大存储中已积累的条目，识别矛盾、失效、老化、孤儿，并通过 keep/deprecate/delete 三态决策清理。

覆盖 8 大场景类、28 子场景（显性/隐性矛盾、失效老化、元数据质量、Maestro 特化、时间线产物 T1-T6、knowhow 漂移、artifact 残留），定义见 workflow knowledge-audit.md。

**闭环**：harvest 写入 → audit 审查 → 三态淘汰；与 `harvest --prune`（物理 GC）互补：audit 做语义层判定，且删除未抽取的 artifact 前反向触发 harvest 抢救。
</purpose>

<required_reading>
@~/.maestro/workflows/knowledge-audit.md
</required_reading>

<deferred_reading>
- @~/.maestro/workflows/harvest.md (audit 检测的 artifact 是 harvest 的产物源)
- @~/.maestro/workflows/specs-add.md (deprecate 操作所需的 `<spec-entry>` 变形)
</deferred_reading>

<context>
Arguments: $ARGUMENTS

**Scope（必选）：** `spec` | `knowhow` | `artifact` | `all`

**删除策略**默认 `--interactive`（三态面板逐项决策）；非交互模式 `--mark`（仅打标）/ `--delete`（软删到 `.trash/`）/ `--purge`（物理擦除，仅 artifact 且需双重确认）。

Flag 全集、scope 对应的扫描路径、Stage 步骤、检测算法定义在 workflow knowledge-audit.md。
</context>

<execution>
Follow `~/.maestro/workflows/knowledge-audit.md` Stages 1-8 in order.

**Key invariants:**
1. **Backup before mutate** — Stage 6 必须把待变更文件打包到 `.workflow/.trash/knowledge-audit-{timestamp}/`，备份失败禁止 Stage 7。
2. **Deprecate over delete** — 文本存储（spec/knowhow）首选注入 `status="deprecated"` 保留历史；只有 artifact 物理残留才走 delete/purge。
3. **Purge requires double confirmation** — `--purge` 仅作用于 artifact scope，且 Stage 5 必须显式 `[y/N]` 二次确认 + 输入 artifact id。
4. **Rescue before delete** — 删除未抽取的 artifact 前（`harvest-log.jsonl` 无记录），强制提示 "是否先 `/manage-harvest`？"。

Scope 路径、8 类检测算法、三态决策面板、报告 schema 定义在 workflow knowledge-audit.md。

**Next-step routing on completion:**
- 复审淘汰记录 → `.workflow/.knowledge-audit/audit-report-{date}.md`
- 抢救未抽取 artifact → `/manage-harvest <artifact-id>`
- 验证 spec 现状 → `/spec-load --role implement`
- 周期巡检 → 每 milestone 结束跑 `--scope all --report`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/` 未初始化 | 先跑 `/maestro-init` |
| E002 | error | `--scope` 缺失或非法 | 提供 spec/knowhow/artifact/all |
| E003 | error | `--purge` 与 `--dry-run` 同用 | 二选一 |
| E004 | error | `--purge` 作用于非 artifact 范围 | purge 仅支持 artifact scope |
| E005 | error | 备份失败（`.trash/` 写入异常） | 检查磁盘空间与权限，重试 |
| W001 | warning | 检出冲突但用户选择 keep | 记入 report，不阻断 |
| W002 | warning | 待删 artifact 无 harvest-log 记录 | 提示先跑 manage-harvest |
| W003 | warning | 循环 supersedes 链 | 自动断环或交互选保留节点 |
| W004 | warning | 检测耗时 >120s（大规模 spec 库） | 建议加 `--scope` 收敛或 `--since` 增量 |
| W005 | warning | LLM detector 不可用 | 降级到正则+图算法子集，跳过 B/G 类语义场景 |
</error_codes>

<success_criteria>
- [ ] Scope 正确解析，互斥标志校验通过
- [ ] 三存储按 scope 加载完成，构建出统一 finding 池
- [ ] Stage 3 时间线索引建立（mtime ↔ session/milestone 状态）
- [ ] Stage 4 按 P0/P1/P2 输出 finding 列表
- [ ] 如非 `--report`：用户对每项做出三态决策
- [ ] 未 harvest 的 artifact 删除前触发抢救确认
- [ ] Stage 6 backup tarball 生成于 `.workflow/.trash/`
- [ ] `deprecate` 通过元数据注入完成（spec/knowhow 文件未被物理删除）
- [ ] `delete` 移动至 `.trash/`，索引同步更新
- [ ] `purge` 仅在双重确认通过后执行
- [ ] `audit-report-{date}.md` + `audit-log.jsonl` 写入完成
- [ ] 摘要展示三存储变更计数与下一步路由
</success_criteria>

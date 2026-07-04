# Knowledge Audit Workflow

---

## Prerequisites

- `.workflow/` 已初始化（`.workflow/state.json` 存在）
- 至少一个目标存储有内容：
  - `spec`: `.workflow/specs/*.md` 含 `<spec-entry>`
  - `knowhow`: `maestro wiki list` 非空
  - `artifact`: `.workflow/.{analysis,brainstorm,debug,lite-plan,lite-fix}/` 或 `state.json.artifacts[]` 非空
- 推荐：`harvest-log.jsonl` 存在（用于追溯 artifact 是否已抽取）

---

## Argument Shape

```
/manage-knowledge-audit --scope all                       → 全量审查三存储（交互式）
/manage-knowledge-audit --scope spec --level P0           → 仅扫 spec 的 P0 问题
/manage-knowledge-audit --scope artifact --timeline T2,T3 → 仅查 milestone 失效与时间倒挂
/manage-knowledge-audit --scope all --since 2026-03-01    → 增量审查
/manage-knowledge-audit --scope spec --milestone M2       → 限定 milestone 上下文
/manage-knowledge-audit --scope all --report              → 仅出报告不动盘
/manage-knowledge-audit --scope all --dry-run             → 完整预演含交互
/manage-knowledge-audit --scope artifact --purge          → 物理擦除（需双重确认）
```

| Flag | Effect |
|------|--------|
| `--scope <type>` | **必选** spec / knowhow / artifact / all |
| `--level <P0\|P1\|P2>` | 仅展示该优先级（默认 all）|
| `--timeline <T1..T6>` | 仅运行指定时间线检测（逗号分隔）|
| `--since <YYYY-MM-DD>` | 仅审查该日期后修改的条目（增量模式）|
| `--milestone <name>` | 限定到某 milestone 上下文 |
| `--include-archive` | 把 `artifact_archive[]` 也纳入扫描 |
| `--interactive` | 三态决策交互（默认开启，除非 `--report`）|
| `--mark` | 非交互：仅注入 warning 标记，不删 |
| `--delete` | 非交互：自动软删（移 `.trash/`）|
| `--purge` | **危险** 物理擦除 artifact，需 `[y/N]` 二次确认 |
| `--dry-run` | 全流程预演，不写盘 |
| `--report` | 仅生成报告到 `.workflow/.knowledge-audit/` |

互斥规则：`--purge` 不可与 `--dry-run` 同用；`--purge` 仅对 `--scope artifact|all` 生效。

---

## Stage 1: parse_input

```
验证 .workflow/ 存在（否则 E001）。解析参数：
  scope: spec | knowhow | artifact | all （E002 若缺失/非法）
  level: P0 | P1 | P2 | all（默认 all）
  mode: interactive（默认）| mark | delete | purge | dry-run | report
  filters: timeline[], since, milestone, include_archive

互斥校验：
  --purge + --dry-run → E003
  --purge + scope != artifact|all → E004
  --report → 强制覆盖 mode 为 read-only
初始化 .workflow/.knowledge-audit/ 目录。
```

---

## Stage 2: load_three_stores

按 scope 加载，建立统一对象池：

### 2a. Spec 加载

```
glob .workflow/specs/*.md
解析每个 <spec-entry category=... keywords=... date=... [id=...] [status=...] [supersedes=...]> 块
→ SpecEntry { id?, file, line, category, keywords[], date, status?, supersedes?, content }
```

未来 schema 升级后 `id` / `status` / `supersedes` 为一等字段；当前未升级时按 `hash(file+title+date)` 生成 fallback id。

### 2b. Knowhow 加载

```
maestro wiki list --json → entries[]
读 .workflow/knowhow/*.md → 解析 frontmatter
合并: KnowhowEntry { slug, type, title, tags[], created_at, last_accessed?, content, code_refs[] }
```

### 2c. Artifact 加载

```
读 .workflow/state.json → artifacts[], artifact_archive[](若 --include-archive), milestones[]
glob .workflow/.{analysis,brainstorm,debug,lite-plan,lite-fix}/*/
合并: Artifact { id, type, path, milestone?, created_at, completed_at?, mtime, harvested? }
harvested 通过 join .workflow/harvest/harvest-log.jsonl 的 source_id 字段确定
```

### 2d. since/milestone 过滤

应用 `--since` 与 `--milestone` 收敛集合。

---

## Stage 3: build_timeline_index

```
read state.json.milestones[] → { id: {status: active|completed|abandoned, started_at, ended_at?} }
for each entry (spec / knowhow / artifact):
  age = today - entry.date_or_mtime
  enclosing_milestone = find_milestone_at(entry.date_or_mtime)
  enclosing_status = milestones[enclosing_milestone].status
  // 用于 F 类（时间线）检测
build supersedes_graph: SpecEntry.supersedes → 有向图
build reverse_ref_graph: artifact ← session/spec/wiki 引用反向边
```

---

## Stage 4: scenario_detection

**并行运行 8 类 detector，按优先级聚合 `AuditFinding[]`。**

### A. 显性矛盾（Spec）

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 行为禁忌冲突 | 同 keywords 簇内 LLM 极性对比（MUST DO vs MUST NOT） | P0 |
| 阈值冲突 | 正则抽数值 + 关键词聚类，比较区间是否冲突 | P0 |
| 命名规范冲突 | LLM 聚类 "naming convention" 规则查异 | P1 |

### B. 隐性矛盾（Spec）

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 跨域权衡 | 抽 security/debug/perf 关键词，交叉对抗推理 | P1 |
| 全局 vs 局部 | arch 文件规则 vs coding 局部规则的范围检测 | P1 |
| 传递性死锁 | 构建前置/后置条件图，检测环路 | P0 |
| 错误处理分歧 | 提取 throw/Result/Either 策略一致性 | P1 |

### C. 失效老化（Spec / Knowhow）

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 幽灵代码引用 | 抽 spec/knowhow 中的代码路径，`fs.exists` 校验 | P0 |
| 依赖版本过期 | 抽提及的库名，对照 `package.json`，LLM 判失效 | P1 |
| 外部配置违背 | 对照 `tsconfig.json` / `.eslintrc` / `biome.json` | P2 |
| 静默推翻 | date 排序找出未标 supersedes 的相反条目 | P0 |

### D. 元数据质量（Spec / Knowhow）

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 标签错位 | LLM 评估 keywords 与正文语义相关度 | P2 |
| 分类错位 | 内容 vs 文件归属语义判定 | P2 |
| 假规范 | LLM 评估是否可转化为具体 check（actionable）| P2 |
| 悬空 supersedes | 图遍历，目标 ID 不存在 | P0 |
| 循环 supersedes | DFS 检测环 | P0 |
| 状态倒挂 | active 条目依赖 deprecated 条目 | P1 |

### E. Maestro 特化（Spec）

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 项目宪法背离 | 加载 `workflows/impeccable/PRODUCT.md` 作真理对照 | P0 |
| TUI 原则碰撞 | 检测 "鼠标/hover" 等违反 keyboard sovereignty 的关键词 | P1 |
| 标签碎片化 | 统计 keywords 频次为 1 的孤儿标签 | P2 |

### F. 时间线产物（Artifact）

| 子类型 | 触发条件 | 检测算法 | 优先级 |
|---|---|---|---|
| **T1 时间陈旧** | artifact.mtime > 90 天 且 harvested | mtime + harvest-log join | P1 |
| **T2 milestone 失效** | enclosing_milestone.status ∈ {abandoned, superseded} | state.json 时间线交叉 | P0 |
| **T3 时间倒挂** | artifact.mtime > parent_session.ended_at | session 元数据对比 | P1 |
| **T4 孤儿** | reverse_ref_graph 无入边，且 harvest-log 无记录 | 反向引用集为空 | P1 |
| **T5 跨 milestone 漂移** | 同主题 artifact 在 M1/M2/M3 都有，无 supersedes 链 | keywords 聚类 + date 排序 | P2 |
| **T6 archive 派生** | source_ref ∈ artifact_archive[] | join state.json.archive | P1 |

### G. Knowhow 特有

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| wiki 引用代码不存在 | 抽 code_refs，磁盘校验 | P1 |
| 与新 spec 矛盾 | 向量相似 >0.85 后 LLM 矛盾判定 | P0 |
| 长期无访问冷门 | last_accessed > 90 天 | P2 |
| digest 漂移 | digest.created_at < 引用的原始 entry.mtime | P1 |

### H. Artifact 特有

| 子类型 | 检测算法 | 优先级 |
|---|---|---|
| 已 graduate 但磁盘残留 | state.json.artifact_archive[].path 在磁盘仍存在 | P1 |
| milestone abandoned 未清 | milestone.status=abandoned 且 artifact 未归档 | P0 |
| 长期未引且无 harvest | T4 子集，age > 180 天 | P1 |
| accumulated_context 重复 spec | state.json.accumulated_context vs spec 语义查重 >70% | P2 |

每个 detector 返回：
```
AuditFinding {
  id: "AUD-{8 hex}",
  store: "spec" | "knowhow" | "artifact",
  category: "A" | "B" | ... | "H",
  subtype: string,
  priority: "P0" | "P1" | "P2",
  target: { file, line?, entry_id? },
  evidence: string,
  recommended_action: "keep" | "deprecate" | "delete" | "purge",
  related_findings: [ids],
}
```

按 P0 → P1 → P2 排序，过滤 `--level`。

---

## Stage 5: interactive_triage

若 `--report` → 跳过。
若 `--mark|--delete|--purge` → 非交互应用 recommended_action。
否则按 finding 顺序展示三态面板：

```
[!] Conflict Detected (P0 - Ghost Code Reference)
Store:    spec
Location: .workflow/specs/coding-conventions.md:42
Evidence: References non-existent file 'src/auth/legacy-token.ts'
Recommendation: [d]eprecate

Action?  [k]eep / [d]eprecate / [D]elete / [s]kip / [a]ll-keep / [q]uit
> _
```

**子分支拦截：**

| 条件 | 二次确认 |
|---|---|
| `[D]elete` 一个 artifact 且 harvest-log 无该 artifact | `This artifact has NO harvest records. Run /manage-harvest first? [Y/n]` |
| `--purge` 任意 artifact | `WARNING: --purge will permanently destroy {path} from disk. Type the artifact id to confirm:` |
| `[D]elete` 一个被其他 spec `supersedes` 引用的条目 | `This spec is referenced by N supersedes chains. Deleting will dangle them. Continue? [y/N]` |

`[a]ll-keep` 仅作用于当前 finding 的 subtype（不跨子类型）。

---

## Stage 6: backup

```
mkdir .workflow/.trash/knowledge-audit-{ISO_timestamp}/
for finding in actionable_findings:
  cp target.file → .trash/{timestamp}/{original_relative_path}
也备份 state.json → .trash/{timestamp}/state.json.bak
若任一备份失败 → E005，禁止 Stage 7
```

---

## Stage 7: apply_actions

| Action | 实施 |
|---|---|
| `keep` | 写 `audit-log.jsonl` 一条 ignore 记录（防止下次重复 flag）|
| `supersede` (spec) | `maestro spec supersede <old-sid> --by <new-sid>`（双向链接 + deprecated，保留演化链） |
| `deprecate` (spec) | Edit 目标文件，把 `<spec-entry ...>` 改为 `<spec-entry ... status="deprecated">`（无替代条目时） |
| `deprecate` (knowhow) | `maestro wiki edit <slug>` 注入 `status: deprecated` frontmatter |
| `deprecate` (artifact) | 更新 state.json.artifacts[].status = "deprecated" |
| `delete` (spec) | Edit 移除整个 `<spec-entry>` 块 |
| `delete` (knowhow) | `maestro wiki delete <slug>` |
| `delete` (artifact) | mv artifact_dir → `.workflow/.trash/{timestamp}/` + state.json 移入 `artifact_archive[]` |
| `purge` (artifact only) | `rm -rf` 物理路径 + state.json 完全移除条目 |

**变更 state.json 时**：先写 `state.json.backup-audit-{timestamp}`，再写新版本，re-read 验证 artifacts 计数符合预期。

---

## Stage 8: report

写 `.workflow/.knowledge-audit/audit-report-{date}.md`：

```markdown
# Knowledge Audit Report — {date}

## Scope
- Scope: {spec|knowhow|artifact|all}
- Filters: {level, timeline, since, milestone}

## Detection Summary
- Total findings: {N}  ({P0_count} P0 / {P1_count} P1 / {P2_count} P2)
- By store: spec {N} / knowhow {N} / artifact {N}
- By category: A{N} B{N} C{N} D{N} E{N} F{N} G{N} H{N}

## Actions Applied
| # | Store | Category | Subtype | Target | Action | Status |
|---|-------|----------|---------|--------|--------|--------|
| 1 | spec  | C-ghost  | code-ref| coding-conventions.md:42 | deprecate | OK |
| 2 | artifact | F-T2  | milestone-dead | .workflow/.analysis/ANL-003/ | delete | OK |

## Skipped (kept by user)
| Finding | Reason |
|---------|--------|
| AUD-abc | User chose keep — marked as ignored |

## Backup
- Tarball: .workflow/.trash/knowledge-audit-{timestamp}/
- state.json backup: state.json.backup-audit-{timestamp}
```

同时追加结构化条目到 `.workflow/.knowledge-audit/audit-log.jsonl`：

```json
{
  "audit_id": "AUD-{timestamp}",
  "finding_id": "AUD-{8 hex}",
  "store": "spec",
  "category": "C",
  "subtype": "ghost-code-ref",
  "priority": "P0",
  "target": {"file": "...", "line": 42, "entry_id": "..."},
  "action": "deprecate",
  "applied_at": "<ISO>",
  "backup_path": "..."
}
```

显示摘要：

```
=== AUDIT COMPLETE ===
Scope: all

  Findings:  28 total (5 P0 / 12 P1 / 11 P2)
  Spec:      8 deprecated, 2 deleted, 3 kept
  Knowhow:   4 deprecated, 1 deleted, 2 kept
  Artifact:  3 deleted (2 to .trash, 1 purged), 5 kept

  Report:  .workflow/.knowledge-audit/audit-report-2026-05-22.md
  Backup:  .workflow/.trash/knowledge-audit-20260522T154500/

Next:
  → 抢救未抽取 artifact:   /manage-harvest <ids>
  → 验证现状:              /spec-load --role implement
  → 复审 wiki 状态:        maestro wiki list --status deprecated
  → 周期巡检 (建议):       milestone 结束时跑 --scope all --report
```

---

### Safety invariants

1. **Deprecate over delete** — 文本存储默认注入 `status=deprecated` 而非物理移除，保留历史上下文
2. **Backup before mutate** — Stage 6 失败则禁止 Stage 7；state.json 原子写（备份 → 写新 → re-read 校验）
3. **Purge restricted** — `--purge` 仅限 artifact scope；spec/knowhow 永不物理删除（最多 delete 到 `.trash/`）
4. **Double confirmation** — `--purge` 需 flag + 交互输入 artifact id 双重确认
5. **Rescue before delete** — 删 artifact 前若 harvest-log 无记录，强制提示先跑 `/manage-harvest`
6. **No dedup re-run** — audit 不做"是否重复"判断（harvest 负责），只做"是否矛盾/失效/老化"
7. **Graceful degradation** — LLM detector 不可用时跳过 B/G 类语义场景，A/D/F 类正则+图算法仍可执行; Stage 8 报告加 partial_audit: true, skipped: [B,G] 并标 [LOW CONFIDENCE]
8. **Idempotent** — 同一存储状态下重跑 `--dry-run` 必须输出一致的 finding 集

# 知识系统缺口交叉分析报告

> 2026-07-17 · 3 agent 交叉分析（架构设计 / 知识演化 / search 检索链路）+ 主线抽检复核
> 全部缺口带 file:line 证据；双命中项经多 agent 独立发现，抽检项经主线 grep/运行时复核。

## 总评

Wiki 检索侧（BM25F + embedding + daemon + time-decay）和 spec 演化模型（sid/supersede/contested/health）设计成熟、实现质量较高。系统性风险集中在四处：

1. **spec 条目身份四分五裂** — sid 造出来了，但索引/KG/credibility 都不用它（X2）
2. **生命周期是 spec-only、project-scope-only 的特权** — knowhow 的废弃在索引层是 no-op（G-B3/G-B6）
3. **多条注入/检索通道行为不一致** — deprecated 泄漏、embedding 开启反而杀死 spec 注入（X1/G-C2）
4. **KG 关系层建了骨架没通血管** — 19,782 个代码节点、0 条代码边，两个千行模块是死代码（G-A1）

---

## 一、交叉验证双命中项（最高置信）

| # | 发现 | 证据 | 命中来源 |
|---|------|------|----------|
| X1 | **keyword 注入通道泄漏 deprecated 条目** — `spec-keyword-index.ts` 完全不看 status（`IndexedEntry` 无 status 字段），已被 supersede 的旧规则仍经 UserPromptSubmit hook 注入，击穿 supersede 的核心承诺"旧条目 search/load 排除" | `src/tools/spec-keyword-index.ts:19-90`（无 status）vs `src/tools/spec-loader.ts:327`、`src/commands/search.ts:180`（均过滤） | A(G-A7) + B(G-B1) + 主线 grep 复核 |
| X2 | **三套 ID 体系割裂，sid 未被采用** — wiki 子条目用位置序号 `{stem}-NNN`、KG 节点用 `spec:{绝对路径}:{lineStart}`、credibility 桥接函数 `wikiIdToNodeId` 按首个 `-` 切分，对 `spec:project:...` 冒号格式必然返回 null。任何增删条目导致 ID 集体漂移，credibility 行变孤儿被 `cleanOrphans` 清除。实测 credibility 表仅 52 行 vs 19.8k 节点 | `src/graph/kg/extraction/knowledge/spec-extractor.ts:46`、`dashboard/src/server/wiki/wiki-indexer.ts:832,890`、`src/graph/kg/credibility.ts:185-192,166-171` | A(G-A5) + B(G-B4)；C(G-C11) 同源 |
| X3 | **credibility 使用信号只写不读** — 每次搜索/注入付出 SQLite 写成本（`search_hits`），但 `credibilityFactors` 参数全仓无调用方传入，`incrementConsumption` 零调用；反馈闭环半接线，采集有成本、消费为零 | 写：`src/commands/search.ts:240-263`、`src/hooks/spec-injector.ts:318-339`；读侧从未传入：`dashboard/src/server/wiki/wiki-indexer.ts:520,579`、`src/graph/kg/query/scoring.ts:257` | A(G-A13) + B(G-B10) + C(G-C8) 三方独立命中 |
| X4 | **搜索展示分是名次合成分，不是相关度** — `rankNormalize` 丢弃真实分数只留名次，×0.6/0.4 源权重后展示。纯 wiki 20 条结果时输出恰为 0.6000, 0.5700, 0.5400…（0.6×(1−i/20)，步长精确 0.03）。无法区分"全部弱相关"与"强命中"；全链路存在三种分数语义（daemon 原始分 / JSON 相对分 / 混排名次分）互不兼容 | `src/commands/search.ts:839-857,903,921` | C(G-C1) + 本次 session 搜索输出运行时印证 + 主线 grep 复核 |

---

## 二、架构设计缺口（Agent A）

### 架构地图速览

**存储层**（`.workflow/` 下）：

| 存储 | 路径 | 格式 |
|---|---|---|
| spec | `specs/*.md`（+ `~/.maestro/specs/` global、`collab/specs/[uid]/`） | Markdown + `<spec-entry sid= status= confidence=>` 块 |
| knowhow | `knowhow/{KNW\|TIP\|TPL\|RCP\|REF\|DCS\|AST\|BLP\|DOC}-{ts}-{slug}.md` | frontmatter + body |
| domain | `domain/glossary.json` | Protected Data Store（GlossaryLock+备份+校验） |
| KG | `kg/maestro.db`（SQLite）+ `code-embedding-index.bin` + `resolution.jsonl` | |
| 派生缓存 | `search-cache.json`(4.9MB) / `wiki-index.json`(4.2MB) / `embedding.zvec` | 同一索引三份投影 |

**数据流**：源文件 → 全量扫描 → WikiIndexer（BM25F + embedding 混合 + time-decay + 短语重排）→ search daemon（TCP，warm ONNX）→ `maestro search` 与 code_fts 结果 `mergeAndNormalize` 混排。写入路径三套并行（spec-writer / WikiWriter / store-knowhow），注入层经 SessionStart / UserPromptSubmit / PreToolUse 三类 hook。

### 缺口清单

| ID | 标题 | 证据 | 严重度 |
|----|------|------|--------|
| G-A1 | **代码边解析层完全未接线**：`ImportResolver`(986 行)/`callback-synthesizer`(1224 行) 无生产调用点；extractor 的 `references` 被接收后丢弃；实测 19,782 代码节点、0 代码边。`getCallers/getCallees/getImpact/findDeadCode` 与 kg-context-injector 的 callers/callees 注入全部返回空 | `src/graph/kg/index.ts:35-36`、`orchestrator.ts:204`、`code-extractor.ts:407-423`、`engine.ts:257-330` | 高 |
| G-A2 | **同一代码符号双重索引**：code_fts 已索引全部代码节点，virtual-wiki-adapters 又把 5000 个 KG 节点投影进 BM25+embedding；靠 `×0.7` 魔法系数事后去重 | `dashboard/src/server/wiki/virtual-wiki-adapters.ts:375-448`、`src/commands/search.ts:878-880` | 中 |
| G-A3 | **KG 虚拟条目污染 knowhow 注入通道**：kg 节点被赋 `type:'knowhow'`，全量 sync 后共享最新 updated_at → wiki-role-loader 按 updated 倒序取 top10 全是单字母函数名列表（有线上运行时实证），真实 knowhow 被挤出；`load --type knowhow` 同样混入 | `virtual-wiki-adapters.ts:419,442`、`src/tools/wiki-role-loader.ts:41-44`、`src/commands/load.ts:39-43` | 高 |
| G-A4 | **spec 写路径无锁**：read→concat→writeFileSync，无跨进程锁、无原子替换、无备份 — 违反项目自己给 domain 定的 Protected Data Store 规范；并行 agent 同时 `spec add` 可互相覆盖 | `src/tools/spec-writer.ts:176-193` vs `src/graph/kg/domain-loader.ts:81-141`、`src/graph/kg/sync/file-lock.ts` | 高 |
| G-A5 | （并入 X2） | | 高 |
| G-A6 | **spec-entry 解析器 3 份 + frontmatter 解析器 2 份**：`src/tools/spec-entry-parser.ts` 与 dashboard 版已分叉；spec-extractor 另有私有 parseSpecFile | `src/tools/spec-entry-parser.ts` vs `dashboard/src/server/wiki/spec-entry-parser.ts`、`spec-extractor.ts:114` | 中 |
| G-A7 | （并入 X1） | | 高 |
| G-A8 | **knowhow ID 生成端与索引端前缀约定相反**：索引端保留前缀 `knowhow-tip-...`，写入端/list/注入提示均去前缀 → 按提示中的 ID 执行 `maestro load --id` 会 Not found，知识回环最后一跳断裂 | `wiki-indexer.ts:1485-1489` vs `src/utils/frontmatter.ts:112`、`knowhow.ts:146`、`spec-loader.ts:409,488` | 中 |
| G-A9 | **"增量同步"实为全量 delete-and-replace**：每次 sync 对每源全删全插；`incremental-sync.ts:20` 的 `changedFiles` 从未被消费；kg-sync hook 冷却后每 prompt 潜在触发全量重建。实测 maestro.db 91MB 中 49% freelist 死空间，从不 VACUUM | `orchestrator.ts:79,126`、`src/hooks/kg-sync-hook.ts:58-75` | 中 |
| G-A10 | **CLI→dashboard 反向层依赖**：WikiIndexer/WikiWriter/types/embedding/spec-entry-parser 物理上住在 dashboard 包（`#maestro-dashboard/wiki/*` → `dashboard/dist-server/`）；是 G-A6 分叉的结构性根因 | `search.ts:20`、`load.ts:15`、`wiki.ts:18`、`package.json:9` | 中 |
| G-A11 | **同一索引三份持久化投影 + 注入热路径重复解析 4.2MB JSON**：spec-injector 在 category 循环内每次 readFileSync+JSON.parse 整个 wiki-index.json 无缓存，单次 agent spawn ≈ 12MB 同步解析，发生在 PreToolUse 阻塞路径 | `wiki-indexer.ts:285-326,1547-1577`、`spec-injector.ts:208`、`wiki-role-loader.ts:23-37` | 中 |
| G-A12 | **无界追加日志**：`kg/resolution.jsonl` 每次 sync 全量 append 无轮转（实测 37MB）；`specs/.hit-log.jsonl` 同；`kg/test.db` 测试残留在生产目录 | `knowledge-resolver.ts:358-375`、`spec-loader.ts:611-629` | 低 |
| G-A13 | （并入 X3；另含读路径每查询开关 SQLite、写不经 FileLock 与全量重建并发碰撞风险） | `search.ts:240-263`、`spec-injector.ts:319-339` | 低 |
| G-A14 | **Wiki staleness 检查线性扫描 sessions 子树**：每次 get() 递归 stat 全部 session 文件；`invalidate(path)` 接收变更路径却全量作废 | `wiki-indexer.ts:193-247,501` | 低 |
| G-A15 | **`~/.codex/sessions` 全局目录无条件进扫描列表**（修复批次中实证发现）：`getSourcePaths` 对 claude 会话按 projectSlug 过滤，但 codex sessions 目录不分项目、只要存在就整个加入 — 实测 2.9GB/1668 文件，每次索引重建全量扫描；临时 workflowRoot（如单测）同样中招，冷缓存下单次 rebuild >5s，导致 dashboard wiki-indexer 测试套件成片超时 | `wiki-indexer.ts:146-152` | 中 |

---

## 三、知识演化缺口（Agent B）

### 实况

spec 的 supersede 双轨、contested ×0.5、health/history/backfill-sid、time-decay（`floor 0.3 + e^(-λ·age)`，半衰期 spec 60d / knowhow 30d / issue 14d / domain 180d）均已实现且与文档基本一致；domain 有真实生命周期（`domain deprecate --successor`）。三轴（confidence ⊥ status ⊥ decay）在 spec 上正交成立。以下为盲区。

### 缺口清单

| ID | 标题 | 证据 | 严重度 |
|----|------|------|--------|
| G-B1 | （并入 X1） | | 高 |
| G-B2 | **conflict 行号与 frontmatter 偏移错位**：`listConflicts`/`clearAllConflicts` 基于剥 frontmatter 后的行号，`markConflict`/`clearConflict` 按原始行号；所有 spec 文件带 13+ 行 frontmatter → list→clear 往返落错行，`clear-all` 在带 frontmatter 文件上必然失败 | `src/tools/spec-conflict-marker.ts:229-230,273-285` vs `:83-92,132-141`、`src/utils/frontmatter.ts:60-66` | 高 |
| G-B3 | **knowhow 无生命周期，废弃在索引层是 no-op**：`asStatus` 白名单无 `deprecated`/`superseded`（→ 静默变 draft），audit 工作流规定的 knowhow deprecate 手段与验证命令全部无效；引用的 `wiki edit` 命令不存在（实际是 `wiki update`） | `wiki-indexer.ts:1593-1603,1636-1640`、`workflows/knowledge-audit.md:266,343`、`src/commands/wiki.ts:629` | 高 |
| G-B4 | （并入 X2） | | 高 |
| G-B5 | **successor 被删时链头误标 CURRENT**：health 只检 `supersedes` 悬空不检 `supersededBy` 悬空；`getEvolutionChain` 尾节点无条件 `current=true` → deprecated 且被排除的条目在 `spec history` 显示 "● CURRENT"，health 报 OK — 知识静默丢失不可观测 | `spec-conflict-marker.ts:525-527,413-419,437-439` | 高 |
| G-B6 | **生命周期只覆盖 project scope**：conflict-marker 全部函数硬编码 `.workflow/specs`（8 处）；global/team/personal 条目有 sid 却不能 supersede、不进 health、conflict mark 够不到 | `spec-conflict-marker.ts:69,118,172,209,259,322,373,476,568` | 中 |
| G-B7 | **无 merge 语义，二并一覆盖 supersedes 链**：`upsertAttribute` 对已存在属性整值替换 → `supersede old2 --by NEW` 把 NEW 已有的 `supersedes="old1"` 覆盖，old1 前向链断，触发 G-B5 同款问题且 health 不报警 | `spec-conflict-marker.ts:356,606-612` | 中 |
| G-B8 | **contested 无时效追踪无升级路径**：标记日期仅藏在 CMK ID 字符串里；list 返回的 date 是条目创建日；health 不统计 contested 龄期 → ×0.5 仍注入的争议条目可无限期悬置 | `spec-conflict-marker.ts:49-54,98-101,242` | 中 |
| G-B9 | **知识与代码零联动**：knowhow `codePaths` 只用于展示无 existsSync 校验；spec 条目连 code anchor 字段都没有；代码重构后知识静默腐烂，唯一自动信号是与正确性无关的时间衰减 | `store-knowhow.ts:61`、`src/commands/wiki.ts:242-251`、`knowledge-audit.md:146` | 中 |
| G-B10 | （并入 X3；另：文档声称 content_hash 变更重置衰减，实际排序走 date 属性，编辑内容不更新 date 不会重置） | `guide/knowledge-management-guide.md:315` vs `time-decay.ts` | 中 |
| G-B11 | **decay ceiling 死配置 + 无续期动作**：`ceiling: 1.2` 永不生效；spec date 只在创建时写入，无 touch/re-affirm — "仍然正确的老规则"与"过时规则"在 decay 轴不可区分 | `credibility.ts:36-49,85-87`、`spec-writer.ts:191-192` | 低 |
| G-B12 | **legacy heading 条目游离于全部生命周期之外**：backfillSids 只补 `<spec-entry` 行；legacy 条目无 sid/status，不能 supersede、conflict mark 被拒、health 不可见 | `spec-entry-parser.ts:384-430`、`spec-conflict-marker.ts:591,92` | 低 |
| G-B13 | **自我/重复 supersede 无守卫**：`oldSid===newSid` 无检查（一条命令可把活规则变成指向自身的僵尸）；对已 deprecated 条目重复 supersede 静默覆盖 superseded-by | `spec-conflict-marker.ts:349-358`、`spec.ts:1083` | 低 |

---

## 四、maestro search 检索缺口（Agent C）

### 链路实况速览

- CLI 一次性进程**永远不做 embedding**（强制 skipEmbedding），语义检索只经 daemon（30min 空闲自杀）
- CJK 分词：文档侧产重叠 2/3-gram；停用词仅 25 个英文词
- BM25F 权重：title 5 / tags 3 / summary 1.5 / body 0.5；embedding 融合 `0.4×rrfNorm + 0.6×bm25Norm`（硬编码，输出 ≤1）
- `--code` 走纯 FTS5（name 20 / keywords 10 / qualified_name 5）；`--kg` 走 knowledge_fts（trigram）四策略
- 混排 `mergeAndNormalize` → `rankNormalize` 名次合成分（见 X4）

### 缺口清单

| ID | 标题 | 证据 | 严重度 |
|----|------|------|--------|
| G-C1 | （并入 X4） | | 高 |
| G-C2 | **bridge minScore=1.0 与 hybrid 分数尺度冲突**：hybrid 分数数学上 ≤1.2×decay(0.3~1)，BM25-only 原始分常 >5 → daemon 带 embedding 时 keyword-spec-injector 的 spec 注入几乎恒空，embedding 挂了反而正常 — 质量随环境静默翻转 | `src/hooks/wiki-search-bridge.ts:25,47,74`、`keyword-spec-injector.ts:123` | 高 |
| G-C3 | **facet 后过滤饥饿**：type/category/kind/workspace/deprecated 全是截断候选池（max(limit×2,40)）后的后过滤；DaemonSearchRequest 无 filter 字段 → 窄 facet 查询排名 40 外的匹配全丢，可能返回 0 结果误导"无既有知识"（Gate rule 依赖的判断） | `search.ts:132,157-181`、`daemon-types.ts:18-23` | 高 |
| G-C4 | **--code 无语义召回，code-embedding 索引对 CLI 白建**：`searchHybrid` 已实现但 CLI 不用（仅 MCP 工具用）；kg-sync-hook 却持续维护 code embedding 索引 | `engine.ts:142-149,208-227`、`kg-sync-hook.ts:69` | 中 |
| G-C5 | **CJK 代码查询降级为无评分 LIKE**：hasCjkChars → searchNodesLike → ORDER BY name，无 bm25 分 → 中文 docstring/符号查询排序完全失效 | `queries.ts:539-541,745` | 中 |
| G-C6 | **wiki 单个 CJK 字符查询零召回**：文档侧 CJK run≥2 只产 2/3-gram 不产单字 token；查"图"匹配不到"图谱"；CLI 直连路径又无 embedding 兜底 | `dashboard/src/server/wiki/search.ts:265-278` | 低 |
| G-C7 | **domain aliases 不参与查询扩展**：SYNONYMS 硬编码约 30 组英文词；expandQueryTerms 不读 glossary — 项目维护了别名体系，检索层不消费 | `dashboard/src/server/wiki/search.ts:22-52,130-182`、`wiki-indexer.ts:974` | 中 |
| G-C8 | （并入 X3） | | 中 |
| G-C9 | **无 phrase/exact-match 查询语法**：tokenize 丢弃引号；仅隐式 proximity rerank ≤+20% | `dashboard/search.ts:284`、`queries.ts:805-811` | 低 |
| G-C10 | **--kind 大小写敏感**：tags 已 lowercase 但 CLI 不 lower 用户输入 → `--kind Diagnosis` 静默 0 结果 | `search.ts:171-174`、`spec-entry-parser.ts:142` | 低 |
| G-C11 | **容器与 -NNN 子条目同时进索引无父子折叠**：同一文件的容器+多条子条目挤占 top-N（CLAUDE.md 教"命中 -NNN 要 load 父条目"即此问题的人工 workaround） | `wiki-indexer.ts:814,831,872-908`、`search.ts:189` | 中 |
| G-C12 | **daemon 降级不可归因**：任何失败（含 5s 超时）吞掉返回 null；仅以 header `bm25` vs `+emb(n)` 区分，不说明原因 | `daemon-client.ts:39-41`、`search.ts:418` | 低 |
| G-C13 | **code index 新鲜度无检测**：hint 只覆盖 not-initialized/empty/error 三态；hook 未生效环境索引静默过期 — 过期 file:line 比无结果更误导 | `search.ts:75-86,311-317` | 中 |
| G-C14 | **无分页**：仅 --limit 无 offset（agent 消费场景影响小，建议 won't-fix） | `search.ts:356,927` | 低 |

---

## 五、优化建议（按投入产出排序）

### 极低成本，立即可做（每项 ≤ 数行）

| # | 动作 | 修复 |
|---|------|------|
| 1 | `spec-keyword-index.ts` 条目循环加 `if (entry.status === 'deprecated') continue;` | X1 |
| 2 | bridge 阈值按 daemon response 的 `embeddingUsed` 切换：hybrid 用相对阈值（≥0.4×top1），BM25 保留 1.0 | G-C2 |
| 3 | facet 存在时 candidateLimit 提到 200 | G-C3 |
| 4 | health 加 `supersededBy` 悬空对称检查；history 尾节点 `status==='deprecated'` 不标 CURRENT 并提示 broken chain | G-B5 |
| 5 | supersedeEntry 拒绝 `oldSid===newSid`、old 已有不同 superseded-by 时报错 | G-B13 |
| 6 | CLI 层 `--kind` 输入 toLowerCase | G-C10 |
| 7 | `wiki-role-loader` 加 `virtualKind !== 'kg-node'` 过滤（G-A3 热修） | G-A3 |
| 8 | `asStatus` 白名单加 `deprecated`，search/injection 按 status 过滤 knowhow；audit 文档 `wiki edit` 改 `wiki update` | G-B3 |
| 9 | markConflict 顺手写 `conflict-date`；health 增 "contested >30d: N" 统计 | G-B8 |
| 10 | 删 decay `ceiling` 死配置；加 `maestro spec touch <sid>` 作续期最小动作 | G-B11 |
| 11 | resolution.jsonl 改覆盖写或仅 DEBUG 输出；删 test.db；.hit-log.jsonl 加轮转 | G-A12 |

### 低成本，高收益

| # | 动作 | 修复 |
|---|------|------|
| 12 | 混排展示改用真实归一化分，rankNormalize 仅决定 interleave 顺序；JSON 同时带 `rank`+`score` 字段 | X4 |
| 13 | `FileLock`（已存在于 kg/sync/）+ tmp+rename 下沉为 `.workflow` 通用写原语，spec-writer/WikiWriter/store-knowhow 统一走它 | G-A4 |
| 14 | credibility 二选一：把 factors 真正传入 `searchWithMeta` 闭环，或按极简哲学删除整条采集路径（含 `incrementConsumption` 死代码）— 当前"采集有成本、消费为零"是最差状态 | X3 |
| 15 | `runCodeSearch` 改调已存在的 `mg.searchHybrid`（换调用点，零新代码，保留降级） | G-C4 |
| 16 | `conflict list/clear-all` 去掉 stripFrontmatter 直接 parse raw（parser 本就忽略非 tag 文本）；中期 conflict 定位迁到 sid | G-B2 |
| 17 | searchNodesLike 结果过一遍现成 `computeScore` 排序，替换 ORDER BY name | G-C5 |
| 18 | `supersedes` 属性支持逗号多值（追加而非替换），悬空检查按 split 展开 — 免新增 merge 命令 | G-B7 |
| 19 | `spec health` 加机械 ghost-ref 检查：扫 codePaths + 正文路径样式，existsSync 失败计数报告 | G-B9 |
| 20 | 抽 `specDirs(projectPath)` 返回各 scope 目录，conflict-marker 8 处遍历之 | G-B6 |
| 21 | 唯一化 knowhow ID 派生函数（保留前缀，与 wiki-indexer 一致），四处写入端改调它 | G-A8 |
| 22 | dedup 加 per-parent 折叠（同 parent 只保留最高分 1 条） | G-C11 |
| 23 | daemon 不可达时输出一行 `Note: search daemon unreachable — BM25-only` | G-C12 |
| 24 | wiki-index.json 由 search-cache.json 派生只留一份；loadWikiByCategory 加进程内 mtime 缓存（照抄 domain-loader 模式）；spec-injector 循环外一次性读取 | G-A11 |
| 24b | codex sessions 扫描做项目过滤（按 transcript cwd 建一次性索引/清单缓存），或至少对非真实项目 workflowRoot（单测临时目录）跳过全局 codex 目录；与 G-A14 的增量化一并处理 | G-A15 |

### 结构性（需规划）

| # | 动作 | 修复 |
|---|------|------|
| 25 | **以 sid 为 spec 条目唯一主键**：KG 节点 ID 改 `spec:{sid}`（legacy 先 backfill-sid）、wiki 子条目有 sid 用 sid、credibility 桥按 sid — 一次性解决 X2 及下游（credibility 孤儿、backlinks 失联、-NNN 漂移） | X2 |
| 26 | **KG 代码边二选一，忌折中**：(a) 接线 — extractor `references` 写入现成 `unresolved_refs` 表，sync 末尾调 `ImportResolver` 生成 calls/imports 边（数据结构已齐备只缺调用链）；(b) 承认不做，删 2200 行死代码，kg-context-injector 退化为符号定位。当前"移植了但不接"是最差状态 | G-A1 |
| 27 | `dashboard/src/server/wiki/` 提取为共享内部包（如 `@maestro/wiki-core`），dashboard 与 CLI 同向依赖 — 消除层次倒置与 3 份解析器分叉 | G-A10/A6 |
| 28 | 知识源按 `files.contentHash`（表已存在）逐文件增量 sync；sync 后按 freelist 比例触发 VACUUM；保留 delete-and-replace 作 `--full` 回退 | G-A9 |
| 29 | 停止把 codegraph 节点投影为 wiki 条目（code 检索由 code_fts 独占），删 0.7 惩罚补丁 | G-A2/A3 根治 |
| 30 | domain aliases 接入 expandQueryTerms（alias→canonical Map，权 0.5），替代硬编码 SYNONYMS 膨胀 | G-C7 |
| 31 | 子条目有 sid 时 wiki id 与 KG key 用 sid，无 sid 回退位置号（改动集中在两处 id 生成点） | G-B4 |
| 32 | backfill-sid 顺带把 legacy heading 条目一次性升格为 `<spec-entry>` tag | G-B12 |
| 33 | DaemonSearchRequest 加 typeFilter 让 daemon 端先过滤再截断（#3 的根治版） | G-C3 |

---

## 附：关键文件索引

- CLI：`src/commands/search.ts`、`load.ts`、`spec.ts`、`knowhow.ts`、`wiki.ts`、`domain.ts`
- 工具层：`src/tools/spec-writer.ts`、`spec-loader.ts`、`spec-entry-parser.ts`、`spec-conflict-marker.ts`、`spec-keyword-index.ts`、`store-knowhow.ts`、`wiki-role-loader.ts`
- Hooks：`src/hooks/keyword-spec-injector.ts`、`spec-injector.ts`、`wiki-search-bridge.ts`、`kg-sync-hook.ts`、`kg-context-injector.ts`
- Daemon：`src/search/daemon.ts`、`daemon-client.ts`、`daemon-types.ts`
- Wiki 核心（dashboard 包内）：`dashboard/src/server/wiki/wiki-indexer.ts`、`search.ts`、`embedding.ts`、`time-decay.ts`、`virtual-wiki-adapters.ts`、`writer.ts`、`spec-entry-parser.ts`
- KG：`src/graph/kg/engine.ts`、`credibility.ts`、`db/queries.ts`、`query/search.ts`、`query/scoring.ts`、`extraction/orchestrator.ts`、`extraction/knowledge/spec-extractor.ts`

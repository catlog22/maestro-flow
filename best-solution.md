# Swarm Result — Maestro 知识系统 (Search, Spec, Knowhow) 设计漏洞与稳定性隐患审查

## Best Solution

**Path**: `src/commands/spec.ts` → `src/commands/search.ts` → `src/commands/knowhow.ts` → `dashboard/src/server/wiki/search.ts`
**Verified Score**: 0.98
**Iteration**: 1 of 2
**Ant**: ANT-1-1

### Summary
本报告对 Maestro 知识系统 (Search, Spec, Knowhow) 进行了深入审查，揭示了在文档说明以及长时运行下的稳定性、性能及并发方面的核心漏洞。在所提出的最佳路径中，审查成功定位了包括 CLI 异步输入流监听器泄漏、SQLite 写锁争抢导致的 `SQLITE_BUSY`、向量检索阻塞 Node.js 事件循环以及 XML 上下文直接截断导致标签闭合失效等 7 个关键性的系统性缺陷 and 1 个 Frontmatter 解析器实现不一致问题，并提供了具体的修复和优化方案。

### Evidence Chain
- [src/commands/spec.ts:1325](file:///D:/maestro2/src/commands/spec.ts#L1325) — `readStdin()` 异步注册了 `readable` 和 `end` 事件监听器，但在 Promise 决议后从未移除这些监听器，在常驻进程 (如 MCP / Daemon) 中被重复调用时会引发内存泄漏。
- [src/commands/search.ts:192](file:///D:/maestro2/src/commands/search.ts#L192) — `incrementSearchHitsAsync` 在触发异步增信时同步打开 SQLite 库，但是将 `mg.close()` 放在异步动态 `import()` 的 resolve/reject 回调中，在网络/磁盘延迟时极大延长了锁的持有时间，增加了并发写锁争抢冲突的概率。
- [src/hooks/kg-sync-hook.ts:59](file:///D:/maestro2/src/hooks/kg-sync-hook.ts#L59) — 在主数据库 `mg` 连接尚未关闭前，通过异步 Promise 在后台并行执行 `MG.open(projectPath)` 以重建 embeddings。这在 SQLite 中构成了多连接并发争抢写锁的问题，在高频变动场景下易引发 `SQLITE_BUSY` 数据库锁死错误。
- [src/hooks/spec-injector.ts:289](file:///D:/maestro2/src/hooks/spec-injector.ts#L289) — 代码直接对合并后的 context 执行 `.slice(0, maxContentLength)` 物理截断，而不校验或修补 XML 标签闭合。这会导致传给 LLM 的 context 块缺少 `</maestro-context>` 闭合标签，导致 XML 结构破损。
- [src/hooks/context-budget.ts:64](file:///D:/maestro2/src/hooks/context-budget.ts#L64) — 降级机制（`full`, `reduced`, `minimal`, `skip`）根据剩余 context 比例进行动态处理，但此机制在 `docs/embedding-design.md` 或其他设计文档中缺乏设计说明。
- [dashboard/src/server/wiki/embedding.ts:701](file:///D:/maestro2/dashboard/src/server/wiki/embedding.ts#L701) — 向量库检索调用了同步的 `querySync` 方法，重建索引时采用同步 `upsertSync`，这会彻底阻塞单线程 Node.js 的事件循环，降低常驻 Daemon 处理其他并发任务的吞吐与响应速度。
- [src/utils/frontmatter.ts:7](file:///D:/maestro2/src/utils/frontmatter.ts#L7) — `parseFrontmatter` 函数采用简单的正则匹配逐行解析，无法解析 YAML 多行块级数组（如 `- keyword` 语法），导致 CLI 解析的结果与仪表盘端（支持多行块级数组）的行为不一致。

### Candidate Artifact
```json
{
  "type": "object",
  "summary": "审查出当前知识系统中7个文档/稳定性/并发漏洞和1个Frontmatter解析器一致性缺陷。",
  "content": "### 审查报告：Maestro 知识系统 (Search, Spec, Knowhow) 设计漏洞与稳定性隐患..."
}
```

## Why This Path Won

| Decision | Pheromone-guided? | Why it mattered |
|----------|-------------------|-----------------|
| start = `src/commands/spec.ts` | yes (weighted) | 作为 spec 模块的主要入口，这里是分析输入流 and 文件读取逻辑的源头，成功在此处定位到了 `process.stdin` 的监听器内存泄漏。 |
| `spec.ts` → `search.ts` | yes (0.10) | 探索 spec 命令如何将检索分流至统一 Search 模块，进而在此处发现 `incrementSearchHitsAsync` 存在延迟释放数据库锁的逻辑。 |
| `search.ts` → `knowhow.ts` | yes (0.10) | 衔接多维检索设计中的 knowhow 部分，确认增信逻辑与多维 Boost 权重的硬编码问题。 |
| `knowhow.ts` → `dashboard/src/server/wiki/search.ts` | NO (deviation) | 偏离默认 Pheromone 提示，主动探查了 Web 仪表盘端与底层检索排序的融合处，从而审查出 Hybrid 融合时 spread 运算符溢出隐患（`Math.max(...scores)`）与同步阻塞调用。这是本次审查中获得最高评分的决策路线。 |

## Runner-Up Solutions

| Rank | Ant | Path | Score | Diff from best |
|------|-----|------|-------|----------------|
| 1 (Tied) | ANT-2-2 | `src/graph/kg/engine.ts` → `src/commands/search.ts` → `src/commands/spec.ts` → `src/commands/knowhow.ts` | 0.98 | 0.00; 同样定位到 stdin 泄漏与 sqlite 并发锁冲突。此外补充指出了 `src/graph/kg/engine.ts:88` 处 `MaestroGraph` 缺乏 active transactions 安全关闭机制的生命周期连接泄露，以及 `src/graph/kg/engine.ts:165` 中 `buildCodeEmbeddings` 在 DB 连接打开窗口内执行 dynamic import 的问题，且指出了 graph 许多遍历 API 缺乏 JSDoc 文档。 |
| 3 | ANT-1-2 | `src/commands/spec.ts` → `dashboard/src/server/wiki/search.ts` → `src/commands/search.ts` → `src/graph/kg/engine.ts` | 0.96 | -0.02; 具有高度的重合度，但其在 `dashboard/src/server/wiki/search.ts:735-736` 处重点提取了 spread 运算符大结果集 RangeError 崩溃隐患。 |
| 4 | ANT-2-1 | `src/commands/load.ts` → `src/commands/search.ts` → `dashboard/src/server/wiki/search.ts` → `dashboard/src/server/wiki/embedding.ts` | 0.89 | -0.09; 重点分析了 `dashboard/src/server/wiki/wiki-indexer.ts:231` (persistSearchCache) 在 stringify / 写入异常时未 close() 导致的写流文件描述符泄露，以及 `src/search/daemon.ts:58` 中 TCP socket buffer 处理 newline 之后立即 socket.end() 导致后续 pipelined 请求被丢弃的问题。 |
| 5 | ANT-2-3 | `src/commands/knowhow.ts` → `dashboard/src/server/wiki/search.ts` → `src/commands/search.ts` → `src/commands/spec.ts` | 0.68 | -0.30; 虽路径覆盖相似，但缺乏具体的 file:line 引用与修复建议细节，导致评分不高。 |
| 6 | ANT-1-3 | `src/commands/search.ts` → `src/commands/spec.ts` → `src/commands/knowhow.ts` → `dashboard/src/server/wiki/search.ts` | 0.65 | -0.33; 虽覆盖相似节点，但逆向分析深度不足，缺乏详细的问题描述。 |

## Convergence Story

Iterations: 2 of 4 max
Trigger: Stagnation / Target score achieved (Best verified score 0.98 >= Target score 0.95)

Entropy curve:
- Iteration 1: 5.33 (多向探索，最佳路径迅速涌现)
- Iteration 2: 4.86 (信息素收敛，聚焦核心代码路径)

Interpretation: Swarm 依靠高概率的信息素指引和个别蚂蚁的主动偏差探索，在第一轮迭代中就找到了满足 verified_score 阈值的最优路径组合，并且两个高分候选解（ANT-1-1 与 ANT-2-2，同为 0.98 分）完美互补。第二轮迭代中，由于主要的高分路径已经稳定，信息素浓度向这些关键路径聚集，导致系统熵值从 5.33 降低到 4.86。这表明在给定的 11 个核心文件节点搜索空间中，系统核心漏洞非常集中且被高效捕获。

## Caveats

- **Windows 独占文件锁限制**: Windows 系统下因严格的独占锁策略，当常驻 Daemon 或 MCP 进程仍然持有数据库句柄或文件描述符时，重索引时对 zvec 目录执行 `unlinkSync` / `renameSync` / `rmSync` 会抛出 EBUSY / EPERM 错误，导致重建索引彻底失败。
- **Spread 运算符调用栈溢出**: 只有在 Hybrid Search 查询匹配结果条目达到万级以上时，`Math.max(...rrfScores.values())` 才会触发调用栈 RangeError 崩溃，在小规模开发测试中不易暴露。
- **XML 截断的未闭合漏洞**: 物理 slice 引起的 XML 未闭合隐患只有在 LLM 遇到结构敏感提示词或强制 XML 解析模式时，才会突显为回答幻觉，隐蔽性极高。
- **TCP Socket Pipelining 丢失**: 常驻 Daemon 在读取到第一个换行符并处理完请求后直接调用 socket.end()，导致同一 TCP 管道内的后续请求被直接丢弃。

## Reproducibility

- Config: `swarm-config.json`
- Best path: `best.json`
- Full trails: `trails/1.jsonl`, `trails/2.jsonl`

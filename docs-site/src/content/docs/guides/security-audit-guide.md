---
title: "安全审计指南"
icon: "🔒"
---

> 本文档介绍 Maestro 的安全审计功能，包括 OWASP Top 10、STRIDE 威胁建模和供应链分析。

## 概述

`security-audit` 命令提供系统性安全审计，覆盖：

- **OWASP Top 10**：Web 应用安全风险
- **依赖供应链**：第三方库安全分析
- **密钥检测**：硬编码凭证和敏感信息
- **CI/CD 管道**：持续集成/部署安全配置
- **STRIDE 威胁建模**：系统性威胁分析（deep 级别）
- **Git 历史**：提交历史中的安全问题（deep 级别）

## 审计深度

| 级别 | OWASP | 依赖 | 密钥 | CI/CD | STRIDE | Git 历史 |
|------|-------|------|------|-------|--------|---------|
| quick | ✓ | ✓ | — | — | — | — |
| standard | ✓ | ✓ | ✓ | ✓ | — | — |
| deep | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### quick 级别

快速扫描，适合日常开发检查：

```bash
/security-audit quick
```

- 扫描 OWASP Top 10 常见漏洞
- 检查依赖库的已知漏洞
- 执行时间：5-10 分钟

### standard 级别

标准扫描，适合发布前检查：

```bash
/security-audit standard
```

- quick 级别所有检查
- 检测硬编码的密钥和凭证
- 审查 CI/CD 管道配置
- 执行时间：15-30 分钟

### deep 级别

深度扫描，适合安全审计：

```bash
/security-audit deep
```

- standard 级别所有检查
- STRIDE 威胁建模
- Git 历史安全分析
- 执行时间：30-60 分钟

## 使用示例

```bash
# 默认 quick 扫描
/security-audit

# 指定深度
/security-audit standard

# 限定扫描范围
/security-audit deep --scope src/auth

# 组合使用
/security-audit standard --scope src/api
```

## OWASP Top 10 覆盖

审计检查以下 OWASP Top 10 风险：

| # | 风险 | 检查内容 |
|---|------|---------|
| A01 | Broken Access Control | 权限检查、角色验证、资源访问控制 |
| A02 | Cryptographic Failures | 加密算法、密钥管理、数据保护 |
| A03 | Injection | SQL/NoSQL/OS/LDAP 注入防护 |
| A04 | Insecure Design | 安全设计模式、威胁建模 |
| A05 | Security Misconfiguration | 默认配置、错误处理、安全头 |
| A06 | Vulnerable Components | 依赖库版本、已知漏洞 |
| A07 | Authentication Failures | 认证机制、会话管理、密码策略 |
| A08 | Data Integrity Failures | 数据验证、序列化、CI/CD 管道 |
| A09 | Logging Failures | 日志记录、监控、告警 |
| A10 | SSRF | 服务端请求伪造防护 |

## STRIDE 威胁建模

deep 级别包含 STRIDE 威胁建模：

| 威胁类型 | 描述 | 检查点 |
|---------|------|--------|
| **S**poofing | 身份伪造 | 认证机制、令牌验证、证书固定 |
| **T**ampering | 数据篡改 | 完整性校验、签名验证、输入验证 |
| **R**epudiation | 抵赖 | 审计日志、数字签名、时间戳 |
| **I**nformation Disclosure | 信息泄露 | 数据加密、错误处理、日志脱敏 |
| **D**enial of Service | 拒绝服务 | 速率限制、资源限制、超时配置 |
| **E**levation of Privilege | 权限提升 | 最小权限原则、角色验证、沙箱隔离 |

## 供应链分析

审计检查依赖供应链安全：

1. **已知漏洞**：检查 npm audit / pip audit / cargo audit 等
2. **版本锁定**：验证 package-lock.json / requirements.txt 等
3. **许可证合规**：检查依赖许可证兼容性
4. **维护状态**：识别长期未更新的依赖
5. **传递依赖**：分析间接依赖的安全风险

## 输出报告

审计完成后生成结构化报告：

```
.security-audit/
├── summary.md          # 执行摘要
├── owasp-top10.md      # OWASP 检查结果
├── dependencies.md     # 依赖分析
├── secrets.md          # 密钥检测结果（standard+）
├── cicd.md             # CI/CD 审查结果（standard+）
├── stride.md           # STRIDE 分析（deep）
├── git-history.md      # Git 历史分析（deep）
└── recommendations.md  # 修复建议
```

## 集成工作流

### 与 ralph 集成

```json
{
  "steps": [
    {
      "index": 0,
      "skill": "security-audit",
      "args": "standard --scope src/api",
      "stage": "verify"
    }
  ]
}
```

### 与 /maestro-ralph --engine swarm --script wf-review 集成

```bash
# 先执行安全审计
/security-audit standard --scope src/auth

# 再执行代码审查（包含安全维度）
/maestro-ralph --engine swarm --script wf-review 1 --dimensions security
```

## 最佳实践

1. **定期审计**：在每个里程碑结束时执行 standard 级别审计
2. **发布前检查**：发布前执行 deep 级别审计
3. **聚焦范围**：使用 `--scope` 限定扫描目录，提高效率
4. **修复优先级**：先修复 critical 和 high 级别问题
5. **持续改进**：将审计结果纳入 spec 系统，持续跟踪

## 常见问题

### Q: 扫描时间太长怎么办？

使用 `--scope` 限定扫描范围，或降低审计深度：

```bash
/security-audit quick --scope src/api
```

### Q: 如何忽略特定警告？

在 `.workflow/config.json` 中配置忽略规则：

```json
{
  "security": {
    "ignore": [
      "CVE-2023-XXXXX",
      "hardcoded-secret-in-test"
    ]
  }
}
```

### Q: 如何与 CI/CD 集成？

在 CI/CD 管道中添加安全审计步骤：

```yaml
- name: Security Audit
  run: maestro delegate "security-audit quick" --mode analysis
```

---

## 相关文档

- [命令参考](../COMMANDS-CARD-REFERENCE.md) — 所有命令的快速参考
- [质量管线指南](./quality-pipeline-guide.md) — 质量保证流程
- [Hooks 指南](./hooks-guide.md) — 工作流 hooks 配置

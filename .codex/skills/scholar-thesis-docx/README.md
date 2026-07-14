# thesis-docx.skill

[![License](https://img.shields.io/badge/license-MIT-16a34a)](./LICENSE)
[![Word](https://img.shields.io/badge/Microsoft_Word-Recommended-185ABD)](#运行前提)
[![Mermaid](https://img.shields.io/badge/Mermaid-Supported-0ea5e9)](#功能)

**语言 / Language**：**中文** | [English](./README_EN.md)

`thesis-docx` 是一个面向毕业论文 / 学位论文场景的 skill。

它的重点不是“批量改 Word”，而是让 AI 在论文文档上按更稳的顺序工作：

1. 先检查 Word 自动化环境  
2. 先审计，再决定怎么改  
3. 学校明确规定的格式严格执行  
4. 学校没规定的格式默认保留现状  
5. 最后导出 PDF 逐页复核

## 功能

- 修订 thesis / dissertation Word 文档
- 统一正文、标题、图题注、表题注、参考文献等样式
- 修复目录、页码、分节、交叉引用、图表编号
- 生成基于真实材料的 Mermaid 图
- 生成适合论文使用的代码片段或伪代码，LaTeX排版
- 审计 OOXML 隐藏问题，例如：
  - `styleId`
  - `firstLineChars`
  - `titlePg`
  - REF 域显示值
  - section 级页眉页脚引用

## 运行前提

- Windows 下建议安装桌面版 Microsoft Word
- Python 脚本建议环境具备：
  - `python-docx`
  - `lxml`
- Mermaid 渲染建议具备：
  - Node.js
  - `mmdc` 或可用的 `npx`

## 快速开始

```powershell
# 1) 检查 Word COM/DOM 是否可用
powershell -ExecutionPolicy Bypass -File scripts/check_word_com.ps1 -Json

# 2) 先做 OOXML 审计
python scripts/audit_docx_ooxml.py .\draft.docx --output_json .\draft.audit.json --output_txt .\draft.audit.txt

# 3) 如有需要，先 dry-run 审计样式归一化
powershell -ExecutionPolicy Bypass -File scripts/normalize_word_styles.ps1 -InputPath .\draft.docx -AuditOnly

# 4) 真正修完后导出 PDF，逐页复核
powershell -ExecutionPolicy Bypass -File scripts/export_word_pdf.ps1 -DocPath .\draft.docx -PdfPath .\draft.audit.pdf
```

## 使用原则

- 先审计，再修复
- 先修学校明确要求，再处理用户自定义要求
- 不对未规定区域做“全局统一美化”
- 图、代码、架构、流程都必须基于真实材料
- 没做 PDF 逐页复核时，不应直接说“格式已全部完成”

## 仓库结构

```text
.
├── agents/
├── SKILL.md
├── scripts/
├── references/
├── examples/
├── README.md
├── README_EN.md
└── LICENSE
```

## 关键文件

- `SKILL.md`：主说明
- `agents/openai.yaml`：界面集成元数据
- `scripts/check_word_com.ps1`：检查 Word COM/DOM
- `scripts/audit_docx_ooxml.py`：审计 DOCX / OOXML 隐藏问题
- `scripts/normalize_word_styles.ps1`：批量样式归一化
- `scripts/export_word_pdf.ps1`：导出 PDF 做逐页审计
- `scripts/render_mermaid_figure.ps1`：渲染 Mermaid 图
- `references/paper-format-workflow.md`：论文格式工作流
- `references/failure-patterns-and-quality-gates.md`：高风险坑与质量门槛
- `references/script-usage.md`：脚本使用说明

## 安装

```powershell
git clone https://github.com/the-shy123456/thesis-docx.git
```

保持仓库目录完整即可，不需要拆文件。

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=the-shy123456/thesis-docx&type=Date)](https://www.star-history.com/#the-shy123456/thesis-docx&Date)

## License

MIT
## 社区

- [LINUX DO 社区](https://linux.do)

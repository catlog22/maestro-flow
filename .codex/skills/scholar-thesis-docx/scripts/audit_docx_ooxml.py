from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from lxml import etree


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


HEADING_STYLE_IDS = {"2", "3", "4"}


def cm_from_twips(raw: str | None) -> float | None:
    if raw is None:
        return None
    return round(int(raw) / 567.0, 3)


def pt_from_half_points(raw: str | None) -> float | None:
    if raw is None:
        return None
    return round(int(raw) / 2.0, 3)


def get_rel_targets(zf: ZipFile) -> dict[str, str]:
    rels = etree.fromstring(zf.read("word/_rels/document.xml.rels"))
    return {rel.get("Id"): rel.get("Target", "") for rel in rels}


def load_styles(zf: ZipFile) -> dict[str, dict]:
    styles_root = etree.fromstring(zf.read("word/styles.xml"))
    styles: dict[str, dict] = {}
    for node in styles_root.xpath("//w:style[@w:type='paragraph']", namespaces=NS):
        style_id = node.get(f"{{{NS['w']}}}styleId", "")
        name = node.xpath("string(w:name/@w:val)", namespaces=NS)
        based_on = node.xpath("string(w:basedOn/@w:val)", namespaces=NS) or None
        ppr = node.find("w:pPr", namespaces=NS)
        rpr = node.find("w:rPr", namespaces=NS)
        ind = ppr.find("w:ind", namespaces=NS) if ppr is not None else None
        spacing = ppr.find("w:spacing", namespaces=NS) if ppr is not None else None
        styles[style_id] = {
            "style_id": style_id,
            "name": name,
            "based_on": based_on,
            "first_line": ind.get(f"{{{NS['w']}}}firstLine") if ind is not None else None,
            "first_line_chars": ind.get(f"{{{NS['w']}}}firstLineChars") if ind is not None else None,
            "left": ind.get(f"{{{NS['w']}}}left") if ind is not None else None,
            "right": ind.get(f"{{{NS['w']}}}right") if ind is not None else None,
            "space_before": spacing.get(f"{{{NS['w']}}}before") if spacing is not None else None,
            "space_after": spacing.get(f"{{{NS['w']}}}after") if spacing is not None else None,
            "line": spacing.get(f"{{{NS['w']}}}line") if spacing is not None else None,
            "line_rule": spacing.get(f"{{{NS['w']}}}lineRule") if spacing is not None else None,
            "font_ascii": (
                rpr.find("w:rFonts", namespaces=NS).get(f"{{{NS['w']}}}ascii")
                if rpr is not None and rpr.find("w:rFonts", namespaces=NS) is not None
                else None
            ),
            "font_east_asia": (
                rpr.find("w:rFonts", namespaces=NS).get(f"{{{NS['w']}}}eastAsia")
                if rpr is not None and rpr.find("w:rFonts", namespaces=NS) is not None
                else None
            ),
            "size_pt": (
                pt_from_half_points(rpr.find("w:sz", namespaces=NS).get(f"{{{NS['w']}}}val"))
                if rpr is not None and rpr.find("w:sz", namespaces=NS) is not None
                else None
            ),
        }
    return styles


def load_numbering(zf: ZipFile) -> dict[str, dict]:
    if "word/numbering.xml" not in zf.namelist():
        return {}
    numbering_root = etree.fromstring(zf.read("word/numbering.xml"))
    abstract_by_id: dict[str, etree._Element] = {}
    for abstract in numbering_root.xpath("//w:abstractNum", namespaces=NS):
        abstract_by_id[abstract.get(f"{{{NS['w']}}}abstractNumId", "")] = abstract

    numbering: dict[str, dict] = {}
    for num in numbering_root.xpath("//w:num", namespaces=NS):
        num_id = num.get(f"{{{NS['w']}}}numId", "")
        abstract_id = num.xpath("string(w:abstractNumId/@w:val)", namespaces=NS)
        abstract = abstract_by_id.get(abstract_id)
        levels = {}
        if abstract is not None:
            for lvl in abstract.xpath("./w:lvl", namespaces=NS):
                ilvl = lvl.get(f"{{{NS['w']}}}ilvl", "")
                ppr = lvl.find("w:pPr", namespaces=NS)
                ind = ppr.find("w:ind", namespaces=NS) if ppr is not None else None
                levels[ilvl] = {
                    "pstyle": lvl.xpath("string(w:pStyle/@w:val)", namespaces=NS) or None,
                    "left": ind.get(f"{{{NS['w']}}}left") if ind is not None else None,
                    "first_line": ind.get(f"{{{NS['w']}}}firstLine") if ind is not None else None,
                    "first_line_chars": ind.get(f"{{{NS['w']}}}firstLineChars") if ind is not None else None,
                    "hanging": ind.get(f"{{{NS['w']}}}hanging") if ind is not None else None,
                }
        numbering[num_id] = {
            "num_id": num_id,
            "abstract_num_id": abstract_id,
            "levels": levels,
        }
    return numbering


def load_sections(zf: ZipFile, rel_targets: dict[str, str]) -> list[dict]:
    document_root = etree.fromstring(zf.read("word/document.xml"))
    sections = []
    for idx, sect in enumerate(document_root.xpath("//w:sectPr", namespaces=NS)):
        pg_sz = sect.find("w:pgSz", namespaces=NS)
        pg_mar = sect.find("w:pgMar", namespaces=NS)
        pg_num = sect.find("w:pgNumType", namespaces=NS)
        sections.append(
            {
                "index": idx,
                "title_pg": sect.find("w:titlePg", namespaces=NS) is not None,
                "page_width_cm": cm_from_twips(pg_sz.get(f"{{{NS['w']}}}w")) if pg_sz is not None else None,
                "page_height_cm": cm_from_twips(pg_sz.get(f"{{{NS['w']}}}h")) if pg_sz is not None else None,
                "top_margin_cm": cm_from_twips(pg_mar.get(f"{{{NS['w']}}}top")) if pg_mar is not None else None,
                "bottom_margin_cm": cm_from_twips(pg_mar.get(f"{{{NS['w']}}}bottom")) if pg_mar is not None else None,
                "left_margin_cm": cm_from_twips(pg_mar.get(f"{{{NS['w']}}}left")) if pg_mar is not None else None,
                "right_margin_cm": cm_from_twips(pg_mar.get(f"{{{NS['w']}}}right")) if pg_mar is not None else None,
                "pg_num_type": dict(pg_num.attrib) if pg_num is not None else None,
                "header_refs": [
                    {
                        "type": ref.get(f"{{{NS['w']}}}type"),
                        "target": rel_targets.get(ref.get(f"{{{NS['r']}}}id"), ""),
                    }
                    for ref in sect.findall("w:headerReference", namespaces=NS)
                ],
                "footer_refs": [
                    {
                        "type": ref.get(f"{{{NS['w']}}}type"),
                        "target": rel_targets.get(ref.get(f"{{{NS['r']}}}id"), ""),
                    }
                    for ref in sect.findall("w:footerReference", namespaces=NS)
                ],
            }
        )
    return sections


def count_ref_result_runs(p_element) -> list[dict]:
    runs = list(p_element.xpath("./w:r", namespaces=NS))
    in_ref = False
    current_instr = None
    result_count = 0
    results = []
    for run in runs:
        instr = "".join(run.xpath(".//w:instrText/text()", namespaces=NS))
        if instr and " REF " in instr:
            current_instr = instr.strip()
        fld = run.find("w:fldChar", namespaces=NS)
        if fld is not None:
            fld_type = fld.get(f"{{{NS['w']}}}fldCharType")
            if fld_type == "separate" and current_instr:
                in_ref = True
                result_count = 0
            elif fld_type == "end" and current_instr:
                results.append(
                    {
                        "instr": current_instr,
                        "result_run_count": result_count,
                    }
                )
                in_ref = False
                current_instr = None
            continue
        if in_ref:
            text_nodes = run.xpath(".//w:t/text()", namespaces=NS)
            if any(t for t in text_nodes):
                result_count += 1
    return results


def load_paragraphs(docx_path: Path, zf: ZipFile) -> list[dict]:
    doc = Document(docx_path)
    document_root = etree.fromstring(zf.read("word/document.xml"))
    xml_paragraphs = document_root.xpath("//w:body/w:p", namespaces=NS)

    results = []
    for idx, para in enumerate(doc.paragraphs):
        if idx >= len(xml_paragraphs):
            break
        pxml = xml_paragraphs[idx]
        ppr = pxml.find("w:pPr", namespaces=NS)
        ind = ppr.find("w:ind", namespaces=NS) if ppr is not None else None
        style_id = pxml.xpath("string(w:pPr/w:pStyle/@w:val)", namespaces=NS) or None
        ref_runs = count_ref_result_runs(pxml)
        results.append(
            {
                "index": idx,
                "text": para.text.strip(),
                "style_name": para.style.name,
                "style_id": style_id,
                "direct_ind": {
                    "left": ind.get(f"{{{NS['w']}}}left") if ind is not None else None,
                    "right": ind.get(f"{{{NS['w']}}}right") if ind is not None else None,
                    "firstLine": ind.get(f"{{{NS['w']}}}firstLine") if ind is not None else None,
                    "firstLineChars": ind.get(f"{{{NS['w']}}}firstLineChars") if ind is not None else None,
                    "hanging": ind.get(f"{{{NS['w']}}}hanging") if ind is not None else None,
                },
                "has_ref_field": bool(ref_runs),
                "ref_field_results": ref_runs,
                "has_drawing": bool(para._p.xpath(".//w:drawing")),
            }
        )
    return results


def build_flags(paragraphs: list[dict], sections: list[dict]) -> dict[str, list]:
    heading_indent_overrides = []
    paragraphs_with_firstlinechars = []
    suspicious_ref_fields = []
    title_pg_sections = []

    for para in paragraphs:
        ind = para["direct_ind"]
        if ind["firstLineChars"] not in (None, "0"):
            paragraphs_with_firstlinechars.append(
                {
                    "index": para["index"],
                    "style_name": para["style_name"],
                    "text": para["text"][:120],
                    "firstLineChars": ind["firstLineChars"],
                }
            )

        if para["style_id"] in HEADING_STYLE_IDS:
            if any(ind[k] not in (None, "0") for k in ("firstLine", "firstLineChars", "hanging")):
                heading_indent_overrides.append(
                    {
                        "index": para["index"],
                        "style_name": para["style_name"],
                        "style_id": para["style_id"],
                        "text": para["text"][:120],
                        "direct_ind": ind,
                    }
                )

        for ref in para["ref_field_results"]:
            if ref["result_run_count"] > 1:
                suspicious_ref_fields.append(
                    {
                        "index": para["index"],
                        "text": para["text"][:120],
                        "instr": ref["instr"],
                        "result_run_count": ref["result_run_count"],
                    }
                )

    for sec in sections:
        if sec["title_pg"]:
            title_pg_sections.append(sec)

    return {
        "heading_indent_overrides": heading_indent_overrides,
        "paragraphs_with_firstLineChars": paragraphs_with_firstlinechars,
        "suspicious_ref_fields": suspicious_ref_fields,
        "title_pg_sections": title_pg_sections,
    }


def build_report(docx_path: Path) -> dict:
    with ZipFile(docx_path) as zf:
        rel_targets = get_rel_targets(zf)
        styles = load_styles(zf)
        numbering = load_numbering(zf)
        sections = load_sections(zf, rel_targets)
        paragraphs = load_paragraphs(docx_path, zf)

    style_counts = Counter(p["style_name"] for p in paragraphs if p["text"])
    flags = build_flags(paragraphs, sections)

    return {
        "input": str(docx_path),
        "summary": {
            "paragraph_count": len(paragraphs),
            "nonempty_style_counts": dict(style_counts),
            "section_count": len(sections),
            "style_count": len(styles),
            "numbering_count": len(numbering),
        },
        "styles": {
            sid: styles[sid]
            for sid in sorted(styles)
            if sid in {"1", "2", "3", "4"} or styles[sid]["name"] in {
                "目录标题",
                "中文摘要标题",
                "英文摘要标题",
                "参考文献",
                "参考文献标题",
                "致谢标题",
            }
        },
        "numbering": numbering,
        "sections": sections,
        "flags": flags,
        "paragraph_samples": [
            p
            for p in paragraphs
            if p["style_id"] in {"2", "3", "4"} or p["text"] in {"目录", "摘  要", "Abstract", "参考文献", "致谢"}
        ],
    }


def build_text_report(report: dict) -> str:
    lines: list[str] = []
    lines.append("DOCX / OOXML Thesis Audit Report")
    lines.append(f"input: {report['input']}")
    lines.append("")

    summary = report["summary"]
    lines.append("Summary")
    lines.append(f"- paragraphs: {summary['paragraph_count']}")
    lines.append(f"- sections: {summary['section_count']}")
    lines.append(f"- paragraph styles: {summary['style_count']}")
    lines.append(f"- numbering definitions: {summary['numbering_count']}")
    lines.append("")

    lines.append("Style Counts")
    for name, count in sorted(summary["nonempty_style_counts"].items()):
        lines.append(f"- {name}: {count}")
    lines.append("")

    flags = report["flags"]

    lines.append("Risk Flags")
    lines.append(f"- heading_indent_overrides: {len(flags['heading_indent_overrides'])}")
    lines.append(f"- paragraphs_with_firstLineChars: {len(flags['paragraphs_with_firstLineChars'])}")
    lines.append(f"- suspicious_ref_fields: {len(flags['suspicious_ref_fields'])}")
    lines.append(f"- title_pg_sections: {len(flags['title_pg_sections'])}")
    lines.append("")

    if flags["heading_indent_overrides"]:
        lines.append("Heading Indent Overrides")
        for row in flags["heading_indent_overrides"][:30]:
            lines.append(
                f"- para {row['index']} | {row['style_name']} | {row['text']} | direct_ind={row['direct_ind']}"
            )
        lines.append("")

    if flags["paragraphs_with_firstLineChars"]:
        lines.append("Paragraphs With firstLineChars")
        for row in flags["paragraphs_with_firstLineChars"][:30]:
            lines.append(
                f"- para {row['index']} | {row['style_name']} | firstLineChars={row['firstLineChars']} | {row['text']}"
            )
        lines.append("")

    if flags["suspicious_ref_fields"]:
        lines.append("Suspicious REF Fields")
        for row in flags["suspicious_ref_fields"][:30]:
            lines.append(
                f"- para {row['index']} | result_run_count={row['result_run_count']} | instr={row['instr']} | {row['text']}"
            )
        lines.append("")

    if flags["title_pg_sections"]:
        lines.append("Sections With titlePg")
        for sec in flags["title_pg_sections"]:
            lines.append(
                f"- section {sec['index']} | page_num={sec['pg_num_type']} | header_refs={sec['header_refs']} | footer_refs={sec['footer_refs']}"
            )
        lines.append("")

    lines.append("Tracked Styles")
    for sid, style in sorted(report["styles"].items()):
        lines.append(
            f"- styleId {sid} | {style['name']} | basedOn={style['based_on']} | firstLine={style['first_line']} | firstLineChars={style['first_line_chars']} | left={style['left']} | right={style['right']}"
        )
    lines.append("")

    lines.append("Section Summary")
    for sec in report["sections"]:
        lines.append(
            f"- section {sec['index']} | titlePg={sec['title_pg']} | margins(cm)={sec['top_margin_cm']},{sec['right_margin_cm']},{sec['bottom_margin_cm']},{sec['left_margin_cm']} | pageNum={sec['pg_num_type']}"
        )
    lines.append("")

    lines.append("Paragraph Samples")
    for row in report["paragraph_samples"][:60]:
        lines.append(
            f"- para {row['index']} | style={row['style_name']}({row['style_id']}) | direct_ind={row['direct_ind']} | text={row['text']}"
        )

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit a thesis DOCX for hidden OOXML formatting pitfalls.")
    parser.add_argument("input_path", type=Path, help="Path to the DOCX file.")
    parser.add_argument(
        "--output_json",
        type=Path,
        default=None,
        help="Optional path for the JSON report. Defaults next to the input as <name>.audit.json",
    )
    parser.add_argument(
        "--output_txt",
        type=Path,
        default=None,
        help="Optional path for a human-readable text report. Defaults next to the input as <name>.audit.txt",
    )
    args = parser.parse_args()

    input_path = args.input_path.resolve()
    output_json = args.output_json or input_path.with_suffix(".audit.json")
    output_txt = args.output_txt or input_path.with_suffix(".audit.txt")

    report = build_report(input_path)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    output_txt.write_text(build_text_report(report), encoding="utf-8")
    print(output_json)
    print(output_txt)


if __name__ == "__main__":
    main()

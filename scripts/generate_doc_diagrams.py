from __future__ import annotations

import copy
import html
import math
import re
import textwrap
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DOCX = ROOT / "软件填写内容_润色审核版.docx"
OUT_DIR = ROOT / "output" / "doc" / "软件填写内容_图稿"
SVG_DIR = OUT_DIR / "svg"
VDX_DIR = OUT_DIR / "visio_vdx"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XML = "http://www.w3.org/XML/1998/namespace"

for prefix, uri in [
    ("w", W),
    ("r", R),
    ("wp", WP),
    ("a", A),
    ("pic", PIC),
    ("rel", REL),
    ("ct", CT),
]:
    ET.register_namespace(prefix, uri)


def q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


DIAGRAMS = [
    {
        "key": "system_boundary",
        "title": "系统边界图",
        "type": "columns",
        "nodes": ["Web 控制端", "后端 API 服务", "Fluent Worker", "数据存储服务"],
        "edges": [(0, 1, "REST/JSON"), (1, 2, "调度/进度"), (2, 3, "结果文件"), (1, 3, "任务/配置")],
        "note": "边界清晰：交互、调度、计算、存储分层。",
    },
    {
        "key": "user_roles",
        "title": "用户角色用例图",
        "type": "hub",
        "center": "软件系统",
        "nodes": ["救援指挥人员", "地质勘探人员", "系统管理员", "任务/结果查看", "模型/参数配置", "节点/系统维护"],
        "edges": [(0, 3, ""), (1, 4, ""), (2, 5, ""), (3, 6, ""), (4, 6, ""), (5, 6, "")],
        "note": "三类角色围绕任务、模型、结果和运维形成职责划分。",
    },
    {
        "key": "scenarios",
        "title": "应用场景图",
        "type": "three_flow",
        "nodes": ["灾后救援", "地质勘探", "训练演练"],
        "children": [
            ["倒塌空间", "气味/温度扩散", "救援方案"],
            ["地下空间", "结构与环境分析", "可行性评估"],
            ["模拟掩埋", "参数复盘", "方案优化"],
        ],
    },
    {
        "key": "function_modules",
        "title": "功能模块图",
        "type": "grid",
        "nodes": ["模型管理", "任务管理", "参数配置", "数据可视化", "时间轴控制", "色带管理", "监测点管理", "Worker 管理"],
        "note": "核心功能围绕仿真任务全流程组织。",
    },
    {
        "key": "performance",
        "title": "性能指标图",
        "type": "metrics",
        "nodes": ["首屏加载 <=3s", "常规 API <=2s", "多用户访问", "多 Worker 并发", "百万级网格", "多核并行求解"],
        "note": "具体数值需以测试报告和部署配置为准。",
    },
    {
        "key": "data_flow",
        "title": "数据流图",
        "type": "flow",
        "nodes": ["模型文件", "仿真任务", "Fluent 结果", "后处理数据", "Web 可视化", "日志/监控"],
        "edges": [(0, 1, "选择/上传"), (1, 2, "计算"), (2, 3, "提取/转换"), (3, 4, "加载展示"), (1, 5, "状态记录")],
    },
    {
        "key": "api_interfaces",
        "title": "API 接口图",
        "type": "grid",
        "nodes": ["Worker API", "Task API", "Model API", "ColorMap API", "PostProcessing API", "Health API", "CSV/Volume API"],
        "note": "接口数量以最终 OpenAPI 或接口清单为准。",
    },
    {
        "key": "security",
        "title": "安全架构图",
        "type": "layers",
        "nodes": ["HTTPS 传输加密", "Bearer Token 认证", "角色权限控制", "输入与文件校验", "审计日志追踪"],
    },
    {
        "key": "reliability",
        "title": "可靠性设计图",
        "type": "flow",
        "nodes": ["心跳检测", "状态监控", "异常识别", "任务恢复/重试", "数据备份", "用户提示"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (2, 5, "")],
    },
    {
        "key": "runtime_env",
        "title": "部署环境图",
        "type": "columns",
        "nodes": ["现代浏览器", "前端静态资源", "API 服务环境", "Fluent Worker 服务器", "数据库/文件存储"],
        "edges": [(0, 1, "访问"), (1, 2, "请求"), (2, 3, "调度"), (3, 4, "读写")],
    },
    {
        "key": "acceptance",
        "title": "验收测试流程图",
        "type": "flow",
        "nodes": ["功能验证", "接口测试", "可视化核验", "代码评审", "测试覆盖检查", "验收结论"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (4, 5, "")],
    },
    {
        "key": "design_overview",
        "title": "总体设计思路图",
        "type": "flow",
        "nodes": ["需求分析", "架构设计", "模块划分", "接口设计", "实现与测试", "交付验收"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (4, 5, "")],
    },
    {
        "key": "bs_architecture",
        "title": "B/S 架构图",
        "type": "columns",
        "nodes": ["浏览器", "Web 单页应用", "RESTful API", "Fluent Worker", "数据存储"],
        "edges": [(0, 1, "加载"), (1, 2, "请求"), (2, 3, "调度"), (3, 4, "结果")],
    },
    {
        "key": "frontend_stack",
        "title": "前端技术栈图",
        "type": "hub",
        "center": "Vue 3 SPA",
        "nodes": ["Vite 7", "Pinia 3", "Element Plus", "ECharts", "Three.js", "VTK.js", "Axios"],
    },
    {
        "key": "backend_stack",
        "title": "后端技术栈图",
        "type": "hub",
        "center": "API 服务",
        "nodes": ["任务调度", "Worker 管理", "数据库/文件存储", "Ansys Fluent", "HTTP/HTTPS", "JSON"],
    },
    {
        "key": "components",
        "title": "组件关系图",
        "type": "layers",
        "nodes": ["HomeView 主界面", "业务组件", "组合式函数", "Pinia Store", "API 模块", "工具函数"],
    },
    {
        "key": "state_flow",
        "title": "数据流设计图",
        "type": "flow",
        "nodes": ["用户操作", "组件事件", "API 请求", "Store/状态", "响应式更新", "界面展示"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (4, 5, "")],
    },
    {
        "key": "visualization_layers",
        "title": "可视化分层架构图",
        "type": "layers",
        "nodes": ["Fluent 结果提取层", "格式转换与压缩层", "时间步数据组织层", "Web 渲染展示层", "色带/时间轴交互层"],
    },
    {
        "key": "worker_schedule",
        "title": "Worker 调度算法流程图",
        "type": "flow",
        "nodes": ["接收任务", "读取 Worker 状态", "资源评分", "选择节点", "启动仿真", "监控/故障处理"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (4, 5, "")],
    },
    {
        "key": "principle",
        "title": "系统工作原理图",
        "type": "columns",
        "nodes": ["用户配置任务", "API 服务调度", "Worker 调用 Fluent", "生成后处理数据", "Web 展示结果"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, "")],
    },
    {
        "key": "frontend_framework",
        "title": "前端框架图",
        "type": "layers",
        "nodes": ["视图层", "组件层", "API 层", "状态层", "工具层", "组合式函数"],
    },
    {
        "key": "backend_modules",
        "title": "后端服务模块图",
        "type": "grid",
        "nodes": ["Worker 管理", "任务调度", "模型管理", "后处理服务", "色带管理", "健康检查", "CSV/Volume 转换"],
    },
    {
        "key": "worker_modules",
        "title": "Fluent Worker 模块图",
        "type": "grid",
        "nodes": ["任务执行引擎", "资源监控模块", "心跳维护模块", "后处理生成模块", "文件管理模块"],
    },
    {
        "key": "business_sequence",
        "title": "业务流程时序图",
        "type": "flow",
        "nodes": ["创建任务", "选择/上传模型", "配置参数", "分配 Worker", "Fluent 仿真", "结果展示"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (3, 4, ""), (4, 5, "")],
    },
    {
        "key": "deployment_architecture",
        "title": "部署架构图",
        "type": "columns",
        "nodes": ["Web/CDN", "负载均衡", "API 服务实例", "Worker 集群", "数据库/文件存储"],
        "edges": [(0, 1, ""), (1, 2, ""), (2, 3, ""), (2, 4, ""), (3, 4, "")],
    },
]


def wrap_label(text: str, max_chars: int = 9) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks = []
    line = ""
    for ch in text:
        line += ch
        if len(line) >= max_chars:
            chunks.append(line)
            line = ""
    if line:
        chunks.append(line)
    return chunks[:3]


def svg_text(x: float, y: float, text: str, size: int = 24, color: str = "#1f2937", weight: str = "500", anchor: str = "middle") -> str:
    lines = wrap_label(text, 10)
    total = (len(lines) - 1) * (size + 4)
    parts = [f'<text x="{x:.1f}" y="{y - total / 2:.1f}" text-anchor="{anchor}" font-family="Microsoft YaHei, Segoe UI, Arial" font-size="{size}" font-weight="{weight}" fill="{color}">']
    for i, line in enumerate(lines):
        dy = 0 if i == 0 else size + 4
        parts.append(f'<tspan x="{x:.1f}" dy="{dy}">{html.escape(line)}</tspan>')
    parts.append("</text>")
    return "".join(parts)


def rect(x, y, w, h, label, fill="#eaf5ff", stroke="#2563eb", size=22):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
        + svg_text(x + w / 2, y + h / 2 + 8, label, size=size)
    )


def arrow(x1, y1, x2, y2, label=""):
    midx = (x1 + x2) / 2
    midy = (y1 + y2) / 2
    text = svg_text(midx, midy - 12, label, 16, "#475569", "400") if label else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#64748b" stroke-width="2.5" marker-end="url(#arrow)"/>{text}'


def base_svg(title: str, body: str, note: str = "") -> str:
    note_svg = svg_text(500, 500, note, 17, "#64748b", "400") if note else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="540" viewBox="0 0 1000 540">
<defs>
  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
  </marker>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#0f172a" flood-opacity="0.14"/>
  </filter>
</defs>
<rect width="1000" height="540" fill="#f8fafc"/>
<rect x="24" y="22" width="952" height="496" rx="24" fill="#ffffff" stroke="#dbeafe"/>
{svg_text(500, 68, title, 30, "#0f172a", "700")}
<g filter="url(#shadow)">
{body}
</g>
{note_svg}
</svg>'''


def render_diagram(diagram: dict) -> tuple[str, list[tuple[float, float, float, float, str]]]:
    title = diagram["title"]
    t = diagram["type"]
    shapes = []
    body = []
    nodes = diagram.get("nodes", [])

    if t == "columns":
        n = len(nodes)
        w = min(150, 780 / n)
        gap = (860 - n * w) / max(1, n - 1)
        y = 230
        for i, label in enumerate(nodes):
            x = 70 + i * (w + gap)
            body.append(rect(x, y, w, 86, label))
            shapes.append((x, y, w, 86, label))
        for i, j, label in diagram.get("edges", []):
            x1, y1, w1, h1, _ = shapes[i]
            x2, y2, _, h2, _ = shapes[j]
            body.append(arrow(x1 + w1, y1 + h1 / 2, x2, y2 + h2 / 2, label))
    elif t == "flow":
        n = len(nodes)
        w = 132 if n >= 6 else 148
        gap = (850 - n * w) / max(1, n - 1)
        y = 230
        for i, label in enumerate(nodes):
            x = 75 + i * (w + gap)
            body.append(rect(x, y, w, 86, label, "#ecfeff", "#0891b2", 20))
            shapes.append((x, y, w, 86, label))
        for i, j, label in diagram.get("edges", []):
            x1, y1, w1, h1, _ = shapes[i]
            x2, y2, _, h2, _ = shapes[j]
            body.append(arrow(x1 + w1, y1 + h1 / 2, x2, y2 + h2 / 2, label))
    elif t == "grid":
        cols = 4 if len(nodes) > 6 else 3
        w, h = 185, 78
        start_x = (1000 - (cols * w + (cols - 1) * 28)) / 2
        start_y = 160
        for i, label in enumerate(nodes):
            row, col = divmod(i, cols)
            x = start_x + col * (w + 28)
            y = start_y + row * (h + 30)
            body.append(rect(x, y, w, h, label, "#f0fdf4", "#16a34a", 21))
            shapes.append((x, y, w, h, label))
    elif t == "metrics":
        for i, label in enumerate(nodes):
            angle = -math.pi / 2 + i * (2 * math.pi / len(nodes))
            cx = 500 + 290 * math.cos(angle)
            cy = 290 + 150 * math.sin(angle)
            body.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="66" fill="#fff7ed" stroke="#ea580c" stroke-width="2"/>')
            body.append(svg_text(cx, cy + 8, label, 19, "#7c2d12", "600"))
            shapes.append((cx - 66, cy - 66, 132, 132, label))
        body.append(f'<circle cx="500" cy="290" r="72" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>')
        body.append(svg_text(500, 298, "性能目标", 24, "#1e3a8a", "700"))
    elif t == "layers":
        w, h = 640, 56
        for i, label in enumerate(nodes):
            x = 180
            y = 132 + i * 62
            fill = ["#eff6ff", "#ecfeff", "#f0fdf4", "#fff7ed", "#fef2f2", "#f5f3ff"][i % 6]
            stroke = ["#2563eb", "#0891b2", "#16a34a", "#ea580c", "#dc2626", "#7c3aed"][i % 6]
            body.append(rect(x, y, w, h, label, fill, stroke, 21))
            shapes.append((x, y, w, h, label))
            if i > 0:
                body.append(arrow(500, y - 6, 500, y, ""))
    elif t == "hub":
        center = diagram.get("center", "系统")
        body.append(f'<circle cx="500" cy="285" r="86" fill="#eef2ff" stroke="#4f46e5" stroke-width="2.5"/>')
        body.append(svg_text(500, 294, center, 23, "#312e81", "700"))
        cshape = (414, 199, 172, 172, center)
        shapes.append(cshape)
        n = len(nodes)
        for i, label in enumerate(nodes):
            angle = -math.pi / 2 + i * (2 * math.pi / n)
            cx = 500 + 300 * math.cos(angle)
            cy = 285 + 170 * math.sin(angle)
            x, y, w, h = cx - 75, cy - 39, 150, 78
            body.append(arrow(cx, cy, 500 + 86 * math.cos(angle), 285 + 86 * math.sin(angle), ""))
            body.append(rect(x, y, w, h, label, "#f8fafc", "#64748b", 19))
            shapes.append((x, y, w, h, label))
    elif t == "three_flow":
        x_positions = [125, 425, 725]
        for i, label in enumerate(nodes):
            x = x_positions[i]
            body.append(rect(x, 130, 150, 70, label, "#eef2ff", "#4f46e5", 21))
            shapes.append((x, 130, 150, 70, label))
            yy = 245
            last_center = (x + 75, 200)
            for child in diagram["children"][i]:
                body.append(rect(x - 15, yy, 180, 58, child, "#f8fafc", "#64748b", 18))
                body.append(arrow(last_center[0], last_center[1] + 8, x + 75, yy, ""))
                shapes.append((x - 15, yy, 180, 58, child))
                last_center = (x + 75, yy + 58)
                yy += 82
    else:
        raise ValueError(f"Unknown diagram type {t}")

    return base_svg(title, "\n".join(body), diagram.get("note", "")), shapes


def render_vdx(diagram: dict, shapes: list[tuple[float, float, float, float, str]]) -> str:
    def inch(v: float) -> float:
        return v / 100.0

    shape_xml = []
    for sid, (x, y, w, h, label) in enumerate(shapes, 1):
        # VDX coordinates use bottom-left origin. This simple source is intended as an editable Visio XML draft.
        pin_x = inch(x + w / 2)
        pin_y = inch(540 - (y + h / 2))
        shape_xml.append(
            f'''<Shape ID="{sid}" NameU="Process.{sid}" Type="Shape">
  <XForm>
    <PinX>{pin_x:.3f}</PinX><PinY>{pin_y:.3f}</PinY>
    <Width>{inch(w):.3f}</Width><Height>{inch(h):.3f}</Height>
    <LocPinX>{inch(w)/2:.3f}</LocPinX><LocPinY>{inch(h)/2:.3f}</LocPinY>
  </XForm>
  <Text>{html.escape(label)}</Text>
</Shape>'''
        )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core">
  <DocumentProperties>
    <Title>{html.escape(diagram["title"])}</Title>
  </DocumentProperties>
  <Pages>
    <Page ID="1" NameU="Page-1" Name="{html.escape(diagram["title"])}">
      <PageSheet>
        <PageProps><PageWidth>10</PageWidth><PageHeight>5.4</PageHeight></PageProps>
      </PageSheet>
      <Shapes>
        {"".join(shape_xml)}
      </Shapes>
    </Page>
  </Pages>
</VisioDocument>
'''


def ensure_svg_content_type(root: ET.Element) -> None:
    for child in root.findall(q(CT, "Default")):
        if child.attrib.get("Extension") == "svg":
            child.set("ContentType", "image/svg+xml")
            return
    default = ET.Element(q(CT, "Default"), {"Extension": "svg", "ContentType": "image/svg+xml"})
    root.insert(0, default)


def paragraph_text(p: ET.Element) -> str:
    return "".join(t.text or "" for t in p.findall(".//" + q(W, "t")))


def clear_paragraph(p: ET.Element) -> ET.Element | None:
    ppr = p.find(q(W, "pPr"))
    for child in list(p):
        if child is not ppr:
            p.remove(child)
    return ppr


def make_text_paragraph(template: ET.Element, text: str, center: bool = False) -> ET.Element:
    p = copy.deepcopy(template)
    ppr = clear_paragraph(p)
    if center:
        if ppr is None:
            ppr = ET.Element(q(W, "pPr"))
            p.insert(0, ppr)
        jc = ppr.find(q(W, "jc"))
        if jc is None:
            jc = ET.SubElement(ppr, q(W, "jc"))
        jc.set(q(W, "val"), "center")
    r = ET.SubElement(p, q(W, "r"))
    rpr = ET.SubElement(r, q(W, "rPr"))
    b = ET.SubElement(rpr, q(W, "b"))
    color = ET.SubElement(rpr, q(W, "color"))
    color.set(q(W, "val"), "475569")
    t = ET.SubElement(r, q(W, "t"))
    t.set(f"{{{XML}}}space", "preserve")
    t.text = text
    return p


def make_drawing_paragraph(template: ET.Element, rid: str, name: str, doc_pr_id: int) -> ET.Element:
    p = copy.deepcopy(template)
    ppr = clear_paragraph(p)
    if ppr is None:
        ppr = ET.Element(q(W, "pPr"))
        p.insert(0, ppr)
    jc = ppr.find(q(W, "jc"))
    if jc is None:
        jc = ET.SubElement(ppr, q(W, "jc"))
    jc.set(q(W, "val"), "center")

    width = 5943600
    height = 3200400
    r = ET.SubElement(p, q(W, "r"))
    drawing = ET.SubElement(r, q(W, "drawing"))
    inline = ET.SubElement(drawing, q(WP, "inline"))
    ET.SubElement(inline, q(WP, "extent"), {"cx": str(width), "cy": str(height)})
    ET.SubElement(inline, q(WP, "docPr"), {"id": str(doc_pr_id), "name": name})
    cnv = ET.SubElement(inline, q(WP, "cNvGraphicFramePr"))
    ET.SubElement(cnv, q(A, "graphicFrameLocks"), {"noChangeAspect": "1"})
    graphic = ET.SubElement(inline, q(A, "graphic"))
    graphic_data = ET.SubElement(graphic, q(A, "graphicData"), {"uri": "http://schemas.openxmlformats.org/drawingml/2006/picture"})
    pic = ET.SubElement(graphic_data, q(PIC, "pic"))
    nv = ET.SubElement(pic, q(PIC, "nvPicPr"))
    ET.SubElement(nv, q(PIC, "cNvPr"), {"id": "0", "name": name})
    ET.SubElement(nv, q(PIC, "cNvPicPr"))
    blip_fill = ET.SubElement(pic, q(PIC, "blipFill"))
    ET.SubElement(blip_fill, q(A, "blip"), {q(R, "embed"): rid})
    stretch = ET.SubElement(blip_fill, q(A, "stretch"))
    ET.SubElement(stretch, q(A, "fillRect"))
    sp_pr = ET.SubElement(pic, q(PIC, "spPr"))
    xfrm = ET.SubElement(sp_pr, q(A, "xfrm"))
    ET.SubElement(xfrm, q(A, "off"), {"x": "0", "y": "0"})
    ET.SubElement(xfrm, q(A, "ext"), {"cx": str(width), "cy": str(height)})
    ET.SubElement(sp_pr, q(A, "prstGeom"), {"prst": "rect"})
    return p


def next_rid(rels_root: ET.Element) -> int:
    nums = []
    for rel in rels_root.findall(q(REL, "Relationship")):
        rid = rel.attrib.get("Id", "")
        if rid.startswith("rId") and rid[3:].isdigit():
            nums.append(int(rid[3:]))
    return max(nums, default=0) + 1


def insert_svg_diagrams(svg_files: list[Path]) -> None:
    tmp = DOCX.with_suffix(".tmp.docx")
    with zipfile.ZipFile(DOCX, "r") as zin:
        doc_root = ET.fromstring(zin.read("word/document.xml"))
        rels_root = ET.fromstring(zin.read("word/_rels/document.xml.rels"))
        ct_root = ET.fromstring(zin.read("[Content_Types].xml"))
        ensure_svg_content_type(ct_root)

        body = doc_root.find(q(W, "body"))
        paragraphs = list(body)
        template = next((p for p in paragraphs if p.tag == q(W, "p")), None)
        if template is None:
            raise RuntimeError("document has no paragraph template")

        rid_start = next_rid(rels_root)
        rids = []
        for i, svg_file in enumerate(svg_files):
            rid = f"rId{rid_start + i}"
            rids.append(rid)
            ET.SubElement(
                rels_root,
                q(REL, "Relationship"),
                {
                    "Id": rid,
                    "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
                    "Target": f"media/{svg_file.name}",
                },
            )

        svg_index = 0
        new_children = []
        for child in list(body):
            if child.tag == q(W, "p") and paragraph_text(child).startswith("【待补图："):
                diagram = DIAGRAMS[svg_index]
                drawing_p = make_drawing_paragraph(template, rids[svg_index], f"{svg_index + 1:02d}_{diagram['key']}.svg", 1000 + svg_index)
                caption_p = make_text_paragraph(template, f"图 {svg_index + 1} {diagram['title']}", center=True)
                new_children.extend([drawing_p, caption_p])
                svg_index += 1
            else:
                new_children.append(child)

        if svg_index != len(svg_files):
            raise RuntimeError(f"matched {svg_index} placeholders, expected {len(svg_files)}")

        for child in list(body):
            body.remove(child)
        for child in new_children:
            body.append(child)

        new_doc = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
        new_rels = ET.tostring(rels_root, encoding="utf-8", xml_declaration=True)
        new_ct = ET.tostring(ct_root, encoding="utf-8", xml_declaration=True)

        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = new_doc
                elif item.filename == "word/_rels/document.xml.rels":
                    data = new_rels
                elif item.filename == "[Content_Types].xml":
                    data = new_ct
                zout.writestr(item, data)
            for svg_file in svg_files:
                zout.writestr(f"word/media/{svg_file.name}", svg_file.read_bytes())
    tmp.replace(DOCX)


def main() -> None:
    SVG_DIR.mkdir(parents=True, exist_ok=True)
    VDX_DIR.mkdir(parents=True, exist_ok=True)
    svg_files = []
    index_lines = ["# 图稿索引", ""]
    for i, diagram in enumerate(DIAGRAMS, 1):
        svg, shapes = render_diagram(diagram)
        svg_file = SVG_DIR / f"{i:02d}_{diagram['key']}.svg"
        vdx_file = VDX_DIR / f"{i:02d}_{diagram['key']}.vdx"
        svg_file.write_text(svg, encoding="utf-8")
        vdx_file.write_text(render_vdx(diagram, shapes), encoding="utf-8")
        svg_files.append(svg_file)
        index_lines.append(f"{i}. {diagram['title']} - `svg/{svg_file.name}` - `visio_vdx/{vdx_file.name}`")

    (OUT_DIR / "图稿索引.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    insert_svg_diagrams(svg_files)
    print(f"generated {len(svg_files)} svg diagrams")
    print(f"updated {DOCX}")
    print(f"sources {OUT_DIR}")


if __name__ == "__main__":
    main()
